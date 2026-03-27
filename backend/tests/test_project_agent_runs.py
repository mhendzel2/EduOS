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
from database import Base
from database_models import ArtifactRecord, ProjectRecord, RunRecord


class DummyProjectAgent:
    artifact_type = "outline"

    async def process(self, request: AgentRequest) -> AgentResponse:
        assert request.context is not None
        assert request.context["project_name"] == "Project Agent Test"
        return AgentResponse(
            agent_name="DummyProjectAgent",
            content="Generated outline from persisted agent route.",
            artifact_type=self.artifact_type,
            confidence=0.95,
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
async def test_run_project_agent_persists_run_and_artifact(db_session: Session, monkeypatch: pytest.MonkeyPatch):
    project = ProjectRecord(
        name="Project Agent Test",
        description="Verify persisted studio runs.",
        domains=["writing"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    monkeypatch.setattr(routes, "_get_workforce_agent_for_project", lambda *_args, **_kwargs: DummyProjectAgent())

    response = await routes.run_project_agent(
        project_id=project.id,
        workforce="writing",
        agent_id="outline",
        request=AgentRequest(
            session_id="frontend-session",
            user_input="Generate the next outline.",
            context={"source": "pytest"},
        ),
        db=db_session,
    )

    db_session.refresh(project)

    runs = db_session.query(RunRecord).all()
    artifacts = db_session.query(ArtifactRecord).all()

    assert response.run.status == "completed"
    assert response.response.agent_name == "DummyProjectAgent"
    assert response.artifact is not None
    assert response.artifact.artifact_type == "outline"
    assert len(runs) == 1
    assert len(artifacts) == 1
    assert project.story_bible["latest_outline"] == "Generated outline from persisted agent route."
