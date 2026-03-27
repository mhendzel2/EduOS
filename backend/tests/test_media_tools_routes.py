from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api import routes
from api.schemas import MediaToolActionRequest, ProjectMediaToolSettingsUpdateRequest, MediaToolSettingsUpdateItem
from database import Base
from database_models import DocumentRecord, ProjectRecord
from services.media_tools import get_project_media_tools_context
from storage.document_store import DocumentStore


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
async def test_media_tool_routes_seed_defaults_and_persist_updates(db_session: Session):
    project = ProjectRecord(
        name="Media Tool Project",
        description="Route test for media tool settings.",
        domains=["web", "youtube"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    initial = await routes.get_project_media_tools(project_id=project.id, db=db_session)

    assert initial.project_id == project.id
    assert len(initial.tools) == 8
    assert any(tool.tool_id == "storyboard_renderer" for tool in initial.tools)
    assert any(tool.tool_id == "infographic_renderer" for tool in initial.tools)
    assert any(tool.tool_id == "narration_generator" for tool in initial.tools)
    assert any(tool.tool_id == "video_assembler" for tool in initial.tools)
    assert any(tool.tool_id == "youtube_comment_collector" for tool in initial.tools)
    assert any(tool.tool_id == "composio_youtube_mcp" for tool in initial.tools)
    assert any(tool.tool_id == "notebooklm_mcp" for tool in initial.tools)
    assert any(tool.tool_id == "ffmpeg_execute_code" for tool in initial.tools)

    updated = await routes.update_project_media_tool_settings_route(
        project_id=project.id,
        payload=ProjectMediaToolSettingsUpdateRequest(
            tools=[
                MediaToolSettingsUpdateItem(
                    tool_id="composio_youtube_mcp",
                    enabled=True,
                    config={"channel_reference": "CellNucleus", "local_upload_path": "/tmp/output.mp4"},
                ),
                MediaToolSettingsUpdateItem(
                    tool_id="ffmpeg_execute_code",
                    enabled=True,
                    config={"branding_asset_path": "/tmp/logo.png"},
                ),
            ]
        ),
        db=db_session,
    )

    composio = next(tool for tool in updated.tools if tool.tool_id == "composio_youtube_mcp")
    ffmpeg = next(tool for tool in updated.tools if tool.tool_id == "ffmpeg_execute_code")
    notebooklm = next(tool for tool in updated.tools if tool.tool_id == "notebooklm_mcp")

    assert composio.enabled is True
    assert composio.config["channel_reference"] == "CellNucleus"
    assert ffmpeg.enabled is True
    assert ffmpeg.config["branding_asset_path"] == "/tmp/logo.png"
    assert notebooklm.enabled is False


def test_get_project_media_tools_context_returns_enabled_subset(db_session: Session):
    project = ProjectRecord(
        name="Media Tool Context",
        description="Context test.",
        domains=["youtube"],
        story_bible={},
        brand_bible={},
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    record = routes.get_or_create_project_media_tool_settings(db_session, project.id)
    routes.update_project_media_tools(
        record,
        [
            {
                "tool_id": "ffmpeg_execute_code",
                "enabled": True,
                "config": {"branding_asset_path": "/tmp/logo.png"},
            }
        ],
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    context = get_project_media_tools_context(project, db=db_session)

    assert len(context["media_tools"]) == 8
    assert context["enabled_media_tool_ids"] == ["ffmpeg_execute_code"]
    assert context["enabled_media_tools"][0]["config"]["branding_asset_path"] == "/tmp/logo.png"


@pytest.mark.asyncio
async def test_execute_youtube_comment_collector_persists_feedback_artifact(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
):
    project = ProjectRecord(
        name="YouTube Feedback Project",
        description="Collect comments into StudioOS.",
        domains=["youtube"],
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
                    tool_id="youtube_comment_collector",
                    enabled=True,
                    config={"video_reference": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "max_results": 5},
                )
            ]
        ),
        db=db_session,
    )

    async def fake_fetch_youtube_comment_feedback(video_reference: str, *, max_results: int):
        assert "youtube.com" in video_reference
        assert max_results == 5
        return {
            "video_id": "dQw4w9WgXcQ",
            "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "fetched_at": "2026-03-25T00:00:00+00:00",
            "comments": [
                {
                    "comment_id": "c1",
                    "author_display_name": "Reviewer One",
                    "author_channel_id": "author-1",
                    "text": "The pacing is much stronger now.",
                    "like_count": 12,
                    "reply_count": 1,
                    "published_at": "2026-03-20T00:00:00Z",
                    "updated_at": "2026-03-20T00:00:00Z",
                    "viewer_rating": "none",
                }
            ],
            "summary": {
                "video_id": "dQw4w9WgXcQ",
                "comment_count": 1,
                "unique_author_count": 1,
                "total_like_count": 12,
                "total_reply_count": 1,
                "top_comments": [
                    {
                        "comment_id": "c1",
                        "author_display_name": "Reviewer One",
                        "like_count": 12,
                        "reply_count": 1,
                        "published_at": "2026-03-20T00:00:00Z",
                        "text": "The pacing is much stronger now.",
                    }
                ],
            },
        }

    monkeypatch.setattr("services.media_tool_runtime.fetch_youtube_comment_feedback", fake_fetch_youtube_comment_feedback)

    response = await routes.execute_project_media_tool_action(
        project_id=project.id,
        tool_id="youtube_comment_collector",
        payload=MediaToolActionRequest(action="collect_comment_feedback"),
        db=db_session,
    )

    assert response.success is True
    assert response.executed is True
    assert response.artifact is not None
    assert response.artifact.artifact_type == "youtube_comment_feedback"
    assert response.metadata["video_id"] == "dQw4w9WgXcQ"
    assert response.metadata["comment_count"] == 1
    assert {asset.kind for asset in response.generated_media_assets} == {"json"}


@pytest.mark.asyncio
async def test_execute_ffmpeg_media_tool_action_generates_output_document(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg is not available")

    project = ProjectRecord(
        name="FFmpeg Media Tool",
        description="Execute local FFmpeg actions.",
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
                    tool_id="ffmpeg_execute_code",
                    enabled=True,
                    config={"branding_asset_path": str(tmp_path / "logo.png")},
                )
            ]
        ),
        db=db_session,
    )

    video_path = tmp_path / "source.mp4"
    image_path = tmp_path / "logo.png"

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=320x240:d=1",
            "-pix_fmt",
            "yuv420p",
            str(video_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=white:s=64x64",
            "-frames:v",
            "1",
            str(image_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    video_document = DocumentRecord(
        project_id=project.id,
        filename="source.mp4",
        path=str(video_path),
        size=video_path.stat().st_size,
        content_type="video/mp4",
        source_path=str(video_path),
        is_reference=True,
        version=1,
    )
    image_document = DocumentRecord(
        project_id=project.id,
        filename="logo.png",
        path=str(image_path),
        size=image_path.stat().st_size,
        content_type="image/png",
        source_path=str(image_path),
        is_reference=True,
        version=1,
    )
    db_session.add(video_document)
    db_session.add(image_document)
    db_session.commit()
    db_session.refresh(video_document)
    db_session.refresh(image_document)

    monkeypatch.setattr(routes, "get_document_store_service", lambda: DocumentStore(upload_dir=str(tmp_path / "uploads")))

    response = await routes.execute_project_media_tool_action(
        project_id=project.id,
        tool_id="ffmpeg_execute_code",
        payload=MediaToolActionRequest(
            action="brand_video",
            document_id=video_document.id,
            secondary_document_id=image_document.id,
            arguments={"overlay_text": "CellNucleus", "output_filename": "branded-output.mp4"},
        ),
        db=db_session,
    )

    assert response.success is True
    assert response.executed is True
    assert response.output_document is not None
    assert response.output_document.filename == "branded-output.mp4"
    assert Path(response.output_document.path).exists()
    assert response.artifact is not None
    assert response.artifact.artifact_type == "tool_execution_log"
    assert {asset.kind for asset in response.generated_media_assets} == {"mp4", "execution_log"}
