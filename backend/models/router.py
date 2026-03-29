"""ResearchAgent-style model routing for EduOS.

This module now wraps the central BaseOS model router while preserving
the EduOS-specific agent tier mappings.
"""
from __future__ import annotations

import logging
from typing import Optional

# Important: Add BaseOS to path for simple import without installation
import sys
from pathlib import Path
baseos_path = Path(__file__).resolve().parents[3] / "BaseOS"
if str(baseos_path) not in sys.path:
    sys.path.append(str(baseos_path))

from baseos.services.model_router import ModelRouter, ModelTier, RoutingDecision, RoutingStrategy

logger = logging.getLogger(__name__)


AGENT_TIER_MAP: dict[str, ModelTier] = {
    "coordination.director": ModelTier.REASONING,
    "media.research": ModelTier.BALANCED,
    "review.review_planner": ModelTier.REASONING,
    "review.reviewer_a": ModelTier.REASONING,
    "review.reviewer_b": ModelTier.REASONING,
    "review.synthesizer": ModelTier.LONG_CONTEXT,
    "review.publisher": ModelTier.BALANCED,
    "media.scriptwriter": ModelTier.REASONING,
    "media.accuracy_reviewer": ModelTier.REASONING,
    "media.script_critic": ModelTier.REASONING,
    "media.video_critic": ModelTier.REASONING,
    "media.video_editor": ModelTier.BALANCED,
    "media.shorts_editor": ModelTier.BALANCED,
    "media.channel_brand": ModelTier.BALANCED,
    "media.seo": ModelTier.FAST,
    "media.thumbnail_brief": ModelTier.BALANCED,
    "media.visual_critic": ModelTier.REASONING,
    "media.audio_planner": ModelTier.FAST,
    "media.assembly_planner": ModelTier.BALANCED,
    "media.brand_manager": ModelTier.REASONING,
    "media.distribution_manager": ModelTier.BALANCED,
    "media.site_manager": ModelTier.BALANCED,
    "promo.campaign_planner": ModelTier.BALANCED,
    "promo.story_hook_extractor": ModelTier.FAST,
    "promo.spoiler_guardian": ModelTier.REASONING,
    "promo.promo_adapter": ModelTier.FAST,
    "writing.ingestion": ModelTier.BALANCED,
    "writing.narrative": ModelTier.REASONING,
    "writing.character": ModelTier.BALANCED,
    "writing.worldbuilding": ModelTier.BALANCED,
    "writing.outline": ModelTier.BALANCED,
    "writing.writer": ModelTier.REASONING,
    "writing.developmental": ModelTier.REASONING,
    "writing.critique": ModelTier.REASONING,
    "writing.line_editor": ModelTier.BALANCED,
    "writing.style_monitor": ModelTier.FAST,
}

_shared_router: Optional[ModelRouter] = None

def get_model_router() -> ModelRouter:
    global _shared_router
    if _shared_router is None:
        import os
        config_path = os.getenv("MODEL_ROUTING_CONFIG_PATH", "./model_routing.json")
        _shared_router = ModelRouter(
            agent_tier_map=AGENT_TIER_MAP,
            app_name="EduOS",
            config_path=config_path
        )
    return _shared_router

def reset_model_router() -> None:
    global _shared_router
    _shared_router = None
