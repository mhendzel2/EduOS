from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from agents.base_agent import AgentRequest, AgentResponse, BaseAgent
from agents.workforces.writing.ingestion_agent import ManuscriptIngestionAgent


@pytest.mark.asyncio
async def test_ingestion_agent_formats_structured_json_lists(monkeypatch: pytest.MonkeyPatch):
    async def fake_process(self: BaseAgent, _request: AgentRequest) -> AgentResponse:
        return AgentResponse(
            agent_name="ManuscriptIngestionAgent",
            content=(
                '{"new_characters":[{"name":"Ava","role":"Lead"}],'
                '"new_locations":[{"name":"Archive"}],'
                '"plot_points":[{"summary":"Ava finds the hidden key."}]}'
            ),
            artifact_type="ingestion_report",
            confidence=0.95,
            metadata={},
        )

    monkeypatch.setattr(BaseAgent, "process", fake_process)

    agent = ManuscriptIngestionAgent()
    response = await agent.process(
        AgentRequest(
            session_id="pytest",
            user_input="Ingest the current manuscript state.",
            context={},
        )
    )

    assert "Characters:\n- Ava - Lead" in response.content
    assert "Locations:\n- Archive" in response.content
    assert "Plot Points:\n- Ava finds the hidden key." in response.content
    assert response.metadata["parsed"]["new_characters"][0]["name"] == "Ava"
