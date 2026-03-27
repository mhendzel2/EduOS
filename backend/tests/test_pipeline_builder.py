from __future__ import annotations

import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from agents.base_agent import AgentRequest, AgentResponse
from api import routes
from api.schemas import PipelineBuilderRunRequest, PipelineBuilderStepRequest
from coordinators.local import LocalCoordinator
from database import Base
from database_models import ArtifactRecord, ProjectRecord, RunRecord


class DummyDirectorAgent:
    artifact_type = "execution_brief"
    is_gate = False

    async def process(self, request: AgentRequest) -> AgentResponse:
        assert request.context is not None
        return AgentResponse(
            agent_name="DummyDirectorAgent",
            content=f"Execution brief for {request.context['project_name']}",
            artifact_type=self.artifact_type,
            confidence=0.98,
            metadata={"source": "test"},
        )


class DummyVideoCriticAgent:
    artifact_type = "video_critique"
    is_gate = False

    async def process(self, request: AgentRequest) -> AgentResponse:
        assert "execution_brief" in request.context.get("artifacts", {})
        return AgentResponse(
            agent_name="DummyVideoCriticAgent",
            content="Video critique with actionable editing notes.",
            artifact_type=self.artifact_type,
            confidence=0.93,
            metadata={"source": "test"},
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
async def test_pipeline_builder_runs_custom_workforce_sequence(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
):
    project = ProjectRecord(
        name="Media Project",
        description="Verify the builder route can execute custom steps.",
        domains=["web", "youtube"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    workforces = {
        "coordination": {"director": DummyDirectorAgent()},
        "media": {"video_critic": DummyVideoCriticAgent()},
    }

    monkeypatch.setattr(routes, "get_active_workforces", lambda _domains: workforces)
    monkeypatch.setattr("coordinators.local.get_active_workforces", lambda _domains: workforces)
    monkeypatch.setattr("coordinators.local.get_gate_agents", lambda _domains: {})
    monkeypatch.setattr(routes, "get_coordinator", lambda: LocalCoordinator())

    response = await routes.run_project_pipeline_builder(
        project_id=project.id,
        payload=PipelineBuilderRunRequest(
            task="Assess the uploaded video and prepare the next production pass.",
            context={"source": "pytest"},
            steps=[
                PipelineBuilderStepRequest(
                    workforce="coordination",
                    agent_id="director",
                    description="Coordinate the execution brief",
                ),
                PipelineBuilderStepRequest(
                    workforce="media",
                    agent_id="video_critic",
                    description="Critique the source video",
                    requires_artifacts=["execution_brief"],
                ),
            ],
        ),
        db=db_session,
    )

    runs = db_session.query(RunRecord).all()
    artifacts = db_session.query(ArtifactRecord).order_by(ArtifactRecord.version.asc()).all()

    assert response.success is True
    assert response.plan["pipeline_kind"] == "custom"
    assert response.plan["task_type"] == "custom_pipeline"
    assert len(response.results) == 2
    assert response.results[0]["artifact_type"] == "execution_brief"
    assert response.results[1]["artifact_type"] == "video_critique"
    assert len(runs) == 1
    assert runs[0].run_type == "custom"
    assert len(artifacts) == 2
    assert artifacts[0].artifact_type == "execution_brief"
    assert artifacts[1].artifact_type == "video_critique"
