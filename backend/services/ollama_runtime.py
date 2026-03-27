from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

import httpx

from config import settings
from models.model_client import get_local_workflow_model


def _normalize_target_model(model: str | None = None) -> str:
    raw = (model or get_local_workflow_model()).strip()
    if not raw:
        return "llama3"
    if raw.startswith("ollama/"):
        return raw.split("/", 1)[1]
    return raw


def _status_path() -> Path:
    return Path(settings.OLLAMA_BOOTSTRAP_STATUS_FILE)


def _log_path() -> Path:
    return Path(settings.OLLAMA_BOOTSTRAP_LOG_FILE)


def _read_status_payload() -> dict[str, Any]:
    path = _status_path()
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _write_status_payload(payload: dict[str, Any]) -> None:
    path = _status_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _tail_log_lines(limit: int = 60) -> list[str]:
    path = _log_path()
    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return []
    return lines[-limit:]


async def get_ollama_bootstrap_status(target_model: str | None = None) -> dict[str, Any]:
    normalized_model = _normalize_target_model(target_model)
    payload = _read_status_payload()

    connected = False
    available_models: list[str] = []
    error_message = ""
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            response = await client.get(f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/tags")
            response.raise_for_status()
        data = response.json()
        models = data.get("models", []) if isinstance(data, dict) else []
        available_models = [
            str(model.get("name")).strip()
            for model in models
            if isinstance(model, dict) and str(model.get("name", "")).strip()
        ]
        connected = True
    except Exception as exc:
        error_message = str(exc)

    target_model_available = normalized_model in available_models
    state = str(payload.get("state") or "idle")
    message = str(payload.get("message") or "").strip()

    if connected and target_model_available:
        state = "succeeded"
        message = f"Ollama is reachable and {normalized_model} is ready."
    elif connected:
        if state != "running":
            state = "idle"
        if not message:
            message = f"Ollama is reachable but {normalized_model} is not available yet."
    elif state != "running":
        state = "failed" if message else "idle"
        if not message:
            message = error_message or "Ollama is not reachable."

    return {
        "state": state,
        "base_url": settings.OLLAMA_BASE_URL,
        "model": normalized_model,
        "connected": connected,
        "available_models": available_models,
        "target_model_available": target_model_available,
        "message": message,
        "started_at": payload.get("started_at"),
        "completed_at": payload.get("completed_at"),
        "log": _tail_log_lines(),
    }


async def start_ollama_bootstrap(target_model: str | None = None) -> dict[str, Any]:
    normalized_model = _normalize_target_model(target_model)
    current_status = await get_ollama_bootstrap_status(normalized_model)
    if current_status["connected"] and current_status["target_model_available"]:
        return current_status
    if current_status["state"] == "running":
        return current_status

    script_path = Path(settings.OLLAMA_BOOTSTRAP_SCRIPT)
    if not script_path.exists():
        raise FileNotFoundError(f"Ollama bootstrap script not found: {script_path}")

    _write_status_payload(
        {
            "state": "running",
            "message": f"Launching Ollama bootstrap for {normalized_model}",
            "model": normalized_model,
            "base_url": settings.OLLAMA_BASE_URL,
            "started_at": None,
            "completed_at": None,
        }
    )

    env = {
        **dict(os.environ),
        "OLLAMA_BASE_URL": settings.OLLAMA_BASE_URL,
        "OLLAMA_BOOTSTRAP_STATUS_FILE": settings.OLLAMA_BOOTSTRAP_STATUS_FILE,
        "OLLAMA_BOOTSTRAP_LOG_FILE": settings.OLLAMA_BOOTSTRAP_LOG_FILE,
        "TARGET_MODEL": normalized_model,
    }
    subprocess.Popen(
        ["/bin/bash", str(script_path), normalized_model],
        cwd=str(script_path.parent.parent),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return await get_ollama_bootstrap_status(normalized_model)
