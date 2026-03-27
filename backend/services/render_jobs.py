from __future__ import annotations

import asyncio
import hashlib
import logging
import mimetypes
from collections.abc import Callable
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from config import settings
from database import SessionLocal
from database_models import (
    ArtifactRecord,
    MediaAssetRecord,
    DocumentProvenanceRecord,
    DocumentRecord,
    ProjectRecord,
    RenderJobAssetRecord,
    RenderJobRecord,
    utc_now,
)
from services.media_tool_runtime import execute_media_tool_action
from services.orchestration import append_run_event, create_run_record, finalize_run, serialize_artifact, serialize_run
from storage.document_store import DocumentStore

logger = logging.getLogger(__name__)

RENDER_JOB_ACTIONS: dict[str, tuple[str, str]] = {
    "storyboard": ("storyboard_renderer", "generate_storyboard"),
    "infographic": ("infographic_renderer", "render_infographic"),
    "narration": ("narration_generator", "generate_narration"),
    "assemble_video": ("video_assembler", "assemble_video"),
}

_DEFAULT_RENDER_QUEUE_SERVICE: Optional["RenderQueueService"] = None
_RENDER_JOB_TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
_RENDER_JOB_QUEUEABLE_STATUSES = {"queued", "retry"}


class _RenderJobParameterModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = ""
    text: str = ""
    script_text: str = ""
    citations: list[str] = Field(default_factory=list)
    output_filename: str = ""


class _StoryboardRenderParameters(_RenderJobParameterModel):
    scene_count: int = Field(default=6, ge=1, le=12)


class _InfographicRenderParameters(_RenderJobParameterModel):
    width: int = Field(default=1280, ge=640, le=2400)
    height: int = Field(default=720, ge=360, le=1800)
    accent_color: str = Field(default="#2563eb", pattern=r"^#[0-9A-Fa-f]{6}$")


class _NarrationRenderParameters(_RenderJobParameterModel):
    output_format: str = Field(default="mp3", pattern=r"^(mp3|wav)$")
    words_per_minute: int = Field(default=150, ge=80, le=260)
    duration_seconds: float | None = Field(default=None, gt=0.0, le=600.0)


class _AssembleVideoParameters(_RenderJobParameterModel):
    width: int = Field(default=1280, ge=640, le=2400)
    height: int = Field(default=720, ge=360, le=1800)
    background_color: str = Field(default="#111827", pattern=r"^#[0-9A-Fa-f]{6}$")
    audio_document_id: str = ""
    duration_seconds: float = Field(default=6.0, gt=0.0, le=600.0)


_RENDER_JOB_PARAMETER_MODELS: dict[str, type[_RenderJobParameterModel]] = {
    "storyboard": _StoryboardRenderParameters,
    "infographic": _InfographicRenderParameters,
    "narration": _NarrationRenderParameters,
    "assemble_video": _AssembleVideoParameters,
}


def serialize_document_provenance(record: DocumentProvenanceRecord | None) -> dict[str, Any] | None:
    if record is None:
        return None
    return {
        "source_type": record.source_type,
        "source_identifier": record.source_identifier,
        "source_url": record.source_url,
        "citation": record.citation,
        "authors": list(record.authors or []),
        "published_at": record.published_at,
        "metadata": record.metadata_ or {},
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def serialize_document_record(document: DocumentRecord) -> dict[str, Any]:
    return {
        "id": document.id,
        "project_id": document.project_id,
        "filename": document.filename,
        "path": document.path,
        "size": document.size,
        "content_type": document.content_type,
        "source_path": document.source_path,
        "is_reference": document.is_reference,
        "version": document.version,
        "created_at": document.created_at,
        "url": f"/api/{settings.API_VERSION}/documents/{document.id}/content",
        "provenance": serialize_document_provenance(document.provenance),
    }


def serialize_media_asset(asset: MediaAssetRecord) -> dict[str, Any]:
    return {
        "id": asset.id,
        "project_id": asset.project_id,
        "run_id": asset.run_id,
        "render_job_id": asset.render_job_id,
        "document_id": asset.document_id,
        "artifact_id": asset.artifact_id,
        "kind": asset.kind,
        "role": asset.role,
        "storage_uri": asset.storage_uri,
        "sha256": asset.sha256,
        "size_bytes": asset.size_bytes,
        "mime_type": asset.mime_type,
        "license": asset.license,
        "created_by": asset.created_by,
        "metadata": asset.metadata_ or {},
        "created_at": asset.created_at,
        "document": serialize_document_record(asset.document) if asset.document is not None else None,
        "artifact": serialize_artifact(asset.artifact) if asset.artifact is not None else None,
    }


def serialize_render_job_asset(asset: RenderJobAssetRecord) -> dict[str, Any]:
    return {
        "id": asset.id,
        "asset_role": asset.asset_role,
        "asset_kind": asset.asset_kind,
        "metadata": asset.metadata_ or {},
        "media_asset": serialize_media_asset(asset.media_asset) if asset.media_asset is not None else None,
        "artifact": serialize_artifact(asset.artifact) if asset.artifact is not None else None,
        "document": serialize_document_record(asset.document) if asset.document is not None else None,
        "created_at": asset.created_at,
    }


def serialize_render_job(job: RenderJobRecord) -> dict[str, Any]:
    return {
        "id": job.id,
        "project_id": job.project_id,
        "run_id": job.run_id,
        "job_type": job.job_type,
        "title": job.title,
        "status": job.status,
        "source_document_id": job.source_document_id,
        "source_artifact_id": job.source_artifact_id,
        "parameters": job.parameters or {},
        "result": job.result or {},
        "error": job.error,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "media_assets": [serialize_media_asset(asset) for asset in job.media_assets],
        "assets": [serialize_render_job_asset(asset) for asset in job.assets],
        "run": serialize_run(job.run) if job.run is not None else None,
    }


def _get_project_document(db: Session, project_id: str, document_id: str | None) -> DocumentRecord | None:
    if not document_id:
        return None
    document = (
        db.query(DocumentRecord)
        .filter(DocumentRecord.project_id == project_id, DocumentRecord.id == document_id)
        .first()
    )
    if document is None:
        raise ValueError(f"Document not found in project: {document_id}")
    return document


def _get_project_artifact(db: Session, project_id: str, artifact_id: str | None) -> ArtifactRecord | None:
    if not artifact_id:
        return None
    artifact = (
        db.query(ArtifactRecord)
        .filter(ArtifactRecord.project_id == project_id, ArtifactRecord.id == artifact_id)
        .first()
    )
    if artifact is None:
        raise ValueError(f"Artifact not found in project: {artifact_id}")
    return artifact


def validate_render_job_parameters(job_type: str, parameters: dict[str, Any] | None) -> dict[str, Any]:
    model = _RENDER_JOB_PARAMETER_MODELS.get(job_type)
    if model is None:
        raise ValueError(f"Unsupported render job type: {job_type}")

    try:
        normalized = model.model_validate(parameters or {})
    except ValidationError as exc:
        messages = []
        for error in exc.errors():
            path = ".".join(str(part) for part in error.get("loc", [])) or "parameters"
            messages.append(f"{path}: {error.get('msg', 'invalid value')}")
        raise ValueError(f"Invalid render job parameters for '{job_type}': {'; '.join(messages)}") from exc

    return normalized.model_dump(exclude_none=True)


def create_render_job(
    db: Session,
    project: ProjectRecord,
    *,
    job_type: str,
    title: str = "",
    source_document_id: str | None = None,
    source_artifact_id: str | None = None,
    parameters: dict[str, Any] | None = None,
) -> RenderJobRecord:
    if job_type not in RENDER_JOB_ACTIONS:
        raise ValueError(f"Unsupported render job type: {job_type}")

    parameters = validate_render_job_parameters(job_type, parameters)
    _get_project_document(db, project.id, source_document_id)
    _get_project_artifact(db, project.id, source_artifact_id)

    if not any(
        [
            source_document_id,
            source_artifact_id,
            str(parameters.get("text") or "").strip(),
            str(parameters.get("script_text") or "").strip(),
            title.strip(),
        ]
    ):
        raise ValueError("Render jobs require a source document, source artifact, or inline text/title input.")

    job = RenderJobRecord(
        project_id=project.id,
        job_type=job_type,
        title=title.strip() or job_type.replace("_", " ").title(),
        status="queued",
        source_document_id=source_document_id,
        source_artifact_id=source_artifact_id,
        parameters=parameters,
        result={},
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def retry_render_job(db: Session, job: RenderJobRecord) -> RenderJobRecord:
    if job.status not in _RENDER_JOB_TERMINAL_STATUSES - {"completed"}:
        raise ValueError(f"Render job {job.id} cannot be retried from status '{job.status}'.")

    job.status = "retry"
    job.error = None
    job.result = {}
    job.started_at = None
    job.completed_at = None
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def cancel_render_job(db: Session, job: RenderJobRecord) -> RenderJobRecord:
    if job.status not in _RENDER_JOB_QUEUEABLE_STATUSES:
        raise ValueError(f"Render job {job.id} cannot be cancelled from status '{job.status}'.")

    job.status = "cancelled"
    job.error = None
    job.result = {**(job.result or {}), "message": "Cancelled before execution.", "executed": False}
    job.completed_at = utc_now()
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_project_render_job(db: Session, project_id: str, job_id: str) -> RenderJobRecord | None:
    return (
        db.query(RenderJobRecord)
        .filter(RenderJobRecord.project_id == project_id, RenderJobRecord.id == job_id)
        .first()
    )


def list_project_render_jobs(
    db: Session,
    project_id: str,
    *,
    limit: int = 50,
    status: str | None = None,
) -> list[RenderJobRecord]:
    query = db.query(RenderJobRecord).filter(RenderJobRecord.project_id == project_id)
    if status:
        query = query.filter(RenderJobRecord.status == status)
    return query.order_by(RenderJobRecord.created_at.desc()).limit(min(max(limit, 1), 200)).all()


def get_project_media_asset(db: Session, project_id: str, asset_id: str) -> MediaAssetRecord | None:
    return (
        db.query(MediaAssetRecord)
        .filter(MediaAssetRecord.project_id == project_id, MediaAssetRecord.id == asset_id)
        .first()
    )


def get_media_asset(db: Session, asset_id: str) -> MediaAssetRecord | None:
    return db.query(MediaAssetRecord).filter(MediaAssetRecord.id == asset_id).first()


def list_project_media_assets(
    db: Session,
    project_id: str,
    *,
    kind: str | None = None,
    limit: int = 50,
) -> list[MediaAssetRecord]:
    query = db.query(MediaAssetRecord).filter(MediaAssetRecord.project_id == project_id)
    if kind:
        query = query.filter(MediaAssetRecord.kind == kind)
    return query.order_by(MediaAssetRecord.created_at.desc()).limit(min(max(limit, 1), 200)).all()


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _artifact_mime_type(artifact: ArtifactRecord) -> str:
    if artifact.metadata_.get("format") == "json" or artifact.artifact_type.endswith("_json"):
        return "application/json"
    return "text/plain; charset=utf-8"


def _infer_kind(document: DocumentRecord | None, artifact: ArtifactRecord | None, fallback_role: str) -> str:
    if document is not None:
        suffix = Path(document.filename).suffix.lower().lstrip(".")
        if suffix:
            return suffix
        guessed = mimetypes.guess_extension(document.content_type or "")
        return (guessed or ".bin").lstrip(".")
    if artifact is not None:
        if artifact.metadata_.get("format") == "json" or artifact.artifact_type.endswith("_json"):
            return "json"
        return fallback_role or "text"
    return "bin"


def register_media_asset(
    db: Session,
    *,
    project_id: str,
    role: str,
    created_by: str,
    document: DocumentRecord | None = None,
    artifact: ArtifactRecord | None = None,
    run_id: str | None = None,
    render_job_id: str | None = None,
    license_name: str = "",
    metadata: dict[str, Any] | None = None,
) -> MediaAssetRecord:
    if document is None and artifact is None:
        raise ValueError("Media assets require either a document or an artifact.")

    metadata = dict(metadata or {})
    if document is not None:
        storage_uri = document.path
        mime_type = document.content_type or mimetypes.guess_type(document.filename)[0] or "application/octet-stream"
        size_bytes = int(document.size or 0)
        sha256 = _sha256_file(document.path) if Path(document.path).exists() else ""
    else:
        content_bytes = (artifact.content or "").encode("utf-8") if artifact is not None else b""
        storage_uri = f"artifact://{artifact.id}"
        mime_type = _artifact_mime_type(artifact)
        size_bytes = len(content_bytes)
        sha256 = _sha256_bytes(content_bytes) if content_bytes else ""

    asset = MediaAssetRecord(
        project_id=project_id,
        run_id=run_id,
        render_job_id=render_job_id,
        document_id=document.id if document is not None else None,
        artifact_id=artifact.id if artifact is not None else None,
        kind=_infer_kind(document, artifact, role),
        role=role,
        storage_uri=storage_uri,
        sha256=sha256,
        size_bytes=size_bytes,
        mime_type=mime_type,
        license=license_name or str(metadata.get("license") or ""),
        created_by=created_by,
        metadata_=metadata,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


class RenderQueueService:
    def __init__(
        self,
        session_factory: Callable[[], Session] = SessionLocal,
        document_store: DocumentStore | None = None,
        poll_interval_seconds: float | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._document_store = document_store or DocumentStore()
        self._poll_interval_seconds = max(poll_interval_seconds or settings.RENDER_WORKER_POLL_INTERVAL_SECONDS, 0.1)
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._worker_task is not None and not self._worker_task.done():
            return
        self._worker_task = asyncio.create_task(self._worker_loop())

    async def stop(self) -> None:
        if self._worker_task is None:
            return
        self._worker_task.cancel()
        try:
            await self._worker_task
        except asyncio.CancelledError:
            pass
        self._worker_task = None

    def is_running(self) -> bool:
        return self._worker_task is not None and not self._worker_task.done()

    async def run_forever(self) -> None:
        await self.start()
        if self._worker_task is None:
            raise RuntimeError("Render worker task did not start.")
        await self._worker_task

    async def enqueue(self, job_id: str) -> bool:
        if not self.is_running():
            return False
        await self._queue.put(job_id)
        return True

    async def _worker_loop(self) -> None:
        while True:
            job_id, from_queue = await self._next_job_id()
            try:
                if job_id is None:
                    continue
                await self._process_job(job_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Render job processing failed for %s", job_id)
            finally:
                if from_queue and job_id is not None:
                    self._queue.task_done()

    async def _next_job_id(self) -> tuple[str | None, bool]:
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=self._poll_interval_seconds), True
        except asyncio.TimeoutError:
            return self._claim_next_job_id(), False

    def _claim_next_job_id(self) -> str | None:
        with self._session_factory() as db:
            candidates = (
                db.query(RenderJobRecord.id)
                .filter(RenderJobRecord.status.in_(sorted(_RENDER_JOB_QUEUEABLE_STATUSES)))
                .order_by(RenderJobRecord.created_at.asc())
                .limit(8)
                .all()
            )
            for candidate in candidates:
                job_id = str(candidate[0])
                updated = (
                    db.query(RenderJobRecord)
                    .filter(
                        RenderJobRecord.id == job_id,
                        RenderJobRecord.status.in_(sorted(_RENDER_JOB_QUEUEABLE_STATUSES)),
                    )
                    .update(
                        {
                            RenderJobRecord.status: "running",
                            RenderJobRecord.started_at: utc_now(),
                            RenderJobRecord.completed_at: None,
                            RenderJobRecord.error: None,
                        },
                        synchronize_session=False,
                    )
                )
                if updated:
                    db.commit()
                    return job_id
                db.rollback()
        return None

    def _claim_job_by_id(self, job_id: str) -> bool:
        with self._session_factory() as db:
            updated = (
                db.query(RenderJobRecord)
                .filter(
                    RenderJobRecord.id == job_id,
                    RenderJobRecord.status.in_(sorted(_RENDER_JOB_QUEUEABLE_STATUSES)),
                )
                .update(
                    {
                        RenderJobRecord.status: "running",
                        RenderJobRecord.started_at: utc_now(),
                        RenderJobRecord.completed_at: None,
                        RenderJobRecord.error: None,
                    },
                    synchronize_session=False,
                )
            )
            if updated:
                db.commit()
                return True
            db.rollback()
            return False

    async def _process_job(self, job_id: str) -> None:
        claimed = self._claim_job_by_id(job_id)
        if not claimed and self.get_job_status(job_id) != "running":
            return

        with self._session_factory() as db:
            job = db.query(RenderJobRecord).filter(RenderJobRecord.id == job_id).first()
            if job is None:
                return
            if job.status != "running":
                return

            project = db.query(ProjectRecord).filter(ProjectRecord.id == job.project_id).first()
            if project is None:
                return

            tool_id, action = RENDER_JOB_ACTIONS[job.job_type]
            run = create_run_record(
                db,
                project_id=project.id,
                run_type="render_pipeline",
                task=job.title or f"{job.job_type} render job",
                context={
                    "render_job_id": job.id,
                    "job_type": job.job_type,
                    "source_document_id": job.source_document_id,
                    "source_artifact_id": job.source_artifact_id,
                },
                details={"tool_id": tool_id, "action": action},
            )

            job.run_id = run.id
            job.error = None
            db.add(job)
            db.commit()
            db.refresh(job)

            append_run_event(
                db,
                run.id,
                "render.job.started",
                {"job_id": job.id, "job_type": job.job_type, "tool_id": tool_id, "action": action},
            )

            try:
                arguments = dict(job.parameters or {})
                if job.source_artifact_id and not str(arguments.get("artifact_id") or "").strip():
                    arguments["artifact_id"] = job.source_artifact_id
                secondary_document_id = str(arguments.pop("secondary_document_id", "") or "").strip() or None

                result = await execute_media_tool_action(
                    project=project,
                    db=db,
                    tool_id=tool_id,
                    action=action,
                    document_id=job.source_document_id,
                    secondary_document_id=secondary_document_id,
                    arguments=arguments,
                    document_store=self._document_store,
                )

                for existing_asset in list(job.assets):
                    db.delete(existing_asset)
                for existing_media_asset in list(job.media_assets):
                    db.delete(existing_media_asset)
                db.commit()

                generated_assets = list(result.get("generated_assets") or [])
                for generated_asset in generated_assets:
                    role = str(generated_asset.get("role") or "output")
                    metadata = dict(generated_asset.get("metadata") or {})
                    media_asset = register_media_asset(
                        db,
                        project_id=project.id,
                        role=role,
                        created_by=tool_id,
                        document=generated_asset.get("document"),
                        artifact=generated_asset.get("artifact"),
                        run_id=run.id,
                        render_job_id=job.id,
                        license_name=str(metadata.get("license") or ""),
                        metadata=metadata,
                    )
                    record = RenderJobAssetRecord(
                        job_id=job.id,
                        asset_role=role,
                        asset_kind=str(generated_asset.get("kind") or "artifact"),
                        media_asset_id=media_asset.id,
                        artifact_id=generated_asset["artifact"].id if generated_asset.get("artifact") is not None else None,
                        document_id=generated_asset["document"].id if generated_asset.get("document") is not None else None,
                        metadata_=metadata,
                    )
                    db.add(record)
                db.commit()
                db.refresh(job)

                job.status = "completed"
                job.completed_at = utc_now()
                job.result = {
                    "message": result.get("message", ""),
                    "executed": bool(result.get("executed")),
                    "metadata": result.get("metadata", {}),
                    "asset_count": len(generated_assets),
                    "asset_roles": [str(asset.get("role") or "") for asset in generated_assets],
                }
                db.add(job)
                db.commit()
                db.refresh(job)

                append_run_event(
                    db,
                    run.id,
                    "render.job.completed",
                    {"job_id": job.id, "asset_count": len(generated_assets), "asset_roles": job.result["asset_roles"]},
                )
                finalize_run(
                    db,
                    run,
                    status="completed",
                    final_output=result.get("message"),
                    details={"asset_count": len(generated_assets), "asset_roles": job.result["asset_roles"]},
                )
            except Exception as exc:
                job.status = "failed"
                job.completed_at = utc_now()
                job.error = str(exc)
                job.result = {"message": "", "executed": False, "metadata": {}, "asset_count": 0, "asset_roles": []}
                db.add(job)
                db.commit()
                db.refresh(job)

                append_run_event(
                    db,
                    run.id,
                    "render.job.failed",
                    {"job_id": job.id, "error": str(exc)},
                )
                finalize_run(
                    db,
                    run,
                    status="failed",
                    error=str(exc),
                    details={"asset_count": 0, "asset_roles": []},
                )
                raise

    def get_job_status(self, job_id: str) -> str:
        with self._session_factory() as db:
            job = db.query(RenderJobRecord).filter(RenderJobRecord.id == job_id).first()
            return str(job.status) if job is not None else ""


def get_render_queue_service() -> RenderQueueService:
    global _DEFAULT_RENDER_QUEUE_SERVICE
    if _DEFAULT_RENDER_QUEUE_SERVICE is None:
        _DEFAULT_RENDER_QUEUE_SERVICE = RenderQueueService()
    return _DEFAULT_RENDER_QUEUE_SERVICE
