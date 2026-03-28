from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api import routes
from config import settings
from services import google_oauth


def _write_client_file(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "installed": {
                    "client_id": "example.apps.googleusercontent.com",
                    "project_id": "cellnucleus",
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "client_secret": "secret-value",
                    "redirect_uris": ["http://localhost"],
                }
            }
        ),
        encoding="utf-8",
    )


def test_google_oauth_status_uses_configured_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    client_file = tmp_path / "google-oauth-client.json"
    _write_client_file(client_file)

    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_FILE", str(client_file))

    status = google_oauth.get_google_oauth_client_status()

    assert status["configured"] is True
    assert status["exists"] is True
    assert status["valid"] is True
    assert status["client_type"] == "installed"
    assert status["project_id"] == "cellnucleus"
    assert status["redirect_uri_count"] == 1


def test_google_oauth_status_autodiscovers_root_client_secret_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    client_file = tmp_path / "client_secret_example.json"
    _write_client_file(client_file)

    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_FILE", "")
    monkeypatch.setattr(google_oauth, "ROOT_DIR", tmp_path)

    resolved = google_oauth.resolve_google_oauth_client_file()

    assert resolved == client_file


@pytest.mark.asyncio
async def test_google_oauth_runtime_route_returns_structured_status(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        routes,
        "get_google_oauth_client_status",
        lambda: {
            "configured": True,
            "discovered": True,
            "path": "C:/EduOS/google-oauth-client.json",
            "exists": True,
            "valid": True,
            "client_type": "installed",
            "project_id": "cellnucleus",
            "client_id_hint": "***.apps.googleusercontent.com",
            "redirect_uri_count": 1,
            "auth_uri_present": True,
            "token_uri_present": True,
            "message": "Google OAuth client JSON is available for Gmail/YouTube OAuth flows.",
        },
    )

    response = await routes.get_google_oauth_runtime_status()

    assert response.valid is True
    assert response.client_type == "installed"
    assert response.project_id == "cellnucleus"