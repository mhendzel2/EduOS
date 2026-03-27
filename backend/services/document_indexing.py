from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from storage.vector_store import Document

logger = logging.getLogger(__name__)

_CHUNK_SIZE = 1500
_CHUNK_OVERLAP = 200
_BINARY_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".ico",
    ".mp4",
    ".mov",
    ".webm",
    ".m4v",
    ".avi",
    ".mp3",
    ".wav",
}


def _chunk_documents(text: str, metadata: dict, *, id_prefix: Optional[str] = None) -> list[Document]:
    chunks: list[Document] = []
    start = 0
    chunk_index = 0
    while start < len(text):
        end = start + _CHUNK_SIZE
        chunk_text = text[start:end].strip()
        if chunk_text:
            chunk_id = f"{id_prefix}:chunk:{chunk_index}" if id_prefix else None
            chunks.append(
                Document(
                    id=chunk_id,
                    content=chunk_text,
                    metadata={**metadata, "chunk_index": chunk_index},
                )
            )
            chunk_index += 1
        start += _CHUNK_SIZE - _CHUNK_OVERLAP
    return chunks


async def build_vector_documents_for_file(
    path: str,
    *,
    document_id: str,
    base_metadata: dict,
) -> list[Document]:
    text_content = await extract_text_for_file(path)
    if not text_content.strip():
        return []

    metadata = {**base_metadata, "document_id": document_id, "source_file": Path(path).name}
    chunked = _chunk_documents(text_content, metadata, id_prefix=document_id)
    if chunked:
        return chunked

    return [Document(id=document_id, content=text_content, metadata=metadata)]


def build_vector_documents_for_structured_document(
    payload: dict,
    *,
    document_id: str,
    base_metadata: dict,
) -> list[Document]:
    title = str(payload.get("title") or "").strip()
    abstract = str(payload.get("abstract") or "").strip()
    content = str(payload.get("content") or "").strip()
    citation = str(payload.get("citation") or "").strip()
    source_type = str(payload.get("source_type") or "structured").strip()
    source_identifier = str(payload.get("source_identifier") or "").strip()
    source_url = str(payload.get("source_url") or "").strip()
    authors = [str(item).strip() for item in list(payload.get("authors") or []) if str(item).strip()]

    sections = [
        section
        for section in [
            f"Title: {title}" if title else "",
            f"Abstract: {abstract}" if abstract else "",
            f"Content: {content}" if content else "",
            f"Authors: {', '.join(authors)}" if authors else "",
            f"Citation: {citation}" if citation else "",
            f"Source Type: {source_type}" if source_type else "",
            f"Identifier: {source_identifier}" if source_identifier else "",
            f"Source URL: {source_url}" if source_url else "",
        ]
        if section
    ]
    normalized_text = "\n\n".join(sections).strip()
    if not normalized_text:
        return []

    metadata = {
        **base_metadata,
        "document_id": document_id,
        "source_type": source_type,
        "source_identifier": source_identifier,
        "source_url": source_url,
        "citation": citation,
        "authors": authors,
    }
    chunked = _chunk_documents(normalized_text, metadata, id_prefix=document_id)
    if chunked:
        return chunked
    return [Document(id=document_id, content=normalized_text, metadata=metadata)]


async def extract_text_for_file(path: str) -> str:
    suffix = Path(path).suffix.lower()
    if suffix in _BINARY_EXTENSIONS:
        return ""
    if suffix == ".pdf":
        return _extract_pdf_text(path)
    if suffix == ".docx":
        return _extract_docx_text(path)
    if suffix == ".json":
        return _extract_json_text(path)
    return _read_text_file(path)


def _read_text_file(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8", errors="ignore")
    except Exception:
        logger.warning("Failed to read %s as plain text", path, exc_info=True)
        return ""


def _extract_pdf_text(path: str) -> str:
    try:
        import fitz

        with fitz.open(path) as document:
            return "\n\n".join(page.get_text("text") for page in document).strip()
    except Exception:
        logger.warning("Failed to extract PDF text from %s", path, exc_info=True)
        return ""


def _extract_docx_text(path: str) -> str:
    try:
        from docx import Document as DocxDocument

        document = DocxDocument(path)
        paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
        return "\n".join(paragraphs)
    except Exception:
        logger.warning("Failed to extract DOCX text from %s", path, exc_info=True)
        return ""


def _extract_json_text(path: str) -> str:
    try:
        parsed = json.loads(Path(path).read_text(encoding="utf-8", errors="ignore"))
        return json.dumps(parsed, indent=2, ensure_ascii=True)
    except Exception:
        logger.warning("Failed to normalize JSON text from %s", path, exc_info=True)
        return _read_text_file(path)
