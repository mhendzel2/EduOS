from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.youtube_feedback import extract_youtube_video_id, summarize_youtube_comments


def test_extract_youtube_video_id_accepts_common_url_shapes():
    assert extract_youtube_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert (
        extract_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        == "dQw4w9WgXcQ"
    )
    assert extract_youtube_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_extract_youtube_video_id_rejects_invalid_values():
    with pytest.raises(ValueError):
        extract_youtube_video_id("")

    with pytest.raises(ValueError):
        extract_youtube_video_id("https://www.youtube.com/watch?v=bad")


def test_summarize_youtube_comments_aggregates_engagement():
    summary = summarize_youtube_comments(
        "dQw4w9WgXcQ",
        [
            {
                "comment_id": "c1",
                "author_display_name": "Reviewer One",
                "author_channel_id": "author-1",
                "text": "The pacing is much stronger now.",
                "like_count": 12,
                "reply_count": 1,
                "published_at": "2026-03-20T00:00:00Z",
            },
            {
                "comment_id": "c2",
                "author_display_name": "Reviewer Two",
                "author_channel_id": "author-2",
                "text": "The title works, but the intro still drags.",
                "like_count": 7,
                "reply_count": 3,
                "published_at": "2026-03-21T00:00:00Z",
            },
        ],
    )

    assert summary["video_id"] == "dQw4w9WgXcQ"
    assert summary["comment_count"] == 2
    assert summary["unique_author_count"] == 2
    assert summary["total_like_count"] == 19
    assert summary["total_reply_count"] == 4
    assert summary["top_comments"][0]["comment_id"] == "c1"
