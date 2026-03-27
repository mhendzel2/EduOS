from __future__ import annotations

import asyncio
import base64
import json
import logging
import mimetypes
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy.orm import Session

from config import settings
from database_models import ArtifactRecord
from services.orchestration import persist_artifact
from storage.document_store import DocumentStore

logger = logging.getLogger(__name__)

MAX_INLINE_IMAGE_ATTACHMENTS = 4
MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024
MAX_INLINE_VIDEO_DOCUMENTS = 2
MAX_TRANSCRIPT_DOCUMENTS = 2
MAX_TRANSCRIPT_CHARS_PER_DOCUMENT = 2400
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v", ".avi"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac"}
FRAME_MANIFEST_ARTIFACT_TYPE = "multimodal_frame_manifest"
TRANSCRIPT_CACHE_ARTIFACT_TYPE = "multimodal_transcript_cache"
MULTIMODAL_CACHE_VERSION = 1


def _configured_secret(value: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return ""
    lowered = cleaned.lower()
    if any(token in lowered for token in ("your_", "example", "replace", "changeme", "here")):
        return ""
    return cleaned


def _document_is_image(document: dict[str, Any]) -> bool:
    kind = str(document.get("kind") or "").strip().lower()
    if kind == "image":
        return True
    content_type = str(document.get("content_type") or "").strip().lower()
    if content_type.startswith("image/"):
        return True
    suffix = Path(str(document.get("filename") or "")).suffix.lower()
    return suffix in IMAGE_EXTENSIONS


def _document_is_video(document: dict[str, Any]) -> bool:
    kind = str(document.get("kind") or "").strip().lower()
    if kind == "video":
        return True
    content_type = str(document.get("content_type") or "").strip().lower()
    if content_type.startswith("video/"):
        return True
    suffix = Path(str(document.get("filename") or "")).suffix.lower()
    return suffix in VIDEO_EXTENSIONS


def _document_is_audio(document: dict[str, Any]) -> bool:
    kind = str(document.get("kind") or "").strip().lower()
    if kind == "audio":
        return True
    content_type = str(document.get("content_type") or "").strip().lower()
    if content_type.startswith("audio/"):
        return True
    suffix = Path(str(document.get("filename") or "")).suffix.lower()
    return suffix in AUDIO_EXTENSIONS


def _guess_image_mime_type(document: dict[str, Any]) -> str:
    content_type = str(document.get("content_type") or "").strip().lower()
    if content_type.startswith("image/"):
        return content_type
    path = Path(str(document.get("path") or ""))
    return mimetypes.guess_type(path.name)[0] or "image/png"


def _encode_bytes_to_data_url(content_bytes: bytes, mime_type: str) -> str:
    encoded = base64.b64encode(content_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _encode_file_to_data_url(path: Path, mime_type: str) -> str:
    return _encode_bytes_to_data_url(path.read_bytes(), mime_type)


def _document_fingerprint(document: dict[str, Any]) -> dict[str, Any] | None:
    path = Path(str(document.get("path") or ""))
    if not path.is_file():
        return None
    stat = path.stat()
    return {
        "path": str(path.resolve()),
        "size": int(document.get("size") or stat.st_size),
        "mtime_ns": int(getattr(stat, "st_mtime_ns", int(stat.st_mtime * 1_000_000_000))),
        "content_type": str(document.get("content_type") or "").strip().lower(),
    }


def _cache_matches_document(
    document: dict[str, Any],
    cached_fingerprint: dict[str, Any] | None,
) -> bool:
    if not cached_fingerprint:
        return False
    current_fingerprint = _document_fingerprint(document)
    if current_fingerprint is None:
        return False
    return current_fingerprint == cached_fingerprint


def _safe_json_loads(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _find_latest_cached_artifact(
    db: Session,
    *,
    project_id: str,
    artifact_type: str,
    source_document_id: str,
) -> ArtifactRecord | None:
    candidates = (
        db.query(ArtifactRecord)
        .filter(
            ArtifactRecord.project_id == project_id,
            ArtifactRecord.artifact_type == artifact_type,
        )
        .order_by(ArtifactRecord.created_at.desc())
        .limit(50)
        .all()
    )
    for artifact in candidates:
        metadata = artifact.metadata_ or {}
        if str(metadata.get("source_document_id") or "").strip() == source_document_id:
            return artifact
    return None


def _load_cached_frame_attachments(
    document: dict[str, Any],
    *,
    artifact: ArtifactRecord | None,
    sample_count: int,
    window_seconds: int,
) -> list[dict[str, Any]]:
    if artifact is None:
        return []
    payload = _safe_json_loads(artifact.content)
    if not payload:
        return []
    if int(payload.get("cache_version") or 0) != MULTIMODAL_CACHE_VERSION:
        return []
    if int(payload.get("sample_count") or 0) != sample_count:
        return []
    if int(payload.get("window_seconds") or 0) != window_seconds:
        return []
    if not _cache_matches_document(document, payload.get("source_fingerprint")):
        return []

    attachments: list[dict[str, Any]] = []
    source_filename = str(payload.get("source_filename") or document.get("filename") or "")
    for frame in payload.get("frames") or []:
        mime_type = str(frame.get("mime_type") or "image/jpeg")
        label = str(frame.get("label") or frame.get("filename") or "").strip()
        data_url = str(frame.get("data_url") or "").strip()
        if not data_url:
            return []
        attachments.append(
            {
                "document_id": str(document.get("id") or ""),
                "filename": label or str(frame.get("filename") or ""),
                "source_filename": source_filename or str(frame.get("filename") or ""),
                "source_kind": "video_frame",
                "mime_type": mime_type,
                "size": int(frame.get("size") or 0),
                "part": {
                    "type": "image_url",
                    "image_url": {
                        "url": data_url,
                    },
                },
            }
        )
    return attachments


def _load_cached_transcript_entry(
    document: dict[str, Any],
    *,
    artifact: ArtifactRecord | None,
    transcription_model: str,
    max_seconds: int,
) -> dict[str, Any] | None:
    if artifact is None:
        return None
    payload = _safe_json_loads(artifact.content)
    if not payload:
        return None
    if int(payload.get("cache_version") or 0) != MULTIMODAL_CACHE_VERSION:
        return None
    if str(payload.get("transcription_model") or "").strip() != transcription_model:
        return None
    if int(payload.get("max_seconds") or 0) != max_seconds:
        return None
    if not _cache_matches_document(document, payload.get("source_fingerprint")):
        return None

    text = " ".join(str(payload.get("text") or "").split())[:MAX_TRANSCRIPT_CHARS_PER_DOCUMENT].strip()
    if not text:
        return None
    return {
        "document_id": str(document.get("id") or ""),
        "filename": str(payload.get("source_filename") or document.get("filename") or ""),
        "source_kind": str(
            payload.get("source_kind")
            or ("video_transcript" if _document_is_video(document) else "audio_transcript")
        ),
        "text": text,
    }


def build_inline_image_attachments(documents: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    attachments: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for document in documents:
        if not _document_is_image(document):
            continue
        filename = str(document.get("filename") or "")
        if len(attachments) >= MAX_INLINE_IMAGE_ATTACHMENTS:
            skipped.append({"document_id": str(document.get("id") or ""), "filename": filename, "reason": "attachment_limit"})
            continue

        path = Path(str(document.get("path") or ""))
        if not path.is_file():
            skipped.append({"document_id": str(document.get("id") or ""), "filename": filename, "reason": "file_missing"})
            continue

        size = path.stat().st_size
        if size > MAX_INLINE_IMAGE_BYTES:
            skipped.append({"document_id": str(document.get("id") or ""), "filename": filename, "reason": "file_too_large"})
            continue

        mime_type = _guess_image_mime_type(document)
        attachments.append(
            {
                "document_id": str(document.get("id") or ""),
                "filename": filename or path.name,
                "source_filename": filename or path.name,
                "source_kind": "image",
                "mime_type": mime_type,
                "size": size,
                "part": {
                    "type": "image_url",
                    "image_url": {
                        "url": _encode_file_to_data_url(path, mime_type),
                    },
                },
            }
        )

    return {"attachments": attachments, "skipped": skipped}


def _ffmpeg_available() -> bool:
    return bool(shutil.which("ffmpeg"))


def _run_ffmpeg_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )


def _extract_video_frame_payloads_sync(
    document: dict[str, Any],
    *,
    sample_count: int,
    window_seconds: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    filename = str(document.get("filename") or "")
    path = Path(str(document.get("path") or ""))
    if not path.is_file():
        return [], [{"document_id": str(document.get("id") or ""), "filename": filename, "reason": "file_missing"}]
    if not _ffmpeg_available():
        return [], [{"document_id": str(document.get("id") or ""), "filename": filename, "reason": "ffmpeg_unavailable"}]

    payloads: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    frame_count = max(1, sample_count)
    sample_window = max(1, window_seconds)
    interval_seconds = max(1, sample_window // frame_count)

    with tempfile.TemporaryDirectory(prefix="studioos-video-frames-") as temp_dir:
        output_pattern = str(Path(temp_dir) / "frame-%02d.jpg")
        command = [
            "ffmpeg",
            "-y",
            "-i",
            str(path),
            "-t",
            str(sample_window),
            "-vf",
            f"fps=1/{interval_seconds},scale=960:-2",
            "-frames:v",
            str(frame_count),
            output_pattern,
        ]
        process = _run_ffmpeg_command(command)
        if process.returncode != 0:
            skipped.append(
                {
                    "document_id": str(document.get("id") or ""),
                    "filename": filename,
                    "reason": "ffmpeg_failed",
                    "stderr": (process.stderr or "")[:400],
                }
            )
            return [], skipped

        frame_paths = sorted(Path(temp_dir).glob("frame-*.jpg"))
        if not frame_paths:
            skipped.append({"document_id": str(document.get("id") or ""), "filename": filename, "reason": "no_frames"})
            return [], skipped

        for index, frame_path in enumerate(frame_paths, start=1):
            label = f"{filename} frame {index}"
            content_bytes = frame_path.read_bytes()
            payloads.append(
                {
                    "document_id": str(document.get("id") or ""),
                    "filename": label,
                    "source_filename": filename,
                    "source_kind": "video_frame",
                    "mime_type": "image/jpeg",
                    "size": len(content_bytes),
                    "content_bytes": content_bytes,
                    "frame_index": index,
                    "stored_filename": f"{Path(filename).stem or 'video'}-frame-{index:02d}.jpg",
                }
            )

    return payloads, skipped


def _extract_video_frame_attachments_sync(
    document: dict[str, Any],
    *,
    sample_count: int,
    window_seconds: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    frame_payloads, skipped = _extract_video_frame_payloads_sync(
        document,
        sample_count=sample_count,
        window_seconds=window_seconds,
    )
    attachments = [
        {
            "document_id": payload["document_id"],
            "filename": payload["filename"],
            "source_filename": payload["source_filename"],
            "source_kind": payload["source_kind"],
            "mime_type": payload["mime_type"],
            "size": payload["size"],
            "part": {
                "type": "image_url",
                "image_url": {
                    "url": _encode_bytes_to_data_url(payload["content_bytes"], payload["mime_type"]),
                },
            },
        }
        for payload in frame_payloads
    ]
    return attachments, skipped


async def _extract_video_frame_payloads(
    document: dict[str, Any],
    *,
    sample_count: int,
    window_seconds: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await asyncio.to_thread(
        _extract_video_frame_payloads_sync,
        document,
        sample_count=sample_count,
        window_seconds=window_seconds,
    )


async def _extract_video_frame_attachments(
    document: dict[str, Any],
    *,
    sample_count: int,
    window_seconds: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await asyncio.to_thread(
        _extract_video_frame_attachments_sync,
        document,
        sample_count=sample_count,
        window_seconds=window_seconds,
    )


async def _transcribe_audio_with_openai(audio_path: Path, source_filename: str) -> str:
    api_key = _configured_secret(settings.OPENAI_API_KEY)
    if not api_key:
        return ""

    headers = {"Authorization": f"Bearer {api_key}"}
    data = {"model": settings.OPENAI_TRANSCRIPTION_MODEL}
    files = {"file": (audio_path.name, audio_path.read_bytes(), "audio/wav")}

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers=headers,
            data=data,
            files=files,
        )
        response.raise_for_status()
        payload = response.json()
        transcript = str(payload.get("text") or "").strip()
        if not transcript:
            logger.debug("OpenAI transcription returned no text for %s", source_filename)
        return transcript


async def _extract_audio_transcript(document: dict[str, Any]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    filename = str(document.get("filename") or "")
    path = Path(str(document.get("path") or ""))
    if not path.is_file():
        return None, [{"document_id": str(document.get("id") or ""), "filename": filename, "reason": "file_missing"}]
    if not _ffmpeg_available():
        return None, [{"document_id": str(document.get("id") or ""), "filename": filename, "reason": "ffmpeg_unavailable"}]
    if not settings.MULTIMODAL_AUDIO_TRANSCRIPTION_ENABLED:
        return None, [{"document_id": str(document.get("id") or ""), "filename": filename, "reason": "transcription_disabled"}]
    if not _configured_secret(settings.OPENAI_API_KEY):
        return None, [{"document_id": str(document.get("id") or ""), "filename": filename, "reason": "openai_unconfigured"}]

    with tempfile.TemporaryDirectory(prefix="studioos-audio-transcript-") as temp_dir:
        audio_path = Path(temp_dir) / "clip.wav"
        command = [
            "ffmpeg",
            "-y",
            "-i",
            str(path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-t",
            str(max(1, settings.MULTIMODAL_AUDIO_TRANSCRIPTION_MAX_SECONDS)),
            "-c:a",
            "pcm_s16le",
            str(audio_path),
        ]
        process = await asyncio.to_thread(_run_ffmpeg_command, command)
        if process.returncode != 0 or not audio_path.is_file():
            return None, [
                {
                    "document_id": str(document.get("id") or ""),
                    "filename": filename,
                    "reason": "audio_extract_failed",
                    "stderr": (process.stderr or "")[:400],
                }
            ]

        try:
            transcript = await _transcribe_audio_with_openai(audio_path, filename)
        except Exception as exc:
            logger.warning("Audio transcription failed for %s: %s", filename, exc)
            return None, [
                {
                    "document_id": str(document.get("id") or ""),
                    "filename": filename,
                    "reason": "transcription_failed",
                    "error": str(exc),
                }
            ]

    cleaned = " ".join(transcript.split())[:MAX_TRANSCRIPT_CHARS_PER_DOCUMENT].strip()
    if not cleaned:
        return None, [{"document_id": str(document.get("id") or ""), "filename": filename, "reason": "empty_transcript"}]

    source_kind = "video_transcript" if _document_is_video(document) else "audio_transcript"
    return (
        {
            "document_id": str(document.get("id") or ""),
            "filename": filename,
            "source_kind": source_kind,
            "text": cleaned,
        },
        [],
    )


async def _build_video_frame_attachments_with_cache(
    document: dict[str, Any],
    *,
    db: Session | None,
    project_id: str,
    document_store: DocumentStore | None,
    sample_count: int,
    window_seconds: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str | None]:
    source_document_id = str(document.get("id") or "").strip()
    if not source_document_id or db is None:
        attachments, skipped = await _extract_video_frame_attachments(
            document,
            sample_count=sample_count,
            window_seconds=window_seconds,
        )
        return attachments, skipped, None

    cached_artifact = _find_latest_cached_artifact(
        db,
        project_id=project_id,
        artifact_type=FRAME_MANIFEST_ARTIFACT_TYPE,
        source_document_id=source_document_id,
    )
    cached_attachments = _load_cached_frame_attachments(
        document,
        artifact=cached_artifact,
        sample_count=sample_count,
        window_seconds=window_seconds,
    )
    if cached_attachments:
        return cached_attachments, [], "cached"

    frame_payloads, skipped = await _extract_video_frame_payloads(
        document,
        sample_count=sample_count,
        window_seconds=window_seconds,
    )
    if not frame_payloads:
        return [], skipped, None

    manifest_frames: list[dict[str, Any]] = []
    attachments: list[dict[str, Any]] = []
    for payload in frame_payloads:
        data_url = _encode_bytes_to_data_url(payload["content_bytes"], payload["mime_type"])
        manifest_frames.append(
            {
                "index": payload["frame_index"],
                "filename": payload["stored_filename"],
                "label": payload["filename"],
                "size": payload["size"],
                "mime_type": payload["mime_type"],
                "data_url": data_url,
            }
        )
        attachments.append(
            {
                "document_id": payload["document_id"],
                "filename": payload["filename"],
                "source_filename": payload["source_filename"],
                "source_kind": payload["source_kind"],
                "mime_type": payload["mime_type"],
                "size": payload["size"],
                "part": {
                    "type": "image_url",
                    "image_url": {
                        "url": data_url,
                    },
                },
            }
        )

    payload = {
        "cache_version": MULTIMODAL_CACHE_VERSION,
        "source_document_id": source_document_id,
        "source_filename": str(document.get("filename") or ""),
        "source_kind": "video",
        "source_fingerprint": _document_fingerprint(document),
        "sample_count": sample_count,
        "window_seconds": window_seconds,
        "frames": manifest_frames,
    }
    persist_artifact(
        db,
        project_id=project_id,
        artifact_type=FRAME_MANIFEST_ARTIFACT_TYPE,
        content=json.dumps(payload, ensure_ascii=True),
        metadata={
            "cache_version": MULTIMODAL_CACHE_VERSION,
            "cache_kind": "multimodal_frames",
            "source_document_id": source_document_id,
            "source_filename": str(document.get("filename") or ""),
            "sample_count": sample_count,
            "window_seconds": window_seconds,
            "frame_count": len(manifest_frames),
        },
    )
    return attachments, skipped, "generated"


async def _build_audio_transcript_with_cache(
    document: dict[str, Any],
    *,
    db: Session | None,
    project_id: str,
    transcription_model: str,
    max_seconds: int,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]], str | None]:
    filename = str(document.get("filename") or "")
    if not settings.MULTIMODAL_AUDIO_TRANSCRIPTION_ENABLED:
        return None, [{"document_id": str(document.get("id") or ""), "filename": filename, "reason": "transcription_disabled"}], None

    source_document_id = str(document.get("id") or "").strip()
    if source_document_id and db is not None:
        cached_artifact = _find_latest_cached_artifact(
            db,
            project_id=project_id,
            artifact_type=TRANSCRIPT_CACHE_ARTIFACT_TYPE,
            source_document_id=source_document_id,
        )
        cached_transcript = _load_cached_transcript_entry(
            document,
            artifact=cached_artifact,
            transcription_model=transcription_model,
            max_seconds=max_seconds,
        )
        if cached_transcript is not None:
            return cached_transcript, [], "cached"

    transcript_entry, skipped = await _extract_audio_transcript(document)
    if transcript_entry is None or not source_document_id or db is None:
        return transcript_entry, skipped, None

    payload = {
        "cache_version": MULTIMODAL_CACHE_VERSION,
        "source_document_id": source_document_id,
        "source_filename": filename,
        "source_kind": transcript_entry["source_kind"],
        "source_fingerprint": _document_fingerprint(document),
        "transcription_model": transcription_model,
        "max_seconds": max_seconds,
        "text": transcript_entry["text"],
    }
    persist_artifact(
        db,
        project_id=project_id,
        artifact_type=TRANSCRIPT_CACHE_ARTIFACT_TYPE,
        content=json.dumps(payload, ensure_ascii=True),
        metadata={
            "cache_version": MULTIMODAL_CACHE_VERSION,
            "cache_kind": "multimodal_transcript",
            "source_document_id": source_document_id,
            "source_filename": filename,
            "transcription_model": transcription_model,
            "max_seconds": max_seconds,
            "source_kind": transcript_entry["source_kind"],
        },
    )
    return transcript_entry, skipped, "generated"


async def build_multimodal_attachments_and_transcripts(
    documents: list[dict[str, Any]],
    *,
    db: Session | None = None,
    project_id: str = "",
    document_store: DocumentStore | None = None,
) -> dict[str, Any]:
    image_result = build_inline_image_attachments(documents)
    attachments: list[dict[str, Any]] = list(image_result["attachments"])
    skipped: list[dict[str, Any]] = list(image_result["skipped"])
    vision_source_names = [
        str(attachment.get("source_filename") or attachment.get("filename") or "")
        for attachment in attachments
        if str(attachment.get("source_filename") or attachment.get("filename") or "").strip()
    ]
    cache = {
        "cached_vision_filenames": [],
        "generated_vision_filenames": [],
        "cached_transcript_filenames": [],
        "generated_transcript_filenames": [],
    }

    video_documents = [document for document in documents if _document_is_video(document)][:MAX_INLINE_VIDEO_DOCUMENTS]
    for document in video_documents:
        video_attachments, video_skipped, cache_mode = await _build_video_frame_attachments_with_cache(
            document,
            db=db,
            project_id=project_id,
            document_store=document_store,
            sample_count=max(1, settings.MULTIMODAL_VIDEO_FRAME_COUNT),
            window_seconds=max(1, settings.MULTIMODAL_VIDEO_FRAME_WINDOW_SECONDS),
        )
        attachments.extend(video_attachments)
        skipped.extend(video_skipped)
        if video_attachments:
            source_name = str(document.get("filename") or "")
            if source_name:
                vision_source_names.append(source_name)
                if cache_mode == "cached":
                    cache["cached_vision_filenames"].append(source_name)
                elif cache_mode == "generated":
                    cache["generated_vision_filenames"].append(source_name)

    transcripts: list[dict[str, Any]] = []
    transcript_source_names: list[str] = []
    transcript_documents = [
        document
        for document in documents
        if _document_is_video(document) or _document_is_audio(document)
    ][:MAX_TRANSCRIPT_DOCUMENTS]
    for document in transcript_documents:
        transcript_entry, transcript_skipped, cache_mode = await _build_audio_transcript_with_cache(
            document,
            db=db,
            project_id=project_id,
            transcription_model=settings.OPENAI_TRANSCRIPTION_MODEL,
            max_seconds=max(1, settings.MULTIMODAL_AUDIO_TRANSCRIPTION_MAX_SECONDS),
        )
        if transcript_entry is not None:
            transcripts.append(transcript_entry)
            if transcript_entry["filename"]:
                transcript_source_names.append(transcript_entry["filename"])
                if cache_mode == "cached":
                    cache["cached_transcript_filenames"].append(transcript_entry["filename"])
                elif cache_mode == "generated":
                    cache["generated_transcript_filenames"].append(transcript_entry["filename"])
        skipped.extend(transcript_skipped)

    return {
        "attachments": attachments,
        "skipped": skipped,
        "vision_source_names": list(dict.fromkeys(item for item in vision_source_names if item)),
        "transcripts": transcripts,
        "transcript_source_names": list(dict.fromkeys(item for item in transcript_source_names if item)),
        "cache": {key: list(dict.fromkeys(value)) for key, value in cache.items()},
    }


def build_multimodal_user_content(
    text: str,
    attachments: list[dict[str, Any]],
    transcripts: list[dict[str, Any]] | None = None,
) -> str | list[dict[str, Any]]:
    prompt = text.strip()

    transcript_entries = list(transcripts or [])
    if transcript_entries:
        transcript_sections = "\n\n".join(
            f"Transcript from {entry['filename']}:\n{entry['text']}"
            for entry in transcript_entries
            if str(entry.get("filename") or "").strip() and str(entry.get("text") or "").strip()
        )
        if transcript_sections:
            prompt = f"{prompt}\n\nAudio transcripts:\n{transcript_sections}"

    if attachments:
        filenames = ", ".join(
            str(attachment.get("filename") or "")
            for attachment in attachments
            if str(attachment.get("filename") or "").strip()
        )
        if filenames:
            prompt = f"{prompt}\n\nAttached vision assets: {filenames}"
        parts: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        parts.extend(
            attachment["part"]
            for attachment in attachments
            if isinstance(attachment.get("part"), dict)
        )
        return parts

    return prompt
