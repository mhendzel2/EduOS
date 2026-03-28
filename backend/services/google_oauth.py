from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from config import ROOT_DIR, settings


def _mask_client_id(value: str) -> str:
    client_id = str(value or "").strip()
    if not client_id:
        return ""
    suffix = ".apps.googleusercontent.com"
    if client_id.endswith(suffix):
        return f"***{suffix}"
    if len(client_id) <= 4:
        return "***"
    return f"***{client_id[-4:]}"


def _candidate_paths() -> list[Path]:
    candidates: list[Path] = []
    configured = str(settings.GOOGLE_OAUTH_CLIENT_FILE or "").strip()
    if configured:
        candidates.append(Path(configured))
        return candidates

    preferred = ROOT_DIR / "google-oauth-client.json"
    if preferred.exists():
        candidates.append(preferred)

    candidates.extend(sorted(ROOT_DIR.glob("client_secret_*.json")))
    return candidates


def resolve_google_oauth_client_file() -> Path | None:
    for candidate in _candidate_paths():
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def load_google_oauth_client_metadata(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    client_section = payload.get("installed") or payload.get("web")
    if not isinstance(client_section, dict):
        raise ValueError("Google OAuth client JSON must contain an 'installed' or 'web' object.")

    client_id = str(client_section.get("client_id") or "").strip()
    client_secret = str(client_section.get("client_secret") or "").strip()
    auth_uri = str(client_section.get("auth_uri") or "").strip()
    token_uri = str(client_section.get("token_uri") or "").strip()
    redirect_uris = client_section.get("redirect_uris") or []

    if not client_id:
        raise ValueError("Google OAuth client JSON is missing client_id.")
    if not client_secret:
        raise ValueError("Google OAuth client JSON is missing client_secret.")
    if not auth_uri:
        raise ValueError("Google OAuth client JSON is missing auth_uri.")
    if not token_uri:
        raise ValueError("Google OAuth client JSON is missing token_uri.")
    if not isinstance(redirect_uris, list):
        raise ValueError("Google OAuth client JSON redirect_uris must be a list.")

    client_type = "installed" if "installed" in payload else "web"
    return {
        "client_type": client_type,
        "project_id": str(client_section.get("project_id") or "").strip(),
        "client_id_hint": _mask_client_id(client_id),
        "redirect_uri_count": len(redirect_uris),
        "auth_uri_present": bool(auth_uri),
        "token_uri_present": bool(token_uri),
    }


def get_google_oauth_client_status() -> dict[str, Any]:
    configured = bool(str(settings.GOOGLE_OAUTH_CLIENT_FILE or "").strip())
    resolved = resolve_google_oauth_client_file()

    if resolved is None:
        message = (
            "Configured Google OAuth client file was not found."
            if configured
            else "No Google OAuth client JSON was found in the repository root."
        )
        return {
            "configured": configured,
            "discovered": False,
            "path": str(Path(settings.GOOGLE_OAUTH_CLIENT_FILE).resolve()) if configured else "",
            "exists": False,
            "valid": False,
            "client_type": "",
            "project_id": "",
            "client_id_hint": "",
            "redirect_uri_count": 0,
            "auth_uri_present": False,
            "token_uri_present": False,
            "message": message,
        }

    try:
        metadata = load_google_oauth_client_metadata(resolved)
    except Exception as exc:
        return {
            "configured": configured,
            "discovered": True,
            "path": str(resolved),
            "exists": True,
            "valid": False,
            "client_type": "",
            "project_id": "",
            "client_id_hint": "",
            "redirect_uri_count": 0,
            "auth_uri_present": False,
            "token_uri_present": False,
            "message": f"Invalid Google OAuth client JSON: {exc}",
        }

    return {
        "configured": configured,
        "discovered": True,
        "path": str(resolved),
        "exists": True,
        "valid": True,
        "message": "Google OAuth client JSON is available for Gmail/YouTube OAuth flows.",
        **metadata,
    }