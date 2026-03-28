from __future__ import annotations

import argparse
import asyncio
import mimetypes
import os
import sys
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import SessionLocal, init_db
from database_models import DocumentRecord, ProjectRecord
from services.document_indexing import build_vector_documents_for_file
from storage.document_store import DocumentStore
from storage.vector_store import VectorStore


IMPORT_EXTENSIONS = {
    ".avi",
    ".bmp",
    ".csv",
    ".docx",
    ".gif",
    ".html",
    ".jpeg",
    ".jpg",
    ".json",
    ".m4v",
    ".md",
    ".mov",
    ".mp3",
    ".mp4",
    ".pdf",
    ".png",
    ".py",
    ".txt",
    ".wav",
    ".webm",
    ".webp",
    ".yaml",
    ".yml",
}

MEDIA_IMPORT_EXTENSIONS = {
    ".avi",
    ".bmp",
    ".gif",
    ".jpeg",
    ".jpg",
    ".m4v",
    ".mov",
    ".mp3",
    ".mp4",
    ".pdf",
    ".png",
    ".wav",
    ".webm",
    ".webp",
}

SKIP_DIR_NAMES = {
    ".git",
    ".pytest_cache",
    "__pycache__",
    "build",
    "dist",
    "logs",
    "node_modules",
    "uploads",
    "vector_store",
}

SKIP_PATH_PARTS = {
    "inbox/resources",
}

SKIP_EXTENSIONS = {
    ".pyc",
    ".zip",
}

CONTENT_TYPES = {
    ".csv": "text/csv",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".html": "text/html",
    ".json": "application/json",
    ".md": "text/markdown",
    ".py": "text/x-python",
    ".txt": "text/plain",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
}


@dataclass(frozen=True)
class ImportSpec:
    project_name: str
    source_dir: Path
    domains: list[str]
    description: str


_DEFAULT_AGENT0_BASE = Path("C:/Users/mjhen/Github/Agent0/agent-zero/usr/workdir")
_DEFAULT_CELLNUCLEUS_SITE_PATH = Path("C:/Users/mjhen/Github/cellnucleus.com")


def _env_path(name: str, default: Path) -> Path:
    raw = str(os.getenv(name, "")).strip()
    if not raw:
        return default
    return Path(raw).expanduser()


_AGENT0_BASE = _env_path("AGENT0_WORKDIR", _DEFAULT_AGENT0_BASE)
_CELLNUCLEUS_SITE_PATH = _env_path("CELLNUCLEUS_SITE_PATH", _DEFAULT_CELLNUCLEUS_SITE_PATH)

IMPORT_SPECS = {
    "polymarket": ImportSpec(
        project_name="Polymarket Site",
        source_dir=_AGENT0_BASE / "polymarket_geo_youtube",
        domains=["writing", "web", "youtube"],
        description="Imported from Agent0 polymarket_geo_youtube workspace.",
    ),
    "cellnucleus": ImportSpec(
        project_name="CellNucleus.com",
        source_dir=_CELLNUCLEUS_SITE_PATH,
        domains=["writing", "web", "youtube"],
        description="Imported from the local CellNucleus website workspace.",
    ),
}


def _should_skip(path: Path, source_dir: Path) -> bool:
    rel_path = path.relative_to(source_dir)
    rel_posix = rel_path.as_posix()
    extension = path.suffix.lower()
    if any(part in SKIP_DIR_NAMES for part in rel_path.parts):
        return True
    if any(skip_part in rel_posix for skip_part in SKIP_PATH_PARTS) and extension not in MEDIA_IMPORT_EXTENSIONS:
        return True
    if path.name == ".gitkeep":
        return True
    if extension in SKIP_EXTENSIONS:
        return True
    if extension and extension not in IMPORT_EXTENSIONS:
        return True
    return False


def _iter_import_files(source_dir: Path) -> list[Path]:
    files: list[Path] = []
    for path in sorted(source_dir.rglob("*")):
        if not path.is_file():
            continue
        if _should_skip(path, source_dir):
            continue
        files.append(path)
    return files


def _content_type_for(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")


def _get_or_create_project(spec: ImportSpec) -> ProjectRecord:
    with SessionLocal() as db:
        existing = db.query(ProjectRecord).filter(ProjectRecord.name == spec.project_name).first()
        if existing:
            return existing

        project = ProjectRecord(
            name=spec.project_name,
            description=spec.description,
            domains=spec.domains,
            story_bible={},
            brand_bible={},
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        return project


async def _import_project_documents(spec: ImportSpec, reindex_existing: bool = False) -> dict[str, int | str]:
    if not spec.source_dir.exists():
        raise FileNotFoundError(f"Source directory not found: {spec.source_dir}")

    project = _get_or_create_project(spec)
    document_store = DocumentStore()
    vector_store = VectorStore(collection_name="studio_documents")

    files = _iter_import_files(spec.source_dir)
    imported = 0
    indexing_failed = 0
    reindexed_existing = 0
    skipped_existing = 0

    async def index_document(document: DocumentRecord, rel_source: str) -> bool:
        try:
            await vector_store.delete_by_document_id(document.id)
            vector_documents = await build_vector_documents_for_file(
                path=document.path,
                document_id=document.id,
                base_metadata={
                    "project_id": project.id,
                    "filename": document.filename,
                    "content_type": document.content_type,
                    "source_path": document.source_path or "",
                    "source_relative_path": rel_source,
                },
            )
            await vector_store.add_documents(vector_documents)
            return True
        except Exception:
            return False

    for file_path in files:
        rel_source = file_path.relative_to(spec.source_dir).as_posix()

        with SessionLocal() as db:
            existing = (
                db.query(DocumentRecord)
                .filter(
                    DocumentRecord.project_id == project.id,
                    DocumentRecord.source_path == str(file_path),
                )
                .first()
            )
            if existing:
                if reindex_existing:
                    if await index_document(existing, rel_source):
                        reindexed_existing += 1
                    else:
                        indexing_failed += 1
                    continue
                skipped_existing += 1
                continue

        file_bytes = file_path.read_bytes()
        file_info = await document_store.save_file(
            file_content=file_bytes,
            filename=file_path.name,
            project_id=project.id,
            content_type=_content_type_for(file_path),
        )

        document_record = DocumentRecord(
            id=file_info.id,
            project_id=project.id,
            filename=file_path.name,
            path=file_info.path,
            size=file_info.size,
            content_type=file_info.content_type,
            source_path=str(file_path),
            is_reference=True,
            version=1,
        )

        with SessionLocal() as db:
            db.add(document_record)
            db.commit()

        if not await index_document(document_record, rel_source):
            indexing_failed += 1
        imported += 1

    return {
        "project_name": project.name,
        "project_id": project.id,
        "selected_files": len(files),
        "imported": imported,
        "indexing_failed": indexing_failed,
        "reindexed_existing": reindexed_existing,
        "skipped_existing": skipped_existing,
    }


async def _run(selected_keys: list[str], reindex_existing: bool) -> int:
    init_db()

    for key in selected_keys:
        spec = IMPORT_SPECS[key]
        result = await _import_project_documents(spec, reindex_existing=reindex_existing)
        print(
            f"{result['project_name']} | id={result['project_id']} | "
            f"selected={result['selected_files']} | imported={result['imported']} | "
            f"reindexed={result['reindexed_existing']} | indexing_failed={result['indexing_failed']} | "
            f"skipped={result['skipped_existing']}"
        )

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Import selected Agent0 projects into StudioOS.")
    parser.add_argument(
        "--project",
        action="append",
        choices=sorted(IMPORT_SPECS.keys()),
        dest="projects",
        help="Project key to import. Repeat to import multiple. Defaults to all supported imports.",
    )
    parser.add_argument(
        "--reindex-existing",
        action="store_true",
        help="Rebuild vector index entries for documents that are already imported.",
    )
    args = parser.parse_args()
    selected_keys = args.projects or sorted(IMPORT_SPECS.keys())
    return asyncio.run(_run(selected_keys, reindex_existing=args.reindex_existing))


if __name__ == "__main__":
    raise SystemExit(main())
