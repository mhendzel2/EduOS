"""ResearchAgent-style model routing for StudioOS.

This ports the same persisted routing concept into StudioOS while keeping the
runtime compatible with the simpler LiteLLM-based model client already used
here. Model ids are stored in the exact runtime format the app can execute,
for example ``openrouter/auto`` or ``ollama/llama3``.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional

from config import settings
from models.model_client import MODEL_COSTS

logger = logging.getLogger(__name__)


class ModelTier(str, Enum):
    REASONING = "reasoning"
    BALANCED = "balanced"
    FAST = "fast"
    CODE = "code"
    LONG_CONTEXT = "long_context"


class RoutingStrategy(str, Enum):
    PERFORMANCE = "performance"
    COST = "cost"
    BALANCED = "balanced"


DEFAULT_TIER_MODELS: Dict[ModelTier, List[str]] = {
    ModelTier.REASONING: ["openrouter/auto", "gemini/gemini-2.5-pro", "ollama/llama3"],
    ModelTier.BALANCED: ["openrouter/auto", "gemini/gemini-2.5-flash", "ollama/llama3"],
    ModelTier.FAST: ["openrouter/auto", "gemini/gemini-2.5-flash", "ollama/llama3"],
    ModelTier.CODE: ["openrouter/auto", "ollama/llama3"],
    ModelTier.LONG_CONTEXT: ["openrouter/auto", "gemini/gemini-2.5-pro", "ollama/llama3"],
}


MODEL_QUALITY: Dict[str, int] = {
    "openrouter/auto": 96,
    "gemini/gemini-2.5-pro": 90,
    "gemini/gemini-2.5-flash": 82,
    "ollama/llama3": 62,
}


AGENT_TIER_MAP: Dict[str, ModelTier] = {
    "coordination.director": ModelTier.REASONING,
    "media.research": ModelTier.BALANCED,
    "media.scriptwriter": ModelTier.REASONING,
    "media.accuracy_reviewer": ModelTier.REASONING,
    "media.script_critic": ModelTier.REASONING,
    "media.video_critic": ModelTier.REASONING,
    "media.video_editor": ModelTier.BALANCED,
    "media.shorts_editor": ModelTier.BALANCED,
    "media.channel_brand": ModelTier.BALANCED,
    "media.seo": ModelTier.FAST,
    "media.thumbnail_brief": ModelTier.BALANCED,
    "media.visual_critic": ModelTier.REASONING,
    "media.audio_planner": ModelTier.FAST,
    "media.assembly_planner": ModelTier.BALANCED,
    "media.brand_manager": ModelTier.REASONING,
    "media.distribution_manager": ModelTier.BALANCED,
    "media.site_manager": ModelTier.BALANCED,
    "promo.campaign_planner": ModelTier.BALANCED,
    "promo.story_hook_extractor": ModelTier.FAST,
    "promo.spoiler_guardian": ModelTier.REASONING,
    "promo.promo_adapter": ModelTier.FAST,
    "writing.ingestion": ModelTier.BALANCED,
    "writing.narrative": ModelTier.REASONING,
    "writing.character": ModelTier.BALANCED,
    "writing.worldbuilding": ModelTier.BALANCED,
    "writing.outline": ModelTier.BALANCED,
    "writing.writer": ModelTier.REASONING,
    "writing.developmental": ModelTier.REASONING,
    "writing.critique": ModelTier.REASONING,
    "writing.line_editor": ModelTier.BALANCED,
    "writing.style_monitor": ModelTier.FAST,
}


@dataclass
class RoutingDecision:
    model: str
    tier: ModelTier
    reason: str
    estimated_cost_per_1k: float = 0.0


def _quality_score(model: str) -> int:
    return MODEL_QUALITY.get(model, 50)


def _cost_score(model: str) -> float:
    cost = MODEL_COSTS.get(model)
    if cost is None:
        return 0.01
    return float(cost[0]) + float(cost[1])


def _provider_configured(model: str) -> bool:
    target = (model or "").strip().lower()
    if not target:
        return False
    def _has_real_key(value: str) -> bool:
        cleaned = (value or "").strip()
        if not cleaned:
            return False
        lowered = cleaned.lower()
        return not any(token in lowered for token in ("your_", "example", "replace", "changeme", "here"))

    if target.startswith("openrouter/"):
        return _has_real_key(settings.OPENROUTER_API_KEY)
    if target.startswith("gemini/") or target.startswith("google/"):
        return _has_real_key(settings.GEMINI_API_KEY) or _has_real_key(settings.GOOGLE_API_KEY)
    if target.startswith("openai/"):
        return _has_real_key(settings.OPENAI_API_KEY)
    if target.startswith("anthropic/"):
        return _has_real_key(settings.ANTHROPIC_API_KEY)
    if target.startswith("ollama/"):
        return True
    return False


class ModelRouter:
    def __init__(
        self,
        agent_overrides: Optional[Dict[str, str]] = None,
        tier_overrides: Optional[Dict[str, str]] = None,
        strategy: RoutingStrategy = RoutingStrategy.BALANCED,
        config_path: Optional[str] = None,
    ) -> None:
        self._agent_overrides: Dict[str, str] = dict(agent_overrides or {})
        self._tier_overrides: Dict[ModelTier, str] = {
            ModelTier(key): value for key, value in (tier_overrides or {}).items()
        }
        self._strategy = strategy
        self._config_path = config_path or settings.MODEL_ROUTING_CONFIG_PATH
        self._load_persisted_config()

    @property
    def strategy(self) -> RoutingStrategy:
        return self._strategy

    def select(
        self,
        agent_name: str,
        *,
        tier_hint: Optional[ModelTier] = None,
        context_tokens: int = 0,
    ) -> RoutingDecision:
        if context_tokens > 50_000:
            effective_tier = ModelTier.LONG_CONTEXT
            reason_suffix = " (auto-upgraded: large context)"
        else:
            effective_tier = tier_hint or AGENT_TIER_MAP.get(agent_name, ModelTier.BALANCED)
            reason_suffix = ""

        if agent_name in self._agent_overrides:
            model = self._agent_overrides[agent_name]
            return RoutingDecision(
                model=model,
                tier=effective_tier,
                reason=f"agent override for '{agent_name}'{reason_suffix}",
                estimated_cost_per_1k=_cost_score(model),
            )

        if effective_tier in self._tier_overrides:
            model = self._tier_overrides[effective_tier]
            return RoutingDecision(
                model=model,
                tier=effective_tier,
                reason=f"tier override for '{effective_tier.value}'{reason_suffix}",
                estimated_cost_per_1k=_cost_score(model),
            )

        raw_candidates = DEFAULT_TIER_MODELS.get(effective_tier, DEFAULT_TIER_MODELS[ModelTier.BALANCED])
        candidates = [candidate for candidate in raw_candidates if _provider_configured(candidate)]
        if not candidates:
            candidates = list(raw_candidates)

        model = self._pick_by_strategy(candidates)
        return RoutingDecision(
            model=model,
            tier=effective_tier,
            reason=f"{self._strategy.value} strategy for tier '{effective_tier.value}'{reason_suffix}",
            estimated_cost_per_1k=_cost_score(model),
        )

    def _pick_by_strategy(self, candidates: List[str]) -> str:
        if not candidates:
            return "ollama/llama3"

        if self._strategy == RoutingStrategy.PERFORMANCE:
            return max(candidates, key=_quality_score)
        if self._strategy == RoutingStrategy.COST:
            return min(candidates, key=_cost_score)

        def _balanced_score(model: str) -> float:
            return _quality_score(model) / (_cost_score(model) + 0.0001)

        return max(candidates, key=_balanced_score)

    def get_config(self) -> dict:
        return {
            "agent_overrides": dict(self._agent_overrides),
            "tier_overrides": {tier.value: model for tier, model in self._tier_overrides.items()},
            "defaults": {tier.value: models for tier, models in DEFAULT_TIER_MODELS.items()},
            "agent_tier_map": {agent: tier.value for agent, tier in AGENT_TIER_MAP.items()},
            "strategy": self._strategy.value,
            "strategies": [strategy.value for strategy in RoutingStrategy],
        }

    def apply_config(self, cfg: dict) -> None:
        if "agent_overrides" in cfg:
            self._agent_overrides = dict(cfg["agent_overrides"] or {})
        if "tier_overrides" in cfg:
            self._tier_overrides = {
                ModelTier(key): value for key, value in (cfg["tier_overrides"] or {}).items()
            }
        if "strategy" in cfg:
            self._strategy = RoutingStrategy(str(cfg["strategy"]))
        self.save_config()

    def save_config(self) -> None:
        if not self._config_path:
            return
        try:
            directory = os.path.dirname(self._config_path)
            if directory:
                os.makedirs(directory, exist_ok=True)
            with open(self._config_path, "w", encoding="utf-8") as handle:
                json.dump(
                    {
                        "agent_overrides": dict(self._agent_overrides),
                        "tier_overrides": {tier.value: model for tier, model in self._tier_overrides.items()},
                        "strategy": self._strategy.value,
                    },
                    handle,
                    indent=2,
                    sort_keys=True,
                )
        except Exception as exc:
            logger.warning("Failed to persist model routing config: %s", exc)

    def _load_persisted_config(self) -> None:
        if not self._config_path or not os.path.exists(self._config_path):
            return
        try:
            with open(self._config_path, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
            if "agent_overrides" in raw:
                self._agent_overrides = dict(raw["agent_overrides"] or {})
            if "tier_overrides" in raw:
                self._tier_overrides = {
                    ModelTier(key): value for key, value in (raw["tier_overrides"] or {}).items()
                }
            if "strategy" in raw:
                self._strategy = RoutingStrategy(str(raw["strategy"]))
        except Exception as exc:
            logger.warning("Failed to load model routing config: %s", exc)


_shared_router: Optional[ModelRouter] = None


def get_model_router() -> ModelRouter:
    global _shared_router
    if _shared_router is None:
        _shared_router = ModelRouter()
    return _shared_router


def reset_model_router() -> None:
    global _shared_router
    _shared_router = None
