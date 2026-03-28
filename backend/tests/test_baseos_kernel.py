from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from agents.base_agent import AgentRequest, BaseAgent
from baseos.contracts import GovernanceSpec, ProjectMemory, TaskClassification, WorkspaceMemory
from baseos.tools import mcp_connector


def test_baseos_agent_request_defaults():
    request = AgentRequest(session_id="session-1", user_input="hello")
    assert request.context == {}
    assert request.turboquant_kv_compression_enabled is False


def test_governance_contracts_validate():
    classification = TaskClassification(
        scope="project",
        risk="medium",
        novelty="low",
        governance_class="review_required",
        integration_level="project",
        failure_cost="moderate",
        reasoning="Educational publishing needs review but not director escalation.",
    )
    spec = GovernanceSpec(
        require_red_team=False,
        min_independent_model_opinions=2,
        require_council_for=["high_risk_publish"],
        director_escalation_rules=["escalate on conflicting reviewer conclusions"],
        confidence_thresholds={"publish": 0.8},
        approval_required_artifacts=["final_review"],
        audit_requirements=["store reviewer artifacts"],
    )
    assert classification.governance_class == "review_required"
    assert spec.confidence_thresholds["publish"] == pytest.approx(0.8)


@pytest.mark.asyncio
async def test_base_agent_can_apply_turboquant_to_memory_context(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, object] = {}

    class DummyResponse:
        choices = [type("Choice", (), {"message": type("Message", (), {"content": "compressed output"})()})()]

    async def fake_chat_completion(**kwargs):
        captured["messages"] = kwargs["messages"]
        return DummyResponse()

    async def fake_compress_context(memory_text: str, engine_model: str | None = None) -> str:
        return "<turboquant_compressed_cache>\ndense memory\n</turboquant_compressed_cache>"

    monkeypatch.setattr("agents.base_agent.chat_completion", fake_chat_completion)
    monkeypatch.setattr("agents.base_agent.TurboQuantCompressor.compress_context", fake_compress_context)

    agent = BaseAgent(name="KernelAgent", system_prompt="Use memory well.")
    response = await agent.process(
        AgentRequest(
            session_id="session-2",
            user_input="Draft the next review step.",
            project_memory=ProjectMemory(
                project_id="project-1",
                project_name="CellNucleus",
                summary="Long project memory " * 80,
                pinned_facts=["Preserve evidence caveats.", "Keep website and YouTube outputs aligned."],
            ),
            workspace_memory=WorkspaceMemory(
                summary="Long workspace memory " * 80,
                pinned_facts=["Reuse rigorous review templates."],
            ),
            turboquant_kv_compression_enabled=True,
        )
    )

    system_messages = [message["content"] for message in captured["messages"] if message["role"] == "system"]
    assert any("<turboquant_compressed_cache>" in str(message) for message in system_messages)
    assert response.metadata["context_compression"]["mode"] == "turboquant"
    assert set(response.metadata["context_compression"]["sections"]) == {"project_memory", "workspace_memory"}


@pytest.mark.asyncio
async def test_mcp_connector_handles_missing_sdk(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(mcp_connector, "MCP_AVAILABLE", False)
    connector = mcp_connector.McpConnector("python", ["-V"])

    assert await connector.get_tools() == []
    with pytest.raises(RuntimeError):
        await connector.connect()
