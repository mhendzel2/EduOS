from __future__ import annotations

from abc import ABC
import json
import logging
from typing import Any, Dict, Optional

from baseos.contracts import AgentRequest, AgentResponse
from baseos.services.turboquant_compressor import TurboQuantCompressor
from config import settings
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
        effective_model = request.model or self.model
        effective_temperature = self.temperature if request.temperature is None else request.temperature
        effective_max_tokens = self.max_tokens if request.max_tokens is None else request.max_tokens
        routing_metadata: dict[str, Any] = {}
        multimodal_attachments: list[dict[str, Any]] = []
        multimodal_transcripts: list[dict[str, Any]] = []
        compression_metadata: dict[str, Any] = {}
        context_payload = dict(request.context or {})
        if request.workspace_memory is not None:
            context_payload["workspace_memory"] = request.workspace_memory.model_dump()
        if request.project_memory is not None:
            context_payload["project_memory"] = request.project_memory.model_dump()

        if context_payload and not request.model:
            agent_slug = str(
                context_payload.get("agent_slug")
                or context_payload.get("requested_agent")
                or ""
            ).strip()
            if context_payload.get("force_local_model"):
                effective_model = get_local_workflow_model()
            else:
                model_override = str(context_payload.get("model_override") or "").strip()
                if model_override:
                    effective_model = model_override
                else:
                    scoped_overrides = context_payload.get("agent_model_overrides") or {}
                    scoped_model = ""
                    if isinstance(scoped_overrides, dict) and agent_slug:
                        scoped_model = str(scoped_overrides.get(agent_slug) or "").strip()
                    if scoped_model:
                        effective_model = scoped_model
                        routing_metadata = {
                            "selected_model": scoped_model,
                            "reason": f"context override for '{agent_slug}'",
                            "agent_slug": agent_slug,
                        }
                if not routing_metadata:
                    if agent_slug:
                        approx_tokens = self._estimate_context_tokens(request.user_input, context_payload)
                        decision = get_model_router().select(agent_slug, context_tokens=approx_tokens)
                        effective_model = decision.model
                        routing_metadata = {
                            "selected_model": decision.model,
                            "tier": decision.tier.value,
                            "reason": decision.reason,
                            "estimated_cost_per_1k": decision.estimated_cost_per_1k,
                            "agent_slug": agent_slug,
                        }

        if context_payload:
            raw_attachments = context_payload.pop("multimodal_attachments", [])
            if isinstance(raw_attachments, list):
                multimodal_attachments = [item for item in raw_attachments if isinstance(item, dict)]
            raw_transcripts = context_payload.pop("multimodal_transcripts", [])
            if isinstance(raw_transcripts, list):
                multimodal_transcripts = [item for item in raw_transcripts if isinstance(item, dict)]
            context_payload, compression_metadata = await self._maybe_compress_context(context_payload, request)
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
                temperature=effective_temperature,
                max_tokens=effective_max_tokens,
            )
            metadata = {"model": effective_model}
            if routing_metadata:
                metadata["routing"] = routing_metadata
            if compression_metadata:
                metadata["context_compression"] = compression_metadata
            return AgentResponse(
                agent_name=self.name,
                content=extract_text(response),
                artifact_type=self.artifact_type,
                confidence=0.9,
                metadata=metadata,
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
            if key == "agent_model_overrides":
                continue
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

    async def _maybe_compress_context(
        self,
        context: Dict[str, Any],
        request: AgentRequest,
    ) -> tuple[Dict[str, Any], dict[str, Any]]:
        compression_enabled = bool(
            request.turboquant_kv_compression_enabled
            or context.get("turboquant_kv_compression_enabled")
            or settings.TURBOQUANT_DEFAULT_ENABLED
        )
        if not compression_enabled:
            return context, {}

        compressed_sections: list[str] = []
        transformed = dict(context)
        for section in ("workspace_memory", "project_memory"):
            raw_value = transformed.get(section)
            raw_text = self._render_memory_for_compression(section, raw_value)
            if not raw_text:
                continue
            compressed = await TurboQuantCompressor.compress_context(raw_text)
            if compressed == raw_text:
                continue
            transformed[section] = {
                "compressed": True,
                "content": compressed,
            }
            compressed_sections.append(section)

        if not compressed_sections:
            return transformed, {}
        return transformed, {"mode": "turboquant", "sections": compressed_sections}

    def _estimate_context_tokens(self, user_input: str, context: Dict[str, Any]) -> int:
        serialized_context = self._format_context(context)
        rough_chars = len(user_input or "") + len(serialized_context)
        return max(1, rough_chars // 4)

    def _render_memory_for_compression(self, section: str, value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return f"{section}:\n{value}"
        if isinstance(value, dict):
            return f"{section}:\n{json.dumps(value, indent=2, ensure_ascii=True)}"
        return f"{section}:\n{value}"
