from __future__ import annotations

import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api import routes
from database import Base
from database_models import ProjectRecord
from services.telegram_control import TelegramControlService, TelegramExecutionResult, TelegramProjectRef


@pytest.fixture
def db_session() -> Session:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, future=True)
    testing_session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)
    session = testing_session_local()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.mark.asyncio
async def test_telegram_control_rejects_unauthorized_chat():
    messages: list[tuple[int, str]] = []

    async def fake_execute_command(_project_id: str, _command: str, _scope: str, _chat_id: int):
        raise AssertionError("Unauthorized chat should not reach the executor")

    service = TelegramControlService(
        token="telegram-token",
        default_project_id="project-a",
        default_scope="general",
        allowed_chat_ids={7},
        resolve_project=lambda _ref: TelegramProjectRef(id="project-a", name="Project A"),
        list_projects=lambda: [TelegramProjectRef(id="project-a", name="Project A")],
        execute_command=fake_execute_command,
    )

    async def fake_send_message(chat_id: int, text: str):
        messages.append((chat_id, text))

    service._send_message = fake_send_message  # type: ignore[method-assign]

    result = await service.handle_update(
        {
            "update_id": 5,
            "message": {
                "chat": {"id": 8},
                "text": "Run the pipeline.",
            },
        }
    )

    assert result.handled is True
    assert result.action == "unauthorized"
    assert messages[0][0] == 8
    assert "not enabled for this chat" in messages[0][1]


@pytest.mark.asyncio
async def test_telegram_control_updates_project_scope_and_runs_command(db_session: Session):
    alpha = ProjectRecord(name="Alpha Site", description="", domains=["web"], story_bible={}, brand_bible={})
    beta = ProjectRecord(name="Beta Media", description="", domains=["youtube"], story_bible={}, brand_bible={})
    db_session.add(alpha)
    db_session.add(beta)
    db_session.commit()
    db_session.refresh(alpha)
    db_session.refresh(beta)

    messages: list[str] = []
    captured: list[tuple[str, str, str, int]] = []

    def resolve_project(reference: str) -> TelegramProjectRef | None:
        normalized = reference.strip().casefold()
        for project in (alpha, beta):
            if project.id == reference.strip() or project.name.casefold() == normalized:
                return TelegramProjectRef(id=project.id, name=project.name)
        return None

    async def fake_execute_command(project_id: str, command: str, scope: str, chat_id: int) -> TelegramExecutionResult:
        captured.append((project_id, command, scope, chat_id))
        return TelegramExecutionResult(
            success=True,
            project_id=project_id,
            project_name=beta.name,
            scope=scope,
            run_id="run-123",
            final_output="Video critique completed.",
            execution_mode="agent",
            plan_summary="Run a focused media critique.",
            model="ollama/test-local",
        )

    service = TelegramControlService(
        token="telegram-token",
        default_project_id=alpha.id,
        default_scope="general",
        allowed_chat_ids=None,
        resolve_project=resolve_project,
        list_projects=lambda: [TelegramProjectRef(id=alpha.id, name=alpha.name), TelegramProjectRef(id=beta.id, name=beta.name)],
        execute_command=fake_execute_command,
    )

    async def fake_send_message(_chat_id: int, text: str):
        messages.append(text)

    service._send_message = fake_send_message  # type: ignore[method-assign]

    await service.handle_update({"message": {"chat": {"id": 7}, "text": "/project Beta Media"}})
    await service.handle_update({"message": {"chat": {"id": 7}, "text": "/scope media"}})
    result = await service.handle_update({"message": {"chat": {"id": 7}, "text": "Review the latest uploaded mp4."}})

    assert result.handled is True
    assert result.action == "task_run"
    assert captured == [(beta.id, "Review the latest uploaded mp4.", "media", 7)]
    assert any("Project updated to `Beta Media`" in message for message in messages)
    assert any("Scope updated to `media`" in message for message in messages)
    assert any("Video critique completed." in message for message in messages)


@pytest.mark.asyncio
async def test_telegram_status_endpoint_reports_runtime_state():
    service = TelegramControlService(
        token="telegram-token",
        default_project_id="project-a",
        default_scope="media",
        allowed_chat_ids={7, 8},
        polling_enabled=True,
        webhook_secret="shared-secret",
        resolve_project=lambda ref: TelegramProjectRef(id=ref, name="Project A") if ref == "project-a" else None,
        list_projects=lambda: [TelegramProjectRef(id="project-a", name="Project A")],
        execute_command=lambda *_args, **_kwargs: None,  # type: ignore[arg-type]
    )

    response = await routes.telegram_control_status(service)

    assert response.enabled is True
    assert response.polling_enabled is True
    assert response.allowed_chat_count == 2
    assert response.default_project_id == "project-a"
    assert response.default_project_name == "Project A"
    assert response.default_scope == "media"
    assert response.webhook_secret_configured is True


@pytest.mark.asyncio
async def test_telegram_webhook_endpoint_dispatches_update():
    captured: list[dict] = []
    service = TelegramControlService(
        token="telegram-token",
        default_project_id="project-a",
        default_scope="general",
        webhook_secret="shared-secret",
        resolve_project=lambda _ref: TelegramProjectRef(id="project-a", name="Project A"),
        list_projects=lambda: [TelegramProjectRef(id="project-a", name="Project A")],
        execute_command=lambda *_args, **_kwargs: None,  # type: ignore[arg-type]
    )

    async def fake_handle_update(update: dict):
        captured.append(update)

    service.handle_update = fake_handle_update  # type: ignore[method-assign]

    response = await routes.telegram_control_webhook("shared-secret", {"message": {}}, service)

    assert response == {"ok": True}
    assert captured == [{"message": {}}]


@pytest.mark.asyncio
async def test_telegram_webhook_endpoint_rejects_invalid_secret():
    service = TelegramControlService(
        token="telegram-token",
        default_project_id="project-a",
        default_scope="general",
        webhook_secret="shared-secret",
        resolve_project=lambda _ref: TelegramProjectRef(id="project-a", name="Project A"),
        list_projects=lambda: [TelegramProjectRef(id="project-a", name="Project A")],
        execute_command=lambda *_args, **_kwargs: None,  # type: ignore[arg-type]
    )

    with pytest.raises(routes.HTTPException) as exc_info:
        await routes.telegram_control_webhook("wrong-secret", {"message": {}}, service)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Invalid Telegram webhook secret"
