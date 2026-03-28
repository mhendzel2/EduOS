from __future__ import annotations

import logging

from config import settings
from models.model_client import chat_completion, extract_text

logger = logging.getLogger(__name__)


class TurboQuantCompressor:
    """
    Dense memory compression inspired by BaseOS TurboQuant support.

    The compressor is opt-in and only runs when memory payloads are large enough
    to justify an extra model call.
    """

    @staticmethod
    async def compress_context(
        memory_text: str,
        engine_model: str | None = None,
    ) -> str:
        if len(memory_text or "") < settings.TURBOQUANT_MIN_CHARS:
            return memory_text

        compression_model = (
            (engine_model or "").strip()
            or (settings.TURBOQUANT_COMPRESSION_MODEL or "").strip()
            or "gemini/gemini-2.5-flash"
        )
        logger.info("[TurboQuant] Compressing context with %s", compression_model)

        try:
            response = await chat_completion(
                model=compression_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a TurboQuant-style semantic memory compressor. "
                            "Compress the provided memory into the smallest possible token footprint "
                            "while preserving critical facts, file paths, constraints, and decision logic. "
                            "Use dense technical shorthand. Do not add filler."
                        ),
                    },
                    {"role": "user", "content": memory_text},
                ],
                temperature=0.0,
                max_tokens=1024,
            )
            compressed = extract_text(response).strip()
            if not compressed:
                return memory_text
            return f"<turboquant_compressed_cache>\n{compressed}\n</turboquant_compressed_cache>"
        except Exception as exc:
            logger.warning("[TurboQuant] Compression failed; using raw memory. %s", exc)
            return memory_text
