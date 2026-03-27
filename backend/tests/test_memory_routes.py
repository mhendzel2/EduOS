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

from api import routes
from api.schemas import MemoryAutocompleteRequest, MemoryUpdateRequest
from database import Base
from database_models import DocumentRecord, ProjectRecord
from services.memory import generate_project_memory_autocomplete, get_memory_context
from services.prompt_feedback import list_prompt_feedback_records
from services.prompt_library import ensure_default_prompt_templates
from storage.vector_store import VectorStore


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
async def test_memory_routes_create_update_and_context(db_session: Session):
    project = ProjectRecord(
        name="Memory Project",
        description="Testing memory routes.",
        domains=["writing", "web"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    workspace_memory = await routes.get_workspace_memory_route(db=db_session)
    assert workspace_memory.id == "global"
    assert workspace_memory.pinned_facts == []

    updated_workspace = await routes.update_workspace_memory_route(
        MemoryUpdateRequest(
            summary="Use the same editorial QA pass across projects.",
            pinned_facts=["Reuse checklists before publishing.", "Keep canonical pages in local repos."],
        ),
        db=db_session,
    )
    assert "Reuse checklists" in updated_workspace.pinned_facts[0]

    project_memory = await routes.get_project_memory_route(project_id=project.id, db=db_session)
    assert project_memory.project_id == project.id

    updated_project = await routes.update_project_memory_route(
        project_id=project.id,
        payload=MemoryUpdateRequest(
            summary="This project prioritizes scientific explainers.",
            pinned_facts=["Lead with the scientific takeaway.", "Avoid hype language."],
        ),
        db=db_session,
    )
    assert updated_project.summary.startswith("This project prioritizes")

    refreshed_project = db_session.query(ProjectRecord).filter(ProjectRecord.id == project.id).first()
    assert refreshed_project is not None
    context = get_memory_context(refreshed_project, db=db_session)
    assert context["workspace_memory"]["summary"] == "Use the same editorial QA pass across projects."
    assert "Avoid hype language." in context["project_memory"]["pinned_facts"]


@pytest.mark.asyncio
async def test_generate_project_memory_autocomplete_uses_project_context(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    ensure_default_prompt_templates(db_session)
    template = db_session.query(routes.PromptTemplateRecord).filter(
        routes.PromptTemplateRecord.slug == "project-memory-autocomplete-default"
    ).first()
    assert template is not None

    project = ProjectRecord(
        name="CellNucleus Memory",
        description="A web and YouTube project.",
        domains=["web", "youtube"],
        story_bible={"latest_outline": "Scientific explainers with direct intros."},
        brand_bible={"voice_tone": "clear, direct, evidence-backed"},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    doc_path = tmp_path / "workflow-notes.md"
    doc_path.write_text(
        "# Workflow\nUse the same upload checklist for every channel and keep website sources in local directories.\n",
        encoding="utf-8",
    )
    document = DocumentRecord(
        project_id=project.id,
        filename="workflow-notes.md",
        path=str(doc_path),
        size=doc_path.stat().st_size,
        content_type="text/markdown",
        source_path=str(doc_path),
        is_reference=True,
        version=1,
    )
    db_session.add(document)
    db_session.commit()

    class DummyResponse:
        choices = [
            SimpleNamespace(
                message=SimpleNamespace(
                    content=(
                        '{"summary":"Shared upload and publishing steps should stay consistent for this project.",'
                        '"pinned_facts":["Reuse the upload checklist for each release.","Keep website files in their source repo directories."],'
                        '"rationale":"Built from the project workflow notes."}'
                    )
                )
            )
        ]

    captured: dict[str, str] = {}

    async def fake_chat_completion(**_kwargs):
        captured["model"] = str(_kwargs.get("model") or "")
        return DummyResponse()

    monkeypatch.setattr("services.memory.chat_completion", fake_chat_completion)
    monkeypatch.setattr("services.memory.get_local_autofill_model", lambda: "ollama/test-local-memory")

    vector_store = VectorStore(path=str(tmp_path / "vector_store"), collection_name="memory_tests")
    vector_store._use_memory_fallback()

    result = await generate_project_memory_autocomplete(
        project=project,
        db=db_session,
        template=template,
        guidance="Focus on reusable workflow rules.",
        vector_store=vector_store,
    )

    assert result["summary"].startswith("Shared upload")
    assert "workflow-notes.md" in result["context_sources"]
    assert captured["model"] == "ollama/test-local-memory"


@pytest.mark.asyncio
async def test_workspace_memory_autocomplete_route_returns_structured_result(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
):
    ensure_default_prompt_templates(db_session)

    async def fake_generate_workspace_memory_autocomplete(**_kwargs):
        return {
            "summary": "Use the same publishing checklist and API targeting defaults across projects.",
            "pinned_facts": [
                "Keep pre-existing sites in their local directories.",
                "Reuse prompt templates for repeated automation tasks.",
            ],
            "rationale": "Built from existing workspace activity.",
            "context_sources": ["project:CellNucleus.com", "run:abc123"],
        }

    monkeypatch.setattr(routes, "generate_workspace_memory_autocomplete", fake_generate_workspace_memory_autocomplete)

    response = await routes.autocomplete_workspace_memory(
        payload=MemoryAutocompleteRequest(guidance="Focus on stable cross-project operating rules."),
        db=db_session,
    )

    template = db_session.query(routes.PromptTemplateRecord).filter(
        routes.PromptTemplateRecord.slug == "workspace-memory-autocomplete-default"
    ).first()
    assert template is not None

    feedback_records = list_prompt_feedback_records(db_session, template.id, limit=5)
    assert response.scope == "workspace"
    assert response.summary.startswith("Use the same publishing checklist")
    assert response.context_sources == ["project:CellNucleus.com", "run:abc123"]
    assert len(feedback_records) == 1
    assert feedback_records[0].feedback_source == "auto_runtime"
    assert feedback_records[0].use_case == "workspace_memory_autocomplete"
    assert feedback_records[0].score >= 4
    assert feedback_records[0].metadata_["success"] is True


@pytest.mark.asyncio
async def test_workspace_memory_autocomplete_captures_failure_feedback(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
):
    ensure_default_prompt_templates(db_session)

    async def fake_generate_workspace_memory_autocomplete(**_kwargs):
        raise ValueError("Model returned no reusable memory.")

    monkeypatch.setattr(routes, "generate_workspace_memory_autocomplete", fake_generate_workspace_memory_autocomplete)

    with pytest.raises(routes.HTTPException) as excinfo:
        await routes.autocomplete_workspace_memory(
            payload=MemoryAutocompleteRequest(guidance="Focus on stable cross-project operating rules."),
            db=db_session,
        )

    template = db_session.query(routes.PromptTemplateRecord).filter(
        routes.PromptTemplateRecord.slug == "workspace-memory-autocomplete-default"
    ).first()
    assert template is not None

    feedback_records = list_prompt_feedback_records(db_session, template.id, limit=5)
    assert excinfo.value.status_code == 422
    assert len(feedback_records) == 1
    assert feedback_records[0].feedback_source == "auto_runtime"
    assert feedback_records[0].score == 1
    assert feedback_records[0].failure_modes == ["validation_error"]
    assert feedback_records[0].metadata_["success"] is False
