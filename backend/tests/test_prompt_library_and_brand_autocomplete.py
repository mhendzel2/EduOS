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
from api.schemas import (
    BrandAutocompleteRequest,
    PromptFeedbackCreate,
    PromptOptimizationRequest,
    PromptTemplateCreate,
    PromptTemplateUpdate,
)
from database import Base
from database_models import DocumentRecord, ProjectRecord
from services.brand_autocomplete import generate_brand_autocomplete
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
async def test_prompt_library_routes_seed_create_and_update(db_session: Session):
    ensure_default_prompt_templates(db_session)

    project = ProjectRecord(
        name="Prompt Project",
        description="Prompt testing.",
        domains=["web", "youtube"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    seeded = await routes.get_prompt_library(category="brand_autocomplete", project_id=project.id, db=db_session)
    assert any(prompt.slug == "brand-autocomplete-default" for prompt in seeded.prompts)

    created = await routes.create_prompt_template(
        PromptTemplateCreate(
            project_id=project.id,
            name="Project Brand Prompt",
            category="brand_autocomplete",
            target_kind="brand_bible",
            description="Project-specific template",
            system_prompt="System prompt",
            user_prompt_template="User prompt",
            tags=["brand", "project"],
            metadata={"scope": "project"},
        ),
        db=db_session,
    )
    assert created.project_id == project.id
    assert created.slug == "project-brand-prompt"

    updated = await routes.update_prompt_template(
        created.id,
        PromptTemplateUpdate(
            name="Project Brand Prompt v2",
            description="Updated description",
            tags=["brand", "project", "updated"],
        ),
        db=db_session,
    )
    assert updated.name == "Project Brand Prompt v2"
    assert updated.slug == "project-brand-prompt-v2"
    assert "updated" in updated.tags


@pytest.mark.asyncio
async def test_prompt_feedback_routes_and_local_optimization_create_variant(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
):
    ensure_default_prompt_templates(db_session)

    project = ProjectRecord(
        name="Prompt Feedback Project",
        description="Feedback loop testing.",
        domains=["web"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    created = await routes.create_prompt_template(
        PromptTemplateCreate(
            project_id=project.id,
            name="Feedback Prompt",
            category="brand_autocomplete",
            target_kind="brand_bible",
            description="Prompt to optimize from feedback.",
            system_prompt="Write concise brand guidance.",
            user_prompt_template="Project: {{project_name}}",
            tags=["brand"],
            metadata={"scope": "feedback"},
        ),
        db=db_session,
    )

    await routes.create_prompt_template_feedback(
        created.id,
        PromptFeedbackCreate(
            project_id=project.id,
            score=2,
            would_reuse=False,
            use_case="brand autocomplete",
            strengths=["clear structure"],
            failure_modes=["too generic", "weak formatting discipline"],
            notes="The output was readable but did not produce enough specific rules.",
            task_input="Generate a style guide from project notes.",
            output_excerpt='{"style_guide": {"voice": "friendly"}}',
        ),
        db=db_session,
    )
    await routes.create_prompt_template_feedback(
        created.id,
        PromptFeedbackCreate(
            project_id=project.id,
            score=5,
            would_reuse=True,
            use_case="brand autocomplete",
            strengths=["clear structure", "good audience fit"],
            failure_modes=["slight verbosity"],
            notes="Useful result overall; tighten the tone constraints a bit more.",
        ),
        db=db_session,
    )

    feedback_list = await routes.get_prompt_template_feedback(created.id, db=db_session)
    assert feedback_list.summary is not None
    assert feedback_list.summary.feedback_count == 2
    assert feedback_list.summary.average_score == 3.5
    assert "clear structure" in feedback_list.summary.common_strengths
    assert "too generic" in feedback_list.summary.common_failures

    prompts = await routes.get_prompt_library(category="brand_autocomplete", project_id=project.id, db=db_session)
    matching = next(prompt for prompt in prompts.prompts if prompt.id == created.id)
    assert matching.feedback_summary is not None
    assert matching.feedback_summary.feedback_count == 2

    class DummyResponse:
        choices = [
            SimpleNamespace(
                message=SimpleNamespace(
                    content=(
                        '{'
                        '"optimized_name":"Feedback Prompt Optimized",'
                        '"system_prompt":"Write concise, concrete, channel-aware brand guidance with explicit formatting rules.",'
                        '"user_prompt_template":"Project: {{project_name}}\\nDeliver 3 reusable rules with examples.",'
                        '"rationale":"Feedback shows the prompt needs more specificity and better formatting discipline.",'
                        '"changes":["Added stronger specificity constraints","Reduced generic outputs"],'
                        '"metadata_updates":{"optimizer_model":"ollama/test-optimizer"}'
                        '}'
                    )
                )
            )
        ]

    async def fake_chat_completion(**kwargs):
        assert kwargs["model"] == "ollama/test-optimizer"
        return DummyResponse()

    monkeypatch.setattr("services.prompt_feedback.chat_completion", fake_chat_completion)
    monkeypatch.setattr("services.prompt_feedback.get_local_workflow_model", lambda: "ollama/test-optimizer")

    optimized = await routes.optimize_prompt_template(
        created.id,
        PromptOptimizationRequest(
            project_id=project.id,
            goal="Improve specificity and format discipline.",
            create_variant=True,
            variant_name="Feedback Prompt Variant",
        ),
        db=db_session,
    )

    assert optimized.optimized_name == "Feedback Prompt Variant"
    assert "specificity" in optimized.rationale.lower()
    assert optimized.created_prompt is not None
    assert optimized.created_prompt.name == "Feedback Prompt Variant"
    assert optimized.created_prompt.project_id == project.id
    assert optimized.created_prompt.metadata["derived_from_prompt_id"] == created.id
    assert optimized.created_prompt.system_prompt.startswith("Write concise, concrete")


@pytest.mark.asyncio
async def test_brand_autocomplete_prefers_high_feedback_prompt_variant(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
):
    ensure_default_prompt_templates(db_session)

    project = ProjectRecord(
        name="Adaptive Prompt Project",
        description="Runtime prompt selection testing.",
        domains=["web"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    weaker_prompt = await routes.create_prompt_template(
        PromptTemplateCreate(
            project_id=project.id,
            name="Style Guide Weak Prompt",
            category="brand_autocomplete",
            target_kind="brand_bible",
            description="Weaker style guide variant.",
            system_prompt="Write style guidance.",
            user_prompt_template="Project: {{project_name}}",
            tags=["brand", "style-guide"],
            metadata={"focus": "style_guide"},
        ),
        db=db_session,
    )
    stronger_prompt = await routes.create_prompt_template(
        PromptTemplateCreate(
            project_id=project.id,
            name="Style Guide Strong Prompt",
            category="brand_autocomplete",
            target_kind="brand_bible",
            description="Higher-performing style guide variant.",
            system_prompt="Write concrete style guidance with formatting rules.",
            user_prompt_template="Project: {{project_name}}",
            tags=["brand", "style-guide"],
            metadata={"focus": "style_guide"},
        ),
        db=db_session,
    )

    await routes.create_prompt_template_feedback(
        weaker_prompt.id,
        PromptFeedbackCreate(
            project_id=project.id,
            score=2,
            would_reuse=False,
            use_case="brand autocomplete",
            failure_modes=["too generic"],
            notes="Did not provide enough concrete rules.",
        ),
        db=db_session,
    )
    await routes.create_prompt_template_feedback(
        stronger_prompt.id,
        PromptFeedbackCreate(
            project_id=project.id,
            score=5,
            would_reuse=True,
            use_case="brand autocomplete",
            strengths=["concrete rules", "strong formatting discipline"],
            notes="This variant should be preferred automatically.",
        ),
        db=db_session,
    )

    async def fake_generate_brand_autocomplete(**kwargs):
        template = kwargs["template"]
        return {
            "field": kwargs["field"],
            "suggestions": {"style_guide": {"headline_case": "Use title case for section headings."}},
            "rationale": f"Used template: {template.name}",
            "raw_text": "{}",
            "context_documents": [],
        }

    monkeypatch.setattr("api.routes.generate_brand_autocomplete", fake_generate_brand_autocomplete)

    response = await routes.autocomplete_project_brand_bible(
        project.id,
        BrandAutocompleteRequest(field="style_guide"),
        db=db_session,
    )

    stronger_feedback = list_prompt_feedback_records(db_session, stronger_prompt.id, limit=5)
    assert response.prompt_template_id == stronger_prompt.id
    assert response.prompt_template_name == stronger_prompt.name
    assert stronger_prompt.name in response.rationale
    assert len(stronger_feedback) == 2
    assert stronger_feedback[0].feedback_source == "auto_runtime"
    assert stronger_feedback[0].score >= 4
    assert stronger_feedback[0].use_case == "brand_autocomplete"
    assert stronger_feedback[0].metadata_["requested_field"] == "style_guide"


@pytest.mark.asyncio
async def test_generate_brand_autocomplete_uses_recent_document_context(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    ensure_default_prompt_templates(db_session)
    template = db_session.query(routes.PromptTemplateRecord).filter(
        routes.PromptTemplateRecord.slug == "brand-autocomplete-default"
    ).first()
    assert template is not None

    project = ProjectRecord(
        name="CellNucleus Brand",
        description="A populated media project.",
        domains=["web", "youtube"],
        story_bible={"latest_outline": "High-trust scientific explainers."},
        brand_bible={"brand_name": "CellNucleus", "voice_tone": "clear and rigorous"},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    doc_path = tmp_path / "site-notes.md"
    doc_path.write_text(
        "# Editorial notes\nUse precise scientific language, avoid hype, and keep YouTube intros under 20 seconds.\n",
        encoding="utf-8",
    )
    document = DocumentRecord(
        project_id=project.id,
        filename="site-notes.md",
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
                        '{"suggestions":{"style_guide":{"headline_style":"Measured, specific, non-hype",'
                        '"intro_length":"Lead with the scientific stake within 20 seconds"}},"rationale":"Built from the project notes."}'
                    )
                )
            )
        ]

    captured: dict[str, str] = {}

    async def fake_chat_completion(**_kwargs):
        captured["model"] = str(_kwargs.get("model") or "")
        return DummyResponse()

    monkeypatch.setattr("services.brand_autocomplete.chat_completion", fake_chat_completion)
    monkeypatch.setattr("services.brand_autocomplete.get_local_autofill_model", lambda: "ollama/test-local-model")

    vector_store = VectorStore(path=str(tmp_path / "vector_store"), collection_name="prompt_tests")
    vector_store._use_memory_fallback()

    result = await generate_brand_autocomplete(
        project=project,
        db=db_session,
        template=template,
        field="style_guide",
        guidance="Focus on editorial consistency.",
        current_brand_bible=project.brand_bible or {},
        vector_store=vector_store,
    )

    assert result["suggestions"]["style_guide"]["headline_style"] == "Measured, specific, non-hype"
    assert "site-notes.md" in result["context_documents"]
    assert captured["model"] == "ollama/test-local-model"


@pytest.mark.asyncio
async def test_brand_autocomplete_route_returns_structured_suggestions(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
):
    ensure_default_prompt_templates(db_session)

    project = ProjectRecord(
        name="Autocomplete Route",
        description="Route test.",
        domains=["web", "youtube"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    async def fake_generate_brand_autocomplete(**_kwargs):
        return {
            "field": "voice_tone",
            "suggestions": {"voice_tone": "Measured, expert, and direct"},
            "rationale": "Matches current editorial posture.",
            "context_documents": ["editorial.md"],
        }

    vector_store = VectorStore(path=":memory:", collection_name="route_test")
    vector_store._use_memory_fallback()

    monkeypatch.setattr(routes, "generate_brand_autocomplete", fake_generate_brand_autocomplete)
    monkeypatch.setattr(routes, "get_vector_store_service", lambda: vector_store)

    response = await routes.autocomplete_project_brand_bible(
        project_id=project.id,
        payload=BrandAutocompleteRequest(field="voice_tone", brand_bible={"brand_name": "Route Test"}),
        db=db_session,
    )

    assert response.project_id == project.id
    assert response.field == "voice_tone"
    assert response.suggestions["voice_tone"] == "Measured, expert, and direct"
    assert response.context_documents == ["editorial.md"]
