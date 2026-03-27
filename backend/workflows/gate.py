"""
Gate evaluation logic for StudioOS.
"""
from __future__ import annotations

import json
from typing import Optional

from pydantic import BaseModel, Field

from agents.base_agent import AgentRequest


class GateVerdict(BaseModel):
    passed: bool
    reason: str
    revisions: list[str] = Field(default_factory=list)
    blocking: bool = True


class GateResult(BaseModel):
    gate_agent: str
    artifact_type: str
    verdict: GateVerdict
    run_id: Optional[str] = None
    step_index: Optional[int] = None


async def evaluate_gate(
    gate_agent,
    artifact_content: str,
    artifact_type: str,
    project_context: dict,
    story_bible: Optional[dict] = None,
    brand_bible: Optional[dict] = None,
) -> GateResult:
    context = {
        "artifact_type": artifact_type,
        "project_context": project_context,
        "agent_slug": project_context.get("agent_slug", ""),
        "requested_agent": project_context.get("requested_agent", ""),
    }
    if story_bible:
        context["story_bible"] = story_bible
    if brand_bible:
        context["brand_bible"] = brand_bible

    response = await gate_agent.process(
        AgentRequest(
            session_id=project_context.get("project_id", "gate-eval"),
            user_input=artifact_content,
            context=context,
        )
    )

    try:
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        verdict = GateVerdict(**json.loads(raw))
    except Exception as exc:
        verdict = GateVerdict(
            passed=False,
            reason=f"gate_agent_parse_error: {exc}",
            revisions=["Gate agent returned unparseable response. Re-run gate."],
            blocking=True,
        )

    return GateResult(
        gate_agent=gate_agent.name,
        artifact_type=artifact_type,
        verdict=verdict,
    )
