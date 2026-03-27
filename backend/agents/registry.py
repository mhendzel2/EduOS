"""Workforce registry for EduOS."""
from __future__ import annotations

from agents.base_agent import BaseAgent
from agents.workforces.coordination import CoordinationDirectorAgent
from agents.workforces.media import (
    AssemblyPlannerAgent,
    AccuracyReviewerAgent,
    AudioPlannerAgent,
    BrandManagerAgent,
    ChannelBrandAgent,
    DistributionManagerAgent,
    MediaResearchAgent,
    SEOAgent,
    ShortsEditorAgent,
    ScriptCriticAgent,
    ScriptwriterAgent,
    SiteManagerAgent,
    ThumbnailBriefAgent,
    VideoCriticAgent,
    VideoEditorAgent,
    VisualCriticAgent,
)
from agents.workforces.promo import (
    CampaignPlannerAgent,
    PromoAdapterAgent,
    SpoilerGuardianAgent,
    StoryHookExtractorAgent,
)
from agents.workforces.review import (
    ReviewPlannerAgent,
    ReviewPublisherAgent,
    ReviewerAAgent,
    ReviewerBAgent,
    ReviewSynthesizerAgent,
)
from agents.workforces.writing import (
    CharacterArcAgent,
    CritiqueAgent,
    DevelopmentalEditorAgent,
    LineEditorAgent,
    ManuscriptIngestionAgent,
    NarrativeDevelopmentAgent,
    OutlineGeneratorAgent,
    StyleMonitorAgent,
    WorldbuildingAgent,
    WriterAgent,
)

WRITING_WORKFORCE: dict[str, BaseAgent] = {
    "ingestion": ManuscriptIngestionAgent(),
    "narrative": NarrativeDevelopmentAgent(),
    "character": CharacterArcAgent(),
    "worldbuilding": WorldbuildingAgent(),
    "outline": OutlineGeneratorAgent(),
    "writer": WriterAgent(),
    "developmental": DevelopmentalEditorAgent(),
    "critique": CritiqueAgent(),
    "line_editor": LineEditorAgent(),
    "style_monitor": StyleMonitorAgent(),
}

COORDINATION_WORKFORCE: dict[str, BaseAgent] = {
    "director": CoordinationDirectorAgent(),
}

MEDIA_WORKFORCE: dict[str, BaseAgent] = {
    "research": MediaResearchAgent(),
    "scriptwriter": ScriptwriterAgent(),
    "accuracy_reviewer": AccuracyReviewerAgent(),
    "script_critic": ScriptCriticAgent(),
    "video_critic": VideoCriticAgent(),
    "video_editor": VideoEditorAgent(),
    "shorts_editor": ShortsEditorAgent(),
    "channel_brand": ChannelBrandAgent(),
    "seo": SEOAgent(),
    "thumbnail_brief": ThumbnailBriefAgent(),
    "visual_critic": VisualCriticAgent(),
    "audio_planner": AudioPlannerAgent(),
    "assembly_planner": AssemblyPlannerAgent(),
    "brand_manager": BrandManagerAgent(),
    "distribution_manager": DistributionManagerAgent(),
    "site_manager": SiteManagerAgent(),
}

PROMO_WORKFORCE: dict[str, BaseAgent] = {
    "campaign_planner": CampaignPlannerAgent(),
    "story_hook_extractor": StoryHookExtractorAgent(),
    "spoiler_guardian": SpoilerGuardianAgent(),
    "promo_adapter": PromoAdapterAgent(),
}

REVIEW_WORKFORCE: dict[str, BaseAgent] = {
    "review_planner": ReviewPlannerAgent(),
    "reviewer_a": ReviewerAAgent(),
    "reviewer_b": ReviewerBAgent(),
    "synthesizer": ReviewSynthesizerAgent(),
    "publisher": ReviewPublisherAgent(),
}


def get_active_workforces(domains: list[str]) -> dict[str, dict[str, BaseAgent]]:
    domain_set = set(domains)
    workforces: dict[str, dict[str, BaseAgent]] = {"coordination": COORDINATION_WORKFORCE}

    if "writing" in domain_set:
        workforces["writing"] = WRITING_WORKFORCE
    if "web" in domain_set or "youtube" in domain_set:
        workforces["media"] = MEDIA_WORKFORCE
        workforces["review"] = REVIEW_WORKFORCE
    if "writing" in domain_set and ("web" in domain_set or "youtube" in domain_set):
        workforces["promo"] = PROMO_WORKFORCE

    return workforces


def get_gate_agents(domains: list[str]) -> dict[str, BaseAgent]:
    active = get_active_workforces(domains)
    gates: dict[str, BaseAgent] = {}
    for workforce_name, workforce in active.items():
        for agent_id, agent in workforce.items():
            if agent.is_gate:
                gates[f"{workforce_name}.{agent_id}"] = agent
    return gates
