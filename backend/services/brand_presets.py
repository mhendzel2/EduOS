from __future__ import annotations

from copy import deepcopy
from typing import Any

from config import settings


CELLNUCLEUS_PRESET: dict[str, Any] = {
    "slug": "cellnucleus",
    "name": "CellNucleus",
    "description": (
        "Default educational publishing preset for CellNucleus, pairing a rigorous biology website "
        "with a companion YouTube channel."
    ),
    "brand_bible": {
        "brand_name": "CellNucleus",
        "voice_tone": (
            "Clear, rigorous, evidence-aware, and visually teachable. Explain with confidence where the "
            "evidence is solid and slow down when the field is unsettled."
        ),
        "style_guide": {
            "website": "Lead with the mechanistic claim, state the evidence standard, and end with what remains unresolved.",
            "youtube": "Use a strong hook, but never oversell certainty or flatten competing models into a single story.",
            "citations": "Prefer primary literature, explicitly flag review-only support, and separate established findings from active hypotheses.",
            "editorial": "Write for advanced learners without unnecessary jargon and define terms the first time they appear.",
        },
        "audience_personas": [
            {
                "name": "advanced_biology_learner",
                "description": "Undergraduate or graduate learner seeking mechanistic clarity without hype.",
                "content_preferences": [
                    "stepwise explanations",
                    "evidence-backed claims",
                    "clear diagrams and visual analogies",
                ],
            },
            {
                "name": "research_curious_professional",
                "description": "Scientist, clinician, or technically literate viewer who wants a fast but rigorous update.",
                "content_preferences": [
                    "critical reviews of major hypotheses",
                    "direct caveats",
                    "citations and unresolved questions",
                ],
            },
        ],
        "off_brand_examples": [
            "Calling unsettled mechanisms proven.",
            "Using in vitro droplet behavior alone as decisive in vivo evidence.",
            "Clickbait titles that promise certainty the literature does not support.",
            "Generic motivational language instead of mechanistic teaching.",
        ],
        "published_content_index": [],
        "primary_site_url": "https://www.cellnucleus.com",
        "youtube_channel_name": "CellNucleus",
        "editorial_mission": (
            "Turn major cell and molecular biology questions into rigorous educational reviews and supporting media."
        ),
        "review_policy": {
            "default_series": "critical_hypothesis_review",
            "evidence_standard": (
                "Treat morphology, FRAP, IDR prediction, and in vitro condensates as suggestive unless causally tied to in vivo function."
            ),
            "publication_rule": "Store individual reviewer artefacts and state where the evidence is insufficient.",
        },
        "distribution_targets": {
            "website": ["feature article", "supporting references", "linked graphics"],
            "youtube": ["long-form explainer", "description references", "chaptered timestamps"],
            "notebooklm": ["source-ready synthesis brief"],
        },
    },
}

BRAND_PRESETS: dict[str, dict[str, Any]] = {
    CELLNUCLEUS_PRESET["slug"]: CELLNUCLEUS_PRESET,
}


def _deep_merge_defaults(defaults: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(defaults)
    for key, value in (overrides or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_defaults(merged[key], value)
        else:
            merged[key] = value
    return merged


def get_brand_preset(slug: str) -> dict[str, Any]:
    key = (slug or "").strip().lower()
    if key not in BRAND_PRESETS:
        raise KeyError(key)
    return deepcopy(BRAND_PRESETS[key])


def list_brand_presets() -> list[dict[str, Any]]:
    presets: list[dict[str, Any]] = []
    for preset in BRAND_PRESETS.values():
        brand_bible = preset.get("brand_bible", {})
        presets.append(
            {
                "slug": preset["slug"],
                "name": preset["name"],
                "description": preset["description"],
                "brand_name": brand_bible.get("brand_name", preset["name"]),
                "primary_site_url": brand_bible.get("primary_site_url", ""),
                "youtube_channel_name": brand_bible.get("youtube_channel_name", ""),
            }
        )
    return presets


def seed_brand_bible(
    brand_bible: dict[str, Any] | None,
    *,
    preset_slug: str | None = None,
) -> dict[str, Any]:
    slug = (preset_slug or settings.DEFAULT_BRAND_PRESET or "").strip().lower()
    if not slug or slug not in BRAND_PRESETS:
        return dict(brand_bible or {})
    defaults = get_brand_preset(slug).get("brand_bible", {})
    return _deep_merge_defaults(defaults, dict(brand_bible or {}))
