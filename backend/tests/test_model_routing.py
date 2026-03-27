from __future__ import annotations

import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from agents.base_agent import AgentRequest, BaseAgent
from api import routes
from database import Base
from database_models import ModelCatalogRecord
from models.router import RoutingDecision, ModelTier


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
async def test_model_routing_config_includes_catalog_models(db_session: Session, monkeypatch: pytest.MonkeyPatch):
    db_session.add(
        ModelCatalogRecord(
            id="openai/gpt-5.1",
            provider="openrouter",
            name="GPT-5.1",
            description="Latest OpenAI frontier model",
            context_length=128000,
            input_cost_per_1k=0.0025,
            output_cost_per_1k=0.015,
            supports_images=False,
            supports_tool_use=False,
            is_free=False,
            top_provider="128000",
        )
    )
    db_session.commit()

    class DummyRouter:
        def get_config(self) -> dict:
            return {
                "agent_overrides": {},
                "tier_overrides": {},
                "defaults": {"reasoning": ["openrouter/auto"]},
                "agent_tier_map": {"media.scriptwriter": "reasoning"},
                "strategy": "balanced",
                "strategies": ["performance", "cost", "balanced"],
            }

    monkeypatch.setattr(routes, "get_model_router", lambda: DummyRouter())
    monkeypatch.setattr(
        routes,
        "get_configured_providers",
        lambda: [{"name": "openrouter", "configured": True, "base_url": "https://openrouter.ai/api/v1", "models": []}],
    )

    response = await routes.get_model_routing_config(db_session)

    assert "openrouter/auto" in response["supported_models"]
    assert "openrouter/openai/gpt-5.1" in response["supported_models"]
    assert response["providers"][0]["name"] == "openrouter"
    assert response["model_costs"]["openrouter/openai/gpt-5.1"]["input"] == pytest.approx(0.0025)


@pytest.mark.asyncio
async def test_base_agent_uses_model_router_when_no_explicit_override(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, object] = {}

    class DummyRouter:
        def select(self, agent_name: str, *, tier_hint=None, context_tokens: int = 0) -> RoutingDecision:
            captured["agent_name"] = agent_name
            captured["context_tokens"] = context_tokens
            return RoutingDecision(
                model="openrouter/auto",
                tier=ModelTier.REASONING,
                reason="balanced strategy for tier 'reasoning'",
                estimated_cost_per_1k=0.01,
            )

    class DummyResponse:
        choices = [type("Choice", (), {"message": type("Message", (), {"content": "routed output"})()})()]

    async def fake_chat_completion(**kwargs):
        captured["model"] = kwargs.get("model")
        return DummyResponse()

    monkeypatch.setattr("agents.base_agent.get_model_router", lambda: DummyRouter())
    monkeypatch.setattr("agents.base_agent.chat_completion", fake_chat_completion)

    agent = BaseAgent(name="TestAgent", system_prompt="Route me")
    response = await agent.process(
        AgentRequest(
            session_id="session-1",
            user_input="Write the review.",
            context={"agent_slug": "media.scriptwriter", "topic": "LLPS"},
        )
    )

    assert captured["agent_name"] == "media.scriptwriter"
    assert captured["model"] == "openrouter/auto"
    assert response.content == "routed output"
    assert response.metadata["model"] == "openrouter/auto"
    assert response.metadata["routing"]["tier"] == "reasoning"
