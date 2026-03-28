from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import quote

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api import routes
from database import Base
from database_models import DocumentProvenanceRecord, DocumentRecord, ProjectRecord
from storage.document_store import DocumentStore
from storage.vector_store import VectorStore


class RawUploadRequest:
    def __init__(self, body: bytes, headers: dict[str, str]):
        self._body = body
        self.headers = headers

    async def body(self) -> bytes:
        return self._body


@pytest.fixture
def db_session() -> Session:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, future=True)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.mark.asyncio
async def test_document_upload_list_search_and_delete(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    project = ProjectRecord(
        name="Docs Project",
        description="Document routing test.",
        domains=["writing"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    document_store = DocumentStore(upload_dir=str(tmp_path / "uploads"))
    vector_store = VectorStore(path=str(tmp_path / "vector_store"), collection_name="test_documents")
    vector_store._use_memory_fallback()

    monkeypatch.setattr(routes, "get_document_store_service", lambda: document_store)
    monkeypatch.setattr(routes, "get_vector_store_service", lambda: vector_store)

    upload_request = RawUploadRequest(
        body=b"Alpha concept note.\nThe silver orchard is the key continuity phrase.",
        headers={
            "x-studio-filename": quote("notes.txt"),
            "content-type": "text/plain",
        },
    )

    uploaded = await routes.upload_project_document(project.id, upload_request, db_session)
    assert uploaded.filename == "notes.txt"
    assert uploaded.project_id == project.id
    assert Path(uploaded.path).exists()

    listed = await routes.list_project_documents(project.id, 100, db_session)
    assert len(listed.documents) == 1
    assert listed.documents[0].id == uploaded.id

    searched = await routes.search_project_documents(project.id, "silver orchard", 5, db_session)
    assert len(searched.results) == 1
    assert searched.results[0].document_id == uploaded.id
    assert "silver orchard" in searched.results[0].content.lower()

    content_response = await routes.get_document_content(uploaded.id, db_session)
    assert content_response.filename == "notes.txt"
    assert content_response.path == uploaded.path

    deleted = await routes.delete_project_document(uploaded.id, db_session)
    assert deleted["status"] == "deleted"
    assert db_session.query(DocumentRecord).count() == 0
    assert not Path(uploaded.path).exists()


@pytest.mark.asyncio
async def test_project_inbox_status_and_import(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    project = ProjectRecord(
        name="Inbox Project",
        description="Inbox import test.",
        domains=["writing"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    inbox_root = tmp_path / "workspace_root"
    inbox_path = inbox_root / "project_inbox" / f"inbox-project-{project.id[:8]}"
    inbox_path.mkdir(parents=True)
    source_file = inbox_path / "brief.txt"
    source_file.write_text("Inbox import content", encoding="utf-8")

    document_store = DocumentStore(upload_dir=str(tmp_path / "uploads"))
    vector_store = VectorStore(path=str(tmp_path / "vector_store"), collection_name="test_inbox_documents")
    vector_store._use_memory_fallback()

    monkeypatch.setattr(routes, "ROOT_DIR", inbox_root)
    monkeypatch.setattr(routes, "get_document_store_service", lambda: document_store)
    monkeypatch.setattr(routes, "get_vector_store_service", lambda: vector_store)

    status = await routes.get_project_inbox_status(project.id, db_session)
    assert status.exists is True
    assert status.importable_file_count == 1
    assert status.sample_files == ["brief.txt"]

    result = await routes.import_project_inbox(project.id, db_session)
    assert result.imported == 1
    assert result.selected_files == 1

    documents = db_session.query(DocumentRecord).filter(DocumentRecord.project_id == project.id).all()
    assert len(documents) == 1
    assert documents[0].filename == "brief.txt"


@pytest.mark.asyncio
async def test_website_import_creates_structured_documents(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    project = ProjectRecord(
        name="Website Project",
        description="Website import test.",
        domains=["web"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    document_store = DocumentStore(upload_dir=str(tmp_path / "uploads"))
    vector_store = VectorStore(path=str(tmp_path / "vector_store"), collection_name="test_website_documents")
    vector_store._use_memory_fallback()

    monkeypatch.setattr(routes, "get_document_store_service", lambda: document_store)
    monkeypatch.setattr(routes, "get_vector_store_service", lambda: vector_store)

    async def fake_fetch_site_pages(site_url: str, *, max_pages: int):
        assert site_url == "https://cellnucleus.com"
        assert max_pages == 2
        return {
            "normalized_site_url": site_url,
            "selected_pages": 1,
            "pages": [
                {
                    "title": "Home",
                    "abstract": "Landing page",
                    "content": "CellNucleus homepage content",
                    "source_type": "website_page",
                    "source_identifier": "/",
                    "source_url": "https://cellnucleus.com",
                    "citation": "https://cellnucleus.com",
                    "authors": [],
                    "published_at": "",
                    "metadata": {"site_url": site_url},
                }
            ],
        }

    monkeypatch.setattr(routes, "fetch_site_pages", fake_fetch_site_pages)

    result = await routes.import_project_website_documents(
        project.id,
        routes.ProjectWebsiteImportRequest(site_url="https://cellnucleus.com", max_pages=2),
        db_session,
    )
    assert result.imported == 1
    assert result.skipped_existing == 0

    second_result = await routes.import_project_website_documents(
        project.id,
        routes.ProjectWebsiteImportRequest(site_url="https://cellnucleus.com", max_pages=2),
        db_session,
    )
    assert second_result.imported == 0
    assert second_result.skipped_existing == 1

    assert db_session.query(DocumentRecord).filter(DocumentRecord.project_id == project.id).count() == 1
    provenance = db_session.query(DocumentProvenanceRecord).one()
    assert provenance.source_url == "https://cellnucleus.com"
