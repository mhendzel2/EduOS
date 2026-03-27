from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config import BASE_DIR, _resolve_database_url, _resolve_path
from config import settings
from models.model_client import (
    get_default_model,
    get_local_autofill_model,
    get_local_vision_model,
    get_local_workflow_model,
    get_openrouter_chat_model,
    get_openrouter_vision_model,
)
from workflows.planner import StudioPlanner


def test_resolve_path_anchors_relative_locations_to_backend_dir():
    resolved = Path(_resolve_path("./uploads"))
    assert resolved == BASE_DIR / "uploads"


def test_resolve_database_url_anchors_relative_sqlite_path_to_backend_dir():
    resolved = _resolve_database_url("sqlite:///./studio_os.db")
    assert resolved == f"sqlite:///{(BASE_DIR / 'studio_os.db').as_posix()}"


def test_planner_rejects_invalid_pipeline_kind_for_project_domains():
    planner = StudioPlanner()

    with pytest.raises(ValueError, match="Pipeline kind 'media'"):
        planner.create_plan(
            task="Draft a scene",
            project_domains=["writing"],
            pipeline_kind="media",
        )


def test_planner_accepts_valid_pipeline_kind_for_project_domains():
    planner = StudioPlanner()
    plan = planner.create_plan(
        task="Create a promo calendar",
        project_domains=["writing", "youtube"],
        pipeline_kind="promo",
    )

    assert plan.pipeline_kind == "promo"
    assert len(plan.steps) > 0


def test_media_plan_includes_accuracy_gate_before_distribution():
    planner = StudioPlanner()
    plan = planner.create_plan(
        task="Create an educational video package",
        project_domains=["web", "youtube"],
        pipeline_kind="media",
    )

    agent_ids = [step.agent_id for step in plan.steps]

    assert "accuracy_reviewer" in agent_ids
    assert agent_ids.index("accuracy_reviewer") < agent_ids.index("seo")
    assert agent_ids.index("accuracy_reviewer") < agent_ids.index("site_manager")


def test_default_model_prefers_openrouter_before_google(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "PROVIDER_PRIORITY", "openrouter,google,ollama,openai,anthropic")
    monkeypatch.setattr(settings, "DEFAULT_MODEL", "gemini-2.5-flash")
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "sk-or-real")
    monkeypatch.setattr(settings, "GOOGLE_API_KEY", "google-real")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")

    assert get_default_model() == "openrouter/google/gemini-2.5-flash"


def test_default_model_can_fall_back_to_gemini_direct(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "PROVIDER_PRIORITY", "openrouter,google,ollama,openai,anthropic")
    monkeypatch.setattr(settings, "DEFAULT_MODEL", "gemini-2.5-flash")
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "your_openrouter_api_key_here")
    monkeypatch.setattr(settings, "GOOGLE_API_KEY", "google-real")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")

    assert get_default_model() == "gemini/gemini-2.5-flash"


def test_local_autofill_model_prefers_ollama_prefix(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "LOCAL_AUTOFILL_MODEL", "qwen2.5:14b")
    assert get_local_autofill_model() == "ollama/qwen2.5:14b"


def test_local_workflow_model_prefers_explicit_override(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "LOCAL_AUTOFILL_MODEL", "ollama/llama3")
    monkeypatch.setattr(settings, "LOCAL_WORKFLOW_MODEL", "qwen2.5:32b")
    assert get_local_workflow_model() == "ollama/qwen2.5:32b"


def test_openrouter_chat_model_prefers_explicit_chat_override(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "OPENROUTER_CHAT_MODEL", "openai/gpt-4.1-mini")
    monkeypatch.setattr(settings, "DEFAULT_MODEL", "gemini-2.5-flash")

    assert get_openrouter_chat_model() == "openrouter/openai/gpt-4.1-mini"
    assert get_openrouter_chat_model("google/gemini-2.5-pro") == "openrouter/google/gemini-2.5-pro"


def test_vision_model_helpers_normalize_expected_prefixes(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "OPENROUTER_VISION_MODEL", "openai/gpt-4o-mini")
    monkeypatch.setattr(settings, "LOCAL_VISION_MODEL", "qwen2.5vl:7b")

    assert get_openrouter_vision_model() == "openrouter/openai/gpt-4o-mini"
    assert get_local_vision_model() == "ollama/qwen2.5vl:7b"
