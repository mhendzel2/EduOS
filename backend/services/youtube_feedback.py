from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from config import settings

YOUTUBE_COMMENT_THREADS_URL = "https://www.googleapis.com/youtube/v3/commentThreads"
YOUTUBE_VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def extract_youtube_video_id(reference: str) -> str:
    raw = str(reference or "").strip()
    if not raw:
        raise ValueError("A YouTube video ID or URL is required.")

    if YOUTUBE_VIDEO_ID_PATTERN.fullmatch(raw):
        return raw

    parsed = urlparse(raw)
    host = parsed.netloc.lower()
    path = parsed.path.strip("/")

    candidates: list[str] = []
    if host in {"youtu.be", "www.youtu.be"} and path:
        candidates.append(path.split("/", 1)[0])
    if host.endswith("youtube.com"):
        query_video_id = parse_qs(parsed.query).get("v", [""])[0]
        if query_video_id:
            candidates.append(query_video_id)
        for prefix in ("shorts/", "live/", "embed/"):
            if path.startswith(prefix):
                candidates.append(path[len(prefix) :].split("/", 1)[0])

    for candidate in candidates:
        cleaned = candidate.strip()
        if YOUTUBE_VIDEO_ID_PATTERN.fullmatch(cleaned):
            return cleaned

    raise ValueError("Could not extract a valid YouTube video ID from the provided reference.")


def summarize_youtube_comments(video_id: str, comments: list[dict[str, Any]]) -> dict[str, Any]:
    unique_authors = {
        str(comment.get("author_channel_id") or comment.get("author_display_name") or "").strip()
        for comment in comments
        if str(comment.get("author_channel_id") or comment.get("author_display_name") or "").strip()
    }
    total_likes = sum(int(comment.get("like_count") or 0) for comment in comments)
    total_replies = sum(int(comment.get("reply_count") or 0) for comment in comments)
    top_comments = sorted(
        comments,
        key=lambda comment: (
            int(comment.get("like_count") or 0),
            int(comment.get("reply_count") or 0),
        ),
        reverse=True,
    )[:5]

    return {
        "video_id": video_id,
        "comment_count": len(comments),
        "unique_author_count": len(unique_authors),
        "total_like_count": total_likes,
        "total_reply_count": total_replies,
        "top_comments": [
            {
                "comment_id": comment.get("comment_id"),
                "author_display_name": comment.get("author_display_name"),
                "like_count": int(comment.get("like_count") or 0),
                "reply_count": int(comment.get("reply_count") or 0),
                "published_at": comment.get("published_at"),
                "text": str(comment.get("text") or "").strip()[:280],
            }
            for comment in top_comments
        ],
    }


async def fetch_youtube_comment_feedback(
    video_reference: str,
    *,
    api_key: str | None = None,
    max_results: int = 25,
) -> dict[str, Any]:
    resolved_api_key = str(api_key or settings.YOUTUBE_API_KEY or "").strip()
    if not resolved_api_key:
        raise ValueError("YOUTUBE_API_KEY is not configured.")

    video_id = extract_youtube_video_id(video_reference)
    bounded_max_results = max(1, min(int(max_results), 100))

    params = {
        "part": "snippet",
        "videoId": video_id,
        "maxResults": bounded_max_results,
        "order": "relevance",
        "textFormat": "plainText",
        "key": resolved_api_key,
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(YOUTUBE_COMMENT_THREADS_URL, params=params)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:500] if exc.response is not None else str(exc)
        raise ValueError(f"YouTube comment fetch failed: {detail}") from exc
    except httpx.HTTPError as exc:
        raise ValueError(f"YouTube comment fetch failed: {exc}") from exc

    payload = response.json()
    comments: list[dict[str, Any]] = []
    for item in payload.get("items", []):
        snippet = item.get("snippet", {})
        top_level_comment = snippet.get("topLevelComment", {})
        top_level_snippet = top_level_comment.get("snippet", {})
        text = str(top_level_snippet.get("textDisplay") or "").strip()
        if not text:
            continue
        comments.append(
            {
                "comment_id": str(top_level_comment.get("id") or ""),
                "author_display_name": str(top_level_snippet.get("authorDisplayName") or "").strip(),
                "author_channel_id": str(
                    (top_level_snippet.get("authorChannelId") or {}).get("value") or ""
                ).strip(),
                "text": text,
                "like_count": int(top_level_snippet.get("likeCount") or 0),
                "reply_count": int(snippet.get("totalReplyCount") or 0),
                "published_at": str(top_level_snippet.get("publishedAt") or "").strip(),
                "updated_at": str(top_level_snippet.get("updatedAt") or "").strip(),
                "viewer_rating": str(top_level_snippet.get("viewerRating") or "").strip(),
            }
        )

    summary = summarize_youtube_comments(video_id, comments)
    return {
        "video_id": video_id,
        "video_url": f"https://www.youtube.com/watch?v={video_id}",
        "fetched_at": _utc_now_iso(),
        "comments": comments,
        "summary": summary,
    }
