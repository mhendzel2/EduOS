from __future__ import annotations

from abc import ABC
import json
import logging
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from models.model_client import (
    chat_completion,
    extract_text,
    get_default_model,
    get_local_workflow_model,
    model_supports_vision,
)
from models.router import get_model_router
from services.multimodal import build_multimodal_user_content

logger = logging.getLogger(__name__)


class AgentRequest(BaseModel):
    session_id: str
    user_input: str
    context: Optional[Dict[str, Any]] = None


class AgentResponse(BaseModel):
    agent_name: str
    content: str
    artifact_type: Optional[str] = None
    action_items: List[str] = Field(default_factory=list)
    confidence: float = 0.9
    metadata: Dict[str, Any] = Field(default_factory=dict)


class BaseAgent(ABC):
    def __init__(
        self,
        name: str,
        system_prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        is_gate: bool = False,
        artifact_type: Optional[str] = None,
        role_description: str = "",
    ):
        self.name = name
        self.system_prompt = system_prompt
        self.model = model or get_default_model()
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.is_gate = is_gate
        self.artifact_type = artifact_type
        self.role_description = role_description or name

    async def process(self, request: AgentRequest) -> AgentResponse:
        messages = [{"role": "system", "content": self.system_prompt}]
        effective_model = self.model
        routing_metadata: dict[str, Any] = {}
        multimodal_attachments: list[dict[str, Any]] = []
        multimodal_transcripts: list[dict[str, Any]] = []
        if request.context:
            if request.context.get("force_local_model"):
                effective_model = get_local_workflow_model()
            else:
                model_override = str(request.context.get("model_override") or "").strip()
                if model_override:
                    effective_model = model_override
                else:
                    agent_slug = str(
                        request.context.get("agent_slug")
                        or request.context.get("requested_agent")
                        or ""
                    ).strip()
                    if agent_slug:
                        approx_tokens = self._estimate_context_tokens(request.user_input, request.context)
                        decision = get_model_router().select(agent_slug, context_tokens=approx_tokens)
                        effective_model = decision.model
                        routing_metadata = {
                            "selected_model": decision.model,
                            "tier": decision.tier.value,
                            "reason": decision.reason,
                            "estimated_cost_per_1k": decision.estimated_cost_per_1k,
                            "agent_slug": agent_slug,
                        }

        if request.context:
            context_payload = dict(request.context)
            raw_attachments = context_payload.pop("multimodal_attachments", [])
            if isinstance(raw_attachments, list):
                multimodal_attachments = [item for item in raw_attachments if isinstance(item, dict)]
            raw_transcripts = context_payload.pop("multimodal_transcripts", [])
            if isinstance(raw_transcripts, list):
                multimodal_transcripts = [item for item in raw_transcripts if isinstance(item, dict)]
            messages.append(
                {
                    "role": "system",
                    "content": f"[Project Context]\n{self._format_context(context_payload)}",
                }
            )

        user_content: Any = request.user_input
        if multimodal_attachments and model_supports_vision(effective_model):
            user_content = build_multimodal_user_content(
                request.user_input,
                multimodal_attachments,
                multimodal_transcripts,
            )
        elif multimodal_transcripts:
            user_content = build_multimodal_user_content(request.user_input, [], multimodal_transcripts)

        messages.append({"role": "user", "content": user_content})

        try:
            response = await chat_completion(
                messages=messages,
                model=effective_model,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )
            return AgentResponse(
                agent_name=self.name,
                content=extract_text(response),
                artifact_type=self.artifact_type,
                confidence=0.9,
                metadata={"model": effective_model, **({"routing": routing_metadata} if routing_metadata else {})},
            )
        except Exception as exc:
            logger.warning("[%s] Falling back due to model error: %s", self.name, exc)
            return AgentResponse(
                agent_name=self.name,
                content=self._fallback_content(request, exc),
                artifact_type=self.artifact_type,
                confidence=0.2,
                metadata={"fallback": True, "error": str(exc)},
            )

    def _format_context(self, context: Dict[str, Any]) -> str:
        parts: list[str] = []
        for key, value in context.items():
            if isinstance(value, (dict, list)):
                parts.append(f"{key}:\n{json.dumps(value, indent=2, ensure_ascii=True)}")
            else:
                parts.append(f"{key}: {value}")
        return "\n".join(parts)

    def _fallback_content(self, request: AgentRequest, error: Exception) -> str:
        if self.is_gate:
            return json.dumps(
                {
                    "passed": False,
                    "reason": f"llm_unavailable: {error}",
                    "revisions": ["Configure an LLM provider or start Ollama, then rerun the gate."],
                    "blocking": True,
                }
            )
        return (
            f"[Fallback output from {self.name}]\n\n"
            f"Prompt summary: {request.user_input[:800]}\n\n"
            "A live model was unavailable, so this placeholder response was returned to keep the workflow moving."
        )

    def _estimate_context_tokens(self, user_input: str, context: Dict[str, Any]) -> int:
        serialized_context = self._format_context(context)
        rough_chars = len(user_input or "") + len(serialized_context)
        return max(1, rough_chars // 4)
