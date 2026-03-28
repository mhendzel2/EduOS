from __future__ import annotations

import json
import math
import mimetypes
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any

from config import settings
from database_models import ArtifactRecord, DocumentRecord, ProjectRecord
from services.document_indexing import extract_text_for_file
from services.media_tools import get_or_create_project_media_tool_settings, normalize_media_tools
from services.orchestration import persist_artifact, serialize_artifact
from services.youtube_feedback import fetch_youtube_comment_feedback
from storage.document_store import DocumentStore

VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v", ".avi"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac"}
FFMPEG_TIMEOUT_SECONDS = 600


def _get_project_tool(project: ProjectRecord, db, tool_id: str) -> dict[str, Any]:
    settings = get_or_create_project_media_tool_settings(db, project.id)
    for tool in normalize_media_tools(settings.tools):
        if tool.get("tool_id") == tool_id:
            return tool
    raise ValueError(f"Unknown media tool: {tool_id}")


def _get_project_document(project: ProjectRecord, db, document_id: str | None) -> DocumentRecord | None:
    if not document_id:
        return None
    document = (
        db.query(DocumentRecord)
        .filter(DocumentRecord.project_id == project.id, DocumentRecord.id == document_id)
        .first()
    )
    if document is None:
        raise ValueError(f"Document not found in project: {document_id}")
    return document


def _get_project_artifact(project: ProjectRecord, db, artifact_id: str | None) -> ArtifactRecord | None:
    if not artifact_id:
        return None
    artifact = (
        db.query(ArtifactRecord)
        .filter(ArtifactRecord.project_id == project.id, ArtifactRecord.id == artifact_id)
        .first()
    )
    if artifact is None:
        raise ValueError(f"Artifact not found in project: {artifact_id}")
    return artifact


def _require_video_document(document: DocumentRecord | None) -> DocumentRecord:
    if document is None:
        raise ValueError("A source video document is required.")
    suffix = Path(document.filename).suffix.lower()
    if not (document.content_type or "").lower().startswith("video/") and suffix not in VIDEO_EXTENSIONS:
        raise ValueError(f"Document is not a video asset: {document.filename}")
    return document


def _require_image_document(document: DocumentRecord | None) -> DocumentRecord:
    if document is None:
        raise ValueError("An image document is required.")
    suffix = Path(document.filename).suffix.lower()
    if not (document.content_type or "").lower().startswith("image/") and suffix not in IMAGE_EXTENSIONS:
        raise ValueError(f"Document is not an image asset: {document.filename}")
    return document


def _require_audio_document(document: DocumentRecord | None) -> DocumentRecord:
    if document is None:
        raise ValueError("An audio document is required.")
    suffix = Path(document.filename).suffix.lower()
    if not (document.content_type or "").lower().startswith("audio/") and suffix not in AUDIO_EXTENSIONS:
        raise ValueError(f"Document is not an audio asset: {document.filename}")
    return document


def _create_output_path(project_id: str, output_filename: str, document_store: DocumentStore) -> tuple[str, Path]:
    safe_filename = document_store._sanitize_filename(output_filename)
    file_id = str(uuid.uuid4())
    suffix = Path(safe_filename).suffix or ".mp4"
    project_dir = Path(document_store.upload_dir) / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    return safe_filename, project_dir / f"{file_id}{suffix}"


def _register_generated_document(
    project: ProjectRecord,
    db,
    output_path: Path,
    output_filename: str,
    content_type: str,
    source_path: str | None,
) -> DocumentRecord:
    document = DocumentRecord(
        project_id=project.id,
        filename=output_filename,
        path=str(output_path),
        size=output_path.stat().st_size,
        content_type=content_type,
        source_path=source_path,
        is_reference=False,
        version=1,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


def _trimmed_string(value: Any, default: str = "") -> str:
    return str(value or default).strip()


def _coerce_int(value: Any, default: int) -> int:
    if value in {None, ""}:
        return default
    try:
        return int(value)
    except Exception as exc:
        raise ValueError(f"Expected an integer, got: {value}") from exc


def _coerce_float(value: Any, default: float | None = None) -> float | None:
    if value in {None, ""}:
        return default
    try:
        return float(value)
    except Exception as exc:
        raise ValueError(f"Expected a number, got: {value}") from exc


def _ffmpeg_drawtext_filter(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace(":", r"\:").replace("'", r"\'")
    return (
        "drawtext="
        f"text='{escaped}':"
        "fontcolor=white:fontsize=32:"
        "box=1:boxcolor=black@0.55:boxborderw=12:"
        "x=(w-text_w)/2:y=h-text_h-48"
    )


def _run_ffmpeg_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=FFMPEG_TIMEOUT_SECONDS,
        check=False,
    )


def _build_ffmpeg_brand_command(
    input_path: str,
    output_path: str,
    overlay_text: str = "",
    watermark_path: str | None = None,
    start_seconds: float | None = None,
    duration_seconds: float | None = None,
) -> list[str]:
    command = ["ffmpeg", "-y"]
    if start_seconds is not None:
        command.extend(["-ss", str(start_seconds)])
    command.extend(["-i", input_path])
    if duration_seconds is not None:
        command.extend(["-t", str(duration_seconds)])

    if watermark_path:
        command.extend(["-i", watermark_path])

    video_filter = ""
    if watermark_path and overlay_text:
        video_filter = f"[0:v][1:v]overlay=W-w-24:H-h-24[tmp];[tmp]{_ffmpeg_drawtext_filter(overlay_text)}"
    elif watermark_path:
        video_filter = "[0:v][1:v]overlay=W-w-24:H-h-24"
    elif overlay_text:
        video_filter = _ffmpeg_drawtext_filter(overlay_text)

    if video_filter:
        command.extend(["-filter_complex", video_filter])

    command.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            output_path,
        ]
    )
    return command


def _build_ffmpeg_shorts_command(
    input_path: str,
    output_path: str,
    overlay_text: str = "",
    watermark_path: str | None = None,
    start_seconds: float | None = None,
    duration_seconds: float | None = 60.0,
) -> list[str]:
    command = ["ffmpeg", "-y"]
    if start_seconds is not None:
        command.extend(["-ss", str(start_seconds)])
    command.extend(["-i", input_path])
    if duration_seconds is not None:
        command.extend(["-t", str(duration_seconds)])
    if watermark_path:
        command.extend(["-i", watermark_path])

    base_vertical = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
    if watermark_path and overlay_text:
        video_filter = (
            f"[0:v]{base_vertical}[base];"
            f"[base][1:v]overlay=W-w-24:H-h-24[tmp];"
            f"[tmp]{_ffmpeg_drawtext_filter(overlay_text)}"
        )
    elif watermark_path:
        video_filter = f"[0:v]{base_vertical}[base];[base][1:v]overlay=W-w-24:H-h-24"
    elif overlay_text:
        video_filter = f"{base_vertical},{_ffmpeg_drawtext_filter(overlay_text)}"
    else:
        video_filter = base_vertical

    command.extend(
        [
            "-filter_complex",
            video_filter,
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            output_path,
        ]
    )
    return command


def _prepare_package_artifact(
    project: ProjectRecord,
    db,
    artifact_type: str,
    title: str,
    payload: dict[str, Any],
) -> ArtifactRecord:
    content = f"{title}\n\n```json\n{json.dumps(payload, indent=2, ensure_ascii=True)}\n```"
    return persist_artifact(
        db=db,
        project_id=project.id,
        artifact_type=artifact_type,
        content=content,
        metadata={"tool_package": True, "title": title},
    )


def _persist_json_artifact(
    project: ProjectRecord,
    db,
    artifact_type: str,
    payload: dict[str, Any],
    metadata: dict[str, Any] | None = None,
) -> ArtifactRecord:
    return persist_artifact(
        db=db,
        project_id=project.id,
        artifact_type=artifact_type,
        content=json.dumps(payload, indent=2, ensure_ascii=True),
        metadata={"format": "json", **(metadata or {})},
    )


def _generated_artifact(role: str, artifact: ArtifactRecord, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"role": role, "kind": "artifact", "artifact": artifact, "metadata": metadata or {}}


def _generated_document(role: str, document: DocumentRecord, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"role": role, "kind": "document", "document": document, "metadata": metadata or {}}


def _build_result(
    *,
    success: bool,
    executed: bool,
    message: str,
    command: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
    generated_assets: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    assets = list(generated_assets or [])
    primary_document = next((item["document"] for item in assets if item["kind"] == "document"), None)
    primary_artifact = next((item["artifact"] for item in assets if item["kind"] == "artifact"), None)
    return {
        "success": success,
        "executed": executed,
        "message": message,
        "output_document": primary_document,
        "artifact": primary_artifact,
        "generated_assets": assets,
        "command": command or [],
        "metadata": metadata or {},
    }


async def _save_generated_document_bytes(
    *,
    project: ProjectRecord,
    db,
    document_store: DocumentStore,
    output_filename: str,
    content_type: str,
    content: bytes,
    source_path: str | None,
) -> DocumentRecord:
    file_info = await document_store.save_file(
        file_content=content,
        filename=output_filename,
        project_id=project.id,
        content_type=content_type,
    )
    document = DocumentRecord(
        id=file_info.id,
        project_id=project.id,
        filename=file_info.filename,
        path=file_info.path,
        size=file_info.size,
        content_type=file_info.content_type,
        source_path=source_path,
        is_reference=False,
        version=1,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


def _collect_citations(
    source_document: DocumentRecord | None,
    source_artifact: ArtifactRecord | None,
    arguments: dict[str, Any],
) -> list[str]:
    citations: list[str] = []
    raw_citations = arguments.get("citations")
    if isinstance(raw_citations, list):
        citations.extend(str(item).strip() for item in raw_citations if str(item).strip())
    elif raw_citations not in {None, ""}:
        citations.append(str(raw_citations).strip())

    if source_document is not None and source_document.provenance and source_document.provenance.citation:
        citations.append(source_document.provenance.citation.strip())
    if source_artifact is not None:
        artifact_citations = source_artifact.metadata_.get("citations") or []
        citations.extend(str(item).strip() for item in artifact_citations if str(item).strip())

    return list(dict.fromkeys(item for item in citations if item))


async def _resolve_render_source(
    project: ProjectRecord,
    db,
    source_document: DocumentRecord | None,
    arguments: dict[str, Any],
) -> tuple[str, str, list[str], ArtifactRecord | None]:
    source_artifact = _get_project_artifact(project, db, _trimmed_string(arguments.get("artifact_id")) or None)
    explicit_text = _trimmed_string(arguments.get("text")) or _trimmed_string(arguments.get("script_text"))

    if source_artifact is not None and (source_artifact.content or "").strip():
        text = source_artifact.content or ""
    elif explicit_text:
        text = explicit_text
    elif source_document is not None:
        text = await extract_text_for_file(source_document.path)
    else:
        text = ""

    if not text.strip():
        raise ValueError("No usable text source was found for this render action.")

    default_title = "StudioOS Render"
    if source_document is not None:
        default_title = Path(source_document.filename).stem.replace("-", " ").replace("_", " ").strip().title()
    elif source_artifact is not None:
        default_title = source_artifact.artifact_type.replace("_", " ").strip().title()

    title = _trimmed_string(arguments.get("title")) or default_title
    citations = _collect_citations(source_document, source_artifact, arguments)
    return text, title, citations, source_artifact


def _chunk_text_for_scenes(text: str, scene_count: int) -> list[str]:
    paragraphs = [segment.strip() for segment in re.split(r"\n\s*\n+", text) if segment.strip()]
    if len(paragraphs) >= scene_count:
        return paragraphs[:scene_count]

    compact = " ".join(text.split())
    if not compact:
        return []
    chunk_size = max(180, math.ceil(len(compact) / max(scene_count, 1)))
    return [
        compact[index : index + chunk_size].strip()
        for index in range(0, len(compact), chunk_size)
        if compact[index : index + chunk_size].strip()
    ][:scene_count]


def _build_storyboard_payload(
    *,
    text: str,
    title: str,
    citations: list[str],
    scene_count: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    segments = _chunk_text_for_scenes(text, scene_count)
    scenes: list[dict[str, Any]] = []
    manifest_scenes: list[dict[str, Any]] = []

    for index, segment in enumerate(segments, start=1):
        clean_segment = " ".join(segment.split())
        scene_title = clean_segment[:64].rsplit(" ", 1)[0] or clean_segment[:64] or f"Scene {index}"
        narration = clean_segment[:320]
        scene = {
            "scene_number": index,
            "title": scene_title,
            "narration": narration,
            "visual_brief": f"Visualize {scene_title.lower()} with an editorial explainer style.",
            "source_excerpt": clean_segment[:240],
            "citations": citations,
        }
        manifest_scene = {
            "scene_number": index,
            "slug": f"scene-{index:02d}",
            "title": scene_title,
            "duration_seconds": 6,
            "narration_text": narration,
            "asset_roles": ["narration_audio", "infographic", "final_video"],
            "citations": citations,
        }
        scenes.append(scene)
        manifest_scenes.append(manifest_scene)

    storyboard = {
        "title": title,
        "scene_count": len(scenes),
        "citations": citations,
        "scenes": scenes,
    }
    scene_manifest = {
        "title": title,
        "total_duration_seconds": len(manifest_scenes) * 6,
        "citations": citations,
        "scenes": manifest_scenes,
    }
    return storyboard, scene_manifest


def _escape_svg_text(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _build_infographic_svg(
    *,
    title: str,
    bullets: list[str],
    width: int,
    height: int,
    accent_color: str,
) -> str:
    safe_title = _escape_svg_text(title)
    safe_bullets = [_escape_svg_text(item) for item in bullets[:5]]
    block_y = 180
    bullet_lines = []
    for index, bullet in enumerate(safe_bullets, start=1):
        y = block_y + (index - 1) * 92
        bullet_lines.append(
            f'<rect x="96" y="{y}" rx="20" ry="20" width="{width - 192}" height="68" fill="white" opacity="0.9" />'
        )
        bullet_lines.append(
            f'<text x="132" y="{y + 42}" font-size="28" font-family="Arial, sans-serif" fill="#0f172a">{bullet}</text>'
        )

    return "\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
            f'<rect width="{width}" height="{height}" fill="#e2e8f0" />',
            f'<rect width="{width}" height="132" fill="{accent_color}" />',
            f'<text x="96" y="82" font-size="44" font-family="Arial, sans-serif" font-weight="700" fill="white">{safe_title}</text>',
            '<text x="96" y="122" font-size="22" font-family="Arial, sans-serif" fill="white">StudioOS render pipeline output</text>',
            *bullet_lines,
            "</svg>",
        ]
    )


def _estimate_duration_seconds(text: str, words_per_minute: int) -> float:
    word_count = len([token for token in text.split() if token.strip()])
    if word_count == 0:
        return 3.0
    seconds = (word_count / max(words_per_minute, 80)) * 60
    return max(3.0, min(seconds, 600.0))


def _build_placeholder_audio_command(
    *,
    output_path: str,
    duration_seconds: float,
    output_format: str,
) -> list[str]:
    command = ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", f"{duration_seconds:.2f}"]
    if output_format == "wav":
        command.extend(["-acodec", "pcm_s16le", output_path])
        return command
    command.extend(["-q:a", "9", "-acodec", "libmp3lame", output_path])
    return command


def _build_placeholder_video_command(
    *,
    output_path: str,
    title: str,
    duration_seconds: float,
    width: int,
    height: int,
    background_color: str,
    audio_path: str | None = None,
) -> list[str]:
    command = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c={background_color}:s={width}x{height}:d={duration_seconds:.2f}",
    ]
    if audio_path:
        command.extend(["-i", audio_path])
    command.extend(
        [
            "-vf",
            _ffmpeg_drawtext_filter(title[:72] or "StudioOS Render"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ]
    )
    if audio_path:
        command.extend(["-c:a", "aac", "-shortest"])
    command.append(output_path)
    return command


async def execute_media_tool_action(
    project: ProjectRecord,
    db,
    tool_id: str,
    action: str,
    document_id: str | None,
    secondary_document_id: str | None,
    arguments: dict[str, Any],
    document_store: DocumentStore,
) -> dict[str, Any]:
    tool = _get_project_tool(project, db, tool_id)
    if not tool.get("enabled"):
        raise ValueError(f"Media tool '{tool_id}' is disabled for this project.")
    source_document = _get_project_document(project, db, document_id)
    secondary_document = _get_project_document(project, db, secondary_document_id)

    if tool_id == "storyboard_renderer":
        if action != "generate_storyboard":
            raise ValueError(f"Unsupported storyboard action: {action}")

        text, title, citations, source_artifact = await _resolve_render_source(project, db, source_document, arguments)
        default_scene_count = _coerce_int(tool.get("config", {}).get("default_scene_count"), 6)
        scene_count = max(1, min(_coerce_int(arguments.get("scene_count"), default_scene_count), 12))
        storyboard_payload, manifest_payload = _build_storyboard_payload(
            text=text,
            title=title,
            citations=citations,
            scene_count=scene_count,
        )
        storyboard_artifact = _persist_json_artifact(
            project=project,
            db=db,
            artifact_type="storyboard_json",
            payload=storyboard_payload,
            metadata={"tool_id": tool_id, "action": action, "citations": citations},
        )
        manifest_artifact = _persist_json_artifact(
            project=project,
            db=db,
            artifact_type="scene_manifest_json",
            payload=manifest_payload,
            metadata={"tool_id": tool_id, "action": action, "citations": citations},
        )
        audit_artifact = _persist_json_artifact(
            project=project,
            db=db,
            artifact_type="render_audit_json",
            payload={
                "tool_id": tool_id,
                "action": action,
                "source_document_id": source_document.id if source_document else None,
                "source_artifact_id": source_artifact.id if source_artifact else None,
                "citations": citations,
                "placeholder": False,
            },
            metadata={"tool_id": tool_id, "action": action, "asset_role": "render_audit"},
        )
        return _build_result(
            success=True,
            executed=True,
            message=f"Generated storyboard and scene manifest for {title}.",
            metadata={"scene_count": len(storyboard_payload["scenes"]), "citations": citations},
            generated_assets=[
                _generated_artifact("storyboard", storyboard_artifact),
                _generated_artifact("scene_manifest", manifest_artifact),
                _generated_artifact("render_audit", audit_artifact),
            ],
        )

    if tool_id == "infographic_renderer":
        if action != "render_infographic":
            raise ValueError(f"Unsupported infographic action: {action}")

        text, title, citations, source_artifact = await _resolve_render_source(project, db, source_document, arguments)
        parsed_storyboard: dict[str, Any] | None = None
        if source_artifact is not None and source_artifact.artifact_type == "storyboard_json":
            try:
                parsed_storyboard = json.loads(source_artifact.content or "{}")
            except Exception:
                parsed_storyboard = None

        if parsed_storyboard and isinstance(parsed_storyboard.get("scenes"), list):
            bullets = [
                str(scene.get("title") or scene.get("narration") or "").strip()
                for scene in parsed_storyboard["scenes"]
                if str(scene.get("title") or scene.get("narration") or "").strip()
            ][:5]
        else:
            bullets = [segment[:96] for segment in _chunk_text_for_scenes(text, 5)]

        width = max(640, min(_coerce_int(arguments.get("width"), _coerce_int(tool.get("config", {}).get("width"), 1280)), 2400))
        height = max(360, min(_coerce_int(arguments.get("height"), _coerce_int(tool.get("config", {}).get("height"), 720)), 1800))
        accent_color = _trimmed_string(arguments.get("accent_color")) or _trimmed_string(tool.get("config", {}).get("accent_color"), "#2563eb")
        svg = _build_infographic_svg(title=title, bullets=bullets or [title], width=width, height=height, accent_color=accent_color)
        output_filename = _trimmed_string(arguments.get("output_filename")) or f"{title.lower().replace(' ', '-')}-infographic.svg"
        output_document = await _save_generated_document_bytes(
            project=project,
            db=db,
            document_store=document_store,
            output_filename=output_filename,
            content_type="image/svg+xml",
            content=svg.encode("utf-8"),
            source_path=source_document.path if source_document else None,
        )
        audit_artifact = _persist_json_artifact(
            project=project,
            db=db,
            artifact_type="render_audit_json",
            payload={
                "tool_id": tool_id,
                "action": action,
                "source_document_id": source_document.id if source_document else None,
                "source_artifact_id": source_artifact.id if source_artifact else None,
                "citations": citations,
                "placeholder": False,
                "output_document_id": output_document.id,
            },
            metadata={"tool_id": tool_id, "action": action, "asset_role": "render_audit"},
        )
        return _build_result(
            success=True,
            executed=True,
            message=f"Rendered infographic {output_document.filename}.",
            metadata={"width": width, "height": height, "citations": citations},
            generated_assets=[
                _generated_document("infographic", output_document),
                _generated_artifact("render_audit", audit_artifact),
            ],
        )

    if tool_id == "narration_generator":
        if action != "generate_narration":
            raise ValueError(f"Unsupported narration action: {action}")

        text, title, citations, source_artifact = await _resolve_render_source(project, db, source_document, arguments)
        output_format = (_trimmed_string(arguments.get("output_format")) or _trimmed_string(tool.get("config", {}).get("default_format"), "mp3")).lower()
        if output_format not in {"mp3", "wav"}:
            raise ValueError(f"Unsupported narration output format: {output_format}")
        words_per_minute = max(80, min(_coerce_int(arguments.get("words_per_minute"), _coerce_int(tool.get("config", {}).get("words_per_minute"), 150)), 260))
        duration_seconds = _coerce_float(arguments.get("duration_seconds"), _estimate_duration_seconds(text, words_per_minute))
        output_filename = _trimmed_string(arguments.get("output_filename")) or f"{title.lower().replace(' ', '-')}-narration.{output_format}"
        safe_filename, output_path = _create_output_path(project.id, output_filename, document_store)
        command = _build_placeholder_audio_command(
            output_path=str(output_path),
            duration_seconds=duration_seconds or 3.0,
            output_format=output_format,
        )
        process = _run_ffmpeg_command(command)
        if process.returncode != 0 or not output_path.exists():
            if output_path.exists():
                output_path.unlink(missing_ok=True)
            raise ValueError(process.stderr.strip() or "Narration generation failed.")

        output_document = _register_generated_document(
            project=project,
            db=db,
            output_path=output_path,
            output_filename=safe_filename,
            content_type=mimetypes.guess_type(safe_filename)[0] or f"audio/{output_format}",
            source_path=source_document.path if source_document else None,
        )
        manifest_artifact = _persist_json_artifact(
            project=project,
            db=db,
            artifact_type="narration_manifest_json",
            payload={
                "title": title,
                "placeholder_audio": True,
                "output_document_id": output_document.id,
                "duration_seconds": duration_seconds,
                "words_per_minute": words_per_minute,
                "citations": citations,
            },
            metadata={"tool_id": tool_id, "action": action, "citations": citations},
        )
        audit_artifact = _persist_json_artifact(
            project=project,
            db=db,
            artifact_type="render_audit_json",
            payload={
                "tool_id": tool_id,
                "action": action,
                "source_document_id": source_document.id if source_document else None,
                "source_artifact_id": source_artifact.id if source_artifact else None,
                "citations": citations,
                "placeholder": True,
                "output_document_id": output_document.id,
            },
            metadata={"tool_id": tool_id, "action": action, "asset_role": "render_audit"},
        )
        return _build_result(
            success=True,
            executed=True,
            message=f"Generated narration asset {output_document.filename}.",
            command=command,
            metadata={
                "duration_seconds": duration_seconds,
                "placeholder_audio": True,
                "stderr_tail": process.stderr[-1200:] if process.stderr else "",
                "stdout_tail": process.stdout[-1200:] if process.stdout else "",
            },
            generated_assets=[
                _generated_document("narration_audio", output_document),
                _generated_artifact("narration_manifest", manifest_artifact),
                _generated_artifact("render_audit", audit_artifact),
            ],
        )

    if tool_id == "video_assembler":
        if action != "assemble_video":
            raise ValueError(f"Unsupported video assembly action: {action}")

        text, title, citations, source_artifact = await _resolve_render_source(project, db, source_document, arguments)
        audio_document_id = _trimmed_string(arguments.get("audio_document_id")) or secondary_document_id
        audio_document = _get_project_document(project, db, audio_document_id) if audio_document_id else None
        if audio_document is not None:
            audio_document = _require_audio_document(audio_document)

        width = max(640, min(_coerce_int(arguments.get("width"), _coerce_int(tool.get("config", {}).get("width"), 1280)), 2400))
        height = max(360, min(_coerce_int(arguments.get("height"), _coerce_int(tool.get("config", {}).get("height"), 720)), 1800))
        background_color = _trimmed_string(arguments.get("background_color")) or _trimmed_string(tool.get("config", {}).get("background_color"), "#111827")
        duration_seconds = _coerce_float(arguments.get("duration_seconds"), 6.0)
        output_filename = _trimmed_string(arguments.get("output_filename")) or f"{title.lower().replace(' ', '-')}-final.mp4"
        safe_filename, output_path = _create_output_path(project.id, output_filename, document_store)
        command = _build_placeholder_video_command(
            output_path=str(output_path),
            title=title,
            duration_seconds=duration_seconds or 6.0,
            width=width,
            height=height,
            background_color=background_color,
            audio_path=audio_document.path if audio_document else None,
        )
        process = _run_ffmpeg_command(command)
        if process.returncode != 0 or not output_path.exists():
            if output_path.exists():
                output_path.unlink(missing_ok=True)
            raise ValueError(process.stderr.strip() or "Video assembly failed.")

        output_document = _register_generated_document(
            project=project,
            db=db,
            output_path=output_path,
            output_filename=safe_filename,
            content_type=mimetypes.guess_type(safe_filename)[0] or "video/mp4",
            source_path=source_document.path if source_document else None,
        )
        audit_artifact = _persist_json_artifact(
            project=project,
            db=db,
            artifact_type="render_audit_json",
            payload={
                "tool_id": tool_id,
                "action": action,
                "source_document_id": source_document.id if source_document else None,
                "source_artifact_id": source_artifact.id if source_artifact else None,
                "audio_document_id": audio_document.id if audio_document else None,
                "citations": citations,
                "placeholder": True,
                "output_document_id": output_document.id,
            },
            metadata={"tool_id": tool_id, "action": action, "asset_role": "render_audit"},
        )
        return _build_result(
            success=True,
            executed=True,
            message=f"Assembled final video asset {output_document.filename}.",
            command=command,
            metadata={
                "duration_seconds": duration_seconds,
                "placeholder_video": True,
                "stderr_tail": process.stderr[-1200:] if process.stderr else "",
                "stdout_tail": process.stdout[-1200:] if process.stdout else "",
            },
            generated_assets=[
                _generated_document("final_video", output_document),
                _generated_artifact("render_audit", audit_artifact),
            ],
        )

    if tool_id == "ffmpeg_execute_code":
        video_document = _require_video_document(source_document)
        watermark_document = _require_image_document(secondary_document) if secondary_document_id else None
        overlay_text = _trimmed_string(arguments.get("overlay_text"))
        output_filename = _trimmed_string(arguments.get("output_filename")) or (
            f"{Path(video_document.filename).stem}-branded.mp4"
            if action == "brand_video"
            else f"{Path(video_document.filename).stem}-shorts.mp4"
        )
        safe_filename, output_path = _create_output_path(project.id, output_filename, document_store)
        start_seconds = _coerce_float(arguments.get("start_seconds"))
        duration_seconds = _coerce_float(arguments.get("duration_seconds"), 60.0 if action == "create_shorts_cut" else None)

        if action == "brand_video":
            command = _build_ffmpeg_brand_command(
                input_path=video_document.path,
                output_path=str(output_path),
                overlay_text=overlay_text,
                watermark_path=watermark_document.path if watermark_document else None,
                start_seconds=start_seconds,
                duration_seconds=duration_seconds,
            )
        elif action == "create_shorts_cut":
            command = _build_ffmpeg_shorts_command(
                input_path=video_document.path,
                output_path=str(output_path),
                overlay_text=overlay_text,
                watermark_path=watermark_document.path if watermark_document else None,
                start_seconds=start_seconds,
                duration_seconds=duration_seconds,
            )
        else:
            raise ValueError(f"Unsupported FFmpeg action: {action}")

        process = _run_ffmpeg_command(command)
        if process.returncode != 0 or not output_path.exists():
            if output_path.exists():
                output_path.unlink(missing_ok=True)
            raise ValueError(process.stderr.strip() or "FFmpeg execution failed.")

        output_document = _register_generated_document(
            project=project,
            db=db,
            output_path=output_path,
            output_filename=safe_filename,
            content_type=mimetypes.guess_type(safe_filename)[0] or "video/mp4",
            source_path=video_document.path,
        )
        artifact = persist_artifact(
            db=db,
            project_id=project.id,
            artifact_type="tool_execution_log",
            content=(
                f"Tool: {tool_id}\nAction: {action}\nSource: {video_document.filename}\n"
                f"Output: {output_document.filename}\nCommand: {' '.join(command)}\n\n"
                f"{process.stderr[-4000:] if process.stderr else ''}"
            ),
            metadata={"tool_id": tool_id, "action": action, "output_document_id": output_document.id},
        )
        return _build_result(
            success=True,
            executed=True,
            message=f"{action} completed and generated {output_document.filename}.",
            command=command,
            metadata={
                "stderr_tail": process.stderr[-1200:] if process.stderr else "",
                "stdout_tail": process.stdout[-1200:] if process.stdout else "",
            },
            generated_assets=[
                _generated_document("video_output", output_document),
                _generated_artifact("execution_log", artifact),
            ],
        )

    if tool_id == "youtube_comment_collector":
        if action != "collect_comment_feedback":
            raise ValueError(f"Unsupported YouTube comment collector action: {action}")

        video_reference = _trimmed_string(arguments.get("video_reference")) or _trimmed_string(tool.get("config", {}).get("video_reference"))
        if not video_reference:
            raise ValueError("A YouTube video reference is required to collect comment feedback.")

        project_api_key = _trimmed_string(tool.get("config", {}).get("youtube_api_key"))

        configured_default = _coerce_int(
            tool.get("config", {}).get("max_results"),
            settings.YOUTUBE_COMMENTS_DEFAULT_MAX_RESULTS,
        )
        max_results = max(1, min(_coerce_int(arguments.get("max_results"), configured_default), 100))
        payload = await fetch_youtube_comment_feedback(
            video_reference,
            api_key=project_api_key or None,
            max_results=max_results,
        )
        artifact = _persist_json_artifact(
            project=project,
            db=db,
            artifact_type="youtube_comment_feedback",
            payload=payload,
            metadata={
                "tool_id": tool_id,
                "action": action,
                "video_id": payload["video_id"],
                "comment_count": payload["summary"]["comment_count"],
                "uses_project_api_key": bool(project_api_key),
            },
        )
        return _build_result(
            success=True,
            executed=True,
            message=(
                f"Collected {payload['summary']['comment_count']} YouTube comments for video {payload['video_id']}."
            ),
            metadata={
                "video_id": payload["video_id"],
                "video_url": payload["video_url"],
                "comment_count": payload["summary"]["comment_count"],
                "unique_author_count": payload["summary"]["unique_author_count"],
                "uses_project_api_key": bool(project_api_key),
            },
            generated_assets=[_generated_artifact("youtube_comment_feedback", artifact)],
        )

    if tool_id == "composio_youtube_mcp":
        video_document = _require_video_document(source_document)
        thumbnail_document = _require_image_document(secondary_document) if secondary_document_id else None
        seo_artifact = (
            db.query(ArtifactRecord)
            .filter(ArtifactRecord.project_id == project.id, ArtifactRecord.artifact_type == "seo_package")
            .order_by(ArtifactRecord.created_at.desc())
            .first()
        )
        payload = {
            "tool": tool_id,
            "action": action,
            "install_command": tool.get("install_command"),
            "channel_reference": tool.get("config", {}).get("channel_reference", ""),
            "video_path": video_document.path,
            "video_filename": video_document.filename,
            "thumbnail_path": thumbnail_document.path if thumbnail_document else tool.get("config", {}).get("thumbnail_input_path", ""),
            "seo_package": seo_artifact.content if seo_artifact else "",
            "notes": tool.get("notes", []),
            "message": "Prepared a YouTube upload package for external Composio MCP execution.",
        }
        artifact = _prepare_package_artifact(
            project=project,
            db=db,
            artifact_type="youtube_upload_package",
            title="Composio YouTube Upload Package",
            payload=payload,
        )
        return _build_result(
            success=True,
            executed=False,
            message="Prepared a YouTube upload package artifact for Composio MCP.",
            command=[tool.get("install_command", "")],
            metadata=payload,
            generated_assets=[_generated_artifact("youtube_upload_package", artifact)],
        )

    if tool_id == "notebooklm_mcp":
        payload = {
            "tool": tool_id,
            "action": action,
            "install_command": tool.get("install_command"),
            "notebook_name": tool.get("config", {}).get("notebook_name", ""),
            "download_directory": tool.get("config", {}).get("download_directory", ""),
            "video_overview_topic": tool.get("config", {}).get("video_overview_topic", ""),
            "source_video_path": source_document.path if source_document else "",
            "source_video_filename": source_document.filename if source_document else "",
            "notes": tool.get("notes", []),
            "message": "Prepared a NotebookLM video manifest for external MCP usage.",
        }
        artifact = _prepare_package_artifact(
            project=project,
            db=db,
            artifact_type="notebooklm_video_manifest",
            title="NotebookLM Video Manifest",
            payload=payload,
        )
        return _build_result(
            success=True,
            executed=False,
            message="Prepared a NotebookLM manifest artifact for later MCP execution.",
            command=[tool.get("install_command", "")],
            metadata=payload,
            generated_assets=[_generated_artifact("notebooklm_video_manifest", artifact)],
        )

    raise ValueError(f"Unsupported media tool: {tool_id}")
