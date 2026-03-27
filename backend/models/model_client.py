from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)

STATIC_PROVIDER_MODELS: dict[str, list[str]] = {
    "openrouter": [
        "openrouter/auto",
        "openrouter/openai/o3",
        "openrouter/openai/gpt-5.1",
        "openrouter/anthropic/claude-opus-4.5",
        "openrouter/google/gemini-3-pro-preview",
        "openrouter/google/gemini-2.5-pro",
        "openrouter/google/gemini-2.5-flash",
    ],
    "google": [
        "gemini/gemini-2.5-pro",
        "gemini/gemini-2.5-flash",
    ],
    "openai": [
        "openai/gpt-4o",
    ],
    "anthropic": [
        "anthropic/claude-3-5-sonnet-20241022",
    ],
    "ollama": [
        "ollama/llama3",
        "ollama/llava",
    ],
}

MODEL_COSTS: dict[str, tuple[float, float]] = {
    "openrouter/auto": (0.0025, 0.01),
    "openrouter/openai/o3": (0.002, 0.008),
    "openrouter/openai/gpt-5.1": (0.0025, 0.015),
    "openrouter/anthropic/claude-opus-4.5": (0.005, 0.025),
    "openrouter/google/gemini-3-pro-preview": (0.002, 0.012),
    "openrouter/google/gemini-2.5-pro": (0.00125, 0.01),
    "openrouter/google/gemini-2.5-flash": (0.0003, 0.0025),
    "gemini/gemini-2.5-pro": (0.00125, 0.01),
    "gemini/gemini-2.5-flash": (0.0003, 0.0025),
    "ollama/llama3": (0.0, 0.0),
    "ollama/llava": (0.0, 0.0),
}

try:
    import litellm
    from litellm import acompletion, completion_cost
    from litellm.caching import Cache

    litellm.set_verbose = False
    litellm.cache = Cache(type="local")
except Exception:  # pragma: no cover - dependency may be absent during bootstrap
    litellm = None
    acompletion = None
    completion_cost = None


def _configured_key(value: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return ""
    lowered = cleaned.lower()
    if any(token in lowered for token in ("your_", "example", "replace", "changeme", "here")):
        return ""
    return cleaned


def _default_model_for_provider(provider: str) -> str:
    provider_name = provider.strip().lower()
    model_name = (settings.DEFAULT_MODEL or "gemini-2.5-flash").strip()

    if provider_name == "openrouter":
        if model_name.startswith("openrouter/"):
            return model_name
        if "/" in model_name:
            return f"openrouter/{model_name}"
        return f"openrouter/google/{model_name}"
    if provider_name in {"google", "gemini"}:
        if model_name.startswith("gemini/"):
            return model_name
        if model_name.startswith("google/"):
            return f"gemini/{model_name.split('/', 1)[1]}"
        if "/" in model_name:
            return model_name
        return f"gemini/{model_name}"
    if provider_name == "openai":
        return "gpt-4o"
    if provider_name == "anthropic":
        return "claude-3-5-sonnet-20241022"
    if provider_name == "ollama":
        return "ollama/llama3"
    return ""


def _provider_is_configured(provider: str) -> bool:
    provider_name = provider.strip().lower()
    if provider_name == "openrouter":
        return bool(_configured_key(settings.OPENROUTER_API_KEY))
    if provider_name in {"google", "gemini"}:
        return bool(_configured_key(settings.GEMINI_API_KEY) or _configured_key(settings.GOOGLE_API_KEY))
    if provider_name == "openai":
        return bool(_configured_key(settings.OPENAI_API_KEY))
    if provider_name == "anthropic":
        return bool(_configured_key(settings.ANTHROPIC_API_KEY))
    if provider_name == "ollama":
        return True
    return False


def is_openrouter_configured() -> bool:
    return bool(_configured_key(settings.OPENROUTER_API_KEY))


def get_openrouter_chat_model(preferred: Optional[str] = None) -> str:
    raw_model = (
        (preferred or "").strip()
        or (settings.OPENROUTER_CHAT_MODEL or "").strip()
        or "openrouter/auto"
    )
    if raw_model.startswith("openrouter/"):
        return raw_model
    if raw_model.startswith("ollama/"):
        return "openrouter/google/gemini-2.5-flash"
    if "/" in raw_model:
        return f"openrouter/{raw_model}"
    return f"openrouter/google/{raw_model}"


def get_openrouter_vision_model(preferred: Optional[str] = None) -> str:
    raw_model = (
        (preferred or "").strip()
        or (settings.OPENROUTER_VISION_MODEL or "").strip()
        or (settings.OPENROUTER_CHAT_MODEL or "").strip()
        or "openrouter/auto"
    )
    if raw_model.startswith("openrouter/"):
        return raw_model
    if raw_model.startswith("ollama/"):
        return "openrouter/google/gemini-2.5-flash"
    if "/" in raw_model:
        return f"openrouter/{raw_model}"
    return f"openrouter/google/{raw_model}"


def get_default_model() -> str:
    for provider in settings.PROVIDER_PRIORITY.split(","):
        if not _provider_is_configured(provider):
            continue
        model_name = _default_model_for_provider(provider)
        if model_name:
            return model_name
    return "ollama/llama3"


def get_local_autofill_model() -> str:
    model_name = (settings.LOCAL_AUTOFILL_MODEL or "ollama/llama3").strip()
    if not model_name:
        return "ollama/llama3"
    if model_name.startswith("ollama/"):
        return model_name
    if "/" in model_name:
        return model_name
    return f"ollama/{model_name}"


def get_local_workflow_model() -> str:
    model_name = (settings.LOCAL_WORKFLOW_MODEL or settings.LOCAL_AUTOFILL_MODEL or "ollama/llama3").strip()
    if not model_name:
        return "ollama/llama3"
    if model_name.startswith("ollama/"):
        return model_name
    if "/" in model_name:
        return model_name
    return f"ollama/{model_name}"


def get_local_vision_model() -> str:
    model_name = (
        (settings.LOCAL_VISION_MODEL or "").strip()
        or (settings.LOCAL_WORKFLOW_MODEL or "").strip()
        or (settings.LOCAL_AUTOFILL_MODEL or "").strip()
        or "ollama/llava"
    )
    if not model_name:
        return "ollama/llava"
    if model_name.startswith("ollama/"):
        return model_name
    if "/" in model_name:
        return model_name
    return f"ollama/{model_name}"


def model_supports_vision(model: str) -> bool:
    target = (model or "").strip()
    if not target:
        return False
    if litellm is not None and hasattr(litellm, "supports_vision"):
        try:
            return bool(litellm.supports_vision(model=target))
        except Exception:
            logger.debug("LiteLLM vision capability lookup failed for %s", target, exc_info=True)
    lowered = target.lower()
    vision_tokens = ("vision", "llava", "vl", "gpt-4o", "gemini", "claude-3", "qwen2.5-vl")
    return any(token in lowered for token in vision_tokens)


def get_available_models() -> list[str]:
    models = {
        "openrouter/auto",
        get_default_model(),
        get_local_autofill_model(),
        get_local_workflow_model(),
        get_local_vision_model(),
        get_openrouter_chat_model(),
        get_openrouter_vision_model(),
    }

    for provider_models in STATIC_PROVIDER_MODELS.values():
        models.update(provider_models)

    try:
        from database import SessionLocal
        from services.model_catalog import get_catalog_models

        db = SessionLocal()
        try:
            for record in get_catalog_models(db):
                models.add(f"openrouter/{record.id}")
        finally:
            db.close()
    except Exception:
        logger.debug("Model catalog not available when listing supported models", exc_info=True)

    return sorted(model for model in models if model and "/" in model)


def get_configured_providers() -> list[dict[str, Any]]:
    base_urls = {
        "openrouter": "https://openrouter.ai/api/v1",
        "google": "https://generativelanguage.googleapis.com/v1beta/openai",
        "openai": "https://api.openai.com/v1",
        "anthropic": "https://api.anthropic.com/v1",
        "ollama": settings.OLLAMA_BASE_URL,
    }
    available_models = get_available_models()

    provider_models: dict[str, list[str]] = {
        "openrouter": [model for model in available_models if model.startswith("openrouter/")],
        "google": [model for model in available_models if model.startswith("gemini/")],
        "openai": [model for model in available_models if model.startswith("openai/")],
        "anthropic": [model for model in available_models if model.startswith("anthropic/")],
        "ollama": [model for model in available_models if model.startswith("ollama/")],
    }

    return [
        {
            "name": provider,
            "configured": _provider_is_configured(provider),
            "base_url": base_urls[provider],
            "models": provider_models.get(provider, []),
        }
        for provider in ("openrouter", "google", "openai", "anthropic", "ollama")
    ]


async def chat_completion(
    messages: List[Dict[str, Any]],
    model: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    stream: bool = False,
) -> Any:
    if acompletion is None:
        raise RuntimeError("litellm is not installed. Install backend requirements first.")

    chosen_model = model or get_default_model()
    extra_kwargs: dict[str, Any] = {}
    timeout_seconds = 20

    openrouter_key = _configured_key(settings.OPENROUTER_API_KEY)
    anthropic_key = _configured_key(settings.ANTHROPIC_API_KEY)
    openai_key = _configured_key(settings.OPENAI_API_KEY)
    gemini_key = _configured_key(settings.GEMINI_API_KEY) or _configured_key(settings.GOOGLE_API_KEY)

    if openrouter_key and chosen_model.startswith("openrouter/"):
        extra_kwargs["api_key"] = openrouter_key
        extra_kwargs["api_base"] = "https://openrouter.ai/api/v1"
    elif gemini_key and chosen_model.startswith("gemini/"):
        extra_kwargs["api_key"] = gemini_key
    elif chosen_model.startswith("ollama/"):
        ollama_base = settings.OLLAMA_BASE_URL
        extra_kwargs["api_base"] = ollama_base
        timeout_seconds = 120
        if not any([openrouter_key, anthropic_key, openai_key, gemini_key]):
            try:
                async with httpx.AsyncClient(timeout=1.0) as client:
                    response = await client.get(ollama_base)
                    response.raise_for_status()
            except Exception as exc:
                raise RuntimeError(
                    "No remote LLM provider is configured and Ollama is unavailable."
                ) from exc

    response = await acompletion(
        model=chosen_model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=stream,
        num_retries=3,
        timeout=timeout_seconds,
        **extra_kwargs,
    )

    if completion_cost is not None:
        try:
            cost = completion_cost(completion_response=response, model=chosen_model)
            if cost:
                logger.debug("[cost] model=%s cost=$%.6f", chosen_model, cost)
        except Exception:
            logger.debug("Could not compute LiteLLM cost", exc_info=True)

    return response


def extract_text(response: Any) -> str:
    try:
        return response.choices[0].message.content or ""
    except Exception:
        return str(response)
