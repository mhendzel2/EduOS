from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from agents.base_agent import AgentRequest, BaseAgent
from database import Base
from database_models import ArtifactRecord, ProjectRecord
from services.multimodal import (
    build_inline_image_attachments,
    build_multimodal_attachments_and_transcripts,
    build_multimodal_user_content,
)
from storage.document_store import DocumentStore


@pytest.fixture
def db_session() -> Session:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, future=True)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def test_build_inline_image_attachments_encodes_project_images(tmp_path: Path):
    image_path = tmp_path / "shot.png"
    image_path.write_bytes(b"\x89PNG\r\n\x1a\nfake-image")

    result = build_inline_image_attachments(
        [
            {
                "id": "img-1",
                "filename": "shot.png",
                "path": str(image_path),
                "content_type": "image/png",
                "kind": "image",
            },
            {
                "id": "txt-1",
                "filename": "notes.md",
                "path": str(tmp_path / "notes.md"),
                "content_type": "text/markdown",
                "kind": "text",
            },
        ]
    )

    assert len(result["attachments"]) == 1
    assert result["attachments"][0]["filename"] == "shot.png"
    assert result["attachments"][0]["part"]["type"] == "image_url"
    assert result["attachments"][0]["part"]["image_url"]["url"].startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_build_multimodal_attachments_and_transcripts_expands_video_and_transcript(
    monkeypatch: pytest.MonkeyPatch,
):
    async def fake_extract_video_frame_attachments(document, *, sample_count, window_seconds):
        return (
            [
                {
                    "document_id": document["id"],
                    "filename": f"{document['filename']} frame 1",
                    "source_filename": document["filename"],
                    "source_kind": "video_frame",
                    "mime_type": "image/jpeg",
                    "size": 1024,
                    "part": {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,ZmFrZQ=="}},
                }
            ],
            [],
        )

    async def fake_extract_audio_transcript(document):
        return (
            {
                "document_id": document["id"],
                "filename": document["filename"],
                "source_kind": "video_transcript",
                "text": "Transcript text from the video.",
            },
            [],
        )

    monkeypatch.setattr("services.multimodal._extract_video_frame_attachments", fake_extract_video_frame_attachments)
    monkeypatch.setattr("services.multimodal._extract_audio_transcript", fake_extract_audio_transcript)

    result = await build_multimodal_attachments_and_transcripts(
        [
            {
                "id": "video-1",
                "filename": "clip.mp4",
                "path": "/tmp/clip.mp4",
                "content_type": "video/mp4",
                "kind": "video",
            }
        ]
    )

    assert result["vision_source_names"] == ["clip.mp4"]
    assert result["transcript_source_names"] == ["clip.mp4"]
    assert len(result["attachments"]) == 1
    assert result["transcripts"][0]["text"] == "Transcript text from the video."
    assert result["cache"] == {
        "cached_vision_filenames": [],
        "generated_vision_filenames": [],
        "cached_transcript_filenames": [],
        "generated_transcript_filenames": [],
    }


@pytest.mark.asyncio
async def test_multimodal_cache_persists_and_reuses_generated_video_frames_and_transcripts(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    project = ProjectRecord(
        name="Cached Multimodal Project",
        description="Cache video prep across chat turns.",
        domains=["web"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    video_path = tmp_path / "clip.mp4"
    video_path.write_bytes(b"first-video")
    document = {
        "id": "video-1",
        "filename": "clip.mp4",
        "path": str(video_path),
        "content_type": "video/mp4",
        "kind": "video",
        "size": video_path.stat().st_size,
    }

    async def fake_extract_video_frame_payloads(document, *, sample_count, window_seconds):
        return (
            [
                {
                    "document_id": document["id"],
                    "filename": "clip.mp4 frame 1",
                    "source_filename": document["filename"],
                    "source_kind": "video_frame",
                    "mime_type": "image/jpeg",
                    "size": 9,
                    "content_bytes": b"frame-one",
                    "frame_index": 1,
                    "stored_filename": "clip-frame-01.jpg",
                }
            ],
            [],
        )

    async def fake_extract_audio_transcript(document):
        return (
            {
                "document_id": document["id"],
                "filename": document["filename"],
                "source_kind": "video_transcript",
                "text": "Transcript from the first pass.",
            },
            [],
        )

    monkeypatch.setattr("services.multimodal._extract_video_frame_payloads", fake_extract_video_frame_payloads)
    monkeypatch.setattr("services.multimodal._extract_audio_transcript", fake_extract_audio_transcript)

    first_result = await build_multimodal_attachments_and_transcripts(
        [document],
        db=db_session,
        project_id=project.id,
        document_store=DocumentStore(upload_dir=str(tmp_path / "uploads")),
    )

    assert first_result["cache"]["generated_vision_filenames"] == ["clip.mp4"]
    assert first_result["cache"]["generated_transcript_filenames"] == ["clip.mp4"]
    assert first_result["cache"]["cached_vision_filenames"] == []
    assert first_result["cache"]["cached_transcript_filenames"] == []
    assert len(first_result["attachments"]) == 1
    assert first_result["transcripts"][0]["text"] == "Transcript from the first pass."

    async def fail_extract_video_frame_payloads(*_args, **_kwargs):
        raise AssertionError("video frames should have been served from cache")

    async def fail_extract_audio_transcript(*_args, **_kwargs):
        raise AssertionError("transcripts should have been served from cache")

    monkeypatch.setattr("services.multimodal._extract_video_frame_payloads", fail_extract_video_frame_payloads)
    monkeypatch.setattr("services.multimodal._extract_audio_transcript", fail_extract_audio_transcript)

    second_result = await build_multimodal_attachments_and_transcripts(
        [document],
        db=db_session,
        project_id=project.id,
        document_store=DocumentStore(upload_dir=str(tmp_path / "uploads")),
    )

    assert second_result["cache"]["cached_vision_filenames"] == ["clip.mp4"]
    assert second_result["cache"]["cached_transcript_filenames"] == ["clip.mp4"]
    assert second_result["cache"]["generated_vision_filenames"] == []
    assert second_result["cache"]["generated_transcript_filenames"] == []
    assert len(second_result["attachments"]) == 1
    assert second_result["transcripts"][0]["text"] == "Transcript from the first pass."

    artifacts = (
        db_session.query(ArtifactRecord)
        .filter(ArtifactRecord.project_id == project.id)
        .order_by(ArtifactRecord.created_at.asc())
        .all()
    )
    assert [artifact.artifact_type for artifact in artifacts] == [
        "multimodal_frame_manifest",
        "multimodal_transcript_cache",
    ]


@pytest.mark.asyncio
async def test_multimodal_cache_invalidates_when_source_document_changes(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    project = ProjectRecord(
        name="Invalidated Multimodal Cache",
        description="Regenerate multimodal prep after the source clip changes.",
        domains=["web"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    video_path = tmp_path / "clip.mp4"
    video_path.write_bytes(b"version-one")
    document = {
        "id": "video-2",
        "filename": "clip.mp4",
        "path": str(video_path),
        "content_type": "video/mp4",
        "kind": "video",
        "size": video_path.stat().st_size,
    }

    call_state = {"count": 0}

    async def fake_extract_video_frame_payloads(document, *, sample_count, window_seconds):
        call_state["count"] += 1
        frame_bytes = f"frame-{call_state['count']}".encode("utf-8")
        return (
            [
                {
                    "document_id": document["id"],
                    "filename": "clip.mp4 frame 1",
                    "source_filename": document["filename"],
                    "source_kind": "video_frame",
                    "mime_type": "image/jpeg",
                    "size": len(frame_bytes),
                    "content_bytes": frame_bytes,
                    "frame_index": 1,
                    "stored_filename": f"clip-frame-{call_state['count']:02d}.jpg",
                }
            ],
            [],
        )

    async def fake_extract_audio_transcript(document):
        return (
            {
                "document_id": document["id"],
                "filename": document["filename"],
                "source_kind": "video_transcript",
                "text": f"Transcript version {call_state['count'] or 1}",
            },
            [],
        )

    monkeypatch.setattr("services.multimodal._extract_video_frame_payloads", fake_extract_video_frame_payloads)
    monkeypatch.setattr("services.multimodal._extract_audio_transcript", fake_extract_audio_transcript)

    first_result = await build_multimodal_attachments_and_transcripts(
        [document],
        db=db_session,
        project_id=project.id,
        document_store=DocumentStore(upload_dir=str(tmp_path / "uploads")),
    )
    assert first_result["cache"]["generated_vision_filenames"] == ["clip.mp4"]
    assert first_result["cache"]["generated_transcript_filenames"] == ["clip.mp4"]

    video_path.write_bytes(b"version-two-with-different-size")
    document["size"] = video_path.stat().st_size

    second_result = await build_multimodal_attachments_and_transcripts(
        [document],
        db=db_session,
        project_id=project.id,
        document_store=DocumentStore(upload_dir=str(tmp_path / "uploads")),
    )

    assert second_result["cache"]["generated_vision_filenames"] == ["clip.mp4"]
    assert second_result["cache"]["generated_transcript_filenames"] == ["clip.mp4"]
    assert second_result["cache"]["cached_vision_filenames"] == []
    assert second_result["cache"]["cached_transcript_filenames"] == []
    assert second_result["transcripts"][0]["text"] == "Transcript version 2"
    assert (
        db_session.query(ArtifactRecord)
        .filter(ArtifactRecord.project_id == project.id, ArtifactRecord.artifact_type == "multimodal_frame_manifest")
        .count()
        == 2
    )
    assert (
        db_session.query(ArtifactRecord)
        .filter(ArtifactRecord.project_id == project.id, ArtifactRecord.artifact_type == "multimodal_transcript_cache")
        .count()
        == 2
    )


def test_build_multimodal_user_content_includes_transcripts_without_images():
    content = build_multimodal_user_content(
        "Analyze the source clip.",
        [],
        [{"filename": "clip.mp4", "text": "Transcript text from the clip."}],
    )

    assert isinstance(content, str)
    assert "Audio transcripts" in content
    assert "clip.mp4" in content
    assert "Transcript text from the clip." in content


@pytest.mark.asyncio
async def test_base_agent_process_uses_multimodal_user_content(monkeypatch: pytest.MonkeyPatch):
    agent = BaseAgent(
        name="VisionAgent",
        system_prompt="Inspect the image and respond.",
        model="openrouter/openai/gpt-4o-mini",
    )

    captured: dict[str, object] = {}

    class DummyResponse:
        choices = [SimpleNamespace(message=SimpleNamespace(content="Vision response"))]

    async def fake_chat_completion(**kwargs):
        captured.update(kwargs)
        return DummyResponse()

    monkeypatch.setattr("agents.base_agent.chat_completion", fake_chat_completion)
    monkeypatch.setattr("agents.base_agent.model_supports_vision", lambda _model: True)

    response = await agent.process(
        AgentRequest(
            session_id="vision-test",
            user_input="Analyze the attached image.",
            context={
                "project_id": "project-1",
                "project_name": "Vision Project",
                "multimodal_attachment_names": ["shot.png"],
                "multimodal_attachments": [
                    {
                        "filename": "shot.png",
                        "part": {
                            "type": "image_url",
                            "image_url": {"url": "data:image/png;base64,ZmFrZS1pbWFnZQ=="},
                        },
                    }
                ],
            },
        )
    )

    messages = captured["messages"]
    assert isinstance(messages, list)
    assert isinstance(messages[-1]["content"], list)
    assert messages[-1]["content"][0]["type"] == "text"
    assert messages[-1]["content"][1]["type"] == "image_url"
    assert "data:image/png;base64" not in messages[1]["content"]
    assert response.content == "Vision response"


@pytest.mark.asyncio
async def test_base_agent_process_appends_transcripts_for_text_only_model(monkeypatch: pytest.MonkeyPatch):
    agent = BaseAgent(
        name="TranscriptAgent",
        system_prompt="Inspect the transcript and respond.",
        model="ollama/llama3",
    )

    captured: dict[str, object] = {}

    class DummyResponse:
        choices = [SimpleNamespace(message=SimpleNamespace(content="Transcript response"))]

    async def fake_chat_completion(**kwargs):
        captured.update(kwargs)
        return DummyResponse()

    monkeypatch.setattr("agents.base_agent.chat_completion", fake_chat_completion)
    monkeypatch.setattr("agents.base_agent.model_supports_vision", lambda _model: False)

    response = await agent.process(
        AgentRequest(
            session_id="transcript-test",
            user_input="Analyze the attached clip.",
            context={
                "project_id": "project-1",
                "multimodal_transcripts": [
                    {"filename": "clip.mp4", "text": "Transcript text from the clip."}
                ],
            },
        )
    )

    messages = captured["messages"]
    assert isinstance(messages[-1]["content"], str)
    assert "Audio transcripts" in messages[-1]["content"]
    assert "clip.mp4" in messages[-1]["content"]
    assert response.content == "Transcript response"
