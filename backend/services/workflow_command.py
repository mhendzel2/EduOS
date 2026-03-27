from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from agents.registry import get_active_workforces
from database_models import ArtifactRecord, DocumentRecord, ProjectRecord
from models.model_client import chat_completion, extract_text, get_local_workflow_model
from services.media_tools import get_project_media_tools_context
from storage.vector_store import VectorStore
from workflows.planner import PipelineStep

TEXT_PREVIEW_EXTENSIONS = {
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".xml",
    ".yaml",
    ".yml",
    ".html",
    ".htm",
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
}
MAX_DOCUMENTS = 8
MAX_ARTIFACTS = 8
MAX_PREVIEW_CHARS = 1600
MAX_ARTIFACT_PREVIEW_CHARS = 800
MAX_MEDIA_INVENTORY = 12


def _allowed_pipeline_kinds(project: ProjectRecord) -> list[str]:
    domains = set(project.domains or [])
    allowed: list[str] = []
    if "writing" in domains:
        allowed.append("writing")
    if "web" in domains or "youtube" in domains:
        allowed.append("media")
    if "writing" in domains and ("web" in domains or "youtube" in domains):
        allowed.append("promo")
    return allowed


def _classify_document_kind(document: DocumentRecord) -> str:
    content_type = (document.content_type or "").lower()
    suffix = Path(document.filename).suffix.lower()
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    if content_type.startswith("audio/"):
        return "audio"
    if content_type == "application/pdf" or suffix == ".pdf":
        return "pdf"
    if content_type.startswith("text/html") or suffix in {".html", ".htm"}:
        return "html"
    if content_type.startswith("text/") or content_type.endswith("json") or suffix in TEXT_PREVIEW_EXTENSIONS:
        return "text"
    return "other"


def _read_text_preview(document: DocumentRecord) -> str:
    if _classify_document_kind(document) not in {"text", "html"}:
        return ""
    try:
        return Path(document.path).read_text(encoding="utf-8", errors="ignore")[:MAX_PREVIEW_CHARS].strip()
    except Exception:
        return ""


def _serialize_document(document: DocumentRecord) -> dict[str, Any]:
    preview = _read_text_preview(document)
    return {
        "id": document.id,
        "filename": document.filename,
        "content_type": document.content_type,
        "kind": _classify_document_kind(document),
        "source_path": document.source_path,
        "path": document.path,
        "is_reference": document.is_reference,
        "size": document.size,
        "preview": preview,
    }


def _serialize_artifact(artifact: ArtifactRecord) -> dict[str, Any]:
    return {
        "id": artifact.id,
        "artifact_type": artifact.artifact_type,
        "version": artifact.version,
        "created_at": artifact.created_at.isoformat() if artifact.created_at else "",
        "preview": (artifact.content or "")[:MAX_ARTIFACT_PREVIEW_CHARS].strip(),
        "metadata": artifact.metadata_ or {},
    }


def _document_scope_priority(document: DocumentRecord, scope: str) -> tuple[int, str]:
    kind = _classify_document_kind(document)
    if scope == "media":
        order = {
            "video": 0,
            "image": 1,
            "audio": 2,
            "pdf": 3,
            "text": 4,
            "html": 5,
            "other": 6,
        }
    else:
        order = {
            "text": 0,
            "html": 1,
            "pdf": 2,
            "image": 3,
            "video": 4,
            "audio": 5,
            "other": 6,
        }
    return (order.get(kind, 99), document.filename.lower())


def _sort_documents_for_scope(records: list[DocumentRecord], scope: str) -> list[DocumentRecord]:
    return sorted(records, key=lambda document: _document_scope_priority(document, scope))


def _serialize_media_inventory_entry(document: DocumentRecord) -> dict[str, Any]:
    return {
        "id": document.id,
        "filename": document.filename,
        "kind": _classify_document_kind(document),
        "content_type": document.content_type,
        "size": document.size,
        "source_path": document.source_path,
        "created_at": document.created_at.isoformat() if document.created_at else "",
    }


def _build_project_media_inventory(project: ProjectRecord, db) -> list[dict[str, Any]]:
    documents = (
        db.query(DocumentRecord)
        .filter(DocumentRecord.project_id == project.id)
        .order_by(DocumentRecord.created_at.desc())
        .limit(MAX_MEDIA_INVENTORY * 3)
        .all()
    )
    media_documents = [
        document
        for document in _sort_documents_for_scope(documents, "media")
        if _classify_document_kind(document) in {"video", "image", "audio", "pdf", "text", "html"}
    ]
    return [_serialize_media_inventory_entry(document) for document in media_documents[:MAX_MEDIA_INVENTORY]]


def _serialize_agent_catalog(project: ProjectRecord) -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    for workforce, agents in get_active_workforces(project.domains or []).items():
        for agent_id, agent in agents.items():
            catalog.append(
                {
                    "workforce": workforce,
                    "agent_id": agent_id,
                    "artifact_type": agent.artifact_type,
                    "is_gate": bool(getattr(agent, "is_gate", False)),
                    "role": getattr(agent, "role_description", "") or agent.name,
                }
            )
    return catalog


def _extract_json_payload(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    fenced_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    if fenced_match:
        text = fenced_match.group(1).strip()

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        parsed = json.loads(text[start : end + 1])
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("Workflow planner did not return valid JSON.")


def _validate_agent_reference(
    active_workforces: dict[str, dict[str, Any]],
    workforce: str | None,
    agent_id: str | None,
) -> bool:
    if not workforce or not agent_id:
        return False
    return workforce in active_workforces and agent_id in active_workforces[workforce]


def _fallback_plan(
    project: ProjectRecord,
    command: str,
    active_workforces: dict[str, dict[str, Any]],
    referenced_document_ids: list[str],
    referenced_artifact_ids: list[str],
) -> dict[str, Any]:
    lowered = command.lower()
    allowed_pipeline_kinds = _allowed_pipeline_kinds(project)

    if any(token in lowered for token in ("full workflow", "end-to-end", "end to end", "pipeline", "all stages")):
        if "media" in allowed_pipeline_kinds:
            return {
                "summary": "Run the media workflow from a local natural-language command.",
                "rationale": "The request reads like an end-to-end media workflow rather than a single-stage action.",
                "execution_mode": "pipeline",
                "task": command,
                "pipeline_kind": "media",
                "workforce": None,
                "agent_id": None,
                "steps": [],
                "context_focus": ["recent project assets", "existing media artifacts", "local runtime execution"],
                "referenced_document_ids": referenced_document_ids,
                "referenced_artifact_ids": referenced_artifact_ids,
            }
        if "writing" in allowed_pipeline_kinds:
            return {
                "summary": "Run the writing workflow from a local natural-language command.",
                "rationale": "The request reads like an end-to-end writing workflow rather than a single-stage action.",
                "execution_mode": "pipeline",
                "task": command,
                "pipeline_kind": "writing",
                "workforce": None,
                "agent_id": None,
                "steps": [],
                "context_focus": ["recent manuscript/project assets", "existing writing artifacts", "local runtime execution"],
                "referenced_document_ids": referenced_document_ids,
                "referenced_artifact_ids": referenced_artifact_ids,
            }

    if _validate_agent_reference(active_workforces, "media", "thumbnail_brief") and "thumbnail" in lowered:
        workforce = "media"
        agent_id = "thumbnail_brief"
    elif _validate_agent_reference(active_workforces, "media", "seo") and any(
        token in lowered for token in ("seo", "title", "description", "tags")
    ):
        workforce = "media"
        agent_id = "seo"
    elif _validate_agent_reference(active_workforces, "media", "video_critic") and any(
        token in lowered for token in ("video critic", "critique", "review the video", "assess the video")
    ):
        workforce = "media"
        agent_id = "video_critic"
    elif _validate_agent_reference(active_workforces, "media", "shorts_editor") and "short" in lowered:
        workforce = "media"
        agent_id = "shorts_editor"
    elif _validate_agent_reference(active_workforces, "media", "video_editor") and "edit" in lowered:
        workforce = "media"
        agent_id = "video_editor"
    elif _validate_agent_reference(active_workforces, "writing", "outline") and "outline" in lowered:
        workforce = "writing"
        agent_id = "outline"
    elif _validate_agent_reference(active_workforces, "writing", "writer") and any(
        token in lowered for token in ("draft", "scene", "chapter", "rewrite")
    ):
        workforce = "writing"
        agent_id = "writer"
    else:
        workforce = "coordination"
        agent_id = "director"

    return {
        "summary": "Route the natural-language command through a single local agent.",
        "rationale": "The command maps most cleanly to one focused step, so agent execution is the safest fallback.",
        "execution_mode": "agent",
        "task": command,
        "pipeline_kind": None,
        "workforce": workforce,
        "agent_id": agent_id,
        "steps": [],
        "context_focus": ["selected project assets", "recent artifacts", "local runtime execution"],
        "referenced_document_ids": referenced_document_ids,
        "referenced_artifact_ids": referenced_artifact_ids,
    }


def _normalize_plan(
    raw_plan: dict[str, Any],
    project: ProjectRecord,
    command: str,
    active_workforces: dict[str, dict[str, Any]],
    referenced_document_ids: list[str],
    referenced_artifact_ids: list[str],
) -> dict[str, Any]:
    allowed_pipeline_kinds = _allowed_pipeline_kinds(project)
    mode = str(raw_plan.get("execution_mode") or "").strip().lower()
    summary = str(raw_plan.get("summary") or "").strip() or "Local workflow command"
    rationale = str(raw_plan.get("rationale") or "").strip() or "Planned from the command and current project context."
    task = str(raw_plan.get("task") or "").strip() or command
    context_focus = [str(item).strip() for item in raw_plan.get("context_focus") or [] if str(item).strip()][:12]

    if mode == "agent":
        workforce = str(raw_plan.get("workforce") or "").strip()
        agent_id = str(raw_plan.get("agent_id") or "").strip()
        if not _validate_agent_reference(active_workforces, workforce, agent_id):
            return _fallback_plan(project, command, active_workforces, referenced_document_ids, referenced_artifact_ids)
        return {
            "summary": summary,
            "rationale": rationale,
            "execution_mode": "agent",
            "task": task,
            "pipeline_kind": None,
            "workforce": workforce,
            "agent_id": agent_id,
            "steps": [],
            "context_focus": context_focus,
            "referenced_document_ids": referenced_document_ids,
            "referenced_artifact_ids": referenced_artifact_ids,
        }

    if mode == "pipeline":
        pipeline_kind = str(raw_plan.get("pipeline_kind") or "").strip().lower()
        if pipeline_kind not in allowed_pipeline_kinds:
            return _fallback_plan(project, command, active_workforces, referenced_document_ids, referenced_artifact_ids)
        return {
            "summary": summary,
            "rationale": rationale,
            "execution_mode": "pipeline",
            "task": task,
            "pipeline_kind": pipeline_kind,
            "workforce": None,
            "agent_id": None,
            "steps": [],
            "context_focus": context_focus,
            "referenced_document_ids": referenced_document_ids,
            "referenced_artifact_ids": referenced_artifact_ids,
        }

    if mode == "pipeline_builder":
        raw_steps = raw_plan.get("steps") or []
        steps: list[PipelineStep] = []
        for index, raw_step in enumerate(raw_steps, start=1):
            if not isinstance(raw_step, dict):
                continue
            workforce = str(raw_step.get("workforce") or "").strip()
            agent_id = str(raw_step.get("agent_id") or "").strip()
            if not _validate_agent_reference(active_workforces, workforce, agent_id):
                continue
            agent = active_workforces[workforce][agent_id]
            requires_artifacts = [
                str(artifact).strip()
                for artifact in raw_step.get("requires_artifacts") or []
                if str(artifact).strip()
            ]
            is_gate = bool(raw_step.get("is_gate") or getattr(agent, "is_gate", False))
            gate_input_artifact = str(raw_step.get("gate_input_artifact") or "").strip() or None
            if is_gate and not gate_input_artifact and requires_artifacts:
                gate_input_artifact = requires_artifacts[-1]
            steps.append(
                PipelineStep(
                    step_num=index,
                    workforce=workforce,
                    agent_id=agent_id,
                    description=str(raw_step.get("description") or f"Run {workforce}.{agent_id}").strip(),
                    artifact_type=str(raw_step.get("artifact_type") or getattr(agent, "artifact_type", "")).strip() or None,
                    requires_artifacts=requires_artifacts,
                    is_gate=is_gate,
                    gate_input_artifact=gate_input_artifact,
                )
            )
        if not steps:
            return _fallback_plan(project, command, active_workforces, referenced_document_ids, referenced_artifact_ids)
        return {
            "summary": summary,
            "rationale": rationale,
            "execution_mode": "pipeline_builder",
            "task": task,
            "pipeline_kind": None,
            "workforce": None,
            "agent_id": None,
            "steps": steps,
            "context_focus": context_focus,
            "referenced_document_ids": referenced_document_ids,
            "referenced_artifact_ids": referenced_artifact_ids,
        }

    return _fallback_plan(project, command, active_workforces, referenced_document_ids, referenced_artifact_ids)


async def _select_documents(
    project: ProjectRecord,
    db,
    command: str,
    document_ids: list[str],
    scope: str,
    vector_store: VectorStore | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    query = db.query(DocumentRecord).filter(DocumentRecord.project_id == project.id)
    selected_records: list[DocumentRecord] = []
    if document_ids:
        selected_records = query.filter(DocumentRecord.id.in_(document_ids)).all()
        record_map = {record.id: record for record in selected_records}
        selected_records = [record_map[document_id] for document_id in document_ids if document_id in record_map]
        found_ids = {document.id for document in selected_records}
        missing = [document_id for document_id in document_ids if document_id not in found_ids]
        if missing:
            raise ValueError(f"Selected documents were not found in project {project.name}: {missing}")
    else:
        recent_records = query.order_by(DocumentRecord.created_at.desc()).limit(MAX_DOCUMENTS * 4).all()
        selected_records = _sort_documents_for_scope(recent_records, scope)[:MAX_DOCUMENTS]

    relevant_excerpts: list[dict[str, Any]] = []
    if vector_store and command.strip():
        try:
            raw_results = await vector_store.search(
                query=command.strip(),
                n_results=4,
                filters={"project_id": project.id},
            )
        except Exception:
            raw_results = []
        seen = {record.id for record in selected_records}
        for result in raw_results:
            document_id = str(result.metadata.get("document_id") or "")
            filename = str(result.metadata.get("filename") or "")
            if document_id and document_id not in seen:
                matched = (
                    db.query(DocumentRecord)
                    .filter(DocumentRecord.project_id == project.id, DocumentRecord.id == document_id)
                    .first()
                )
                if matched is not None and len(selected_records) < MAX_DOCUMENTS:
                    selected_records.append(matched)
                    seen.add(matched.id)
            relevant_excerpts.append(
                {
                    "document_id": document_id,
                    "filename": filename,
                    "score": result.score,
                    "excerpt": result.document.content[:700].strip(),
                }
            )

    return ([_serialize_document(record) for record in selected_records[:MAX_DOCUMENTS]], relevant_excerpts)


def _select_artifacts(project: ProjectRecord, db, artifact_ids: list[str]) -> list[dict[str, Any]]:
    query = db.query(ArtifactRecord).filter(ArtifactRecord.project_id == project.id)
    if artifact_ids:
        selected_records = query.filter(ArtifactRecord.id.in_(artifact_ids)).all()
        found_ids = {artifact.id for artifact in selected_records}
        missing = [artifact_id for artifact_id in artifact_ids if artifact_id not in found_ids]
        if missing:
            raise ValueError(f"Selected artifacts were not found in project {project.name}: {missing}")
    else:
        selected_records = query.order_by(ArtifactRecord.created_at.desc()).limit(MAX_ARTIFACTS).all()
    return [_serialize_artifact(record) for record in selected_records[:MAX_ARTIFACTS]]


async def plan_project_workflow_command(
    project: ProjectRecord,
    db,
    command: str,
    scope: str = "workspace",
    document_ids: list[str] | None = None,
    artifact_ids: list[str] | None = None,
    vector_store: VectorStore | None = None,
    planner_model: str | None = None,
    conversation: list[dict[str, str]] | None = None,
    include_project_media: bool = True,
) -> dict[str, Any]:
    stripped_command = command.strip()
    if not stripped_command:
        raise ValueError("Workflow command is required.")

    document_ids = document_ids or []
    artifact_ids = artifact_ids or []
    selected_documents, relevant_document_excerpts = await _select_documents(
        project=project,
        db=db,
        command=stripped_command,
        document_ids=document_ids,
        scope=scope,
        vector_store=vector_store,
    )
    selected_artifacts = _select_artifacts(project=project, db=db, artifact_ids=artifact_ids)
    active_workforces = get_active_workforces(project.domains or [])
    media_tool_context = get_project_media_tools_context(project, db=db)
    project_media_inventory = _build_project_media_inventory(project, db) if include_project_media else []
    trimmed_conversation = [
        {
            "role": str(item.get("role") or "").strip(),
            "content": str(item.get("content") or "").strip(),
        }
        for item in (conversation or [])[-12:]
        if str(item.get("role") or "").strip() in {"user", "assistant"}
        and str(item.get("content") or "").strip()
    ]

    planner_context = {
        "project": {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "domains": list(project.domains or []),
            "scope": scope,
        },
        "story_bible": project.story_bible or {},
        "brand_bible": project.brand_bible or {},
        "allowed_pipeline_kinds": _allowed_pipeline_kinds(project),
        "available_agents": _serialize_agent_catalog(project),
        "media_tools": media_tool_context["media_tools"],
        "enabled_media_tools": media_tool_context["enabled_media_tools"],
        "selected_documents": selected_documents,
        "selected_artifacts": selected_artifacts,
        "relevant_document_excerpts": relevant_document_excerpts,
        "project_media_inventory": project_media_inventory,
        "conversation_history": trimmed_conversation,
    }
    model = planner_model or get_local_workflow_model()
    messages = [
        {
            "role": "system",
            "content": (
                "You are StudioOS Local Workflow Command Planner. "
                "Convert the user command into a valid StudioOS execution plan that uses only the provided "
                "pipeline kinds and workforce.agent pairs. "
                "Return strict JSON with keys: "
                "summary, rationale, execution_mode, task, pipeline_kind, workforce, agent_id, steps, context_focus. "
                "Allowed execution_mode values: agent, pipeline, pipeline_builder. "
                "Use agent for one focused stage, pipeline for a standard built-in workflow, and pipeline_builder "
                "for a custom multi-stage sequence. "
                "Use conversation_history when the latest user message depends on earlier turns. "
                "Use project_media_inventory and brand_bible when the request is about media analysis, packaging, or branding. "
                "Treat enabled_media_tools as real runtime options that downstream agents can rely on. "
                "Each pipeline_builder step must include workforce, agent_id, description, artifact_type, "
                "requires_artifacts, is_gate, and gate_input_artifact. "
                "Do not invent agents, workforces, or pipeline kinds."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Project planning context:\n{json.dumps(planner_context, indent=2, ensure_ascii=True)}\n\n"
                f"Natural-language command:\n{stripped_command}\n"
            ),
        },
    ]

    response = await chat_completion(
        messages=messages,
        model=model,
        temperature=0.1,
        max_tokens=1800,
    )
    raw_plan = _extract_json_payload(extract_text(response))
    normalized = _normalize_plan(
        raw_plan=raw_plan,
        project=project,
        command=stripped_command,
        active_workforces=active_workforces,
        referenced_document_ids=[document["id"] for document in selected_documents],
        referenced_artifact_ids=[artifact["id"] for artifact in selected_artifacts],
    )
    normalized["model"] = model
    normalized["selected_documents"] = selected_documents
    normalized["selected_artifacts"] = selected_artifacts
    normalized["relevant_document_excerpts"] = relevant_document_excerpts
    normalized["project_media_inventory"] = project_media_inventory
    normalized["conversation_history"] = trimmed_conversation
    return normalized
