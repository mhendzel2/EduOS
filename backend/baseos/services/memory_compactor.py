from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from config import settings
from storage.vector_store import Document, VectorStore

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_facts(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        items = value.splitlines()
    elif isinstance(value, list):
        items = value
    else:
        items = list(value)

    normalized: list[str] = []
    seen: set[str] = set()
    for item in items:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized


def _estimate_tokens(summary: str, pinned_facts: list[str]) -> int:
    source = summary.strip()
    if pinned_facts:
        source = f"{source}\n" + "\n".join(pinned_facts)
    if not source.strip():
        return 0
    return max(1, round(len(source) / 4))


@dataclass
class MemoryArchiveMatch:
    content: str
    score: float
    metadata: dict[str, Any]


class MemoryCompactor:
    """
    Active memory budget manager for EduOS.

    It archives older memory blocks into the existing vector store so agents can
    retrieve them later instead of carrying them in every prompt.
    """

    def __init__(self, vector_store: VectorStore | None = None):
        self.vector_store = vector_store or VectorStore(collection_name="memory_archives")

    async def compact_project_memory(self, record) -> bool:
        return await self._compact_record(record, scope="project", scope_id=str(record.project_id))

    async def compact_workspace_memory(self, record) -> bool:
        return await self._compact_record(record, scope="workspace", scope_id=str(record.id))

    async def search_archives(
        self,
        *,
        scope: str,
        scope_id: str,
        query: str,
        n_results: int = 3,
    ) -> list[MemoryArchiveMatch]:
        if not query.strip():
            return []

        results = await self.vector_store.search(
            query=query,
            n_results=max(1, n_results),
            filters={"scope": scope, "scope_id": scope_id},
        )
        return [
            MemoryArchiveMatch(
                content=result.document.content,
                score=result.score,
                metadata=dict(result.metadata or {}),
            )
            for result in results
        ]

    async def _compact_record(self, record, *, scope: str, scope_id: str) -> bool:
        threshold = max(1, settings.MEMORY_COMPACTION_TOKEN_THRESHOLD)
        keep_fact_count = max(1, settings.MEMORY_COMPACTION_FACT_RETENTION)
        summary_keep_chars = max(200, settings.MEMORY_COMPACTION_SUMMARY_KEEP_CHARS)

        summary = str(record.summary or "").strip()
        pinned_facts = _normalize_facts(record.pinned_facts)
        estimated_tokens = _estimate_tokens(summary, pinned_facts)
        record.active_token_estimate = estimated_tokens

        if estimated_tokens <= threshold:
            return False

        archived_documents: list[Document] = []

        if len(pinned_facts) > keep_fact_count:
            archived_facts = pinned_facts[:-keep_fact_count]
            retained_facts = pinned_facts[-keep_fact_count:]
            record.pinned_facts = retained_facts
            for fact in archived_facts:
                archived_documents.append(
                    Document(
                        id=f"{scope}-{scope_id}-fact-{uuid4().hex[:12]}",
                        content=fact,
                        metadata={
                            "scope": scope,
                            "scope_id": scope_id,
                            "kind": "pinned_fact",
                        },
                    )
                )
        else:
            record.pinned_facts = pinned_facts

        if len(summary) > summary_keep_chars:
            overflow = summary[summary_keep_chars:].strip()
            if overflow:
                archived_documents.append(
                    Document(
                        id=f"{scope}-{scope_id}-summary-{uuid4().hex[:12]}",
                        content=overflow,
                        metadata={
                            "scope": scope,
                            "scope_id": scope_id,
                            "kind": "summary_overflow",
                        },
                    )
                )
                retained_summary = summary[:summary_keep_chars].rstrip()
                record.summary = f"{retained_summary}\n\n[Older memory archived to semantic search.]"
        else:
            record.summary = summary

        if not archived_documents:
            record.active_token_estimate = _estimate_tokens(record.summary or "", _normalize_facts(record.pinned_facts))
            return False

        await self.vector_store.add_documents(archived_documents)
        record.compaction_count = int(getattr(record, "compaction_count", 0) or 0) + 1
        record.last_compacted_at = _utc_now()
        record.active_token_estimate = _estimate_tokens(record.summary or "", _normalize_facts(record.pinned_facts))
        logger.info(
            "[MemoryCompactor] Archived %s memory entries for %s:%s",
            len(archived_documents),
            scope,
            scope_id,
        )
        return True


global_memory_compactor = MemoryCompactor()
