from __future__ import annotations

import json
import logging
import mimetypes
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from agents.base_agent import AgentRequest
from agents.registry import get_active_workforces
from api.dependencies import get_coordinator, get_model_router
from api.schemas import (
    AgentInvocationResponse,
    ArtifactResponse,
    BibleUpdate,
    BrandAutocompleteRequest,
    BrandAutocompleteResponse,
    DocumentSearchResponse,
    DocumentSearchResultResponse,
    GoogleOAuthClientStatusResponse,
    HealthResponse,
    MediaAssetListResponse,
    MediaAssetResponse,
    MediaJobCreateRequest,
    MediaToolActionRequest,
    MediaToolActionResponse,
    MemoryAutocompleteRequest,
    MemoryAutocompleteResponse,
    MemoryArchiveSearchResponse,
    MemoryArchiveSearchResultResponse,
    MemoryUpdateRequest,
    MediaToolSettingsResponseItem,
    OllamaBootstrapRequest,
    OllamaBootstrapStatusResponse,
    PipelineBuilderRunRequest,
    PipelineRunResponse,
    PipelineRunRequest,
    ProjectCreate,
    ProjectChatRequest,
    ProjectChatResponse,
    ProjectDocumentResponse,
    ProjectDocumentsResponse,
    ProjectInboxStatusResponse,
    ProjectImportRequest,
    ProjectImportResponse,
    ProjectAgentRunResponse,
    ProjectMediaToolSettingsResponse,
    ProjectMediaToolSettingsUpdateRequest,
    ProjectMemoryResponse,
    ProjectWebsiteImportRequest,
    ProjectWebsiteImportResponse,
    PromptFeedbackCreate,
    PromptFeedbackListResponse,
    PromptFeedbackResponse,
    PromptOptimizationRequest,
    PromptOptimizationResponse,
    PromptTemplateCreate,
    PromptTemplateListResponse,
    PromptTemplateFeedbackSummaryResponse,
    PromptTemplateResponse,
    RenderJobCreateRequest,
    RenderJobListResponse,
    RenderJobResponse,
    StructuredDocumentCreateRequest,
    TelegramControlStatusResponse,
    PromptTemplateUpdate,
    WorkflowCommandExecutionResponse,
    WorkflowCommandPlanResponse,
    WorkflowCommandRequest,
    WorkflowCommandResponse,
    WorkspaceMemoryResponse,
)
from models.model_client import (
    MODEL_COSTS,
    get_available_models,
    get_configured_providers,
    get_local_vision_model,
    get_local_workflow_model,
    get_openrouter_chat_model,
    get_openrouter_vision_model,
    is_openrouter_configured,
    model_supports_vision,
)
from models.router import ModelTier
from config import ROOT_DIR, settings
from database import SessionLocal, get_db
from database_models import (
    ArtifactRecord,
    DocumentProvenanceRecord,
    DocumentRecord,
    ProjectRecord,
    PromptTemplateRecord,
    RenderJobRecord,
    RunRecord,
)
from services.brand_autocomplete import generate_brand_autocomplete
from services.brand_presets import get_brand_preset, list_brand_presets, seed_brand_bible
from services.document_indexing import build_vector_documents_for_file, build_vector_documents_for_structured_document
from services.google_oauth import get_google_oauth_client_status
from services.memory import (
    get_memory_contracts,
    generate_project_memory_autocomplete,
    generate_workspace_memory_autocomplete,
    get_memory_context,
    get_or_create_project_memory,
    get_or_create_workspace_memory,
    search_memory_archives,
    serialize_project_memory,
    serialize_workspace_memory,
    update_bibles_from_artifact,
    update_memory_record,
)
from services.media_tools import (
    get_or_create_project_media_tool_settings,
    get_project_media_tools_context,
    serialize_project_media_tool_settings,
    update_project_media_tools,
)
from services.media_tool_runtime import execute_media_tool_action
from services.multimodal import build_multimodal_attachments_and_transcripts
from services.ollama_runtime import get_ollama_bootstrap_status, start_ollama_bootstrap
from services.orchestration import (
    append_run_event,
    create_run_record,
    finalize_run,
    persist_artifact,
    serialize_artifact,
    serialize_project,
    serialize_run,
)
from services.prompt_library import (
    ensure_default_prompt_templates,
    get_prompt_template,
    list_prompt_templates,
    select_preferred_prompt_template,
    serialize_prompt_template,
    slugify_prompt_name,
)
from services.prompt_feedback import (
    capture_automatic_prompt_feedback,
    create_prompt_feedback,
    generate_prompt_optimization,
    list_prompt_feedback_records,
    serialize_prompt_feedback,
    summarize_prompt_feedback,
)
from services.render_jobs import (
    cancel_render_job,
    create_render_job,
    get_media_asset,
    get_project_render_job,
    get_render_queue_service,
    list_project_media_assets,
    list_project_render_jobs,
    register_media_asset,
    retry_render_job,
    serialize_document_record,
    serialize_media_asset,
    serialize_render_job,
)
from services.telegram_control import (
    TelegramControlService,
    TelegramExecutionResult,
    TelegramProjectRef,
    parse_allowed_chat_ids,
)
from services.website_import import fetch_site_pages
from services.workflow_command import plan_project_workflow_command
from storage.document_store import DocumentStore
from storage.vector_store import VectorStore
from workflows.planner import PipelineStep

router = APIRouter()
logger = logging.getLogger(__name__)
VALID_DOMAINS = {"writing", "web", "youtube"}
_DOCUMENT_STORE = DocumentStore()
_VECTOR_STORE = VectorStore(collection_name="studio_documents")
_IMPORT_SKIP_DIR_NAMES = {
    ".git",
    ".next",
    ".pytest_cache",
    ".secrets",
    ".venv",
    "__pycache__",
    "backup",
    "build",
    "dist",
    "logs",
    "node_modules",
    "uploads",
    "vector_store",
}
_IMPORT_SKIP_FILE_NAMES = {
    ".DS_Store",
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
}
_IMPORT_SKIP_EXTENSIONS = {
    ".db",
    ".pyc",
    ".pyo",
    ".sqlite",
    ".sqlite3",
    ".zip",
}


def validate_domains(domains: list[str]) -> list[str]:
    invalid = set(domains) - VALID_DOMAINS
    if invalid:
        raise ValueError(f"Invalid domains: {sorted(invalid)}. Valid: {sorted(VALID_DOMAINS)}")
    if not domains:
        raise ValueError("Project must have at least one domain.")
    return domains


def _get_project(db: Session, project_id: str) -> ProjectRecord:
    project = db.query(ProjectRecord).filter(ProjectRecord.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def get_document_store_service() -> DocumentStore:
    return _DOCUMENT_STORE


def get_vector_store_service() -> VectorStore:
    return _VECTOR_STORE


def _find_project_by_reference(db: Session, project_ref: str) -> ProjectRecord | None:
    reference = (project_ref or "").strip()
    if not reference:
        return None

    by_id = db.query(ProjectRecord).filter(ProjectRecord.id == reference).first()
    if by_id is not None:
        return by_id

    lowered = reference.casefold()
    projects = db.query(ProjectRecord).all()
    for project in projects:
        if (project.name or "").casefold() == lowered:
            return project
    return None


def _resolve_project_for_telegram(project_ref: str) -> TelegramProjectRef | None:
    with SessionLocal() as db:
        project = _find_project_by_reference(db, project_ref)
        if project is None:
            return None
        return TelegramProjectRef(id=project.id, name=project.name)


def _list_projects_for_telegram() -> list[TelegramProjectRef]:
    with SessionLocal() as db:
        projects = (
            db.query(ProjectRecord)
            .order_by(ProjectRecord.updated_at.desc(), ProjectRecord.created_at.desc())
            .limit(12)
            .all()
        )
        return [TelegramProjectRef(id=project.id, name=project.name) for project in projects]


@lru_cache(maxsize=1)
def get_telegram_control_service() -> TelegramControlService:
    async def execute_command(project_id: str, command: str, scope: str, chat_id: int) -> TelegramExecutionResult:
        with SessionLocal() as db:
            project = _get_project(db, project_id)
            response = await run_project_workflow_command(
                project_id=project_id,
                payload=WorkflowCommandRequest(
                    command=command,
                    scope=scope,
                    execute=True,
                ),
                db=db,
            )
            execution = response.execution
            if execution is None:
                raise RuntimeError("StudioOS workflow command did not return an execution payload.")
            return TelegramExecutionResult(
                success=execution.run.status == "completed",
                project_id=project.id,
                project_name=project.name,
                scope=scope,
                run_id=execution.run.id,
                final_output=execution.final_output,
                execution_mode=execution.mode,
                plan_summary=response.plan.summary,
                model=response.model,
                error=execution.run.error or "",
            )

    return TelegramControlService(
        token=settings.TELEGRAM_BOT_TOKEN,
        default_project_id=settings.TELEGRAM_DEFAULT_PROJECT_ID,
        default_scope=settings.TELEGRAM_DEFAULT_SCOPE,
        allowed_chat_ids=parse_allowed_chat_ids(settings.TELEGRAM_ALLOWED_CHAT_IDS),
        polling_enabled=bool(settings.TELEGRAM_POLLING_ENABLED),
        poll_timeout_seconds=settings.TELEGRAM_POLL_TIMEOUT_SECONDS,
        webhook_secret=settings.TELEGRAM_WEBHOOK_SECRET,
        resolve_project=_resolve_project_for_telegram,
        list_projects=_list_projects_for_telegram,
        execute_command=execute_command,
    )


def _document_content_url(document_id: str) -> str:
    return f"/api/{settings.API_VERSION}/documents/{document_id}/content"


def _normalize_local_source_path(raw_path: str) -> Path:
    candidate = raw_path.strip()
    if not candidate:
        raise ValueError("Source path is required.")

    return Path(candidate).expanduser().resolve()


def _project_slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", (value or "").strip()).strip("-").lower()
    return slug or "project"


def _get_project_inbox_path(project: ProjectRecord) -> Path:
    return (ROOT_DIR / "project_inbox" / f"{_project_slug(project.name)}-{project.id[:8]}").resolve()


async def _create_structured_project_document(
    *,
    project: ProjectRecord,
    payload: StructuredDocumentCreateRequest,
    db: Session,
) -> tuple[DocumentRecord, bool]:
    existing = None
    if payload.source_url:
        existing = (
            db.query(DocumentProvenanceRecord)
            .join(DocumentRecord, DocumentRecord.id == DocumentProvenanceRecord.document_id)
            .filter(
                DocumentRecord.project_id == project.id,
                DocumentProvenanceRecord.source_url == payload.source_url,
            )
            .first()
        )
    if existing is not None:
        document = db.query(DocumentRecord).filter(DocumentRecord.id == existing.document_id).first()
        if document is not None:
            return document, False

    document_store = get_document_store_service()
    vector_store = get_vector_store_service()
    safe_stem = re.sub(r"[^a-zA-Z0-9_-]+", "-", payload.title.strip()).strip("-").lower() or "structured-document"
    filename = payload.filename or f"{safe_stem}.json"
    canonical_payload = {
        "title": payload.title,
        "abstract": payload.abstract,
        "content": payload.content,
        "source_type": payload.source_type,
        "source_identifier": payload.source_identifier,
        "source_url": payload.source_url,
        "citation": payload.citation,
        "authors": payload.authors,
        "published_at": payload.published_at,
        "metadata": payload.metadata,
    }
    file_content = json.dumps(canonical_payload, indent=2, ensure_ascii=True).encode("utf-8")

    file_info = await document_store.save_file(
        file_content=file_content,
        filename=filename,
        project_id=project.id,
        content_type="application/json",
    )

    try:
        document = DocumentRecord(
            id=file_info.id,
            project_id=project.id,
            filename=file_info.filename,
            path=file_info.path,
            size=file_info.size,
            content_type=file_info.content_type,
            source_path=payload.source_url or None,
            is_reference=True,
            version=1,
        )
        db.add(document)
        db.commit()
        db.refresh(document)

        provenance = DocumentProvenanceRecord(
            document_id=document.id,
            source_type=payload.source_type,
            source_identifier=payload.source_identifier,
            source_url=payload.source_url,
            citation=payload.citation,
            authors=list(payload.authors or []),
            published_at=payload.published_at,
            metadata_=payload.metadata or {},
        )
        db.add(provenance)
        db.commit()
        db.refresh(document)

        vector_documents = build_vector_documents_for_structured_document(
            canonical_payload,
            document_id=document.id,
            base_metadata={
                "project_id": project.id,
                "filename": document.filename,
                "content_type": document.content_type,
                "source_path": document.source_path or "",
            },
        )
        await vector_store.add_documents(vector_documents)
    except Exception:
        db.rollback()
        existing_provenance = (
            db.query(DocumentProvenanceRecord)
            .filter(DocumentProvenanceRecord.document_id == file_info.id)
            .first()
        )
        if existing_provenance is not None:
            db.delete(existing_provenance)
            db.commit()
        existing_document = db.query(DocumentRecord).filter(DocumentRecord.id == file_info.id).first()
        if existing_document is not None:
            db.delete(existing_document)
            db.commit()
        await document_store.delete_file(file_info.path)
        raise

    return document, True


def _build_project_inbox_status(project: ProjectRecord) -> ProjectInboxStatusResponse:
    inbox_path = _get_project_inbox_path(project)
    files = _iter_import_files(inbox_path, recursive=True) if inbox_path.exists() else []
    sample_files = [str(path.relative_to(inbox_path)) for path in files[:5]]
    return ProjectInboxStatusResponse(
        project_id=project.id,
        inbox_path=str(inbox_path),
        exists=inbox_path.exists(),
        importable_file_count=len(files),
        sample_files=sample_files,
    )


def _iter_import_files(source_path: Path, recursive: bool) -> list[Path]:
    if source_path.is_file():
        return [source_path]
    if not source_path.is_dir():
        return []

    iterator = source_path.rglob("*") if recursive else source_path.glob("*")
    files: list[Path] = []
    for path in iterator:
        if not path.is_file():
            continue
        rel_path = path.relative_to(source_path)
        if any(part in _IMPORT_SKIP_DIR_NAMES for part in rel_path.parts):
            continue
        if path.name in _IMPORT_SKIP_FILE_NAMES:
            continue
        if path.suffix.lower() in _IMPORT_SKIP_EXTENSIONS:
            continue
        files.append(path)
    return sorted(files)


def _guess_content_type(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _serialize_document(document: DocumentRecord) -> dict:
    serialized = serialize_document_record(document)
    serialized["url"] = _document_content_url(document.id)
    return serialized


async def _enqueue_render_job_if_embedded(job_id: str) -> None:
    if not settings.RENDER_EMBEDDED_WORKER_ENABLED:
        return
    queue = get_render_queue_service()
    is_running = getattr(queue, "is_running", None)
    if callable(is_running) and not is_running():
        start = getattr(queue, "start", None)
        if callable(start):
            await start()
    enqueue = getattr(queue, "enqueue", None)
    if callable(enqueue):
        await enqueue(job_id)


def _register_media_assets_for_result(
    *,
    db: Session,
    project: ProjectRecord,
    tool_id: str,
    result: dict,
    run_id: str | None = None,
    render_job_id: str | None = None,
) -> list[dict]:
    registered_assets: list[dict] = []
    for generated_asset in result.get("generated_assets", []):
        metadata = dict(generated_asset.get("metadata") or {})
        media_asset = register_media_asset(
            db,
            project_id=project.id,
            role=str(generated_asset.get("role") or "output"),
            created_by=tool_id,
            document=generated_asset.get("document"),
            artifact=generated_asset.get("artifact"),
            run_id=run_id,
            render_job_id=render_job_id,
            license_name=str(metadata.get("license") or ""),
            metadata=metadata,
        )
        registered_assets.append(serialize_media_asset(media_asset))
    return registered_assets


def _get_workforce_agent_for_project(project: ProjectRecord, workforce: str, agent_id: str):
    active_workforces = get_active_workforces(project.domains or [])
    workforce_agents = active_workforces.get(workforce)
    if workforce_agents is None:
        raise HTTPException(
            status_code=400,
            detail=f"Workforce '{workforce}' is not active for project domains {sorted(project.domains or [])}",
        )

    agent = workforce_agents.get(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in active workforce '{workforce}'")
    return agent


def _serialize_plan(plan) -> dict:
    return {
        "task": plan.task,
        "pipeline_kind": plan.pipeline_kind,
        "task_type": plan.task_type,
        "steps": [step.__dict__ for step in plan.steps],
    }


def _build_project_agent_context(project: ProjectRecord, db: Session, request_context: Optional[dict] = None) -> dict:
    return {
        **(request_context or {}),
        **get_memory_context(project, db=db),
        **get_project_media_tools_context(project, db=db),
        "project_id": project.id,
        "project_name": project.name,
        "project_description": project.description,
        "domains": list(project.domains or []),
        "story_bible": project.story_bible or {},
        "brand_bible": project.brand_bible or {},
    }


def _resolve_project_chat_model(model_target: str, external_model: str, *, use_vision: bool = False) -> str:
    target = (model_target or "local").strip().lower()
    if target == "openrouter":
        if not is_openrouter_configured():
            raise HTTPException(
                status_code=422,
                detail="OpenRouter is not configured. Set OPENROUTER_API_KEY before using external chat.",
            )
        return get_openrouter_vision_model(external_model) if use_vision else get_openrouter_chat_model(external_model)
    return get_local_vision_model() if use_vision else get_local_workflow_model()


async def _prepare_multimodal_chat_context(
    *,
    selected_documents: list[dict],
    project_id: str,
    db: Session,
    model_target: str,
    external_model: str,
    planner_model: str,
) -> dict[str, object]:
    multimodal_payload = await build_multimodal_attachments_and_transcripts(
        selected_documents,
        db=db,
        project_id=project_id,
        document_store=get_document_store_service(),
    )
    attachments = list(multimodal_payload["attachments"])
    transcripts = list(multimodal_payload["transcripts"])
    multimodal_cache = dict(multimodal_payload.get("cache") or {})
    if not attachments and not transcripts:
        return {
            "execution_model": planner_model,
            "vision_enabled": False,
            "audio_transcription_enabled": False,
            "multimodal_attachments": [],
            "multimodal_attachment_names": [],
            "multimodal_transcripts": [],
            "multimodal_transcript_names": [],
            "multimodal_cache": multimodal_cache,
        }

    preferred_model = _resolve_project_chat_model(
        model_target,
        external_model,
        use_vision=bool(attachments),
    )
    if attachments and not model_supports_vision(preferred_model):
        return {
            "execution_model": planner_model,
            "vision_enabled": False,
            "audio_transcription_enabled": bool(transcripts),
            "multimodal_attachments": [],
            "multimodal_attachment_names": [],
            "multimodal_transcripts": transcripts,
            "multimodal_transcript_names": [
                str(item.get("filename") or "")
                for item in transcripts
                if str(item.get("filename") or "").strip()
            ],
            "multimodal_cache": multimodal_cache,
        }

    return {
        "execution_model": preferred_model,
        "vision_enabled": bool(attachments),
        "audio_transcription_enabled": bool(transcripts),
        "multimodal_attachments": attachments,
        "multimodal_attachment_names": list(
            dict.fromkeys(
                str(attachment.get("source_filename") or attachment.get("filename") or "")
                for attachment in attachments
                if str(attachment.get("source_filename") or attachment.get("filename") or "").strip()
            )
        ),
        "multimodal_transcripts": transcripts,
        "multimodal_transcript_names": list(
            dict.fromkeys(
                str(item.get("filename") or "")
                for item in transcripts
                if str(item.get("filename") or "").strip()
            )
        ),
        "multimodal_cache": multimodal_cache,
    }


def _assistant_message_from_workflow_execution(
    execution: WorkflowCommandExecutionResponse | None,
    plan: WorkflowCommandPlanResponse,
) -> str:
    if execution is None:
        return (
            f"{plan.summary}\n\n"
            f"Route: {plan.execution_mode}"
            + (f" via {plan.workforce}.{plan.agent_id}" if plan.workforce and plan.agent_id else "")
        )
    if execution.agent_response and execution.agent_response.content.strip():
        return execution.agent_response.content
    if execution.final_output.strip():
        return execution.final_output
    return plan.summary


async def _execute_workflow_plan(
    *,
    project: ProjectRecord,
    plan: dict,
    command: str,
    scope: str,
    db: Session,
    extra_context: Optional[dict] = None,
) -> WorkflowCommandExecutionResponse:
    execution_context = {
        "workflow_command": command,
        "workflow_scope": scope,
        "command_summary": plan["summary"],
        "command_context_focus": plan["context_focus"],
        "selected_documents": plan["selected_documents"],
        "selected_artifacts": plan["selected_artifacts"],
        "relevant_document_excerpts": plan["relevant_document_excerpts"],
        "project_media_inventory": plan.get("project_media_inventory") or [],
        "conversation_history": plan.get("conversation_history") or [],
        **(extra_context or {}),
    }

    if plan["execution_mode"] == "agent":
        execution_result = await _execute_project_agent_run(
            project=project,
            workforce=plan["workforce"],
            agent_id=plan["agent_id"],
            request=AgentRequest(
                session_id=f"workflow-command-{project.id}",
                user_input=plan["task"],
                context=execution_context,
            ),
            db=db,
        )
        return WorkflowCommandExecutionResponse(
            mode="agent",
            run=execution_result.run,
            final_output=execution_result.response.content,
            agent_response=execution_result.response,
            artifact=execution_result.artifact,
            pipeline_success=None,
            pipeline_errors=[],
            pipeline_results=[],
        )

    if plan["execution_mode"] == "pipeline":
        execution_result = await _execute_project_pipeline_run(
            project=project,
            task=plan["task"],
            pipeline_kind=plan["pipeline_kind"],
            context=execution_context,
            db=db,
        )
        return WorkflowCommandExecutionResponse(
            mode="pipeline",
            run=execution_result.run,
            final_output=execution_result.final_output,
            agent_response=None,
            artifact=None,
            pipeline_success=execution_result.success,
            pipeline_errors=execution_result.errors,
            pipeline_results=execution_result.results,
        )

    execution_result = await _execute_project_custom_pipeline_run(
        project=project,
        task=plan["task"],
        steps=plan["steps"],
        context=execution_context,
        db=db,
    )
    return WorkflowCommandExecutionResponse(
        mode="pipeline_builder",
        run=execution_result.run,
        final_output=execution_result.final_output,
        agent_response=None,
        artifact=None,
        pipeline_success=execution_result.success,
        pipeline_errors=execution_result.errors,
        pipeline_results=execution_result.results,
    )


async def _execute_project_agent_run(
    project: ProjectRecord,
    workforce: str,
    agent_id: str,
    request: AgentRequest,
    db: Session,
) -> ProjectAgentRunResponse:
    agent = _get_workforce_agent_for_project(project, workforce, agent_id)

    run = create_run_record(
        db=db,
        project_id=project.id,
        run_type="agent",
        task=request.user_input,
        requested_agent=f"{workforce}.{agent_id}",
        context=request.context,
        details={"workforce": workforce, "agent_id": agent_id},
    )
    append_run_event(
        db,
        run.id,
        "agent.started",
        {"agent": f"{workforce}.{agent_id}", "artifact_type": agent.artifact_type},
    )

    agent_context = _build_project_agent_context(project, db=db, request_context=request.context)
    agent_context.setdefault("agent_slug", f"{workforce}.{agent_id}")
    agent_context.setdefault("requested_agent", f"{workforce}.{agent_id}")
    workspace_memory_contract, project_memory_contract = get_memory_contracts(project, db=db)

    try:
        response = await agent.process(
            AgentRequest(
                session_id=run.id,
                user_input=request.user_input,
                context=agent_context,
                project_memory=request.project_memory or project_memory_contract,
                workspace_memory=request.workspace_memory or workspace_memory_contract,
                model=request.model,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                turboquant_kv_compression_enabled=request.turboquant_kv_compression_enabled,
            )
        )
        append_run_event(
            db,
            run.id,
            "agent.completed",
            {
                "agent": f"{workforce}.{agent_id}",
                "artifact_type": response.artifact_type,
                "confidence": response.confidence,
            },
        )

        artifact = None
        if response.artifact_type:
            artifact = persist_artifact(
                db=db,
                project_id=project.id,
                run_id=run.id,
                artifact_type=response.artifact_type,
                content=response.content,
                metadata={
                    "agent": f"{workforce}.{agent_id}",
                    "workforce": workforce,
                    "requested_agent": agent_id,
                    **response.metadata,
                },
            )
            if settings.BIBLE_AUTO_UPDATE:
                update_bibles_from_artifact(project, response.artifact_type, response.content)
                db.add(project)
                db.commit()
                db.refresh(project)

        finalize_run(
            db=db,
            run=run,
            status="completed",
            final_output=response.content,
            details={
                "workforce": workforce,
                "agent_id": agent_id,
                "artifact_id": artifact.id if artifact else None,
            },
        )
    except Exception as exc:
        append_run_event(db, run.id, "agent.failed", {"agent": f"{workforce}.{agent_id}", "error": str(exc)})
        finalize_run(db=db, run=run, status="failed", error=str(exc))
        raise

    refreshed = db.query(RunRecord).filter(RunRecord.id == run.id).first()
    return ProjectAgentRunResponse(
        run=serialize_run(refreshed, include_events=True),
        response=AgentInvocationResponse(**response.model_dump()),
        artifact=ArtifactResponse(**serialize_artifact(artifact)) if artifact else None,
    )


async def _execute_project_pipeline_run(
    project: ProjectRecord,
    task: str,
    pipeline_kind: Optional[str],
    context: Optional[dict],
    db: Session,
) -> PipelineRunResponse:
    coordinator = get_coordinator()
    run = create_run_record(
        db=db,
        project_id=project.id,
        run_type=pipeline_kind or "auto",
        task=task,
        context=context,
    )

    async def event_callback(event_type: str, event_payload: dict):
        append_run_event(db, run.id, event_type, event_payload)

    append_run_event(
        db,
        run.id,
        "pipeline.started",
        {"pipeline_kind": pipeline_kind, "domains": project.domains or []},
    )

    try:
        result = await coordinator.run_pipeline(
            task=task,
            project=project,
            db=db,
            run_id=run.id,
            pipeline_kind=pipeline_kind,
            context=context,
            event_callback=event_callback,
        )
        finalize_run(
            db=db,
            run=run,
            status="completed" if result.success else "failed",
            final_output=result.final_output,
            error="\n".join(result.errors) if result.errors else None,
            details={"plan": _serialize_plan(result.plan), "result_count": len(result.results)},
        )
    except ValueError as exc:
        append_run_event(db, run.id, "pipeline.failed", {"error": str(exc)})
        finalize_run(db=db, run=run, status="failed", error=str(exc))
        raise
    except Exception as exc:
        append_run_event(db, run.id, "pipeline.failed", {"error": str(exc)})
        finalize_run(db=db, run=run, status="failed", error=str(exc))
        raise

    refreshed = db.query(RunRecord).filter(RunRecord.id == run.id).first()
    return PipelineRunResponse(
        run=serialize_run(refreshed, include_events=True),
        plan=_serialize_plan(result.plan),
        final_output=result.final_output,
        success=result.success,
        errors=result.errors,
        results=result.results,
    )


async def _execute_project_custom_pipeline_run(
    project: ProjectRecord,
    task: str,
    steps: list[PipelineStep],
    context: Optional[dict],
    db: Session,
) -> PipelineRunResponse:
    coordinator = get_coordinator()
    run_context = {"launched_from": "workflow_command", **(context or {})}
    run = create_run_record(
        db=db,
        project_id=project.id,
        run_type="custom",
        task=task,
        context=run_context,
    )

    async def event_callback(event_type: str, event_payload: dict):
        append_run_event(db, run.id, event_type, event_payload)

    append_run_event(
        db,
        run.id,
        "pipeline.started",
        {"pipeline_kind": "custom", "domains": project.domains or [], "custom_step_count": len(steps)},
    )

    try:
        result = await coordinator.run_custom_pipeline(
            task=task,
            steps=steps,
            project=project,
            db=db,
            run_id=run.id,
            context=run_context,
            event_callback=event_callback,
        )
        finalize_run(
            db=db,
            run=run,
            status="completed" if result.success else "failed",
            final_output=result.final_output,
            error="\n".join(result.errors) if result.errors else None,
            details={"plan": _serialize_plan(result.plan), "result_count": len(result.results), "custom_step_count": len(steps)},
        )
    except ValueError as exc:
        append_run_event(db, run.id, "pipeline.failed", {"error": str(exc)})
        finalize_run(db=db, run=run, status="failed", error=str(exc))
        raise
    except Exception as exc:
        append_run_event(db, run.id, "pipeline.failed", {"error": str(exc)})
        finalize_run(db=db, run=run, status="failed", error=str(exc))
        raise

    refreshed = db.query(RunRecord).filter(RunRecord.id == run.id).first()
    return PipelineRunResponse(
        run=serialize_run(refreshed, include_events=True),
        plan=_serialize_plan(result.plan),
        final_output=result.final_output,
        success=result.success,
        errors=result.errors,
        results=result.results,
    )


@router.get("/health")
async def health() -> HealthResponse:
    return HealthResponse(
        version=settings.API_VERSION,
        coordinator=settings.COORDINATOR_PROVIDER,
        domains=settings.STUDIO_DOMAINS,
        database_url=settings.DATABASE_URL,
        upload_dir=settings.UPLOAD_DIR,
    )


@router.get("/telegram/status", response_model=TelegramControlStatusResponse, tags=["Telegram"])
async def telegram_control_status(
    telegram_service: TelegramControlService = Depends(get_telegram_control_service),
) -> TelegramControlStatusResponse:
    return TelegramControlStatusResponse(**telegram_service.status_payload())


@router.post("/telegram/webhook/{secret}", tags=["Telegram"])
async def telegram_control_webhook(
    secret: str,
    payload: dict,
    telegram_service: TelegramControlService = Depends(get_telegram_control_service),
):
    if not telegram_service.enabled:
        raise HTTPException(status_code=503, detail="Telegram control is not configured")
    if not telegram_service.validate_webhook_secret(secret):
        raise HTTPException(status_code=403, detail="Invalid Telegram webhook secret")
    await telegram_service.handle_update(payload)
    return {"ok": True}


@router.get("/runtime/ollama")
async def get_ollama_runtime_status() -> OllamaBootstrapStatusResponse:
    return OllamaBootstrapStatusResponse(**(await get_ollama_bootstrap_status()))


@router.get("/runtime/google-oauth")
async def get_google_oauth_runtime_status() -> GoogleOAuthClientStatusResponse:
    return GoogleOAuthClientStatusResponse(**get_google_oauth_client_status())


@router.post("/runtime/ollama/start")
async def start_ollama_runtime(payload: OllamaBootstrapRequest) -> OllamaBootstrapStatusResponse:
    try:
        status = await start_ollama_bootstrap(payload.model)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start Ollama bootstrap: {exc}") from exc
    return OllamaBootstrapStatusResponse(**status)


@router.get("/model-routing/config", tags=["Model Routing"])
async def get_model_routing_config(db: Session = Depends(get_db)):
    router_inst = get_model_router()
    cfg = router_inst.get_config()
    supported_models = set(get_available_models())
    try:
        from services.model_catalog import get_catalog_models

        for record in get_catalog_models(db):
            supported_models.add(f"openrouter/{record.id}")
    except Exception:
        logger.debug("Could not merge DB model catalog entries", exc_info=True)
    cfg["supported_models"] = sorted(supported_models)
    cfg["tiers"] = [tier.value for tier in ModelTier]
    cfg["providers"] = get_configured_providers()
    effective_costs = dict(MODEL_COSTS)
    try:
        from services.model_catalog import get_catalog_costs

        db_costs = get_catalog_costs(db)
        if db_costs:
            effective_costs.update(db_costs)
    except Exception:
        logger.debug("Could not merge model catalog costs", exc_info=True)
    cfg["model_costs"] = {model: {"input": cost[0], "output": cost[1]} for model, cost in effective_costs.items()}
    return cfg


@router.put("/model-routing/config", tags=["Model Routing"])
async def update_model_routing_config(body: dict, db: Session = Depends(get_db)):
    router_inst = get_model_router()
    all_models = set((await get_model_routing_config(db))["supported_models"])
    for model_id in list((body.get("agent_overrides") or {}).values()) + list((body.get("tier_overrides") or {}).values()):
        if model_id and model_id not in all_models:
            raise HTTPException(status_code=400, detail=f"Unsupported model: {model_id}")
    try:
        router_inst.apply_config(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await get_model_routing_config(db)


@router.get("/model-routing/resolve", tags=["Model Routing"])
async def resolve_model_route(
    agent_name: str = Query(...),
    context_tokens: int = Query(default=0),
):
    decision = get_model_router().select(agent_name, context_tokens=context_tokens)
    return {
        "model": decision.model,
        "tier": decision.tier.value,
        "reason": decision.reason,
        "estimated_cost_per_1k": decision.estimated_cost_per_1k,
    }


@router.get("/providers", tags=["Model Routing"])
async def list_model_providers():
    return {"providers": get_configured_providers()}


@router.get("/model-catalog", tags=["Model Catalog"])
async def list_model_catalog(
    vendor: Optional[str] = Query(default=None, description="Filter by vendor prefix, e.g. 'openai'"),
    db: Session = Depends(get_db),
):
    from services.model_catalog import get_catalog_models

    models = get_catalog_models(db)
    if vendor:
        vendor_lower = vendor.lower().strip()
        models = [model for model in models if model.id.lower().startswith(f"{vendor_lower}/")]
    return {
        "models": [
            {
                "id": f"openrouter/{model.id}",
                "name": model.name,
                "provider": model.provider,
                "context_length": model.context_length,
                "input_cost_per_1k": model.input_cost_per_1k,
                "output_cost_per_1k": model.output_cost_per_1k,
                "supports_images": model.supports_images,
                "is_free": model.is_free,
                "fetched_at": model.fetched_at.isoformat() if model.fetched_at else None,
            }
            for model in models
        ],
        "total": len(models),
    }


@router.post("/model-catalog/refresh", tags=["Model Catalog"])
async def refresh_model_catalog():
    from services.model_catalog import fetch_and_store_catalog

    result = await fetch_and_store_catalog()
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "Refresh failed"))
    return result


@router.get("/projects")
async def list_projects(db: Session = Depends(get_db)):
    projects = db.query(ProjectRecord).order_by(ProjectRecord.updated_at.desc()).all()
    return {"projects": [serialize_project(project) for project in projects]}


@router.get("/brand-presets")
async def list_brand_presets_route():
    return {"presets": list_brand_presets()}


@router.get("/brand-presets/{slug}")
async def get_brand_preset_route(slug: str):
    try:
        return get_brand_preset(slug)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown brand preset '{slug}'.") from exc


@router.post("/projects")
async def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    try:
        domains = validate_domains(payload.domains)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    brand_bible = dict(payload.brand_bible or {})
    if "web" in domains or "youtube" in domains:
        preset_slug = str(brand_bible.get("brand_preset") or settings.DEFAULT_BRAND_PRESET or "").strip().lower()
        brand_bible = seed_brand_bible(brand_bible, preset_slug=preset_slug)

    project = ProjectRecord(
        name=payload.name,
        description=payload.description,
        domains=domains,
        story_bible=payload.story_bible,
        brand_bible=brand_bible,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return serialize_project(project)


@router.get("/projects/{project_id}")
async def get_project(project_id: str, db: Session = Depends(get_db)):
    return serialize_project(_get_project(db, project_id))


@router.get("/projects/{project_id}/runs")
async def list_project_runs(project_id: str, db: Session = Depends(get_db)):
    _get_project(db, project_id)
    runs = (
        db.query(RunRecord)
        .filter(RunRecord.project_id == project_id)
        .order_by(RunRecord.started_at.desc())
        .all()
    )
    return {"runs": [serialize_run(run, include_events=False) for run in runs]}


@router.get("/runs/{run_id}")
async def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.query(RunRecord).filter(RunRecord.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return serialize_run(run, include_events=True)


@router.get("/projects/{project_id}/domains")
async def get_project_domains(project_id: str, db: Session = Depends(get_db)):
    project = _get_project(db, project_id)
    workforces = get_active_workforces(project.domains or [])
    return {
        "domains": project.domains or [],
        "active_workforces": list(workforces.keys()),
        "agents": {wf: list(agents.keys()) for wf, agents in workforces.items()},
    }


@router.get("/projects/{project_id}/story-bible")
async def get_story_bible(project_id: str, db: Session = Depends(get_db)):
    project = _get_project(db, project_id)
    return {"story_bible": project.story_bible or {}}


@router.put("/projects/{project_id}/story-bible")
async def update_story_bible(project_id: str, payload: BibleUpdate, db: Session = Depends(get_db)):
    project = _get_project(db, project_id)
    project.story_bible = payload.value
    db.add(project)
    db.commit()
    db.refresh(project)
    return {"status": "updated", "story_bible": project.story_bible}


@router.get("/projects/{project_id}/brand-bible")
async def get_brand_bible(project_id: str, db: Session = Depends(get_db)):
    project = _get_project(db, project_id)
    return {"brand_bible": project.brand_bible or {}}


@router.put("/projects/{project_id}/brand-bible")
async def update_brand_bible(project_id: str, payload: BibleUpdate, db: Session = Depends(get_db)):
    project = _get_project(db, project_id)
    project.brand_bible = payload.value
    db.add(project)
    db.commit()
    db.refresh(project)
    return {"status": "updated", "brand_bible": project.brand_bible}


@router.get("/projects/{project_id}/media-tools")
async def get_project_media_tools(project_id: str, db: Session = Depends(get_db)):
    _get_project(db, project_id)
    settings_record = get_or_create_project_media_tool_settings(db, project_id)
    serialized = serialize_project_media_tool_settings(settings_record)
    return ProjectMediaToolSettingsResponse(
        project_id=serialized["project_id"],
        tools=[MediaToolSettingsResponseItem(**tool) for tool in serialized["tools"]],
        created_at=serialized["created_at"],
        updated_at=serialized["updated_at"],
    )


@router.put("/projects/{project_id}/media-tools")
async def update_project_media_tool_settings_route(
    project_id: str,
    payload: ProjectMediaToolSettingsUpdateRequest,
    db: Session = Depends(get_db),
):
    _get_project(db, project_id)
    settings_record = get_or_create_project_media_tool_settings(db, project_id)
    update_project_media_tools(
        settings_record,
        updates=[
            {
                "tool_id": tool.tool_id,
                "enabled": tool.enabled,
                "config": tool.config,
            }
            for tool in payload.tools
        ],
    )
    db.add(settings_record)
    db.commit()
    db.refresh(settings_record)
    serialized = serialize_project_media_tool_settings(settings_record)
    return ProjectMediaToolSettingsResponse(
        project_id=serialized["project_id"],
        tools=[MediaToolSettingsResponseItem(**tool) for tool in serialized["tools"]],
        created_at=serialized["created_at"],
        updated_at=serialized["updated_at"],
    )


@router.post("/projects/{project_id}/media-tools/{tool_id}/execute")
async def execute_project_media_tool_action(
    project_id: str,
    tool_id: str,
    payload: MediaToolActionRequest,
    db: Session = Depends(get_db),
):
    project = _get_project(db, project_id)
    try:
        result = await execute_media_tool_action(
            project=project,
            db=db,
            tool_id=tool_id,
            action=payload.action,
            document_id=payload.document_id,
            secondary_document_id=payload.secondary_document_id,
            arguments=payload.arguments,
            document_store=get_document_store_service(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Media tool execution failed: {exc}") from exc

    media_assets = _register_media_assets_for_result(
        db=db,
        project=project,
        tool_id=tool_id,
        result=result,
        run_id=result.get("artifact").run_id if result.get("artifact") else None,
    )

    return MediaToolActionResponse(
        project_id=project.id,
        tool_id=tool_id,
        action=payload.action,
        success=result["success"],
        executed=result["executed"],
        message=result["message"],
        output_document=ProjectDocumentResponse(**_serialize_document(result["output_document"]))
        if result.get("output_document")
        else None,
        artifact=ArtifactResponse(**serialize_artifact(result["artifact"])) if result.get("artifact") else None,
        generated_documents=[
            ProjectDocumentResponse(**_serialize_document(asset["document"]))
            for asset in result.get("generated_assets", [])
            if asset.get("kind") == "document" and asset.get("document") is not None
        ],
        generated_artifacts=[
            ArtifactResponse(**serialize_artifact(asset["artifact"]))
            for asset in result.get("generated_assets", [])
            if asset.get("kind") == "artifact" and asset.get("artifact") is not None
        ],
        generated_media_assets=[MediaAssetResponse(**asset) for asset in media_assets],
        command=[str(item) for item in result.get("command", []) if str(item).strip()],
        metadata=result.get("metadata", {}),
    )


@router.post("/projects/{project_id}/render-jobs")
async def create_project_render_job_route(
    project_id: str,
    payload: RenderJobCreateRequest,
    db: Session = Depends(get_db),
):
    project = _get_project(db, project_id)
    try:
        job = create_render_job(
            db,
            project,
            job_type=payload.job_type,
            title=payload.title,
            source_document_id=payload.document_id,
            source_artifact_id=payload.artifact_id,
            parameters=payload.parameters,
        )
        await _enqueue_render_job_if_embedded(job.id)
        db.refresh(job)
        return RenderJobResponse(**serialize_render_job(job))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Render job creation failed: {exc}") from exc


@router.get("/projects/{project_id}/render-jobs")
async def list_project_render_jobs_route(
    project_id: str,
    limit: int = 50,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    _get_project(db, project_id)
    jobs = list_project_render_jobs(db, project_id, limit=limit, status=status)
    return RenderJobListResponse(jobs=[RenderJobResponse(**serialize_render_job(job)) for job in jobs])


@router.get("/projects/{project_id}/render-jobs/{job_id}")
async def get_project_render_job_route(
    project_id: str,
    job_id: str,
    db: Session = Depends(get_db),
):
    _get_project(db, project_id)
    job = get_project_render_job(db, project_id, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Render job not found")
    return RenderJobResponse(**serialize_render_job(job))


@router.post("/media/jobs")
async def create_media_job_route(
    payload: MediaJobCreateRequest,
    db: Session = Depends(get_db),
):
    return await create_project_render_job_route(
        project_id=payload.project_id,
        payload=RenderJobCreateRequest(
            job_type=payload.job_type,
            title=payload.title,
            document_id=payload.document_id,
            artifact_id=payload.artifact_id,
            parameters=payload.parameters,
        ),
        db=db,
    )


@router.get("/media/jobs")
async def list_media_jobs_route(
    project_id: Optional[str] = None,
    limit: int = 50,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    if project_id:
        _get_project(db, project_id)
        jobs = list_project_render_jobs(db, project_id, limit=limit, status=status)
    else:
        query = db.query(RenderJobRecord)
        if status:
            query = query.filter(RenderJobRecord.status == status)
        jobs = query.order_by(RenderJobRecord.created_at.desc()).limit(min(max(limit, 1), 200)).all()
    return RenderJobListResponse(jobs=[RenderJobResponse(**serialize_render_job(job)) for job in jobs])


@router.get("/media/jobs/{job_id}")
async def get_media_job_route(
    job_id: str,
    db: Session = Depends(get_db),
):
    job = db.query(RenderJobRecord).filter(RenderJobRecord.id == job_id).first()
    if job is None:
        raise HTTPException(status_code=404, detail="Render job not found")
    return RenderJobResponse(**serialize_render_job(job))


@router.post("/media/jobs/{job_id}/retry")
async def retry_media_job_route(
    job_id: str,
    db: Session = Depends(get_db),
):
    job = db.query(RenderJobRecord).filter(RenderJobRecord.id == job_id).first()
    if job is None:
        raise HTTPException(status_code=404, detail="Render job not found")
    try:
        job = retry_render_job(db, job)
        await _enqueue_render_job_if_embedded(job.id)
        db.refresh(job)
        return RenderJobResponse(**serialize_render_job(job))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/media/jobs/{job_id}/cancel")
async def cancel_media_job_route(
    job_id: str,
    db: Session = Depends(get_db),
):
    job = db.query(RenderJobRecord).filter(RenderJobRecord.id == job_id).first()
    if job is None:
        raise HTTPException(status_code=404, detail="Render job not found")
    try:
        job = cancel_render_job(db, job)
        return RenderJobResponse(**serialize_render_job(job))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/projects/{project_id}/media/assets")
async def list_project_media_assets_route(
    project_id: str,
    kind: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    _get_project(db, project_id)
    assets = list_project_media_assets(db, project_id, kind=kind, limit=limit)
    return MediaAssetListResponse(assets=[MediaAssetResponse(**serialize_media_asset(asset)) for asset in assets])


@router.get("/media/assets/{asset_id}")
async def get_media_asset_route(
    asset_id: str,
    db: Session = Depends(get_db),
):
    asset = get_media_asset(db, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Media asset not found")
    return MediaAssetResponse(**serialize_media_asset(asset))


@router.get("/media/assets/{asset_id}/content")
async def get_media_asset_content_route(
    asset_id: str,
    db: Session = Depends(get_db),
):
    asset = get_media_asset(db, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Media asset not found")

    if asset.document is not None:
        media_type = asset.mime_type or asset.document.content_type or "application/octet-stream"
        return FileResponse(path=asset.document.path, media_type=media_type, filename=asset.document.filename)

    if asset.artifact is not None:
        media_type = asset.mime_type or "text/plain; charset=utf-8"
        return Response(content=asset.artifact.content or "", media_type=media_type)

    raise HTTPException(status_code=404, detail="Media asset content is unavailable")


@router.get("/memory/global")
async def get_workspace_memory_route(db: Session = Depends(get_db)):
    memory = get_or_create_workspace_memory(db)
    return WorkspaceMemoryResponse(**serialize_workspace_memory(memory))


@router.put("/memory/global")
async def update_workspace_memory_route(payload: MemoryUpdateRequest, db: Session = Depends(get_db)):
    memory = get_or_create_workspace_memory(db)
    await update_memory_record(memory, summary=payload.summary, pinned_facts=payload.pinned_facts)
    db.add(memory)
    db.commit()
    db.refresh(memory)
    return WorkspaceMemoryResponse(**serialize_workspace_memory(memory))


@router.get("/memory/global/archives/search")
async def search_workspace_memory_archives_route(
    query: str,
    limit: int = 3,
    db: Session = Depends(get_db),
):
    memory = get_or_create_workspace_memory(db)
    results = await search_memory_archives(
        scope="workspace",
        scope_id=memory.id,
        query=query,
        limit=min(max(limit, 1), 20),
    )
    return MemoryArchiveSearchResponse(
        scope="workspace",
        query=query,
        results=[MemoryArchiveSearchResultResponse(**result) for result in results],
    )


@router.post("/memory/global/autocomplete")
async def autocomplete_workspace_memory(
    payload: MemoryAutocompleteRequest,
    db: Session = Depends(get_db),
):
    ensure_default_prompt_templates(db)

    template = None
    if payload.prompt_template_id:
        template = get_prompt_template(db, payload.prompt_template_id)
        if template is None:
            raise HTTPException(status_code=404, detail="Prompt template not found")
    else:
        template = select_preferred_prompt_template(
            db,
            category="workspace_memory_autocomplete",
            target_kind="workspace_memory",
            fallback_slug="workspace-memory-autocomplete-default",
        )
        if template is None:
            raise HTTPException(status_code=500, detail="Default workspace memory prompt is unavailable")

    task_input = f"guidance={payload.guidance.strip() or 'None'}"
    try:
        result = await generate_workspace_memory_autocomplete(
            db=db,
            template=template,
            guidance=payload.guidance,
        )
    except ValueError as exc:
        capture_automatic_prompt_feedback(
            db,
            template,
            use_case="workspace_memory_autocomplete",
            task_input=task_input,
            error_message=str(exc),
            metadata={"error_kind": "validation_error"},
        )
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        capture_automatic_prompt_feedback(
            db,
            template,
            use_case="workspace_memory_autocomplete",
            task_input=task_input,
            error_message=str(exc),
            metadata={"error_kind": "runtime_error"},
        )
        raise HTTPException(status_code=500, detail=f"Workspace memory autocomplete failed: {exc}") from exc

    capture_automatic_prompt_feedback(
        db,
        template,
        use_case="workspace_memory_autocomplete",
        task_input=task_input,
        result_payload=result,
    )

    return MemoryAutocompleteResponse(
        scope="workspace",
        prompt_template_id=template.id,
        prompt_template_name=template.name,
        summary=result["summary"],
        pinned_facts=result["pinned_facts"],
        rationale=result["rationale"],
        context_sources=result["context_sources"],
    )


@router.get("/projects/{project_id}/memory")
async def get_project_memory_route(project_id: str, db: Session = Depends(get_db)):
    _get_project(db, project_id)
    memory = get_or_create_project_memory(db, project_id)
    return ProjectMemoryResponse(**serialize_project_memory(memory))


@router.put("/projects/{project_id}/memory")
async def update_project_memory_route(
    project_id: str,
    payload: MemoryUpdateRequest,
    db: Session = Depends(get_db),
):
    _get_project(db, project_id)
    memory = get_or_create_project_memory(db, project_id)
    await update_memory_record(memory, summary=payload.summary, pinned_facts=payload.pinned_facts)
    db.add(memory)
    db.commit()
    db.refresh(memory)
    return ProjectMemoryResponse(**serialize_project_memory(memory))


@router.get("/projects/{project_id}/memory/archives/search")
async def search_project_memory_archives_route(
    project_id: str,
    query: str,
    limit: int = 3,
    db: Session = Depends(get_db),
):
    _get_project(db, project_id)
    results = await search_memory_archives(
        scope="project",
        scope_id=project_id,
        query=query,
        limit=min(max(limit, 1), 20),
    )
    return MemoryArchiveSearchResponse(
        scope="project",
        project_id=project_id,
        query=query,
        results=[MemoryArchiveSearchResultResponse(**result) for result in results],
    )


@router.post("/projects/{project_id}/memory/autocomplete")
async def autocomplete_project_memory(
    project_id: str,
    payload: MemoryAutocompleteRequest,
    db: Session = Depends(get_db),
):
    ensure_default_prompt_templates(db)
    project = _get_project(db, project_id)

    template = None
    if payload.prompt_template_id:
        template = get_prompt_template(db, payload.prompt_template_id, project_id=project.id)
        if template is None:
            raise HTTPException(status_code=404, detail="Prompt template not found")
    else:
        template = select_preferred_prompt_template(
            db,
            category="project_memory_autocomplete",
            target_kind="project_memory",
            project_id=project.id,
            fallback_slug="project-memory-autocomplete-default",
        )
        if template is None:
            raise HTTPException(status_code=500, detail="Default project memory prompt is unavailable")

    task_input = (
        f"project={project.name}\n"
        f"guidance={payload.guidance.strip() or 'None'}"
    )
    try:
        result = await generate_project_memory_autocomplete(
            project=project,
            db=db,
            template=template,
            guidance=payload.guidance,
            vector_store=get_vector_store_service(),
        )
    except ValueError as exc:
        capture_automatic_prompt_feedback(
            db,
            template,
            project_id=project.id,
            use_case="project_memory_autocomplete",
            task_input=task_input,
            error_message=str(exc),
            metadata={"error_kind": "validation_error"},
        )
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        capture_automatic_prompt_feedback(
            db,
            template,
            project_id=project.id,
            use_case="project_memory_autocomplete",
            task_input=task_input,
            error_message=str(exc),
            metadata={"error_kind": "runtime_error"},
        )
        raise HTTPException(status_code=500, detail=f"Project memory autocomplete failed: {exc}") from exc

    capture_automatic_prompt_feedback(
        db,
        template,
        project_id=project.id,
        use_case="project_memory_autocomplete",
        task_input=task_input,
        result_payload=result,
    )

    return MemoryAutocompleteResponse(
        scope="project",
        project_id=project.id,
        prompt_template_id=template.id,
        prompt_template_name=template.name,
        summary=result["summary"],
        pinned_facts=result["pinned_facts"],
        rationale=result["rationale"],
        context_sources=result["context_sources"],
    )


@router.get("/prompt-library")
async def get_prompt_library(
    category: Optional[str] = None,
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ensure_default_prompt_templates(db)
    prompts = list_prompt_templates(db, category=category, project_id=project_id)
    return PromptTemplateListResponse(prompts=[PromptTemplateResponse(**serialize_prompt_template(prompt)) for prompt in prompts])


@router.post("/prompt-library")
async def create_prompt_template(payload: PromptTemplateCreate, db: Session = Depends(get_db)):
    if payload.project_id:
        _get_project(db, payload.project_id)

    prompt = PromptTemplateRecord(
        project_id=payload.project_id,
        name=payload.name.strip(),
        slug=slugify_prompt_name(payload.name),
        category=payload.category.strip() or "general",
        target_kind=payload.target_kind.strip() or "general",
        description=payload.description,
        system_prompt=payload.system_prompt,
        user_prompt_template=payload.user_prompt_template,
        tags=[tag.strip() for tag in payload.tags if tag.strip()],
        metadata_=payload.metadata,
        is_builtin=False,
    )
    db.add(prompt)
    db.commit()
    db.refresh(prompt)
    return PromptTemplateResponse(**serialize_prompt_template(prompt))


@router.put("/prompt-library/{template_id}")
async def update_prompt_template(template_id: str, payload: PromptTemplateUpdate, db: Session = Depends(get_db)):
    ensure_default_prompt_templates(db)
    prompt = db.query(PromptTemplateRecord).filter(PromptTemplateRecord.id == template_id).first()
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt template not found")

    if payload.project_id:
        _get_project(db, payload.project_id)

    if "project_id" in payload.model_fields_set:
        prompt.project_id = payload.project_id
    if payload.name is not None:
        prompt.name = payload.name.strip()
        prompt.slug = slugify_prompt_name(prompt.name)
    if payload.category is not None:
        prompt.category = payload.category.strip() or prompt.category
    if payload.target_kind is not None:
        prompt.target_kind = payload.target_kind.strip() or prompt.target_kind
    if payload.description is not None:
        prompt.description = payload.description
    if payload.system_prompt is not None:
        prompt.system_prompt = payload.system_prompt
    if payload.user_prompt_template is not None:
        prompt.user_prompt_template = payload.user_prompt_template
    if payload.tags is not None:
        prompt.tags = [tag.strip() for tag in payload.tags if tag.strip()]
    if payload.metadata is not None:
        prompt.metadata_ = payload.metadata

    db.add(prompt)
    db.commit()
    db.refresh(prompt)
    return PromptTemplateResponse(**serialize_prompt_template(prompt))


@router.get("/prompt-library/{template_id}/feedback")
async def get_prompt_template_feedback(
    template_id: str,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    ensure_default_prompt_templates(db)
    template = db.query(PromptTemplateRecord).filter(PromptTemplateRecord.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Prompt template not found")

    feedback_records = list_prompt_feedback_records(db, template.id, limit=limit)
    summary = summarize_prompt_feedback(feedback_records)
    return PromptFeedbackListResponse(
        template_id=template.id,
        summary=PromptTemplateFeedbackSummaryResponse(**summary) if summary else None,
        feedback=[PromptFeedbackResponse(**serialize_prompt_feedback(record)) for record in feedback_records],
    )


@router.post("/prompt-library/{template_id}/feedback")
async def create_prompt_template_feedback(
    template_id: str,
    payload: PromptFeedbackCreate,
    db: Session = Depends(get_db),
):
    ensure_default_prompt_templates(db)
    template = db.query(PromptTemplateRecord).filter(PromptTemplateRecord.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Prompt template not found")

    if payload.project_id:
        _get_project(db, payload.project_id)

    if payload.run_id:
        run = db.query(RunRecord).filter(RunRecord.id == payload.run_id).first()
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        if payload.project_id and run.project_id != payload.project_id:
            raise HTTPException(status_code=400, detail="Run does not belong to the provided project")

    record = create_prompt_feedback(
        db,
        template,
        project_id=payload.project_id,
        run_id=payload.run_id,
        feedback_source=payload.feedback_source,
        score=payload.score,
        would_reuse=payload.would_reuse,
        use_case=payload.use_case,
        strengths=payload.strengths,
        failure_modes=payload.failure_modes,
        notes=payload.notes,
        task_input=payload.task_input,
        output_excerpt=payload.output_excerpt,
        metadata=payload.metadata,
    )
    return PromptFeedbackResponse(**serialize_prompt_feedback(record))


@router.post("/prompt-library/{template_id}/optimize")
async def optimize_prompt_template(
    template_id: str,
    payload: PromptOptimizationRequest,
    db: Session = Depends(get_db),
):
    ensure_default_prompt_templates(db)
    template = db.query(PromptTemplateRecord).filter(PromptTemplateRecord.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Prompt template not found")

    variant_project_id = payload.project_id if payload.project_id is not None else template.project_id
    if variant_project_id:
        _get_project(db, variant_project_id)

    feedback_records = list_prompt_feedback_records(db, template.id, limit=30)
    if not feedback_records and not payload.goal.strip():
        raise HTTPException(
            status_code=400,
            detail="Prompt optimization needs at least one feedback record or an explicit optimization goal.",
        )

    optimization = await generate_prompt_optimization(
        template,
        feedback_records=feedback_records,
        goal=payload.goal,
    )

    created_prompt = None
    if payload.create_variant:
        optimized_name = payload.variant_name.strip() or optimization["optimized_name"].strip() or f"{template.name} Optimized"
        metadata = dict(template.metadata_ or {})
        metadata.update(optimization.get("metadata_updates") or {})
        metadata.update(
            {
                "derived_from_prompt_id": template.id,
                "derived_from_prompt_slug": template.slug,
                "optimizer_feedback_count": len(feedback_records),
            }
        )
        created_prompt_record = PromptTemplateRecord(
            project_id=variant_project_id,
            name=optimized_name,
            slug=slugify_prompt_name(optimized_name),
            category=template.category,
            target_kind=template.target_kind,
            description=template.description,
            system_prompt=optimization["system_prompt"],
            user_prompt_template=optimization["user_prompt_template"],
            tags=list(template.tags or []),
            metadata_=metadata,
            is_builtin=False,
        )
        db.add(created_prompt_record)
        db.commit()
        db.refresh(created_prompt_record)
        created_prompt = PromptTemplateResponse(**serialize_prompt_template(created_prompt_record))

    summary = summarize_prompt_feedback(feedback_records)
    return PromptOptimizationResponse(
        template_id=template.id,
        optimized_name=payload.variant_name.strip() or optimization["optimized_name"],
        system_prompt=optimization["system_prompt"],
        user_prompt_template=optimization["user_prompt_template"],
        rationale=optimization.get("rationale") or "",
        changes=list(optimization.get("changes") or []),
        metadata_updates=dict(optimization.get("metadata_updates") or {}),
        feedback_summary=PromptTemplateFeedbackSummaryResponse(**summary) if summary else None,
        created_prompt=created_prompt,
    )


@router.post("/projects/{project_id}/brand-bible/autocomplete")
async def autocomplete_project_brand_bible(
    project_id: str,
    payload: BrandAutocompleteRequest,
    db: Session = Depends(get_db),
):
    ensure_default_prompt_templates(db)
    project = _get_project(db, project_id)

    template = None
    if payload.prompt_template_id:
        template = get_prompt_template(db, payload.prompt_template_id, project_id=project.id)
        if template is None:
            raise HTTPException(status_code=404, detail="Prompt template not found")
    else:
        template = select_preferred_prompt_template(
            db,
            category="brand_autocomplete",
            target_kind="brand_bible",
            project_id=project.id,
            focus=payload.field,
            fallback_slug="brand-autocomplete-default",
        )
        if template is None:
            raise HTTPException(status_code=500, detail="Default brand autocomplete prompt is unavailable")

    task_input = (
        f"project={project.name}\n"
        f"field={payload.field}\n"
        f"guidance={payload.guidance.strip() or 'None'}"
    )
    try:
        result = await generate_brand_autocomplete(
            project=project,
            db=db,
            template=template,
            field=payload.field,
            guidance=payload.guidance,
            current_brand_bible=payload.brand_bible or project.brand_bible or {},
            vector_store=get_vector_store_service(),
        )
    except ValueError as exc:
        capture_automatic_prompt_feedback(
            db,
            template,
            project_id=project.id,
            use_case="brand_autocomplete",
            task_input=task_input,
            error_message=str(exc),
            metadata={"error_kind": "validation_error", "requested_field": payload.field},
        )
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        capture_automatic_prompt_feedback(
            db,
            template,
            project_id=project.id,
            use_case="brand_autocomplete",
            task_input=task_input,
            error_message=str(exc),
            metadata={"error_kind": "runtime_error", "requested_field": payload.field},
        )
        raise HTTPException(status_code=500, detail=f"Brand autocomplete failed: {exc}") from exc

    capture_automatic_prompt_feedback(
        db,
        template,
        project_id=project.id,
        use_case="brand_autocomplete",
        task_input=task_input,
        result_payload=result,
        metadata={"requested_field": payload.field},
    )

    return BrandAutocompleteResponse(
        project_id=project.id,
        field=result["field"],
        prompt_template_id=template.id,
        prompt_template_name=template.name,
        suggestions=result["suggestions"],
        rationale=result["rationale"],
        context_documents=result["context_documents"],
    )


@router.get("/projects/{project_id}/artifacts")
async def list_artifacts(project_id: str, artifact_type: Optional[str] = None, db: Session = Depends(get_db)):
    _get_project(db, project_id)
    query = db.query(ArtifactRecord).filter(ArtifactRecord.project_id == project_id)
    if artifact_type:
        query = query.filter(ArtifactRecord.artifact_type == artifact_type)
    artifacts = query.order_by(ArtifactRecord.created_at.desc()).all()
    return {"artifacts": [serialize_artifact(artifact) for artifact in artifacts]}


@router.post("/projects/{project_id}/documents")
async def upload_project_document(
    project_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    project = _get_project(db, project_id)
    raw_filename = request.headers.get("x-studio-filename", "").strip()
    filename = unquote(raw_filename)
    if not filename:
        raise HTTPException(status_code=400, detail="Missing X-Studio-Filename header")
    source_path = unquote(request.headers.get("x-studio-source-path", "").strip()) or None

    file_content = await request.body()
    if not file_content:
        raise HTTPException(status_code=400, detail="Empty file upload")

    content_type = request.headers.get("content-type", "application/octet-stream").split(";", 1)[0].strip()
    document_store = get_document_store_service()
    vector_store = get_vector_store_service()

    file_info = await document_store.save_file(
        file_content=file_content,
        filename=filename,
        project_id=project.id,
        content_type=content_type or "application/octet-stream",
    )

    try:
        document = DocumentRecord(
            id=file_info.id,
            project_id=project.id,
            filename=file_info.filename,
            path=file_info.path,
            size=file_info.size,
            content_type=file_info.content_type,
            source_path=source_path,
        )
        db.add(document)
        db.commit()
        db.refresh(document)

        vector_documents = await build_vector_documents_for_file(
            path=document.path,
            document_id=document.id,
            base_metadata={
                "project_id": project.id,
                "filename": document.filename,
                "content_type": document.content_type,
            },
        )
        await vector_store.add_documents(vector_documents)
    except Exception as exc:
        db.rollback()
        existing_document = db.query(DocumentRecord).filter(DocumentRecord.id == file_info.id).first()
        if existing_document:
            db.delete(existing_document)
            db.commit()
        await document_store.delete_file(file_info.path)
        raise HTTPException(status_code=500, detail=f"Document upload failed during indexing: {exc}") from exc

    return ProjectDocumentResponse(**_serialize_document(document))


@router.post("/projects/{project_id}/documents/structured")
async def upload_project_structured_document(
    project_id: str,
    payload: StructuredDocumentCreateRequest,
    db: Session = Depends(get_db),
):
    project = _get_project(db, project_id)
    try:
        document, _ = await _create_structured_project_document(project=project, payload=payload, db=db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Structured document upload failed during indexing: {exc}") from exc

    return ProjectDocumentResponse(**_serialize_document(document))


@router.get("/projects/{project_id}/documents")
async def list_project_documents(
    project_id: str,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    _get_project(db, project_id)
    query_limit = min(max(limit, 1), 500)
    documents = (
        db.query(DocumentRecord)
        .filter(DocumentRecord.project_id == project_id)
        .order_by(DocumentRecord.created_at.desc())
        .limit(query_limit)
        .all()
    )
    return ProjectDocumentsResponse(documents=[ProjectDocumentResponse(**_serialize_document(document)) for document in documents])


@router.post("/projects/{project_id}/documents/import-path")
async def import_project_documents_from_path(
    project_id: str,
    payload: ProjectImportRequest,
    db: Session = Depends(get_db),
):
    project = _get_project(db, project_id)
    document_store = get_document_store_service()
    vector_store = get_vector_store_service()

    try:
        source_path = _normalize_local_source_path(payload.source_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not source_path.exists():
        raise HTTPException(status_code=404, detail=f"Source path not found: {source_path}")

    files = _iter_import_files(source_path, recursive=payload.recursive)
    if not files:
        raise HTTPException(status_code=400, detail=f"No files found at source path: {source_path}")

    imported = 0
    skipped_existing = 0
    indexing_failed = 0

    for file_path in files:
        existing = (
            db.query(DocumentRecord)
            .filter(
                DocumentRecord.project_id == project.id,
                DocumentRecord.source_path == str(file_path),
            )
            .first()
        )
        if existing:
            skipped_existing += 1
            continue

        content_type = _guess_content_type(file_path)
        if payload.mode == "copy":
            file_info = await document_store.save_file(
                file_content=file_path.read_bytes(),
                filename=file_path.name,
                project_id=project.id,
                content_type=content_type,
            )
            document = DocumentRecord(
                id=file_info.id,
                project_id=project.id,
                filename=file_info.filename,
                path=file_info.path,
                size=file_info.size,
                content_type=file_info.content_type,
                source_path=str(file_path),
                is_reference=True,
                version=1,
            )
        else:
            stat = file_path.stat()
            document = DocumentRecord(
                project_id=project.id,
                filename=file_path.name,
                path=str(file_path),
                size=stat.st_size,
                content_type=content_type,
                source_path=str(file_path),
                is_reference=True,
                version=1,
            )

        db.add(document)
        db.commit()
        db.refresh(document)

        try:
            vector_documents = await build_vector_documents_for_file(
                path=document.path,
                document_id=document.id,
                base_metadata={
                    "project_id": project.id,
                    "filename": document.filename,
                    "content_type": document.content_type,
                    "source_path": document.source_path or "",
                },
            )
            await vector_store.add_documents(vector_documents)
        except Exception:
            indexing_failed += 1

        imported += 1

    return ProjectImportResponse(
        project_id=project.id,
        normalized_source_path=str(source_path),
        mode=payload.mode,
        selected_files=len(files),
        imported=imported,
        skipped_existing=skipped_existing,
        indexing_failed=indexing_failed,
    )


@router.get("/projects/{project_id}/inbox")
async def get_project_inbox_status(project_id: str, db: Session = Depends(get_db)):
    project = _get_project(db, project_id)
    return _build_project_inbox_status(project)


@router.post("/projects/{project_id}/inbox/import")
async def import_project_inbox(project_id: str, db: Session = Depends(get_db)):
    project = _get_project(db, project_id)
    inbox_path = _get_project_inbox_path(project)
    if not inbox_path.exists():
        inbox_path.mkdir(parents=True, exist_ok=True)
        return ProjectImportResponse(
            project_id=project.id,
            normalized_source_path=str(inbox_path),
            mode="copy",
            selected_files=0,
            imported=0,
            skipped_existing=0,
            indexing_failed=0,
        )

    return await import_project_documents_from_path(
        project_id=project_id,
        payload=ProjectImportRequest(source_path=str(inbox_path), recursive=True, mode="copy"),
        db=db,
    )


@router.post("/projects/{project_id}/documents/import-website")
async def import_project_website_documents(
    project_id: str,
    payload: ProjectWebsiteImportRequest,
    db: Session = Depends(get_db),
):
    project = _get_project(db, project_id)
    try:
        website_result = await fetch_site_pages(payload.site_url, max_pages=payload.max_pages)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Website import failed: {exc}") from exc

    imported = 0
    skipped_existing = 0
    indexing_failed = 0

    for page in website_result["pages"]:
        try:
            _, created = await _create_structured_project_document(
                project=project,
                payload=StructuredDocumentCreateRequest(
                    title=page["title"],
                    abstract=page.get("abstract") or "",
                    content=page["content"],
                    source_type=page.get("source_type") or "website_page",
                    source_identifier=page.get("source_identifier") or page.get("source_url") or "",
                    source_url=page.get("source_url") or "",
                    citation=page.get("citation") or page.get("source_url") or "",
                    authors=list(page.get("authors") or []),
                    published_at=page.get("published_at") or "",
                    metadata=dict(page.get("metadata") or {}),
                ),
                db=db,
            )
        except Exception:
            indexing_failed += 1
            continue
        if created:
            imported += 1
        else:
            skipped_existing += 1

    return ProjectWebsiteImportResponse(
        project_id=project.id,
        normalized_site_url=website_result["normalized_site_url"],
        selected_pages=website_result["selected_pages"],
        imported=imported,
        skipped_existing=skipped_existing,
        indexing_failed=indexing_failed,
    )


@router.get("/projects/{project_id}/documents/search")
async def search_project_documents(
    project_id: str,
    q: str,
    limit: int = 5,
    db: Session = Depends(get_db),
):
    _get_project(db, project_id)
    query = q.strip()
    if not query:
        return DocumentSearchResponse(query="", results=[])

    vector_store = get_vector_store_service()
    raw_results = await vector_store.search(
        query=query,
        n_results=min(max(limit, 1), 20),
        filters={"project_id": project_id},
    )
    results = [
        DocumentSearchResultResponse(
            document_id=str(result.metadata.get("document_id", result.document.id or "")),
            filename=str(result.metadata.get("filename", "")),
            content=result.document.content,
            score=result.score,
            metadata=result.metadata,
        )
        for result in raw_results
    ]
    return DocumentSearchResponse(query=query, results=results)


@router.get("/documents/{document_id}/content")
async def get_document_content(document_id: str, db: Session = Depends(get_db)):
    document = db.query(DocumentRecord).filter(DocumentRecord.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return FileResponse(path=document.path, media_type=document.content_type, filename=document.filename)


@router.delete("/documents/{document_id}")
async def delete_project_document(document_id: str, db: Session = Depends(get_db)):
    document = db.query(DocumentRecord).filter(DocumentRecord.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    vector_store = get_vector_store_service()
    document_store = get_document_store_service()
    await vector_store.delete_by_document_id(document.id)
    await document_store.delete_file(document.path)

    db.delete(document)
    db.commit()
    return {"status": "deleted", "document_id": document_id}


@router.post("/agent/{workforce}/{agent_id}")
async def call_workforce_agent(workforce: str, agent_id: str, request: AgentRequest):
    workforce_map = get_active_workforces(settings.STUDIO_DOMAINS)
    wf = workforce_map.get(workforce)
    if wf is None:
        raise HTTPException(status_code=404, detail=f"Workforce '{workforce}' not found")
    agent = wf.get(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in '{workforce}'")
    enriched_request = request.model_copy(
        update={
            "context": {
                **(request.context or {}),
                "agent_slug": f"{workforce}.{agent_id}",
                "requested_agent": f"{workforce}.{agent_id}",
            }
        }
    )
    return (await agent.process(enriched_request)).model_dump()


@router.post("/projects/{project_id}/agent/{workforce}/{agent_id}")
async def run_project_agent(
    project_id: str,
    workforce: str,
    agent_id: str,
    request: AgentRequest,
    db: Session = Depends(get_db),
):
    project = _get_project(db, project_id)
    try:
        return await _execute_project_agent_run(
            project=project,
            workforce=workforce,
            agent_id=agent_id,
            request=request,
            db=db,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/projects/{project_id}/pipeline")
async def run_project_pipeline(
    project_id: str,
    payload: PipelineRunRequest,
    db: Session = Depends(get_db),
):
    project = _get_project(db, project_id)
    try:
        return await _execute_project_pipeline_run(
            project=project,
            task=payload.task,
            pipeline_kind=payload.pipeline_kind,
            context=payload.context,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/projects/{project_id}/pipeline-builder")
async def run_project_pipeline_builder(
    project_id: str,
    payload: PipelineBuilderRunRequest,
    db: Session = Depends(get_db),
):
    project = _get_project(db, project_id)
    active_workforces = get_active_workforces(project.domains or [])

    steps: list[PipelineStep] = []
    for index, step in enumerate(payload.steps, start=1):
        workforce_agents = active_workforces.get(step.workforce)
        if workforce_agents is None:
            raise HTTPException(
                status_code=400,
                detail=f"Workforce '{step.workforce}' is not active for project domains {sorted(project.domains or [])}",
            )

        agent = workforce_agents.get(step.agent_id)
        if agent is None:
            raise HTTPException(
                status_code=400,
                detail=f"Agent '{step.agent_id}' is not available in workforce '{step.workforce}'",
            )

        requires_artifacts = [artifact.strip() for artifact in step.requires_artifacts if artifact.strip()]
        is_gate = step.is_gate or bool(getattr(agent, "is_gate", False))
        gate_input_artifact = step.gate_input_artifact or (
            requires_artifacts[-1] if is_gate and requires_artifacts else None
        )
        if is_gate and not gate_input_artifact:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Gate step '{step.workforce}.{step.agent_id}' requires either "
                    f"'gate_input_artifact' or at least one required artifact."
                ),
            )

        steps.append(
            PipelineStep(
                step_num=index,
                workforce=step.workforce,
                agent_id=step.agent_id,
                description=step.description or f"Run {step.workforce}.{step.agent_id}",
                artifact_type=step.artifact_type or getattr(agent, "artifact_type", None),
                requires_artifacts=requires_artifacts,
                is_gate=is_gate,
                gate_input_artifact=gate_input_artifact,
            )
        )

    try:
        return await _execute_project_custom_pipeline_run(
            project=project,
            task=payload.task,
            steps=steps,
            context={**(payload.context or {}), "launched_from": "pipeline_builder"},
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/projects/{project_id}/workflow-command")
async def run_project_workflow_command(
    project_id: str,
    payload: WorkflowCommandRequest,
    db: Session = Depends(get_db),
):
    project = _get_project(db, project_id)

    try:
        plan = await plan_project_workflow_command(
            project=project,
            db=db,
            command=payload.command,
            scope=payload.scope,
            document_ids=payload.document_ids,
            artifact_ids=payload.artifact_ids,
            vector_store=get_vector_store_service(),
            planner_model=get_local_workflow_model(),
            include_project_media=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Workflow command planning failed: {exc}") from exc

    plan_response = WorkflowCommandPlanResponse(
        summary=plan["summary"],
        rationale=plan["rationale"],
        execution_mode=plan["execution_mode"],
        task=plan["task"],
        pipeline_kind=plan["pipeline_kind"],
        workforce=plan["workforce"],
        agent_id=plan["agent_id"],
        steps=[step.__dict__ if isinstance(step, PipelineStep) else step for step in plan["steps"]],
        context_focus=plan["context_focus"],
        referenced_document_ids=plan["referenced_document_ids"],
        referenced_artifact_ids=plan["referenced_artifact_ids"],
    )

    if not payload.execute:
        return WorkflowCommandResponse(
            project_id=project.id,
            command=payload.command,
            scope=payload.scope,
            model=plan["model"],
            plan=plan_response,
            execution=None,
        )

    try:
        execution = await _execute_workflow_plan(
            project=project,
            plan=plan,
            command=payload.command,
            scope=payload.scope,
            db=db,
            extra_context={
                "force_local_model": True,
                "model_override": plan["model"],
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Workflow command execution failed: {exc}") from exc

    return WorkflowCommandResponse(
        project_id=project.id,
        command=payload.command,
        scope=payload.scope,
        model=plan["model"],
        plan=plan_response,
        execution=execution,
    )


@router.post("/projects/{project_id}/chat")
async def run_project_chat(
    project_id: str,
    payload: ProjectChatRequest,
    db: Session = Depends(get_db),
):
    project = _get_project(db, project_id)
    planner_model = _resolve_project_chat_model(payload.model_target, payload.external_model, use_vision=False)

    try:
        plan = await plan_project_workflow_command(
            project=project,
            db=db,
            command=payload.message,
            scope=payload.scope,
            document_ids=payload.document_ids,
            artifact_ids=payload.artifact_ids,
            vector_store=get_vector_store_service(),
            planner_model=planner_model,
            conversation=[message.model_dump() for message in payload.conversation],
            include_project_media=payload.include_project_media,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Project chat planning failed: {exc}") from exc

    multimodal_context = await _prepare_multimodal_chat_context(
        selected_documents=plan["selected_documents"],
        project_id=project.id,
        db=db,
        model_target=payload.model_target,
        external_model=payload.external_model,
        planner_model=planner_model,
    )
    execution_model = str(multimodal_context["execution_model"])
    vision_enabled = bool(multimodal_context["vision_enabled"])
    used_vision_filenames = list(multimodal_context["multimodal_attachment_names"])
    audio_transcription_enabled = bool(multimodal_context["audio_transcription_enabled"])
    used_transcript_filenames = list(multimodal_context["multimodal_transcript_names"])

    plan_response = WorkflowCommandPlanResponse(
        summary=plan["summary"],
        rationale=plan["rationale"],
        execution_mode=plan["execution_mode"],
        task=plan["task"],
        pipeline_kind=plan["pipeline_kind"],
        workforce=plan["workforce"],
        agent_id=plan["agent_id"],
        steps=[step.__dict__ if isinstance(step, PipelineStep) else step for step in plan["steps"]],
        context_focus=plan["context_focus"],
        referenced_document_ids=plan["referenced_document_ids"],
        referenced_artifact_ids=plan["referenced_artifact_ids"],
    )

    execution = None
    if payload.execute:
        try:
            execution = await _execute_workflow_plan(
                project=project,
                plan=plan,
                command=payload.message,
                scope=payload.scope,
                db=db,
                extra_context={
                    "chat_mode": True,
                    "model_override": execution_model,
                    "multimodal_attachments": multimodal_context["multimodal_attachments"],
                    "multimodal_attachment_names": used_vision_filenames,
                    "multimodal_transcripts": multimodal_context["multimodal_transcripts"],
                    "multimodal_transcript_names": used_transcript_filenames,
                    "vision_enabled": vision_enabled,
                    "audio_transcription_enabled": audio_transcription_enabled,
                },
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Project chat execution failed: {exc}") from exc

    referenced_documents = [
        ProjectDocumentResponse(**_serialize_document(document))
        for document in (
            db.query(DocumentRecord)
            .filter(DocumentRecord.project_id == project.id, DocumentRecord.id.in_(plan["referenced_document_ids"]))
            .all()
            if plan["referenced_document_ids"]
            else []
        )
    ]
    document_order = {document_id: index for index, document_id in enumerate(plan["referenced_document_ids"])}
    referenced_documents.sort(key=lambda document: document_order.get(document.id, 999))

    referenced_artifacts = [
        ArtifactResponse(**serialize_artifact(artifact))
        for artifact in (
            db.query(ArtifactRecord)
            .filter(ArtifactRecord.project_id == project.id, ArtifactRecord.id.in_(plan["referenced_artifact_ids"]))
            .all()
            if plan["referenced_artifact_ids"]
            else []
        )
    ]
    artifact_order = {artifact_id: index for index, artifact_id in enumerate(plan["referenced_artifact_ids"])}
    referenced_artifacts.sort(key=lambda artifact: artifact_order.get(artifact.id, 999))

    return ProjectChatResponse(
        project_id=project.id,
        scope=payload.scope,
        message=payload.message,
        model_target=payload.model_target,
        model=execution_model if payload.execute else planner_model,
        planner_model=planner_model,
        assistant_message=_assistant_message_from_workflow_execution(execution, plan_response),
        vision_enabled=vision_enabled,
        used_vision_filenames=used_vision_filenames,
        audio_transcription_enabled=audio_transcription_enabled,
        used_transcript_filenames=used_transcript_filenames,
        multimodal_cache=multimodal_context["multimodal_cache"],
        plan=plan_response,
        execution=execution,
        referenced_documents=referenced_documents,
        referenced_artifacts=referenced_artifacts,
    )
