from __future__ import annotations

from typing import Any

from config import settings


def _normalize_model_name(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if raw.startswith(("openrouter/", "ollama/", "gemini/", "openai/", "anthropic/")):
        return raw
    if "/" in raw:
        return f"openrouter/{raw}"
    return f"openrouter/{raw}"


def build_review_agent_model_overrides() -> dict[str, str]:
    configured: dict[str, Any] = {
        "review.reviewer_a": settings.REVIEWER_A_MODEL,
        "review.reviewer_b": settings.REVIEWER_B_MODEL,
        "review.synthesizer": settings.REVIEW_SYNTHESIS_MODEL,
        "review.publisher": settings.REVIEW_PUBLICATION_MODEL,
    }
    overrides: dict[str, str] = {}
    for agent_slug, model in configured.items():
        normalized = _normalize_model_name(str(model or ""))
        if normalized:
            overrides[agent_slug] = normalized
    return overrides
