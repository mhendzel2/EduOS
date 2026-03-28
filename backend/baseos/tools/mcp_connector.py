from __future__ import annotations

import os
from typing import Any, Optional

try:
    from mcp import StdioServerParameters
    from mcp.client.session import ClientSession
    from mcp.client.stdio import stdio_client

    MCP_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    MCP_AVAILABLE = False
    ClientSession = Any  # type: ignore[assignment]
    StdioServerParameters = Any  # type: ignore[assignment]


class McpConnector:
    """Connect EduOS to stdio MCP servers using the BaseOS connector contract."""

    def __init__(self, command: str, args: list[str]):
        self.command = command
        self.args = args
        self.session: Optional[ClientSession] = None
        self._exit_stack = None
        self.read = None
        self.write = None

    async def connect(self) -> ClientSession:
        if not MCP_AVAILABLE:
            raise RuntimeError("mcp package is not installed. Run `pip install mcp`")

        from contextlib import AsyncExitStack

        self._exit_stack = AsyncExitStack()
        server_params = StdioServerParameters(
            command=self.command,
            args=self.args,
            env=os.environ.copy(),
        )
        stdio_transport = await self._exit_stack.enter_async_context(stdio_client(server_params))
        self.read, self.write = stdio_transport
        self.session = await self._exit_stack.enter_async_context(ClientSession(self.read, self.write))
        await self.session.initialize()
        return self.session

    async def get_tools(self) -> list[Any]:
        if not MCP_AVAILABLE:
            return []
        if self.session is None:
            await self.connect()
        try:
            response = await self.session.list_tools()
            return list(response.tools or [])
        except Exception:
            return []

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        if self.session is None:
            await self.connect()
        return await self.session.call_tool(name, arguments)

    async def close(self) -> None:
        if self._exit_stack is not None:
            await self._exit_stack.aclose()
