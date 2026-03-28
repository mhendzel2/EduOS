from __future__ import annotations

import shutil
from typing import Any

from config import settings
from database_models import ProjectMediaToolSettingsRecord, ProjectRecord

MEDIA_TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "tool_id": "storyboard_renderer",
        "name": "Storyboard Renderer",
        "provider": "StudioOS",
        "category": "local_tool",
        "description": (
            "Turn script or research inputs into structured storyboard and scene-manifest artifacts with citations "
            "that downstream render steps can consume."
        ),
        "capabilities": [
            "Generate storyboard JSON scene plans",
            "Produce scene-manifest artifacts with timing and source references",
            "Attach citation and provenance metadata for later audit steps",
        ],
        "install_command": "builtin",
        "notes": [
            "Runs entirely inside StudioOS and produces planning artifacts rather than rasterized media.",
            "Best used as the first step in a queued render pipeline.",
        ],
        "auth_required": False,
        "enabled": False,
        "config": {
            "default_scene_count": 6,
            "include_citations": True,
        },
    },
    {
        "tool_id": "infographic_renderer",
        "name": "Infographic Renderer",
        "provider": "StudioOS",
        "category": "local_tool",
        "description": (
            "Render a simple SVG infographic from structured research or storyboard inputs and register it as a "
            "project document."
        ),
        "capabilities": [
            "Create local SVG infographic outputs",
            "Package infographic metadata and source citations into artifacts",
            "Generate deterministic placeholder visuals for downstream assembly tests",
        ],
        "install_command": "builtin",
        "notes": [
            "Outputs SVG today so the backend can track a first-class visual asset immediately.",
            "PNG rasterization can be layered on later without changing the job model.",
        ],
        "auth_required": False,
        "enabled": False,
        "config": {
            "width": 1280,
            "height": 720,
            "accent_color": "#2563eb",
        },
    },
    {
        "tool_id": "narration_generator",
        "name": "Narration Generator",
        "provider": "StudioOS + FFmpeg",
        "category": "local_tool",
        "description": (
            "Produce a local placeholder narration audio asset and a narration manifest so the render pipeline can "
            "track audio outputs before a real TTS backend is attached."
        ),
        "capabilities": [
            "Generate MP3 or WAV placeholder narration assets",
            "Estimate duration from source text and persist audit metadata",
            "Provide a stable backend contract for later TTS provider swaps",
        ],
        "install_command": "ffmpeg -version",
        "notes": [
            "Current audio output is a timing placeholder generated locally with FFmpeg.",
            "The job/asset contract is intended to stay stable when a real narration backend replaces it.",
        ],
        "auth_required": False,
        "enabled": False,
        "config": {
            "default_format": "mp3",
            "words_per_minute": 150,
        },
    },
    {
        "tool_id": "video_assembler",
        "name": "Video Assembler",
        "provider": "StudioOS + FFmpeg",
        "category": "local_tool",
        "description": (
            "Assemble a local placeholder MP4 output from render metadata so StudioOS can persist a final video "
            "asset without blocking on a future NLE integration."
        ),
        "capabilities": [
            "Generate MP4 placeholder outputs for queued render jobs",
            "Bind narration and storyboard metadata into a final asset record",
            "Emit audit artifacts that track exactly which sources informed the render",
        ],
        "install_command": "ffmpeg -version",
        "notes": [
            "Current output is a deterministic title-card style assembly for backend orchestration purposes.",
            "This tool establishes the async asset lifecycle expected by a later full compositor.",
        ],
        "auth_required": False,
        "enabled": False,
        "config": {
            "width": 1280,
            "height": 720,
            "background_color": "#111827",
        },
    },
    {
        "tool_id": "youtube_comment_collector",
        "name": "YouTube Comment Collector",
        "provider": "YouTube Data API",
        "category": "local_tool",
        "description": (
            "Collect top-level YouTube comments for a published video and persist them as a structured feedback "
            "artifact that StudioOS can use for review, memory, and future optimization passes."
        ),
        "capabilities": [
            "Fetch top-level YouTube comments from a video URL or ID",
            "Persist a structured feedback artifact with comment text and engagement metrics",
            "Capture audience-review signals for later agent analysis and prompt tuning",
        ],
        "install_command": "Set YOUTUBE_API_KEY in the StudioOS environment",
        "notes": [
            "Supports either the global YOUTUBE_API_KEY env var or a project-specific youtube_api_key override.",
            "This currently collects top-level comments and engagement counts, not reply threads.",
        ],
        "auth_required": True,
        "enabled": False,
        "config": {
            "video_reference": "",
            "max_results": 25,
            "youtube_api_key": "",
        },
    },
    {
        "tool_id": "composio_youtube_mcp",
        "name": "Composio YouTube MCP",
        "provider": "Composio",
        "category": "mcp",
        "description": (
            "Handle YouTube title/description/tags, thumbnail coordination, and direct MP4 upload to a channel "
            "from a local file path."
        ),
        "capabilities": [
            "Generate channel-ready title, description, and tag packages",
            "Route thumbnail inputs into the YouTube publishing flow",
            "Upload a local MP4 directly to the configured YouTube channel",
        ],
        "install_command": "npx @composio/cli add cursor --app youtube",
        "notes": [
            "Requires Composio setup and YouTube account authorization outside StudioOS.",
            "Best suited for final upload and SEO packaging after local edit outputs are ready.",
        ],
        "auth_required": True,
        "enabled": False,
        "config": {
            "channel_reference": "",
            "youtube_api_key": "",
            "local_upload_path": "",
            "thumbnail_input_path": "",
        },
    },
    {
        "tool_id": "notebooklm_mcp",
        "name": "NotebookLM MCP",
        "provider": "jacob-bd/notebooklm-mcp",
        "category": "mcp",
        "description": (
            "Access NotebookLM generated MP4s, create video overviews, and list or download exported assets into "
            "the project workflow."
        ),
        "capabilities": [
            "Trigger NotebookLM video overview generation",
            "List generated video assets from the authenticated notebook workspace",
            "Download exported MP4 outputs into the local project pipeline",
        ],
        "install_command": "uv tool install notebooklm-mcp-server",
        "notes": [
            "Requires NotebookLM authentication before StudioOS can rely on it.",
            "Useful when a project depends on NotebookLM-generated source videos or explainers.",
        ],
        "auth_required": True,
        "enabled": False,
        "config": {
            "notebook_name": "",
            "download_directory": "",
            "video_overview_topic": "",
        },
    },
    {
        "tool_id": "ffmpeg_execute_code",
        "name": "FFmpeg via execute_code MCP",
        "provider": "Local FFmpeg",
        "category": "local_tool",
        "description": (
            "Perform local post-processing on MP4 outputs: watermarking, logo overlays, text overlays, trimming, "
            "format conversion, and full-length or shorts-specific edits."
        ),
        "capabilities": [
            "Add branding overlays, watermarks, and text callouts",
            "Trim long-form and short-form variants from a source MP4",
            "Create channel-specific delivery outputs locally before upload",
        ],
        "install_command": "ffmpeg -version",
        "notes": [
            "StudioOS treats this as a local execution tool and assumes FFmpeg is installed on the host machine.",
            "Recommended for branding, cutdowns, and pre-upload output packaging.",
        ],
        "auth_required": False,
        "enabled": False,
        "config": {
            "branding_asset_path": "",
            "longform_output_directory": "",
            "shorts_output_directory": "",
        },
    },
]


def _tool_index(tools: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(tool.get("tool_id") or ""): tool for tool in tools if str(tool.get("tool_id") or "").strip()}


def get_default_media_tools() -> list[dict[str, Any]]:
    return [
        {
            **tool,
            "capabilities": list(tool.get("capabilities") or []),
            "notes": list(tool.get("notes") or []),
            "config": dict(tool.get("config") or {}),
        }
        for tool in MEDIA_TOOL_DEFINITIONS
    ]


def normalize_media_tools(raw_tools: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    raw_index = _tool_index(raw_tools or [])
    normalized: list[dict[str, Any]] = []

    for default_tool in get_default_media_tools():
        saved = raw_index.get(default_tool["tool_id"], {})
        merged_config = {
            **default_tool.get("config", {}),
            **{
                str(key): value
                for key, value in dict(saved.get("config") or {}).items()
                if str(key).strip()
            },
        }
        normalized.append(
            {
                **default_tool,
                "enabled": bool(saved.get("enabled", default_tool.get("enabled", False))),
                "config": merged_config,
            }
        )

    return normalized


def get_or_create_project_media_tool_settings(db, project_id: str) -> ProjectMediaToolSettingsRecord:
    record = db.query(ProjectMediaToolSettingsRecord).filter(ProjectMediaToolSettingsRecord.project_id == project_id).first()
    if record is None:
        record = ProjectMediaToolSettingsRecord(
            project_id=project_id,
            tools=normalize_media_tools(None),
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    normalized = normalize_media_tools(record.tools)
    if normalized != (record.tools or []):
        record.tools = normalized
        db.add(record)
        db.commit()
        db.refresh(record)
    return record


def update_project_media_tools(record: ProjectMediaToolSettingsRecord, updates: list[dict[str, Any]]) -> None:
    record.tools = normalize_media_tools(updates)


def serialize_project_media_tool_settings(record: ProjectMediaToolSettingsRecord) -> dict[str, Any]:
    tools = []
    for tool in normalize_media_tools(record.tools):
        runtime = get_media_tool_runtime_status(tool)
        tools.append({**tool, **runtime})
    return {
        "project_id": record.project_id,
        "tools": tools,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def get_project_media_tools_context(project: ProjectRecord, db) -> dict[str, Any]:
    domains = set(project.domains or [])
    if "web" not in domains and "youtube" not in domains:
        return {"media_tools": [], "enabled_media_tools": [], "enabled_media_tool_ids": []}

    record = get_or_create_project_media_tool_settings(db, project.id)
    tools = normalize_media_tools(record.tools)
    enabled_tools = [tool for tool in tools if tool.get("enabled")]
    return {
        "media_tools": tools,
        "enabled_media_tools": enabled_tools,
        "enabled_media_tool_ids": [str(tool.get("tool_id")) for tool in enabled_tools],
    }


def get_media_tool_runtime_status(tool: dict[str, Any]) -> dict[str, Any]:
    tool_id = str(tool.get("tool_id") or "")

    if tool_id == "storyboard_renderer":
        return {
            "runtime_available": True,
            "runtime_ready": bool(tool.get("enabled")),
            "runtime_message": "Built-in storyboard generation is available.",
            "supported_actions": ["generate_storyboard"],
        }

    if tool_id == "infographic_renderer":
        return {
            "runtime_available": True,
            "runtime_ready": bool(tool.get("enabled")),
            "runtime_message": "Built-in SVG infographic rendering is available.",
            "supported_actions": ["render_infographic"],
        }

    if tool_id == "narration_generator":
        available = shutil.which("ffmpeg") is not None
        return {
            "runtime_available": available,
            "runtime_ready": available and bool(tool.get("enabled")),
            "runtime_message": (
                "FFmpeg is available for placeholder narration generation."
                if available
                else "FFmpeg is required for local narration placeholder generation."
            ),
            "supported_actions": ["generate_narration"],
        }

    if tool_id == "video_assembler":
        available = shutil.which("ffmpeg") is not None
        return {
            "runtime_available": available,
            "runtime_ready": available and bool(tool.get("enabled")),
            "runtime_message": (
                "FFmpeg is available for placeholder video assembly."
                if available
                else "FFmpeg is required for local placeholder MP4 assembly."
            ),
            "supported_actions": ["assemble_video"],
        }

    if tool_id == "ffmpeg_execute_code":
        available = shutil.which("ffmpeg") is not None
        message = "FFmpeg is available on the host machine." if available else "FFmpeg is not installed or not on PATH."
        return {
            "runtime_available": available,
            "runtime_ready": available,
            "runtime_message": message,
            "supported_actions": ["brand_video", "create_shorts_cut"],
        }

    if tool_id == "composio_youtube_mcp":
        npx_available = shutil.which("npx") is not None
        return {
            "runtime_available": npx_available,
            "runtime_ready": npx_available and bool(tool.get("enabled")),
            "runtime_message": (
                "npx is available. External Composio install/auth is still required before direct channel actions."
                if npx_available
                else "npx is not available on this machine."
            ),
            "supported_actions": ["prepare_youtube_upload_package"],
        }

    if tool_id == "youtube_comment_collector":
        project_api_key = str(tool.get("config", {}).get("youtube_api_key") or "").strip()
        api_key_configured = bool(project_api_key or settings.YOUTUBE_API_KEY.strip())
        return {
            "runtime_available": api_key_configured,
            "runtime_ready": api_key_configured and bool(tool.get("enabled")),
            "runtime_message": (
                "Project-specific YouTube Data API key is configured for comment collection."
                if project_api_key
                else "YouTube Data API key is configured for comment collection."
                if api_key_configured
                else "Set a project youtube_api_key or global YOUTUBE_API_KEY to enable comment collection."
            ),
            "supported_actions": ["collect_comment_feedback"],
        }

    if tool_id == "notebooklm_mcp":
        server_available = shutil.which("notebooklm-mcp-server") is not None
        uv_available = shutil.which("uv") is not None
        if server_available:
            message = "NotebookLM MCP server binary is available."
        elif uv_available:
            message = "uv is available, but notebooklm-mcp-server is not installed yet."
        else:
            message = "NotebookLM MCP server is not installed, and uv is not available on PATH."
        return {
            "runtime_available": server_available or uv_available,
            "runtime_ready": server_available and bool(tool.get("enabled")),
            "runtime_message": message,
            "supported_actions": ["prepare_notebooklm_video_manifest"],
        }

    return {
        "runtime_available": False,
        "runtime_ready": False,
        "runtime_message": "No runtime information available.",
        "supported_actions": [],
    }
