from __future__ import annotations

from typing import Any

import httpx


class BrowserToolkit:
    """Async helper for the local AI Browser API."""

    def __init__(self, base_url: str = "http://localhost:8001"):
        self.base_url = base_url.rstrip("/")

    async def check_status(self) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(f"{self.base_url}/status")
                response.raise_for_status()
            return response.json()
        except Exception as exc:
            return {"status": "offline", "error": str(exc)}

    async def navigate(self, url: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(f"{self.base_url}/navigate", json={"url": url})
            response.raise_for_status()
        return response.json()

    async def type_text(self, element_id: int, text: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{self.base_url}/type",
                json={"element_id": element_id, "text": text},
            )
            response.raise_for_status()
        return response.json()

    async def click_element(self, element_id: int) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(f"{self.base_url}/click", json={"element_id": element_id})
            response.raise_for_status()
        return response.json()

    async def get_markdown(self) -> str:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{self.base_url}/markdown")
            response.raise_for_status()
        data = response.json()
        if data.get("status") == "success":
            return data.get("markdown", "")
        return f"Error: {data.get('error', 'Unknown Error')}"

    async def get_screenshot(self) -> str:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{self.base_url}/screenshot")
            response.raise_for_status()
        data = response.json()
        if data.get("status") == "success":
            return data.get("image_base64", "")
        return ""
