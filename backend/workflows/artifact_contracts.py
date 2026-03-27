"""
Studio OS Artifact Taxonomy.
Defines valid artifact types per domain and their required/produced contracts.
"""
from __future__ import annotations

from enum import Enum
from typing import List

from pydantic import BaseModel, Field


class ArtifactType(str, Enum):
    INGESTION_REPORT = "ingestion_report"
    MANUSCRIPT_CHUNK = "manuscript_chunk"
    CHARACTER_BIBLE = "character_bible"
    CONTINUITY_RECORD = "continuity_record"
    OUTLINE = "outline"
    SCENE_DRAFT = "scene_draft"
    EDIT_PASS = "edit_pass"

    RESEARCH_BRIEF = "research_brief"
    SCRIPT = "script"
    ACCURACY_REPORT = "accuracy_report"
    SEO_PACKAGE = "seo_package"
    THUMBNAIL_BRIEF = "thumbnail_brief"
    AUDIO_PLAN = "audio_plan"
    EXECUTION_BRIEF = "execution_brief"
    VIDEO_CRITIQUE = "video_critique"
    VIDEO_EDIT_PLAN = "video_edit_plan"
    SHORTS_EDIT_PLAN = "shorts_edit_plan"
    CHANNEL_BRANDING_PACKAGE = "channel_branding_package"
    ASSEMBLY_PLAN = "assembly_plan"
    DISTRIBUTION_PACKAGE = "distribution_package"
    PUBLISH_PACKAGE = "publish_package"

    PROMO_BRIEF = "promo_brief"
    STORY_HOOK_SET = "story_hook_set"
    SPOILER_CLEARED_HOOKS = "spoiler_cleared_hooks"
    PROMO_CALENDAR = "promo_calendar"

    MULTIMODAL_FRAME_MANIFEST = "multimodal_frame_manifest"
    MULTIMODAL_TRANSCRIPT_CACHE = "multimodal_transcript_cache"


DOMAIN_ARTIFACTS = {
    "writing": [
        ArtifactType.INGESTION_REPORT,
        ArtifactType.MANUSCRIPT_CHUNK,
        ArtifactType.CHARACTER_BIBLE,
        ArtifactType.CONTINUITY_RECORD,
        ArtifactType.OUTLINE,
        ArtifactType.SCENE_DRAFT,
        ArtifactType.EDIT_PASS,
    ],
    "web": [
        ArtifactType.EXECUTION_BRIEF,
        ArtifactType.RESEARCH_BRIEF,
        ArtifactType.SCRIPT,
        ArtifactType.ACCURACY_REPORT,
        ArtifactType.SEO_PACKAGE,
        ArtifactType.THUMBNAIL_BRIEF,
        ArtifactType.AUDIO_PLAN,
        ArtifactType.VIDEO_CRITIQUE,
        ArtifactType.VIDEO_EDIT_PLAN,
        ArtifactType.SHORTS_EDIT_PLAN,
        ArtifactType.CHANNEL_BRANDING_PACKAGE,
        ArtifactType.ASSEMBLY_PLAN,
        ArtifactType.DISTRIBUTION_PACKAGE,
        ArtifactType.PUBLISH_PACKAGE,
        ArtifactType.MULTIMODAL_FRAME_MANIFEST,
        ArtifactType.MULTIMODAL_TRANSCRIPT_CACHE,
    ],
    "youtube": [
        ArtifactType.EXECUTION_BRIEF,
        ArtifactType.RESEARCH_BRIEF,
        ArtifactType.SCRIPT,
        ArtifactType.ACCURACY_REPORT,
        ArtifactType.SEO_PACKAGE,
        ArtifactType.THUMBNAIL_BRIEF,
        ArtifactType.AUDIO_PLAN,
        ArtifactType.VIDEO_CRITIQUE,
        ArtifactType.VIDEO_EDIT_PLAN,
        ArtifactType.SHORTS_EDIT_PLAN,
        ArtifactType.CHANNEL_BRANDING_PACKAGE,
        ArtifactType.ASSEMBLY_PLAN,
        ArtifactType.DISTRIBUTION_PACKAGE,
        ArtifactType.PUBLISH_PACKAGE,
        ArtifactType.MULTIMODAL_FRAME_MANIFEST,
        ArtifactType.MULTIMODAL_TRANSCRIPT_CACHE,
    ],
    "promo": [
        ArtifactType.PROMO_BRIEF,
        ArtifactType.STORY_HOOK_SET,
        ArtifactType.SPOILER_CLEARED_HOOKS,
        ArtifactType.PROMO_CALENDAR,
    ],
}


class ArtifactContract(BaseModel):
    artifact_type: ArtifactType
    requires: List[ArtifactType] = Field(default_factory=list)
    produces: ArtifactType
    is_gate: bool = False
    gate_blocks_on_fail: bool = False


WRITING_PIPELINE_CONTRACTS: List[ArtifactContract] = [
    ArtifactContract(artifact_type=ArtifactType.OUTLINE, requires=[], produces=ArtifactType.OUTLINE),
    ArtifactContract(
        artifact_type=ArtifactType.SCENE_DRAFT,
        requires=[ArtifactType.OUTLINE],
        produces=ArtifactType.SCENE_DRAFT,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.EDIT_PASS,
        requires=[ArtifactType.SCENE_DRAFT],
        produces=ArtifactType.EDIT_PASS,
        is_gate=True,
        gate_blocks_on_fail=True,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.CONTINUITY_RECORD,
        requires=[ArtifactType.EDIT_PASS],
        produces=ArtifactType.CONTINUITY_RECORD,
        is_gate=True,
        gate_blocks_on_fail=True,
    ),
]


MEDIA_PIPELINE_CONTRACTS: List[ArtifactContract] = [
    ArtifactContract(
        artifact_type=ArtifactType.EXECUTION_BRIEF,
        requires=[],
        produces=ArtifactType.EXECUTION_BRIEF,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.RESEARCH_BRIEF,
        requires=[],
        produces=ArtifactType.RESEARCH_BRIEF,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.SCRIPT,
        requires=[ArtifactType.RESEARCH_BRIEF],
        produces=ArtifactType.SCRIPT,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.ACCURACY_REPORT,
        requires=[ArtifactType.SCRIPT],
        produces=ArtifactType.ACCURACY_REPORT,
        is_gate=True,
        gate_blocks_on_fail=True,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.SCRIPT,
        requires=[ArtifactType.SCRIPT],
        produces=ArtifactType.SCRIPT,
        is_gate=True,
        gate_blocks_on_fail=True,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.SEO_PACKAGE,
        requires=[ArtifactType.SCRIPT],
        produces=ArtifactType.SEO_PACKAGE,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.THUMBNAIL_BRIEF,
        requires=[ArtifactType.SCRIPT],
        produces=ArtifactType.THUMBNAIL_BRIEF,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.THUMBNAIL_BRIEF,
        requires=[ArtifactType.THUMBNAIL_BRIEF],
        produces=ArtifactType.THUMBNAIL_BRIEF,
        is_gate=True,
        gate_blocks_on_fail=True,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.AUDIO_PLAN,
        requires=[ArtifactType.SCRIPT],
        produces=ArtifactType.AUDIO_PLAN,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.VIDEO_CRITIQUE,
        requires=[ArtifactType.SCRIPT],
        produces=ArtifactType.VIDEO_CRITIQUE,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.VIDEO_EDIT_PLAN,
        requires=[ArtifactType.SCRIPT, ArtifactType.VIDEO_CRITIQUE],
        produces=ArtifactType.VIDEO_EDIT_PLAN,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.SHORTS_EDIT_PLAN,
        requires=[ArtifactType.SCRIPT, ArtifactType.VIDEO_CRITIQUE],
        produces=ArtifactType.SHORTS_EDIT_PLAN,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.CHANNEL_BRANDING_PACKAGE,
        requires=[ArtifactType.VIDEO_EDIT_PLAN, ArtifactType.SHORTS_EDIT_PLAN],
        produces=ArtifactType.CHANNEL_BRANDING_PACKAGE,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.ASSEMBLY_PLAN,
        requires=[
            ArtifactType.SEO_PACKAGE,
            ArtifactType.AUDIO_PLAN,
            ArtifactType.THUMBNAIL_BRIEF,
            ArtifactType.VIDEO_EDIT_PLAN,
            ArtifactType.SHORTS_EDIT_PLAN,
            ArtifactType.CHANNEL_BRANDING_PACKAGE,
        ],
        produces=ArtifactType.ASSEMBLY_PLAN,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.DISTRIBUTION_PACKAGE,
        requires=[ArtifactType.ASSEMBLY_PLAN],
        produces=ArtifactType.DISTRIBUTION_PACKAGE,
    ),
    ArtifactContract(
        artifact_type=ArtifactType.PUBLISH_PACKAGE,
        requires=[ArtifactType.DISTRIBUTION_PACKAGE],
        produces=ArtifactType.PUBLISH_PACKAGE,
    ),
]
