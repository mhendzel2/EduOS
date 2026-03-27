from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api import routes
from services.ollama_runtime import _normalize_target_model


def test_normalize_target_model_strips_ollama_prefix():
    assert _normalize_target_model("ollama/llama3.2:3b") == "llama3.2:3b"
    assert _normalize_target_model("qwen2.5:14b") == "qwen2.5:14b"


@pytest.mark.asyncio
async def test_get_ollama_runtime_status_route_returns_structured_status(monkeypatch: pytest.MonkeyPatch):
    async def fake_get_status():
        return {
            "state": "idle",
            "base_url": "http://localhost:11434",
            "model": "llama3.2:3b",
            "connected": False,
            "available_models": [],
            "target_model_available": False,
            "message": "Ollama is not reachable.",
            "started_at": None,
            "completed_at": None,
            "log": [],
        }

    monkeypatch.setattr(routes, "get_ollama_bootstrap_status", fake_get_status)
    response = await routes.get_ollama_runtime_status()

    assert response.state == "idle"
    assert response.model == "llama3.2:3b"
    assert response.connected is False


@pytest.mark.asyncio
async def test_start_ollama_runtime_route_returns_running_status(monkeypatch: pytest.MonkeyPatch):
    async def fake_start(model: str | None):
        assert model == "llama3.2:3b"
        return {
            "state": "running",
            "base_url": "http://localhost:11434",
            "model": "llama3.2:3b",
            "connected": False,
            "available_models": [],
            "target_model_available": False,
            "message": "Launching Ollama bootstrap for llama3.2:3b",
            "started_at": None,
            "completed_at": None,
            "log": ["[2026-03-24T00:00:00] Bootstrap requested"],
        }

    monkeypatch.setattr(routes, "start_ollama_bootstrap", fake_start)
    response = await routes.start_ollama_runtime(routes.OllamaBootstrapRequest(model="llama3.2:3b"))

    assert response.state == "running"
    assert response.model == "llama3.2:3b"
    assert "Launching Ollama bootstrap" in response.message
