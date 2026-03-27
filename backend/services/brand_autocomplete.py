from __future__ import annotations

import json
from typing import Any, Iterable

from sqlalchemy.orm import Session

from database_models import DocumentRecord, ProjectRecord, PromptTemplateRecord
from models.model_client import chat_completion, extract_text, get_local_autofill_model
from services.document_indexing import extract_text_for_file
from storage.vector_store import VectorStore

BRAND_BIBLE_FIELDS = {
    "brand_name",
    "voice_tone",
    "style_guide",
    "audience_personas",
    "off_brand_examples",
    "published_content_index",
}

FIELD_QUERY_HINTS = {
    "brand_name": "brand name tagline positioning about page mission statement",
    "voice_tone": "voice tone editorial style tone language audience messaging",
    "style_guide": "style guide editorial standards formatting structure website youtube brand rules",
    "audience_personas": "target audience persona viewer reader customer content preferences",
    "off_brand_examples": "avoid off-brand mistakes inconsistencies low quality misaligned messaging",
    "published_content_index": "published content library episodes articles releases uploads archive",
    "all": "brand identity audience style guide messaging website youtube publishing",
}

TEXT_FALLBACK_EXTENSIONS = {
    ".csv",
    ".docx",
    ".html",
    ".json",
    ".md",
    ".py",
    ".txt",
    ".yaml",
    ".yml",
}


def _json_dump(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=True)


def _render_template(template: str, values: dict[str, Any]) -> str:
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", str(value))
    return rendered


def _strip_code_fences(raw: str) -> str:
    text = raw.strip()
    if not text.startswith("```"):
        return text
    parts = text.split("```")
    if len(parts) < 2:
        return text
    candidate = parts[1].strip()
    if candidate.startswith("json"):
        candidate = candidate[4:].strip()
    return candidate


def _normalize_string(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalize_string_list(values: Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        text = values.strip()
        return [text] if text else []
    if not isinstance(values, Iterable):
        return [_normalize_string(values)] if _normalize_string(values) else []

    normalized: list[str] = []
    for value in values:
        text = _normalize_string(value)
        if text:
            normalized.append(text)
    return normalized


def _normalize_style_guide(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(key): _normalize_string(item) for key, item in value.items() if str(key).strip()}


def _normalize_audience_personas(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    personas: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = _normalize_string(item.get("name"))
        description = _normalize_string(item.get("description"))
        preferences = _normalize_string_list(item.get("content_preferences"))
        if not any([name, description, preferences]):
            continue
        personas.append(
            {
                "name": name,
                "description": description,
                "content_preferences": preferences,
            }
        )
    return personas


def _normalize_published_content_index(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    entries: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        title = _normalize_string(item.get("title"))
        platform = _normalize_string(item.get("platform"))
        published_at = _normalize_string(item.get("published_at"))
        url = _normalize_string(item.get("url"))
        topics = _normalize_string_list(item.get("topics"))
        if not any([title, platform, published_at, url, topics]):
            continue
        payload = {
            "title": title,
            "platform": platform,
            "published_at": published_at,
            "topics": topics,
        }
        if url:
            payload["url"] = url
        entries.append(payload)
    return entries


def normalize_brand_bible_suggestions(payload: dict[str, Any], requested_field: str) -> dict[str, Any]:
    requested_fields = BRAND_BIBLE_FIELDS if requested_field == "all" else {requested_field}
    source = payload.get("suggestions") if isinstance(payload.get("suggestions"), dict) else payload

    suggestions: dict[str, Any] = {}
    if "brand_name" in requested_fields and "brand_name" in source:
        suggestions["brand_name"] = _normalize_string(source.get("brand_name"))
    if "voice_tone" in requested_fields and "voice_tone" in source:
        suggestions["voice_tone"] = _normalize_string(source.get("voice_tone"))
    if "style_guide" in requested_fields and "style_guide" in source:
        suggestions["style_guide"] = _normalize_style_guide(source.get("style_guide"))
    if "audience_personas" in requested_fields and "audience_personas" in source:
        suggestions["audience_personas"] = _normalize_audience_personas(source.get("audience_personas"))
    if "off_brand_examples" in requested_fields and "off_brand_examples" in source:
        suggestions["off_brand_examples"] = _normalize_string_list(source.get("off_brand_examples"))
    if "published_content_index" in requested_fields and "published_content_index" in source:
        suggestions["published_content_index"] = _normalize_published_content_index(source.get("published_content_index"))

    return suggestions


def _parse_model_json(raw_text: str) -> dict[str, Any]:
    candidate = _strip_code_fences(raw_text)
    return json.loads(candidate)


async def _gather_document_context(
    project: ProjectRecord,
    db: Session,
    *,
    field: str,
    vector_store: VectorStore,
) -> tuple[str, list[str]]:
    doc_chunks: list[str] = []
    doc_names: list[str] = []
    seen_ids: set[str] = set()
    query = FIELD_QUERY_HINTS.get(field, FIELD_QUERY_HINTS["all"])

    try:
        vector_results = await vector_store.search(query=query, n_results=4, filters={"project_id": project.id})
    except Exception:
        vector_results = []

    for result in vector_results:
        document_id = str(result.metadata.get("document_id") or result.document.id or "")
        filename = str(result.metadata.get("filename") or "document")
        if document_id and document_id in seen_ids:
            continue
        if document_id:
            seen_ids.add(document_id)
        snippet = result.document.content.strip()
        if not snippet:
            continue
        doc_names.append(filename)
        doc_chunks.append(f"[{filename}]\n{snippet[:1200]}")

    if len(doc_chunks) >= 3:
        return "\n\n".join(doc_chunks[:3]), doc_names[:3]

    recent_documents = (
        db.query(DocumentRecord)
        .filter(DocumentRecord.project_id == project.id)
        .order_by(DocumentRecord.created_at.desc())
        .limit(8)
        .all()
    )

    for document in recent_documents:
        if document.id in seen_ids:
            continue
        suffix = document.filename.rsplit(".", 1)[-1].lower() if "." in document.filename else ""
        if suffix and f".{suffix}" not in TEXT_FALLBACK_EXTENSIONS:
            continue
        text = (await extract_text_for_file(document.path)).strip()
        if not text:
            continue
        seen_ids.add(document.id)
        doc_names.append(document.filename)
        doc_chunks.append(f"[{document.filename}]\n{text[:1200]}")
        if len(doc_chunks) >= 3:
            break

    if not doc_chunks:
        return "No indexed project document context was available.", []
    return "\n\n".join(doc_chunks), doc_names


async def generate_brand_autocomplete(
    *,
    project: ProjectRecord,
    db: Session,
    template: PromptTemplateRecord,
    field: str,
    guidance: str,
    current_brand_bible: dict[str, Any],
    vector_store: VectorStore,
) -> dict[str, Any]:
    document_context, context_documents = await _gather_document_context(
        project,
        db,
        field=field,
        vector_store=vector_store,
    )

    render_values = {
        "project_name": project.name,
        "project_description": project.description or "",
        "project_domains": ", ".join(project.domains or []),
        "requested_field": field,
        "guidance": guidance.strip() or "None",
        "brand_bible_json": _json_dump(current_brand_bible or {}),
        "story_bible_json": _json_dump(project.story_bible or {}),
        "document_context": document_context,
    }

    system_prompt = _render_template(template.system_prompt, render_values).strip()
    user_prompt = _render_template(template.user_prompt_template, render_values).strip()
    user_prompt += (
        "\n\nReturn exactly one JSON object with this shape:\n"
        "{\n"
        '  "suggestions": {\n'
        '    "brand_name": "string",\n'
        '    "voice_tone": "string",\n'
        '    "style_guide": {"rule_name": "rule details"},\n'
        '    "audience_personas": [{"name": "string", "description": "string", "content_preferences": ["string"]}],\n'
        '    "off_brand_examples": ["string"],\n'
        '    "published_content_index": [{"title": "string", "platform": "string", "published_at": "string", "topics": ["string"], "url": "optional string"}]\n'
        "  },\n"
        '  "rationale": "brief explanation"\n'
        "}\n"
        f"Only include the requested field(s): {field}."
    )

    response = await chat_completion(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        model=get_local_autofill_model(),
        temperature=0.4,
        max_tokens=2200,
    )
    raw_text = extract_text(response)
    parsed = _parse_model_json(raw_text)
    suggestions = normalize_brand_bible_suggestions(parsed, field)
    if not suggestions:
        raise ValueError("The model response did not include usable brand suggestions.")

    rationale = _normalize_string(parsed.get("rationale"))
    return {
        "field": field,
        "suggestions": suggestions,
        "rationale": rationale,
        "raw_text": raw_text,
        "context_documents": context_documents,
    }
