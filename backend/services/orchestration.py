from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from database_models import ArtifactRecord, ProjectRecord, RunEventRecord, RunRecord


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_run_record(
    db: Session,
    project_id: str,
    run_type: str,
    task: str,
    requested_agent: Optional[str] = None,
    context: Optional[dict[str, Any]] = None,
    details: Optional[dict[str, Any]] = None,
) -> RunRecord:
    run = RunRecord(
        project_id=project_id,
        run_type=run_type,
        task=task,
        requested_agent=requested_agent,
        status="running",
        context=context or {},
        details=details or {},
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def append_run_event(db: Session, run_id: str, event_type: str, payload: Optional[dict[str, Any]] = None) -> RunEventRecord:
    sequence = (
        db.query(RunEventRecord)
        .filter(RunEventRecord.run_id == run_id)
        .count()
        + 1
    )
    event = RunEventRecord(
        run_id=run_id,
        sequence=sequence,
        event_type=event_type,
        payload=payload or {},
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def persist_artifact(
    db: Session,
    project_id: str,
    artifact_type: str,
    content: Optional[str],
    run_id: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> ArtifactRecord:
    previous = (
        db.query(ArtifactRecord)
        .filter(
            ArtifactRecord.project_id == project_id,
            ArtifactRecord.artifact_type == artifact_type,
        )
        .order_by(ArtifactRecord.version.desc())
        .first()
    )
    version = 1 if previous is None else previous.version + 1
    artifact = ArtifactRecord(
        project_id=project_id,
        run_id=run_id,
        artifact_type=artifact_type,
        content=content,
        metadata_=metadata or {},
        version=version,
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)
    return artifact


def finalize_run(
    db: Session,
    run: RunRecord,
    status: str,
    final_output: Optional[str] = None,
    error: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> RunRecord:
    run.status = status
    run.final_output = final_output
    run.error = error
    if details:
        run.details = {**(run.details or {}), **details}
    run.completed_at = utc_now()
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def serialize_project(project: ProjectRecord) -> dict[str, Any]:
    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "domains": list(project.domains or []),
        "story_bible": project.story_bible or {},
        "brand_bible": project.brand_bible or {},
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "run_count": len(project.runs or []),
        "artifact_count": len(project.artifacts or []),
        "document_count": len(project.documents or []),
    }


def serialize_run_event(event: RunEventRecord) -> dict[str, Any]:
    return {
        "sequence": event.sequence,
        "event_type": event.event_type,
        "payload": event.payload or {},
        "created_at": event.created_at,
    }


def serialize_run(run: RunRecord, include_events: bool = True) -> dict[str, Any]:
    return {
        "id": run.id,
        "project_id": run.project_id,
        "run_type": run.run_type,
        "task": run.task,
        "requested_agent": run.requested_agent,
        "status": run.status,
        "context": run.context or {},
        "final_output": run.final_output,
        "error": run.error,
        "metadata": run.details or {},
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "events": [serialize_run_event(event) for event in run.events] if include_events else [],
    }


def serialize_artifact(artifact: ArtifactRecord) -> dict[str, Any]:
    return {
        "id": artifact.id,
        "project_id": artifact.project_id,
        "run_id": artifact.run_id,
        "artifact_type": artifact.artifact_type,
        "content": artifact.content,
        "metadata": artifact.metadata_ or {},
        "version": artifact.version,
        "created_at": artifact.created_at,
    }
