from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

try:
    from dotenv import dotenv_values

    def _merge_env_values(path: Path, *, replace_root_values: set[str] | None = None) -> set[str]:
        loaded_keys: set[str] = set()
        for key, value in dotenv_values(path).items():
            if not key or value is None:
                continue
            if key not in os.environ or (replace_root_values and key in replace_root_values):
                os.environ[key] = value
                loaded_keys.add(key)
        return loaded_keys

    root_loaded_keys = _merge_env_values(ROOT_DIR / ".env")
    _merge_env_values(BASE_DIR / ".env", replace_root_values=root_loaded_keys)
except Exception:
    pass


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return list(default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _resolve_path(value: str) -> str:
    path = Path(value)
    if path.is_absolute():
        return str(path)
    return str((BASE_DIR / path).resolve())


def _resolve_database_url(value: str) -> str:
    sqlite_prefix = "sqlite:///"
    if not value.startswith(sqlite_prefix):
        return value

    database_path = value[len(sqlite_prefix) :]
    if database_path.startswith("/"):
        return value
    return f"{sqlite_prefix}{Path(_resolve_path(database_path)).as_posix()}"


@dataclass
class Settings:
    APP_NAME: str = os.getenv("APP_NAME", "EduOS")
    API_VERSION: str = os.getenv("API_VERSION", "v1")
    DEBUG: bool = _env_bool("DEBUG", False)

    OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    YOUTUBE_API_KEY: str = os.getenv("YOUTUBE_API_KEY", "")
    PROVIDER_PRIORITY: str = os.getenv("PROVIDER_PRIORITY", "openrouter,google,ollama")
    DEFAULT_MODEL: str = os.getenv("DEFAULT_MODEL", "openrouter/auto")
    MODEL_ROUTING_CONFIG_PATH: str = _resolve_path(
        os.getenv("MODEL_ROUTING_CONFIG_PATH", "./model_routing.json")
    )
    OPENROUTER_CHAT_MODEL: str = os.getenv("OPENROUTER_CHAT_MODEL", "")
    OPENROUTER_VISION_MODEL: str = os.getenv("OPENROUTER_VISION_MODEL", "openai/gpt-4o-mini")
    REVIEWER_A_MODEL: str = os.getenv("REVIEWER_A_MODEL", "")
    REVIEWER_B_MODEL: str = os.getenv("REVIEWER_B_MODEL", "")
    REVIEW_SYNTHESIS_MODEL: str = os.getenv("REVIEW_SYNTHESIS_MODEL", "")
    REVIEW_PUBLICATION_MODEL: str = os.getenv("REVIEW_PUBLICATION_MODEL", "")
    LOCAL_AUTOFILL_MODEL: str = os.getenv("LOCAL_AUTOFILL_MODEL", "ollama/llama3")
    LOCAL_WORKFLOW_MODEL: str = os.getenv("LOCAL_WORKFLOW_MODEL", "")
    LOCAL_VISION_MODEL: str = os.getenv("LOCAL_VISION_MODEL", "ollama/llava")
    OPENAI_TRANSCRIPTION_MODEL: str = os.getenv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe")
    MULTIMODAL_VIDEO_FRAME_COUNT: int = int(os.getenv("MULTIMODAL_VIDEO_FRAME_COUNT", "4"))
    MULTIMODAL_VIDEO_FRAME_WINDOW_SECONDS: int = int(os.getenv("MULTIMODAL_VIDEO_FRAME_WINDOW_SECONDS", "60"))
    MULTIMODAL_AUDIO_TRANSCRIPTION_ENABLED: bool = _env_bool("MULTIMODAL_AUDIO_TRANSCRIPTION_ENABLED", True)
    MULTIMODAL_AUDIO_TRANSCRIPTION_MAX_SECONDS: int = int(os.getenv("MULTIMODAL_AUDIO_TRANSCRIPTION_MAX_SECONDS", "90"))
    OPENROUTER_EMBEDDING_MODEL: str = os.getenv("OPENROUTER_EMBEDDING_MODEL", "openai/text-embedding-3-small")
    GEMINI_EMBEDDING_MODEL: str = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    OLLAMA_BOOTSTRAP_SCRIPT: str = _resolve_path(os.getenv("OLLAMA_BOOTSTRAP_SCRIPT", "./scripts/bootstrap_ollama.sh"))
    OLLAMA_BOOTSTRAP_STATUS_FILE: str = os.getenv("OLLAMA_BOOTSTRAP_STATUS_FILE", "/tmp/eduos-ollama-bootstrap-status.json")
    OLLAMA_BOOTSTRAP_LOG_FILE: str = os.getenv("OLLAMA_BOOTSTRAP_LOG_FILE", "/tmp/eduos-ollama-bootstrap.log")

    TELEGRAM_BOT_TOKEN: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    TELEGRAM_ALLOWED_CHAT_IDS: str = os.getenv("TELEGRAM_ALLOWED_CHAT_IDS", "")
    TELEGRAM_POLLING_ENABLED: bool = _env_bool("TELEGRAM_POLLING_ENABLED", False)
    TELEGRAM_POLL_TIMEOUT_SECONDS: int = int(os.getenv("TELEGRAM_POLL_TIMEOUT_SECONDS", "30"))
    TELEGRAM_WEBHOOK_SECRET: str = os.getenv("TELEGRAM_WEBHOOK_SECRET", "")
    TELEGRAM_DEFAULT_PROJECT_ID: str = os.getenv("TELEGRAM_DEFAULT_PROJECT_ID", "")
    TELEGRAM_DEFAULT_SCOPE: str = os.getenv("TELEGRAM_DEFAULT_SCOPE", "general")

    COORDINATOR_PROVIDER: str = os.getenv("COORDINATOR_PROVIDER", "local")

    VECTOR_DB_PATH: str = _resolve_path(os.getenv("VECTOR_DB_PATH", "./vector_store"))
    UPLOAD_DIR: str = _resolve_path(os.getenv("UPLOAD_DIR", "./uploads"))
    DATABASE_URL: str = _resolve_database_url(os.getenv("DATABASE_URL", "sqlite:///./edu_os.db"))
    SECRET_KEY: str = os.getenv("SECRET_KEY", "change-me-in-production")
    SECURITY_MODE: str = os.getenv("SECURITY_MODE", "MODE_A")
    DEFAULT_BRAND_PRESET: str = os.getenv("DEFAULT_BRAND_PRESET", "cellnucleus")

    STUDIO_DOMAINS: list[str] = None  # type: ignore[assignment]
    GATE_REVISION_MAX_RETRIES: int = int(os.getenv("GATE_REVISION_MAX_RETRIES", "3"))
    BIBLE_AUTO_UPDATE: bool = _env_bool("BIBLE_AUTO_UPDATE", True)
    YOUTUBE_COMMENTS_DEFAULT_MAX_RESULTS: int = int(os.getenv("YOUTUBE_COMMENTS_DEFAULT_MAX_RESULTS", "25"))
    LITELLM_CACHE_TTL: int = int(os.getenv("LITELLM_CACHE_TTL", "3600"))
    MAX_REQUEST_BODY_BYTES: int = int(os.getenv("MAX_REQUEST_BODY_BYTES", str(500 * 1024 * 1024)))
    RENDER_EMBEDDED_WORKER_ENABLED: bool = _env_bool("RENDER_EMBEDDED_WORKER_ENABLED", True)
    RENDER_WORKER_POLL_INTERVAL_SECONDS: float = float(os.getenv("RENDER_WORKER_POLL_INTERVAL_SECONDS", "1.0"))

    def __post_init__(self) -> None:
        if self.STUDIO_DOMAINS is None:
            self.STUDIO_DOMAINS = _env_list("STUDIO_DOMAINS", ["writing", "web", "youtube"])


settings = Settings()
