from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api import routes
from api.schemas import (
    MediaToolActionRequest,
    MediaJobCreateRequest,
    MediaToolSettingsUpdateItem,
    ProjectMediaToolSettingsUpdateRequest,
    StructuredDocumentCreateRequest,
)
from database import Base
from database_models import DocumentRecord, ProjectRecord
from services.render_jobs import RenderQueueService
from storage.document_store import DocumentStore


class FakeVectorStore:
    def __init__(self) -> None:
        self.documents = []

    async def add_documents(self, documents):
        self.documents.extend(documents)
        return [document.id for document in documents]


class NoopQueueService:
    async def enqueue(self, job_id: str) -> None:
        return None


@pytest.fixture
def session_bundle():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, future=True)
    testing_session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)
    session = testing_session_local()
    try:
        yield session, testing_session_local
    finally:
        session.close()
        engine.dispose()


@pytest.mark.asyncio
async def test_execute_storyboard_media_tool_action_generates_artifacts(
    session_bundle,
    tmp_path: Path,
):
    db_session, _ = session_bundle
    project = ProjectRecord(
        name="Storyboard Project",
        description="Media planning project.",
        domains=["web", "youtube"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    await routes.update_project_media_tool_settings_route(
        project_id=project.id,
        payload=ProjectMediaToolSettingsUpdateRequest(
            tools=[
                MediaToolSettingsUpdateItem(
                    tool_id="storyboard_renderer",
                    enabled=True,
                    config={"default_scene_count": 4},
                )
            ]
        ),
        db=db_session,
    )

    script_path = tmp_path / "script.txt"
    script_path.write_text(
        "Cell state transitions drive disease progression.\n\n"
        "Spatial context changes how biomarkers are interpreted.\n\n"
        "A final segment ties evidence back to treatment response.",
        encoding="utf-8",
    )
    document = DocumentRecord(
        project_id=project.id,
        filename="script.txt",
        path=str(script_path),
        size=script_path.stat().st_size,
        content_type="text/plain",
        source_path=str(script_path),
        is_reference=True,
        version=1,
    )
    db_session.add(document)
    db_session.commit()
    db_session.refresh(document)

    response = await routes.execute_project_media_tool_action(
        project_id=project.id,
        tool_id="storyboard_renderer",
        payload=MediaToolActionRequest(
            action="generate_storyboard",
            document_id=document.id,
            arguments={"title": "Cell State Explainer", "scene_count": 3},
        ),
        db=db_session,
    )

    assert response.success is True
    assert response.artifact is not None
    assert response.artifact.artifact_type == "storyboard_json"
    generated_types = {artifact.artifact_type for artifact in response.generated_artifacts}
    assert "storyboard_json" in generated_types
    assert "scene_manifest_json" in generated_types
    assert "render_audit_json" in generated_types
    assert {asset.kind for asset in response.generated_media_assets} == {"json"}


@pytest.mark.asyncio
async def test_upload_project_structured_document_indexes_provenance(
    session_bundle,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    db_session, _ = session_bundle
    project = ProjectRecord(
        name="Literature Project",
        description="Structured literature ingestion test.",
        domains=["web"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    fake_vector_store = FakeVectorStore()
    monkeypatch.setattr(routes, "get_document_store_service", lambda: DocumentStore(upload_dir=str(tmp_path / "uploads")))
    monkeypatch.setattr(routes, "get_vector_store_service", lambda: fake_vector_store)

    response = await routes.upload_project_structured_document(
        project_id=project.id,
        payload=StructuredDocumentCreateRequest(
            title="Single-cell atlas of response",
            abstract="An atlas of treatment response across cell states.",
            content="Results show several disease-associated state transitions.",
            source_type="pubmed",
            source_identifier="PMID:123456",
            source_url="https://pubmed.ncbi.nlm.nih.gov/123456/",
            citation="Doe et al. 2025",
            authors=["Jane Doe", "John Roe"],
            published_at="2025-02-01",
            metadata={"journal": "Nature Methods"},
        ),
        db=db_session,
    )

    assert response.provenance is not None
    assert response.provenance.source_type == "pubmed"
    assert response.provenance.source_identifier == "PMID:123456"
    assert response.provenance.citation == "Doe et al. 2025"
    assert fake_vector_store.documents
    assert "Single-cell atlas of response" in fake_vector_store.documents[0].content


@pytest.mark.asyncio
async def test_create_media_job_rejects_invalid_parameters(
    session_bundle,
    monkeypatch: pytest.MonkeyPatch,
):
    db_session, _ = session_bundle
    project = ProjectRecord(
        name="Validation Project",
        description="Validation test.",
        domains=["web"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    monkeypatch.setattr(routes, "get_render_queue_service", lambda: NoopQueueService())

    with pytest.raises(HTTPException) as exc_info:
        await routes.create_media_job_route(
            payload=MediaJobCreateRequest(
                project_id=project.id,
                job_type="infographic",
                title="Invalid job",
                parameters={"unexpected": "value"},
            ),
            db=db_session,
        )

    assert exc_info.value.status_code == 400
    assert "Invalid render job parameters" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_cancel_media_job_route_cancels_queued_job(
    session_bundle,
    monkeypatch: pytest.MonkeyPatch,
):
    db_session, _ = session_bundle
    project = ProjectRecord(
        name="Cancel Project",
        description="Cancel test.",
        domains=["web"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    monkeypatch.setattr(routes, "get_render_queue_service", lambda: NoopQueueService())

    created = await routes.create_media_job_route(
        payload=MediaJobCreateRequest(
            project_id=project.id,
            job_type="infographic",
            title="Queued job",
            parameters={"text": "Render this figure."},
        ),
        db=db_session,
    )

    cancelled = await routes.cancel_media_job_route(job_id=created.id, db=db_session)
    assert cancelled.status == "cancelled"
    assert cancelled.result["message"] == "Cancelled before execution."


@pytest.mark.asyncio
async def test_retry_media_job_route_requeues_failed_job(
    session_bundle,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    db_session, testing_session_local = session_bundle
    project = ProjectRecord(
        name="Retry Project",
        description="Retry test.",
        domains=["web", "youtube"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    script_path = tmp_path / "retry-source.txt"
    script_path.write_text("Retryable render input.", encoding="utf-8")
    document = DocumentRecord(
        project_id=project.id,
        filename="retry-source.txt",
        path=str(script_path),
        size=script_path.stat().st_size,
        content_type="text/plain",
        source_path=str(script_path),
        is_reference=True,
        version=1,
    )
    db_session.add(document)
    db_session.commit()
    db_session.refresh(document)

    render_queue = RenderQueueService(
        session_factory=testing_session_local,
        document_store=DocumentStore(upload_dir=str(tmp_path / "retry-uploads")),
    )
    monkeypatch.setattr(routes, "get_render_queue_service", lambda: render_queue)

    created = await routes.create_media_job_route(
        payload=MediaJobCreateRequest(
            project_id=project.id,
            job_type="infographic",
            title="Retry Infographic",
            document_id=document.id,
        ),
        db=db_session,
    )

    try:
        failed = created
        for _ in range(40):
            failed = await routes.get_media_job_route(job_id=created.id, db=db_session)
            if failed.status == "failed":
                break
            await asyncio.sleep(0.05)

        assert failed.status == "failed"
        assert "disabled" in (failed.error or "")

        await routes.update_project_media_tool_settings_route(
            project_id=project.id,
            payload=ProjectMediaToolSettingsUpdateRequest(
                tools=[
                    MediaToolSettingsUpdateItem(
                        tool_id="infographic_renderer",
                        enabled=True,
                        config={"accent_color": "#2563eb"},
                    )
                ]
            ),
            db=db_session,
        )

        retried = await routes.retry_media_job_route(job_id=created.id, db=db_session)
        assert retried.status == "retry"

        final = retried
        for _ in range(40):
            final = await routes.get_media_job_route(job_id=created.id, db=db_session)
            if final.status in {"completed", "failed"}:
                break
            await asyncio.sleep(0.05)

        assert final.status == "completed"
        assert any(asset.kind == "svg" for asset in final.media_assets)
    finally:
        await render_queue.stop()


@pytest.mark.asyncio
async def test_polled_render_worker_processes_queued_job_without_enqueue(
    session_bundle,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    db_session, testing_session_local = session_bundle
    project = ProjectRecord(
        name="Polled Worker Project",
        description="DB polling worker test.",
        domains=["web", "youtube"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    await routes.update_project_media_tool_settings_route(
        project_id=project.id,
        payload=ProjectMediaToolSettingsUpdateRequest(
            tools=[
                MediaToolSettingsUpdateItem(
                    tool_id="infographic_renderer",
                    enabled=True,
                    config={"accent_color": "#0f766e"},
                )
            ]
        ),
        db=db_session,
    )

    script_path = tmp_path / "polled-source.txt"
    script_path.write_text("Polled worker render input.", encoding="utf-8")
    document = DocumentRecord(
        project_id=project.id,
        filename="polled-source.txt",
        path=str(script_path),
        size=script_path.stat().st_size,
        content_type="text/plain",
        source_path=str(script_path),
        is_reference=True,
        version=1,
    )
    db_session.add(document)
    db_session.commit()
    db_session.refresh(document)

    monkeypatch.setattr(routes, "get_render_queue_service", lambda: NoopQueueService())

    created = await routes.create_media_job_route(
        payload=MediaJobCreateRequest(
            project_id=project.id,
            job_type="infographic",
            title="Polled job",
            document_id=document.id,
        ),
        db=db_session,
    )
    assert created.status == "queued"

    render_queue = RenderQueueService(
        session_factory=testing_session_local,
        document_store=DocumentStore(upload_dir=str(tmp_path / "polled-uploads")),
        poll_interval_seconds=0.05,
    )

    try:
        await render_queue.start()
        final = created
        for _ in range(60):
            final = await routes.get_media_job_route(job_id=created.id, db=db_session)
            if final.status in {"completed", "failed"}:
                break
            await asyncio.sleep(0.05)

        assert final.status == "completed"
        assert any(asset.kind == "svg" for asset in final.media_assets)
    finally:
        await render_queue.stop()


@pytest.mark.asyncio
async def test_render_job_queue_executes_infographic_job(
    session_bundle,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    db_session, testing_session_local = session_bundle
    project = ProjectRecord(
        name="Queued Render Project",
        description="Render queue test.",
        domains=["web", "youtube"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    await routes.update_project_media_tool_settings_route(
        project_id=project.id,
        payload=ProjectMediaToolSettingsUpdateRequest(
            tools=[
                MediaToolSettingsUpdateItem(
                    tool_id="infographic_renderer",
                    enabled=True,
                    config={"accent_color": "#0f766e"},
                )
            ]
        ),
        db=db_session,
    )

    script_path = tmp_path / "render-source.txt"
    script_path.write_text(
        "Point one explains the cohort.\n\nPoint two explains the assay.\n\nPoint three explains the outcome.",
        encoding="utf-8",
    )
    document = DocumentRecord(
        project_id=project.id,
        filename="render-source.txt",
        path=str(script_path),
        size=script_path.stat().st_size,
        content_type="text/plain",
        source_path=str(script_path),
        is_reference=True,
        version=1,
    )
    db_session.add(document)
    db_session.commit()
    db_session.refresh(document)

    render_queue = RenderQueueService(
        session_factory=testing_session_local,
        document_store=DocumentStore(upload_dir=str(tmp_path / "queued-uploads")),
    )
    monkeypatch.setattr(routes, "get_render_queue_service", lambda: render_queue)

    created = await routes.create_media_job_route(
        payload=MediaJobCreateRequest(
            project_id=project.id,
            job_type="infographic",
            title="Queued Infographic",
            document_id=document.id,
            parameters={"accent_color": "#0f766e"},
        ),
        db=db_session,
    )

    try:
        final = created
        for _ in range(40):
            final = await routes.get_project_render_job_route(project_id=project.id, job_id=created.id, db=db_session)
            if final.status in {"completed", "failed"}:
                break
            await asyncio.sleep(0.05)

        assert final.status == "completed"
        assert final.run is not None
        assert final.run.status == "completed"
        assert any(asset.kind == "svg" for asset in final.media_assets)
        assert any(asset.asset_kind == "document" and asset.asset_role == "infographic" for asset in final.assets)
        assert any(asset.asset_kind == "artifact" and asset.asset_role == "render_audit" for asset in final.assets)

        listed_jobs = await routes.list_media_jobs_route(project_id=project.id, db=db_session)
        assert any(job.id == created.id for job in listed_jobs.jobs)

        listed_assets = await routes.list_project_media_assets_route(project_id=project.id, db=db_session)
        assert listed_assets.assets
        svg_asset = next(asset for asset in listed_assets.assets if asset.kind == "svg")
        streamed = await routes.get_media_asset_content_route(asset_id=svg_asset.id, db=db_session)
        assert isinstance(streamed, FileResponse)
        assert Path(streamed.path).exists()
    finally:
        await render_queue.stop()
