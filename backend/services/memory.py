from __future__ import annotations

import json
from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from database_models import (
    ArtifactRecord,
    DocumentRecord,
    ProjectMemoryRecord,
    ProjectRecord,
    PromptTemplateRecord,
    RunRecord,
    WorkspaceMemoryRecord,
)
from models.model_client import chat_completion, extract_text, get_local_autofill_model
from services.document_indexing import extract_text_for_file
from storage.vector_store import VectorStore

WORKSPACE_MEMORY_ID = "global"
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
    return json.dumps(value, indent=2, ensure_ascii=True, default=str)


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


def normalize_pinned_facts(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        items = value.splitlines()
    elif isinstance(value, Iterable):
        items = list(value)
    else:
        items = [value]

    normalized: list[str] = []
    seen: set[str] = set()
    for item in items:
        if item is None:
            continue
        text = str(item).strip()
        if not text:
            continue
        if text in seen:
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


def serialize_project_memory(record: ProjectMemoryRecord) -> dict[str, Any]:
    return {
        "project_id": record.project_id,
        "summary": record.summary or "",
        "pinned_facts": normalize_pinned_facts(record.pinned_facts),
        "active_token_estimate": record.active_token_estimate or 0,
        "compaction_count": record.compaction_count or 0,
        "last_compacted_at": record.last_compacted_at,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def serialize_workspace_memory(record: WorkspaceMemoryRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "summary": record.summary or "",
        "pinned_facts": normalize_pinned_facts(record.pinned_facts),
        "active_token_estimate": record.active_token_estimate or 0,
        "compaction_count": record.compaction_count or 0,
        "last_compacted_at": record.last_compacted_at,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def get_or_create_workspace_memory(db: Session) -> WorkspaceMemoryRecord:
    record = db.query(WorkspaceMemoryRecord).filter(WorkspaceMemoryRecord.id == WORKSPACE_MEMORY_ID).first()
    if record:
        return record

    record = WorkspaceMemoryRecord(id=WORKSPACE_MEMORY_ID)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_or_create_project_memory(db: Session, project_id: str) -> ProjectMemoryRecord:
    record = db.query(ProjectMemoryRecord).filter(ProjectMemoryRecord.project_id == project_id).first()
    if record:
        return record

    record = ProjectMemoryRecord(project_id=project_id)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def update_memory_record(record: ProjectMemoryRecord | WorkspaceMemoryRecord, *, summary: str, pinned_facts: Any) -> None:
    normalized_facts = normalize_pinned_facts(pinned_facts)
    record.summary = summary.strip()
    record.pinned_facts = normalized_facts
    record.active_token_estimate = _estimate_tokens(record.summary, normalized_facts)


def get_memory_context(project: ProjectRecord, db: Optional[Session] = None) -> dict[str, Any]:
    project_memory = getattr(project, "memory", None)
    if project_memory is None and db is not None:
        project_memory = db.query(ProjectMemoryRecord).filter(ProjectMemoryRecord.project_id == project.id).first()

    workspace_memory = None
    if db is not None:
        workspace_memory = db.query(WorkspaceMemoryRecord).filter(WorkspaceMemoryRecord.id == WORKSPACE_MEMORY_ID).first()

    return {
        "story_bible": project.story_bible or {},
        "brand_bible": project.brand_bible or {},
        "domains": list(project.domains or []),
        "workspace_memory": {
            "summary": workspace_memory.summary if workspace_memory else "",
            "pinned_facts": normalize_pinned_facts(workspace_memory.pinned_facts if workspace_memory else []),
        },
        "project_memory": {
            "summary": project_memory.summary if project_memory else "",
            "pinned_facts": normalize_pinned_facts(project_memory.pinned_facts if project_memory else []),
        },
    }


def _parse_json_loose(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    raw = value.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        if len(parts) > 1:
            raw = parts[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        parsed = json.loads(raw.strip())
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def update_bibles_from_artifact(project: ProjectRecord, artifact_type: str, content: str | None) -> None:
    story_bible = dict(project.story_bible or {})
    brand_bible = dict(project.brand_bible or {})
    parsed = _parse_json_loose(content)

    if artifact_type == "character_bible" and parsed:
        story_bible.setdefault("characters", {}).update(parsed.get("characters", {}))
    elif artifact_type == "continuity_record":
        story_bible.setdefault("continuity", [])
        if content:
            story_bible["continuity"].append({"fact": content[:500], "established_in": "latest_run", "canon": True})
    elif artifact_type == "outline" and content:
        story_bible["latest_outline"] = content
    elif artifact_type == "publish_package" and content:
        brand_bible.setdefault("published_content_index", []).append(
            {
                "title": parsed.get("title", "Generated package") if parsed else "Generated package",
                "platform": parsed.get("platform", "studio") if parsed else "studio",
                "published_at": "pending",
                "topics": parsed.get("topics", []) if parsed else [],
            }
        )

    project.story_bible = story_bible
    project.brand_bible = brand_bible


def _format_run_context(runs: list[RunRecord]) -> str:
    if not runs:
        return "No recent run history was available."

    chunks: list[str] = []
    for run in runs:
        final_output = (run.final_output or "").strip()
        output_snippet = final_output[:900] if final_output else "(no final output recorded)"
        chunks.append(
            f"[Run {run.id}]\n"
            f"Task: {run.task}\n"
            f"Type: {run.run_type}\n"
            f"Status: {run.status}\n"
            f"Output:\n{output_snippet}"
        )
    return "\n\n".join(chunks)


def _format_artifact_context(artifacts: list[ArtifactRecord]) -> str:
    if not artifacts:
        return "No recent artifacts were available."

    chunks: list[str] = []
    for artifact in artifacts:
        content = (artifact.content or "").strip()
        if not content:
            continue
        chunks.append(
            f"[Artifact {artifact.artifact_type} v{artifact.version}]\n"
            f"{content[:900]}"
        )
    return "\n\n".join(chunks) if chunks else "No recent artifacts were available."


async def _gather_project_document_context(
    project: ProjectRecord,
    db: Session,
    *,
    guidance: str,
    vector_store: VectorStore,
) -> tuple[str, list[str]]:
    doc_chunks: list[str] = []
    doc_names: list[str] = []
    seen_ids: set[str] = set()
    query = guidance.strip() or project.description or project.name

    try:
        vector_results = await vector_store.search(query=query, n_results=4, filters={"project_id": project.id})
    except Exception:
        vector_results = []

    for result in vector_results:
        document_id = str(result.metadata.get("document_id") or result.document.id or "")
        filename = str(result.metadata.get("filename") or "document")
        snippet = result.document.content.strip()
        if not snippet:
            continue
        if document_id and document_id in seen_ids:
            continue
        if document_id:
            seen_ids.add(document_id)
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


def _parse_memory_model_response(raw_text: str) -> dict[str, Any]:
    parsed = json.loads(_strip_code_fences(raw_text))
    if not isinstance(parsed, dict):
        raise ValueError("The model response was not a JSON object.")

    summary = str(parsed.get("summary") or "").strip()
    pinned_facts = normalize_pinned_facts(parsed.get("pinned_facts", []))
    rationale = str(parsed.get("rationale") or "").strip()
    if not summary and not pinned_facts:
        raise ValueError("The model response did not include usable memory content.")
    return {
        "summary": summary,
        "pinned_facts": pinned_facts,
        "rationale": rationale,
    }


async def generate_project_memory_autocomplete(
    *,
    project: ProjectRecord,
    db: Session,
    template: PromptTemplateRecord,
    guidance: str,
    vector_store: VectorStore,
) -> dict[str, Any]:
    project_memory = get_or_create_project_memory(db, project.id)
    workspace_memory = get_or_create_workspace_memory(db)
    document_context, document_names = await _gather_project_document_context(
        project,
        db,
        guidance=guidance,
        vector_store=vector_store,
    )
    recent_runs = (
        db.query(RunRecord)
        .filter(RunRecord.project_id == project.id)
        .order_by(RunRecord.started_at.desc())
        .limit(4)
        .all()
    )
    recent_artifacts = (
        db.query(ArtifactRecord)
        .filter(ArtifactRecord.project_id == project.id)
        .order_by(ArtifactRecord.created_at.desc())
        .limit(4)
        .all()
    )

    render_values = {
        "project_name": project.name,
        "project_description": project.description or "",
        "project_domains": ", ".join(project.domains or []),
        "guidance": guidance.strip() or "None",
        "story_bible_json": _json_dump(project.story_bible or {}),
        "brand_bible_json": _json_dump(project.brand_bible or {}),
        "workspace_memory_json": _json_dump(serialize_workspace_memory(workspace_memory)),
        "project_memory_json": _json_dump(serialize_project_memory(project_memory)),
        "document_context": document_context,
        "recent_runs": _format_run_context(recent_runs),
        "recent_artifacts": _format_artifact_context(recent_artifacts),
    }

    system_prompt = _render_template(template.system_prompt, render_values).strip()
    user_prompt = _render_template(template.user_prompt_template, render_values).strip()
    user_prompt += (
        "\n\nReturn exactly one JSON object with this shape:\n"
        "{\n"
        '  "summary": "short reusable project memory summary",\n'
        '  "pinned_facts": ["fact 1", "fact 2"],\n'
        '  "rationale": "brief explanation"\n'
        "}\n"
        "Focus on stable facts, recurring preferences, reusable process guidance, and active constraints."
    )

    response = await chat_completion(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        model=get_local_autofill_model(),
        temperature=0.3,
        max_tokens=1800,
    )
    raw_text = extract_text(response)
    parsed = _parse_memory_model_response(raw_text)
    return {
        **parsed,
        "raw_text": raw_text,
        "context_sources": document_names + [f"run:{run.id}" for run in recent_runs] + [f"artifact:{artifact.artifact_type}" for artifact in recent_artifacts],
    }


async def generate_workspace_memory_autocomplete(
    *,
    db: Session,
    template: PromptTemplateRecord,
    guidance: str,
) -> dict[str, Any]:
    workspace_memory = get_or_create_workspace_memory(db)
    projects = db.query(ProjectRecord).order_by(ProjectRecord.updated_at.desc()).limit(8).all()
    recent_runs = db.query(RunRecord).order_by(RunRecord.started_at.desc()).limit(8).all()
    recent_artifacts = db.query(ArtifactRecord).order_by(ArtifactRecord.created_at.desc()).limit(6).all()

    project_summaries = [
        {
            "name": project.name,
            "domains": list(project.domains or []),
            "description": project.description or "",
        }
        for project in projects
    ]

    render_values = {
        "guidance": guidance.strip() or "None",
        "workspace_memory_json": _json_dump(serialize_workspace_memory(workspace_memory)),
        "projects_json": _json_dump(project_summaries),
        "recent_runs": _format_run_context(recent_runs),
        "recent_artifacts": _format_artifact_context(recent_artifacts),
    }

    system_prompt = _render_template(template.system_prompt, render_values).strip()
    user_prompt = _render_template(template.user_prompt_template, render_values).strip()
    user_prompt += (
        "\n\nReturn exactly one JSON object with this shape:\n"
        "{\n"
        '  "summary": "shared operating memory summary for all projects",\n'
        '  "pinned_facts": ["fact 1", "fact 2"],\n'
        '  "rationale": "brief explanation"\n'
        "}\n"
        "Prioritize reusable operating preferences, recurring workflows, automation rules, and cross-project constraints."
    )

    response = await chat_completion(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        model=get_local_autofill_model(),
        temperature=0.3,
        max_tokens=1800,
    )
    raw_text = extract_text(response)
    parsed = _parse_memory_model_response(raw_text)
    return {
        **parsed,
        "raw_text": raw_text,
        "context_sources": [f"project:{project.name}" for project in projects] + [f"run:{run.id}" for run in recent_runs],
    }
