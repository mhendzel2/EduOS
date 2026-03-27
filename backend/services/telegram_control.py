from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

_TELEGRAM_MESSAGE_LIMIT = 4096
_DEFAULT_SCOPES = {"general", "media", "workspace"}


def parse_allowed_chat_ids(raw_value: str) -> set[int]:
    allowed: set[int] = set()
    for part in (raw_value or "").split(","):
        text = part.strip()
        if not text:
            continue
        try:
            allowed.add(int(text))
        except ValueError:
            logger.warning("Ignoring invalid TELEGRAM_ALLOWED_CHAT_IDS entry: %s", text)
    return allowed


@dataclass
class TelegramProjectRef:
    id: str
    name: str


@dataclass
class TelegramChatSession:
    chat_id: int
    project_id: str
    project_name: str
    scope: str


@dataclass
class TelegramDispatchResult:
    handled: bool
    action: str
    reply_preview: str = ""


@dataclass
class TelegramExecutionResult:
    success: bool
    project_id: str
    project_name: str
    scope: str
    run_id: str
    final_output: str
    execution_mode: str
    plan_summary: str = ""
    model: str = ""
    error: str = ""


class TelegramControlService:
    def __init__(
        self,
        *,
        token: str,
        default_project_id: str,
        default_scope: str,
        allowed_chat_ids: set[int] | None = None,
        polling_enabled: bool = False,
        poll_timeout_seconds: int = 30,
        webhook_secret: str = "",
        resolve_project: Callable[[str], TelegramProjectRef | None],
        list_projects: Callable[[], list[TelegramProjectRef]],
        execute_command: Callable[[str, str, str, int], Awaitable[TelegramExecutionResult]],
    ) -> None:
        self.token = token.strip()
        self.default_project_id = (default_project_id or "").strip()
        self.default_scope = self._normalize_scope(default_scope)
        self.allowed_chat_ids = allowed_chat_ids or set()
        self.polling_enabled = polling_enabled
        self.poll_timeout_seconds = max(int(poll_timeout_seconds or 30), 1)
        self.webhook_secret = (webhook_secret or "").strip()
        self.resolve_project = resolve_project
        self.list_projects = list_projects
        self.execute_command = execute_command

        self._offset: int | None = None
        self._poll_task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        self._sessions: dict[int, TelegramChatSession] = {}

    @property
    def enabled(self) -> bool:
        return bool(self.token)

    @property
    def is_running(self) -> bool:
        return self._poll_task is not None and not self._poll_task.done()

    @property
    def active_session_count(self) -> int:
        return len(self._sessions)

    def status_payload(self) -> dict[str, Any]:
        default_project = self.resolve_project(self.default_project_id) if self.default_project_id else None
        return {
            "enabled": self.enabled,
            "polling_enabled": self.polling_enabled,
            "running": self.is_running,
            "allowed_chat_count": len(self.allowed_chat_ids),
            "default_project_id": self.default_project_id,
            "default_project_name": default_project.name if default_project else "",
            "default_project_resolved": default_project is not None,
            "default_scope": self.default_scope,
            "active_session_count": self.active_session_count,
            "webhook_secret_configured": bool(self.webhook_secret),
        }

    def validate_webhook_secret(self, provided_secret: str) -> bool:
        if not self.webhook_secret:
            return True
        return provided_secret == self.webhook_secret

    async def start(self) -> None:
        if not self.enabled or not self.polling_enabled or self.is_running:
            return
        self._stop_event.clear()
        self._poll_task = asyncio.create_task(self._poll_loop())
        logger.info("Telegram control polling started")

    async def stop(self) -> None:
        if self._poll_task is None:
            return
        self._stop_event.set()
        self._poll_task.cancel()
        try:
            await self._poll_task
        except asyncio.CancelledError:
            pass
        finally:
            self._poll_task = None
        logger.info("Telegram control polling stopped")

    async def handle_update(self, update: dict[str, Any]) -> TelegramDispatchResult:
        message = update.get("message") if isinstance(update, dict) else None
        if not isinstance(message, dict):
            return TelegramDispatchResult(handled=False, action="ignored")

        update_id = update.get("update_id")
        if isinstance(update_id, int):
            self._offset = update_id + 1

        chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
        chat_id = chat.get("id")
        text = message.get("text")
        if not isinstance(chat_id, int) or not isinstance(text, str) or not text.strip():
            return TelegramDispatchResult(handled=False, action="ignored")

        if not self._is_authorized_chat(chat_id):
            await self._send_message(
                chat_id,
                "Telegram control is not enabled for this chat. "
                "Add this chat ID to TELEGRAM_ALLOWED_CHAT_IDS to authorize it.",
            )
            return TelegramDispatchResult(handled=True, action="unauthorized")

        session = self._sessions.get(chat_id) or self._default_session(chat_id)
        self._sessions[chat_id] = session

        stripped = text.strip()
        if stripped.startswith("/"):
            return await self._handle_command(chat_id, stripped, session)
        return await self._run_command(chat_id, stripped, session)

    def _default_session(self, chat_id: int) -> TelegramChatSession:
        default_project = self.resolve_project(self.default_project_id) if self.default_project_id else None
        if default_project is None:
            default_project = self._first_available_project()
        return TelegramChatSession(
            chat_id=chat_id,
            project_id=default_project.id if default_project else "",
            project_name=default_project.name if default_project else "",
            scope=self.default_scope,
        )

    def _first_available_project(self) -> TelegramProjectRef | None:
        projects = self.list_projects()
        return projects[0] if projects else None

    async def _poll_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                updates = await self._get_updates()
                for update in updates:
                    try:
                        await self.handle_update(update)
                    except Exception:
                        logger.exception("Telegram update handling failed")
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Telegram polling iteration failed")
                await asyncio.sleep(5)

    async def _get_updates(self) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {"timeout": self.poll_timeout_seconds}
        if self._offset is not None:
            payload["offset"] = self._offset
        response = await self._api_post("getUpdates", payload, timeout=self.poll_timeout_seconds + 10)
        if not response.get("ok"):
            raise RuntimeError(f"Telegram getUpdates failed: {response}")
        result = response.get("result")
        return result if isinstance(result, list) else []

    async def _handle_command(
        self,
        chat_id: int,
        command_text: str,
        session: TelegramChatSession,
    ) -> TelegramDispatchResult:
        parts = command_text.split(maxsplit=1)
        command = parts[0].lower()
        argument = parts[1].strip() if len(parts) > 1 else ""

        if command in {"/start", "/help"}:
            await self._send_message(chat_id, self._help_text(session))
            return TelegramDispatchResult(handled=True, action="help", reply_preview="help")

        if command == "/status":
            await self._send_message(chat_id, self._status_text(session))
            return TelegramDispatchResult(handled=True, action="status", reply_preview="status")

        if command == "/projects":
            await self._send_message(chat_id, self._projects_text())
            return TelegramDispatchResult(handled=True, action="projects", reply_preview="projects")

        if command == "/project":
            if not argument:
                await self._send_message(
                    chat_id,
                    "Usage: /project <project_id_or_exact_name>\n"
                    f"Current project: `{session.project_name or session.project_id or 'unset'}`",
                )
                return TelegramDispatchResult(handled=True, action="project_usage")

            project = self.resolve_project(argument)
            if project is None:
                await self._send_message(
                    chat_id,
                    "Project not found. Use `/projects` to see available StudioOS projects.",
                )
                return TelegramDispatchResult(handled=True, action="project_invalid")

            session.project_id = project.id
            session.project_name = project.name
            await self._send_message(
                chat_id,
                f"Project updated to `{project.name}` (`{project.id}`).",
            )
            return TelegramDispatchResult(handled=True, action="project_set", reply_preview=project.id)

        if command == "/scope":
            if not argument:
                await self._send_message(
                    chat_id,
                    "Usage: /scope <general|media|workspace>\n"
                    f"Current scope: `{session.scope}`",
                )
                return TelegramDispatchResult(handled=True, action="scope_usage")

            normalized = self._normalize_scope(argument)
            if normalized not in _DEFAULT_SCOPES:
                await self._send_message(
                    chat_id,
                    "Invalid scope. Use one of `general`, `media`, or `workspace`.",
                )
                return TelegramDispatchResult(handled=True, action="scope_invalid")

            session.scope = normalized
            await self._send_message(chat_id, f"Scope updated to `{session.scope}`.")
            return TelegramDispatchResult(handled=True, action="scope_set", reply_preview=session.scope)

        if command == "/reset":
            replacement = self._default_session(chat_id)
            self._sessions[chat_id] = replacement
            await self._send_message(
                chat_id,
                "Session reset.\n\n"
                f"Project: `{replacement.project_name or replacement.project_id or 'unset'}`\n"
                f"Scope: `{replacement.scope}`",
            )
            return TelegramDispatchResult(handled=True, action="reset")

        if command == "/run":
            if not argument:
                await self._send_message(chat_id, "Usage: /run <task>")
                return TelegramDispatchResult(handled=True, action="run_usage")
            return await self._run_command(chat_id, argument, session)

        await self._send_message(
            chat_id,
            "Unknown command. Use /help to see Telegram control commands.",
        )
        return TelegramDispatchResult(handled=True, action="unknown_command")

    async def _run_command(
        self,
        chat_id: int,
        command_text: str,
        session: TelegramChatSession,
    ) -> TelegramDispatchResult:
        task = command_text.strip()
        if not task:
            await self._send_message(chat_id, "Send a task or use /run <task>.")
            return TelegramDispatchResult(handled=True, action="empty_task")

        if not session.project_id:
            await self._send_message(
                chat_id,
                "No StudioOS project is selected. Use `/projects` and `/project <id>` first.",
            )
            return TelegramDispatchResult(handled=True, action="project_missing")

        await self._send_message(
            chat_id,
            f"Running StudioOS command for `{session.project_name or session.project_id}` in `{session.scope}` scope...",
        )

        try:
            result = await self.execute_command(session.project_id, task, session.scope, chat_id)
        except Exception as exc:
            logger.exception("Telegram command execution failed")
            await self._send_message(
                chat_id,
                f"StudioOS command failed for project `{session.project_id}`.\n\n{exc}",
            )
            return TelegramDispatchResult(handled=True, action="task_failed", reply_preview=str(exc)[:240])

        if result.success:
            reply = (
                f"Project: `{result.project_name}`\n"
                f"Scope: `{result.scope}`\n"
                f"Mode: `{result.execution_mode}`\n"
                f"Run ID: `{result.run_id}`\n"
                f"Model: `{result.model or 'local'}`\n"
            )
            if result.plan_summary:
                reply += f"\nPlan: {result.plan_summary}\n"
            reply += f"\n{result.final_output.strip() or '[No text returned]'}"
        else:
            reply = (
                f"Project: `{result.project_name or result.project_id}`\n"
                f"Scope: `{result.scope}`\n"
                f"Run ID: `{result.run_id or 'unavailable'}`\n"
                f"Status: failed\n\n"
                f"{result.error or 'The workflow command returned an unknown error.'}"
            )

        await self._send_message(chat_id, reply)
        return TelegramDispatchResult(
            handled=True,
            action="task_run" if result.success else "task_failed",
            reply_preview=reply[:240],
        )

    def _help_text(self, session: TelegramChatSession) -> str:
        return (
            "StudioOS Telegram control\n\n"
            "Plain text runs a natural-language StudioOS workflow command for the current project and scope.\n\n"
            "Commands:\n"
            "/status - show current Telegram session settings\n"
            "/projects - list recent StudioOS projects\n"
            "/project <project_id_or_exact_name> - switch the active project\n"
            "/scope <general|media|workspace> - switch the workflow-command scope\n"
            "/run <task> - run an explicit task\n"
            "/reset - restore default project and scope\n"
            "/help - show this message\n\n"
            f"Current project: `{session.project_name or session.project_id or 'unset'}`\n"
            f"Current scope: `{session.scope}`"
        )

    def _status_text(self, session: TelegramChatSession) -> str:
        allowlist_state = "configured" if self.allowed_chat_ids else "open"
        return (
            "Telegram control status\n\n"
            f"Project: `{session.project_name or session.project_id or 'unset'}`\n"
            f"Scope: `{session.scope}`\n"
            f"Service polling: `{self.polling_enabled}`\n"
            f"Authorized chat list: `{allowlist_state}`\n"
            f"Webhook secret configured: `{bool(self.webhook_secret)}`"
        )

    def _projects_text(self) -> str:
        projects = self.list_projects()
        if not projects:
            return "No StudioOS projects are available yet."

        lines = ["Recent StudioOS projects", ""]
        for project in projects[:12]:
            lines.append(f"- `{project.name}`: `{project.id}`")
        lines.append("")
        lines.append("Use `/project <project_id>` or `/project <exact_name>` to switch.")
        return "\n".join(lines)

    def _is_authorized_chat(self, chat_id: int) -> bool:
        if not self.allowed_chat_ids:
            return True
        return chat_id in self.allowed_chat_ids

    async def _send_message(self, chat_id: int, text: str) -> None:
        for chunk in self._split_message(text):
            payload = {
                "chat_id": chat_id,
                "text": chunk,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            }
            response = await self._api_post("sendMessage", payload, timeout=30)
            if not response.get("ok"):
                logger.warning("Telegram sendMessage failed: %s", response)

    async def _api_post(self, method: str, payload: dict[str, Any], *, timeout: int) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"https://api.telegram.org/bot{self.token}/{method}",
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    @staticmethod
    def _normalize_scope(raw_scope: str) -> str:
        normalized = (raw_scope or "general").strip().lower()
        if normalized not in _DEFAULT_SCOPES:
            return "general"
        return normalized

    @staticmethod
    def _split_message(text: str) -> list[str]:
        normalized = re.sub(r"\r\n?", "\n", text).strip()
        if not normalized:
            return ["[empty response]"]
        if len(normalized) <= _TELEGRAM_MESSAGE_LIMIT:
            return [normalized]

        chunks: list[str] = []
        current = normalized
        while current:
            if len(current) <= _TELEGRAM_MESSAGE_LIMIT:
                chunks.append(current)
                break
            split_at = current.rfind("\n\n", 0, _TELEGRAM_MESSAGE_LIMIT)
            if split_at < 0:
                split_at = current.rfind("\n", 0, _TELEGRAM_MESSAGE_LIMIT)
            if split_at < 0:
                split_at = _TELEGRAM_MESSAGE_LIMIT
            chunks.append(current[:split_at].strip())
            current = current[split_at:].strip()
        return [chunk for chunk in chunks if chunk]
