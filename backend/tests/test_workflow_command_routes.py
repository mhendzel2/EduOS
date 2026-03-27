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

from agents.base_agent import AgentRequest, AgentResponse
from api import routes
from api.schemas import ProjectChatRequest, WorkflowCommandRequest
from database import Base
from database_models import ArtifactRecord, DocumentRecord, ProjectRecord, RunRecord
from services.workflow_command import plan_project_workflow_command
from storage.vector_store import VectorStore


class DummyMediaAgent:
    artifact_type = "video_critique"

    async def process(self, request: AgentRequest) -> AgentResponse:
        assert request.context is not None
        assert request.context["force_local_model"] is True
        assert request.context["model_override"] == "ollama/test-workflow"
        assert request.context["selected_documents"][0]["filename"] == "scene-notes.md"
        assert request.context["selected_artifacts"][0]["artifact_type"] == "research_brief"
        assert "story_bible" in request.context
        assert "brand_bible" in request.context
        return AgentResponse(
            agent_name="DummyMediaAgent",
            content="Local workflow command completed.",
            artifact_type=self.artifact_type,
            confidence=0.91,
            metadata={"route": "workflow-command"},
        )


class DummyExternalChatAgent:
    artifact_type = "channel_branding_package"

    async def process(self, request: AgentRequest) -> AgentResponse:
        assert request.context is not None
        assert request.context["model_override"] == "openrouter/google/gemini-2.5-pro"
        assert request.context["chat_mode"] is True
        assert request.context["conversation_history"][0]["content"] == "We are repositioning the brand."
        assert request.context["project_media_inventory"][0]["filename"] == "hero-shot.png"
        assert request.context["brand_bible"]["brand_name"] == "Northlight"
        assert request.context["vision_enabled"] is True
        assert request.context["multimodal_attachment_names"] == ["hero-shot.png"]
        assert len(request.context["multimodal_attachments"]) == 1
        return AgentResponse(
            agent_name="DummyExternalChatAgent",
            content="I scanned the attached media and drafted a stronger channel branding direction.",
            artifact_type=self.artifact_type,
            confidence=0.94,
            metadata={"route": "project-chat"},
        )


class DummyVideoTranscriptAgent:
    artifact_type = "video_critique"

    async def process(self, request: AgentRequest) -> AgentResponse:
        assert request.context is not None
        assert request.context["model_override"] == "ollama/llava"
        assert request.context["vision_enabled"] is True
        assert request.context["audio_transcription_enabled"] is True
        assert request.context["multimodal_attachment_names"] == ["source-clip.mp4"]
        assert request.context["multimodal_transcript_names"] == ["source-clip.mp4"]
        assert len(request.context["multimodal_attachments"]) == 2
        assert request.context["multimodal_transcripts"][0]["text"] == "Transcript text from the source clip."
        return AgentResponse(
            agent_name="DummyVideoTranscriptAgent",
            content="I reviewed the clip frames and transcript and prepared a critique.",
            artifact_type=self.artifact_type,
            confidence=0.93,
            metadata={"route": "project-chat-video"},
        )


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


@pytest.mark.asyncio
async def test_plan_project_workflow_command_uses_local_model(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    project = ProjectRecord(
        name="Local Workflow Planning",
        description="Plan media actions from local AI.",
        domains=["web", "youtube"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    doc_path = tmp_path / "scene-notes.md"
    doc_path.write_text("Use the strongest opening clip in the first fifteen seconds.", encoding="utf-8")
    document = DocumentRecord(
        project_id=project.id,
        filename="scene-notes.md",
        path=str(doc_path),
        size=doc_path.stat().st_size,
        content_type="text/markdown",
        source_path=str(doc_path),
        is_reference=True,
        version=1,
    )
    artifact = ArtifactRecord(
        project_id=project.id,
        artifact_type="research_brief",
        content="Prioritize one clear scientific narrative and one hero frame.",
        metadata_={},
        version=1,
    )
    db_session.add(document)
    db_session.add(artifact)
    db_session.commit()
    db_session.refresh(document)
    db_session.refresh(artifact)

    class DummyResponse:
        choices = [
            SimpleNamespace(
                message=SimpleNamespace(
                    content=(
                        '{"summary":"Run a focused video critique.","rationale":"The command is asking for a single '
                        'critique pass.","execution_mode":"agent","task":"Critique the selected video assets and '
                        'recommend edits.","pipeline_kind":null,"workforce":"media","agent_id":"video_critic",'
                        '"steps":[],"context_focus":["selected media assets","recent research artifact"]}'
                    )
                )
            )
        ]

    captured: dict[str, str] = {}

    async def fake_chat_completion(**kwargs):
        captured["model"] = str(kwargs.get("model") or "")
        return DummyResponse()

    vector_store = VectorStore(path=str(tmp_path / "vector_store"), collection_name="workflow_command_tests")
    vector_store._use_memory_fallback()

    monkeypatch.setattr("services.workflow_command.chat_completion", fake_chat_completion)
    monkeypatch.setattr("services.workflow_command.get_local_workflow_model", lambda: "ollama/test-workflow")

    result = await plan_project_workflow_command(
        project=project,
        db=db_session,
        command="Review the current uploaded video and tell the editor what to change.",
        scope="media",
        vector_store=vector_store,
    )

    assert result["execution_mode"] == "agent"
    assert result["workforce"] == "media"
    assert result["agent_id"] == "video_critic"
    assert result["referenced_document_ids"] == [document.id]
    assert result["referenced_artifact_ids"] == [artifact.id]
    assert captured["model"] == "ollama/test-workflow"


@pytest.mark.asyncio
async def test_workflow_command_route_executes_agent_with_local_context(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    project = ProjectRecord(
        name="Workflow Command Route",
        description="Execute workflow command runs.",
        domains=["web", "youtube"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    doc_path = tmp_path / "scene-notes.md"
    doc_path.write_text("Lead with the visual hook, then tighten pacing after the first minute.", encoding="utf-8")
    document = DocumentRecord(
        project_id=project.id,
        filename="scene-notes.md",
        path=str(doc_path),
        size=doc_path.stat().st_size,
        content_type="text/markdown",
        source_path=str(doc_path),
        is_reference=True,
        version=1,
    )
    artifact = ArtifactRecord(
        project_id=project.id,
        artifact_type="research_brief",
        content="Recent audience feedback asks for clearer chapter transitions.",
        metadata_={},
        version=1,
    )
    db_session.add(document)
    db_session.add(artifact)
    db_session.commit()
    db_session.refresh(document)
    db_session.refresh(artifact)

    async def fake_plan_project_workflow_command(**_kwargs):
        return {
            "summary": "Run a local video critique.",
            "rationale": "The command targets one selected media review step.",
            "execution_mode": "agent",
            "task": "Critique the selected video assets and recommend edits.",
            "pipeline_kind": None,
            "workforce": "media",
            "agent_id": "video_critic",
            "steps": [],
            "context_focus": ["selected media assets", "recent research artifact"],
            "referenced_document_ids": [document.id],
            "referenced_artifact_ids": [artifact.id],
            "model": "ollama/test-workflow",
            "selected_documents": [
                {
                    "id": document.id,
                    "filename": document.filename,
                    "content_type": document.content_type,
                    "kind": "text",
                    "source_path": document.source_path,
                    "path": document.path,
                    "is_reference": True,
                    "size": document.size,
                    "preview": "Lead with the visual hook.",
                }
            ],
            "selected_artifacts": [
                {
                    "id": artifact.id,
                    "artifact_type": artifact.artifact_type,
                    "version": artifact.version,
                    "created_at": artifact.created_at.isoformat(),
                    "preview": "Recent audience feedback asks for clearer chapter transitions.",
                    "metadata": {},
                }
            ],
            "relevant_document_excerpts": [],
        }

    monkeypatch.setattr(routes, "plan_project_workflow_command", fake_plan_project_workflow_command)
    monkeypatch.setattr(routes, "_get_workforce_agent_for_project", lambda *_args, **_kwargs: DummyMediaAgent())

    response = await routes.run_project_workflow_command(
        project_id=project.id,
        payload=WorkflowCommandRequest(
            command="Review the uploaded video and recommend a stronger edit path.",
            scope="media",
            document_ids=[document.id],
            artifact_ids=[artifact.id],
            execute=True,
        ),
        db=db_session,
    )

    runs = db_session.query(RunRecord).all()
    artifacts = db_session.query(ArtifactRecord).filter(ArtifactRecord.project_id == project.id).all()

    assert response.project_id == project.id
    assert response.model == "ollama/test-workflow"
    assert response.plan.execution_mode == "agent"
    assert response.execution is not None
    assert response.execution.mode == "agent"
    assert response.execution.run.status == "completed"
    assert response.execution.agent_response is not None
    assert response.execution.agent_response.content == "Local workflow command completed."
    assert len(runs) == 1
    assert len(artifacts) == 2


@pytest.mark.asyncio
async def test_project_chat_route_supports_openrouter_model_and_media_context(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    project = ProjectRecord(
        name="Media Chat Route",
        description="Use chat to build branding from current media.",
        domains=["web", "youtube"],
        story_bible={"latest_outline": "Reframe the narrative around evidence-first explainers."},
        brand_bible={"brand_name": "Northlight", "voice_tone": "precise and calm"},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    image_path = tmp_path / "hero-shot.png"
    image_path.write_bytes(b"\x89PNG\r\n\x1a\nfake-image")
    text_path = tmp_path / "style-guide.md"
    text_path.write_text("Lead with clean evidence visuals and restrained typography.", encoding="utf-8")

    image_document = DocumentRecord(
        project_id=project.id,
        filename="hero-shot.png",
        path=str(image_path),
        size=image_path.stat().st_size,
        content_type="image/png",
        source_path=str(image_path),
        is_reference=False,
        version=1,
    )
    text_document = DocumentRecord(
        project_id=project.id,
        filename="style-guide.md",
        path=str(text_path),
        size=text_path.stat().st_size,
        content_type="text/markdown",
        source_path=str(text_path),
        is_reference=True,
        version=1,
    )
    db_session.add(image_document)
    db_session.add(text_document)
    db_session.commit()
    db_session.refresh(image_document)
    db_session.refresh(text_document)

    async def fake_plan_project_workflow_command(**_kwargs):
        return {
            "summary": "Create a channel branding package from the current project media.",
            "rationale": "The user is asking for a focused branding deliverable based on attached media.",
            "execution_mode": "agent",
            "task": "Analyze the current media and produce an updated branding package.",
            "pipeline_kind": None,
            "workforce": "media",
            "agent_id": "channel_brand",
            "steps": [],
            "context_focus": ["current project media", "brand bible", "conversation history"],
            "referenced_document_ids": [image_document.id, text_document.id],
            "referenced_artifact_ids": [],
            "model": "openrouter/google/gemini-2.5-pro",
            "selected_documents": [
                {
                    "id": image_document.id,
                    "filename": image_document.filename,
                    "content_type": image_document.content_type,
                    "kind": "image",
                    "source_path": image_document.source_path,
                    "path": image_document.path,
                    "is_reference": False,
                    "size": image_document.size,
                    "preview": "",
                },
                {
                    "id": text_document.id,
                    "filename": text_document.filename,
                    "content_type": text_document.content_type,
                    "kind": "text",
                    "source_path": text_document.source_path,
                    "path": text_document.path,
                    "is_reference": True,
                    "size": text_document.size,
                    "preview": "Lead with clean evidence visuals and restrained typography.",
                },
            ],
            "selected_artifacts": [],
            "relevant_document_excerpts": [],
            "project_media_inventory": [
                {
                    "id": image_document.id,
                    "filename": image_document.filename,
                    "kind": "image",
                    "content_type": image_document.content_type,
                    "size": image_document.size,
                    "source_path": image_document.source_path,
                    "created_at": image_document.created_at.isoformat(),
                },
                {
                    "id": text_document.id,
                    "filename": text_document.filename,
                    "kind": "text",
                    "content_type": text_document.content_type,
                    "size": text_document.size,
                    "source_path": text_document.source_path,
                    "created_at": text_document.created_at.isoformat(),
                },
            ],
            "conversation_history": [{"role": "user", "content": "We are repositioning the brand."}],
        }

    monkeypatch.setattr(routes, "plan_project_workflow_command", fake_plan_project_workflow_command)
    monkeypatch.setattr(routes, "_get_workforce_agent_for_project", lambda *_args, **_kwargs: DummyExternalChatAgent())
    monkeypatch.setattr(routes, "is_openrouter_configured", lambda: True)

    response = await routes.run_project_chat(
        project_id=project.id,
        payload=ProjectChatRequest(
            message="Scan the current media and produce a better branding package.",
            scope="media",
            conversation=[{"role": "user", "content": "We are repositioning the brand."}],
            document_ids=[image_document.id, text_document.id],
            artifact_ids=[],
            model_target="openrouter",
            external_model="google/gemini-2.5-pro",
        ),
        db=db_session,
    )

    assert response.project_id == project.id
    assert response.model_target == "openrouter"
    assert response.model == "openrouter/google/gemini-2.5-pro"
    assert response.vision_enabled is True
    assert response.used_vision_filenames == ["hero-shot.png"]
    assert response.execution is not None
    assert response.execution.run.status == "completed"
    assert response.assistant_message.startswith("I scanned the attached media")
    assert [document.filename for document in response.referenced_documents] == ["hero-shot.png", "style-guide.md"]


@pytest.mark.asyncio
async def test_project_chat_route_can_use_video_frames_and_transcript_context(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    project = ProjectRecord(
        name="Video Chat Route",
        description="Use chat to critique source clips.",
        domains=["web", "youtube"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    video_path = tmp_path / "source-clip.mp4"
    video_path.write_bytes(b"fake-video")
    video_document = DocumentRecord(
        project_id=project.id,
        filename="source-clip.mp4",
        path=str(video_path),
        size=video_path.stat().st_size,
        content_type="video/mp4",
        source_path=str(video_path),
        is_reference=False,
        version=1,
    )
    db_session.add(video_document)
    db_session.commit()
    db_session.refresh(video_document)

    async def fake_plan_project_workflow_command(**_kwargs):
        return {
            "summary": "Critique the uploaded source clip.",
            "rationale": "The user wants a focused critique of one video asset.",
            "execution_mode": "agent",
            "task": "Review the current clip and produce critique notes.",
            "pipeline_kind": None,
            "workforce": "media",
            "agent_id": "video_critic",
            "steps": [],
            "context_focus": ["current source clip", "visual frames", "transcript"],
            "referenced_document_ids": [video_document.id],
            "referenced_artifact_ids": [],
            "model": "ollama/test-workflow",
            "selected_documents": [
                {
                    "id": video_document.id,
                    "filename": video_document.filename,
                    "content_type": video_document.content_type,
                    "kind": "video",
                    "source_path": video_document.source_path,
                    "path": video_document.path,
                    "is_reference": False,
                    "size": video_document.size,
                    "preview": "",
                }
            ],
            "selected_artifacts": [],
            "relevant_document_excerpts": [],
            "project_media_inventory": [
                {
                    "id": video_document.id,
                    "filename": video_document.filename,
                    "kind": "video",
                    "content_type": video_document.content_type,
                    "size": video_document.size,
                    "source_path": video_document.source_path,
                    "created_at": video_document.created_at.isoformat(),
                }
            ],
            "conversation_history": [],
        }

    async def fake_build_multimodal_attachments_and_transcripts(_documents, **_kwargs):
        return {
            "attachments": [
                {
                    "document_id": video_document.id,
                    "filename": "source-clip.mp4 frame 1",
                    "source_filename": "source-clip.mp4",
                    "source_kind": "video_frame",
                    "mime_type": "image/jpeg",
                    "size": 1024,
                    "part": {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,ZmFrZS0x"}},
                },
                {
                    "document_id": video_document.id,
                    "filename": "source-clip.mp4 frame 2",
                    "source_filename": "source-clip.mp4",
                    "source_kind": "video_frame",
                    "mime_type": "image/jpeg",
                    "size": 1024,
                    "part": {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,ZmFrZS0y"}},
                },
            ],
            "skipped": [],
            "vision_source_names": ["source-clip.mp4"],
            "transcripts": [
                {
                    "document_id": video_document.id,
                    "filename": "source-clip.mp4",
                    "source_kind": "video_transcript",
                    "text": "Transcript text from the source clip.",
                }
            ],
            "transcript_source_names": ["source-clip.mp4"],
            "cache": {
                "cached_vision_filenames": ["source-clip.mp4"],
                "generated_vision_filenames": [],
                "cached_transcript_filenames": [],
                "generated_transcript_filenames": ["source-clip.mp4"],
            },
        }

    monkeypatch.setattr(routes, "plan_project_workflow_command", fake_plan_project_workflow_command)
    monkeypatch.setattr(routes, "_get_workforce_agent_for_project", lambda *_args, **_kwargs: DummyVideoTranscriptAgent())
    monkeypatch.setattr(routes, "build_multimodal_attachments_and_transcripts", fake_build_multimodal_attachments_and_transcripts)
    monkeypatch.setattr(routes, "get_local_vision_model", lambda: "ollama/llava")
    monkeypatch.setattr(routes, "model_supports_vision", lambda _model: True)

    response = await routes.run_project_chat(
        project_id=project.id,
        payload=ProjectChatRequest(
            message="Review the current clip and tell me what to tighten.",
            scope="media",
            conversation=[],
            document_ids=[video_document.id],
            artifact_ids=[],
            model_target="local",
        ),
        db=db_session,
    )

    assert response.model == "ollama/llava"
    assert response.vision_enabled is True
    assert response.audio_transcription_enabled is True
    assert response.used_vision_filenames == ["source-clip.mp4"]
    assert response.used_transcript_filenames == ["source-clip.mp4"]
    assert response.multimodal_cache.cached_vision_filenames == ["source-clip.mp4"]
    assert response.multimodal_cache.generated_transcript_filenames == ["source-clip.mp4"]
    assert response.execution is not None
    assert response.execution.run.status == "completed"
    assert response.assistant_message.startswith("I reviewed the clip frames")
