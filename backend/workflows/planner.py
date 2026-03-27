from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from workflows.artifact_contracts import ArtifactType


@dataclass
class PipelineStep:
    step_num: int
    workforce: str
    agent_id: str
    description: str
    artifact_type: Optional[str] = None
    requires_artifacts: list[str] = field(default_factory=list)
    is_gate: bool = False
    gate_input_artifact: Optional[str] = None


@dataclass
class StudioPlan:
    task: str
    pipeline_kind: str
    task_type: str
    steps: list[PipelineStep] = field(default_factory=list)
    estimated_tokens: int = 0
    metadata: dict = field(default_factory=dict)


PIPELINE_LIBRARY: dict[str, list[PipelineStep]] = {
    "writing": [
        PipelineStep(1, "writing", "outline", "Generate or revise the working outline", ArtifactType.OUTLINE.value),
        PipelineStep(
            2,
            "writing",
            "writer",
            "Draft the next scene from the outline",
            ArtifactType.SCENE_DRAFT.value,
            requires_artifacts=[ArtifactType.OUTLINE.value],
        ),
        PipelineStep(
            3,
            "writing",
            "critique",
            "Gate the draft for structural quality",
            ArtifactType.EDIT_PASS.value,
            requires_artifacts=[ArtifactType.SCENE_DRAFT.value],
            is_gate=True,
            gate_input_artifact=ArtifactType.SCENE_DRAFT.value,
        ),
        PipelineStep(
            4,
            "writing",
            "worldbuilding",
            "Gate the draft for continuity and canon",
            ArtifactType.CONTINUITY_RECORD.value,
            requires_artifacts=[ArtifactType.EDIT_PASS.value],
            is_gate=True,
            gate_input_artifact=ArtifactType.EDIT_PASS.value,
        ),
    ],
    "media": [
        PipelineStep(1, "media", "research", "Create a research brief", ArtifactType.RESEARCH_BRIEF.value),
        PipelineStep(
            2,
            "media",
            "scriptwriter",
            "Write the script",
            ArtifactType.SCRIPT.value,
            requires_artifacts=[ArtifactType.RESEARCH_BRIEF.value],
        ),
        PipelineStep(
            3,
            "media",
            "accuracy_reviewer",
            "Gate the script for educational accuracy and evidence discipline",
            ArtifactType.ACCURACY_REPORT.value,
            requires_artifacts=[ArtifactType.SCRIPT.value],
            is_gate=True,
            gate_input_artifact=ArtifactType.SCRIPT.value,
        ),
        PipelineStep(
            4,
            "media",
            "script_critic",
            "Gate the script quality",
            None,
            requires_artifacts=[ArtifactType.SCRIPT.value],
            is_gate=True,
            gate_input_artifact=ArtifactType.SCRIPT.value,
        ),
        PipelineStep(
            5,
            "media",
            "seo",
            "Generate SEO package",
            ArtifactType.SEO_PACKAGE.value,
            requires_artifacts=[ArtifactType.SCRIPT.value],
        ),
        PipelineStep(
            6,
            "media",
            "thumbnail_brief",
            "Generate thumbnail brief",
            ArtifactType.THUMBNAIL_BRIEF.value,
            requires_artifacts=[ArtifactType.SCRIPT.value],
        ),
        PipelineStep(
            7,
            "media",
            "visual_critic",
            "Gate the thumbnail brief",
            None,
            requires_artifacts=[ArtifactType.THUMBNAIL_BRIEF.value],
            is_gate=True,
            gate_input_artifact=ArtifactType.THUMBNAIL_BRIEF.value,
        ),
        PipelineStep(
            8,
            "media",
            "audio_planner",
            "Create the audio plan",
            ArtifactType.AUDIO_PLAN.value,
            requires_artifacts=[ArtifactType.SCRIPT.value],
        ),
        PipelineStep(
            9,
            "media",
            "assembly_planner",
            "Create the assembly plan",
            ArtifactType.ASSEMBLY_PLAN.value,
            requires_artifacts=[
                ArtifactType.SEO_PACKAGE.value,
                ArtifactType.THUMBNAIL_BRIEF.value,
                ArtifactType.AUDIO_PLAN.value,
            ],
        ),
        PipelineStep(
            10,
            "media",
            "brand_manager",
            "Gate the package against the brand bible",
            None,
            requires_artifacts=[ArtifactType.ASSEMBLY_PLAN.value],
            is_gate=True,
            gate_input_artifact=ArtifactType.ASSEMBLY_PLAN.value,
        ),
        PipelineStep(
            11,
            "media",
            "site_manager",
            "Prepare the publish package",
            ArtifactType.PUBLISH_PACKAGE.value,
            requires_artifacts=[ArtifactType.ASSEMBLY_PLAN.value],
        ),
    ],
    "review": [
        PipelineStep(1, "review", "review_planner", "Define the critical review brief", ArtifactType.REVIEW_BRIEF.value),
        PipelineStep(
            2,
            "media",
            "research",
            "Collect the evidence-oriented research brief",
            ArtifactType.RESEARCH_BRIEF.value,
            requires_artifacts=[ArtifactType.REVIEW_BRIEF.value],
        ),
        PipelineStep(
            3,
            "review",
            "reviewer_a",
            "Run the first independent critical review",
            ArtifactType.REVIEW_MODEL_A.value,
            requires_artifacts=[ArtifactType.REVIEW_BRIEF.value, ArtifactType.RESEARCH_BRIEF.value],
        ),
        PipelineStep(
            4,
            "review",
            "reviewer_b",
            "Run the second independent critical review",
            ArtifactType.REVIEW_MODEL_B.value,
            requires_artifacts=[ArtifactType.REVIEW_BRIEF.value, ArtifactType.RESEARCH_BRIEF.value],
        ),
        PipelineStep(
            5,
            "review",
            "synthesizer",
            "Synthesize the two reviewer artefacts into the canonical review",
            ArtifactType.REVIEW_SYNTHESIS.value,
            requires_artifacts=[
                ArtifactType.REVIEW_BRIEF.value,
                ArtifactType.RESEARCH_BRIEF.value,
                ArtifactType.REVIEW_MODEL_A.value,
                ArtifactType.REVIEW_MODEL_B.value,
            ],
        ),
        PipelineStep(
            6,
            "review",
            "publisher",
            "Package the review for CellNucleus website, YouTube, and NotebookLM",
            ArtifactType.PUBLISH_PACKAGE.value,
            requires_artifacts=[ArtifactType.REVIEW_SYNTHESIS.value],
        ),
    ],
    "promo": [
        PipelineStep(1, "promo", "campaign_planner", "Create the campaign plan", ArtifactType.PROMO_BRIEF.value),
        PipelineStep(
            2,
            "promo",
            "story_hook_extractor",
            "Extract promotional hooks",
            ArtifactType.STORY_HOOK_SET.value,
            requires_artifacts=[ArtifactType.PROMO_BRIEF.value],
        ),
        PipelineStep(
            3,
            "promo",
            "spoiler_guardian",
            "Gate the hooks for spoiler safety",
            ArtifactType.SPOILER_CLEARED_HOOKS.value,
            requires_artifacts=[ArtifactType.STORY_HOOK_SET.value],
            is_gate=True,
            gate_input_artifact=ArtifactType.STORY_HOOK_SET.value,
        ),
        PipelineStep(
            4,
            "promo",
            "promo_adapter",
            "Adapt cleared hooks into a promo calendar",
            ArtifactType.PROMO_CALENDAR.value,
            requires_artifacts=[ArtifactType.SPOILER_CLEARED_HOOKS.value],
        ),
    ],
}


class StudioPlanner:
    def create_plan(
        self,
        task: str,
        project_domains: list[str],
        pipeline_kind: Optional[str] = None,
        context: Optional[dict] = None,
    ) -> StudioPlan:
        selected = self._resolve_pipeline_kind(project_domains, pipeline_kind)
        base_steps = PIPELINE_LIBRARY[selected]
        steps = [
            PipelineStep(
                step_num=index,
                workforce=step.workforce,
                agent_id=step.agent_id,
                description=step.description,
                artifact_type=step.artifact_type,
                requires_artifacts=list(step.requires_artifacts),
                is_gate=step.is_gate,
                gate_input_artifact=step.gate_input_artifact,
            )
            for index, step in enumerate(base_steps, start=1)
        ]
        return StudioPlan(
            task=task,
            pipeline_kind=selected,
            task_type=f"{selected}_pipeline",
            steps=steps,
            estimated_tokens=len(steps) * 2000,
            metadata={"domains": list(project_domains), "context_keys": list((context or {}).keys())},
        )

    def create_custom_plan(
        self,
        task: str,
        project_domains: list[str],
        steps: list[PipelineStep],
        context: Optional[dict] = None,
        pipeline_kind: str = "custom",
    ) -> StudioPlan:
        if not steps:
            raise ValueError("Custom pipelines require at least one step.")

        normalized_steps = [
            PipelineStep(
                step_num=index,
                workforce=step.workforce,
                agent_id=step.agent_id,
                description=step.description,
                artifact_type=step.artifact_type,
                requires_artifacts=list(step.requires_artifacts),
                is_gate=step.is_gate,
                gate_input_artifact=step.gate_input_artifact,
            )
            for index, step in enumerate(steps, start=1)
        ]

        return StudioPlan(
            task=task,
            pipeline_kind=pipeline_kind,
            task_type="custom_pipeline",
            steps=normalized_steps,
            estimated_tokens=len(normalized_steps) * 2200,
            metadata={
                "domains": list(project_domains),
                "context_keys": list((context or {}).keys()),
                "custom_step_count": len(normalized_steps),
            },
        )

    def _resolve_pipeline_kind(self, project_domains: list[str], pipeline_kind: Optional[str]) -> str:
        if pipeline_kind:
            if not self._pipeline_kind_allowed(project_domains, pipeline_kind):
                raise ValueError(
                    f"Pipeline kind '{pipeline_kind}' is not valid for project domains {sorted(project_domains)}."
                )
            return pipeline_kind
        domain_set = set(project_domains)
        if "writing" in domain_set and ("web" in domain_set or "youtube" in domain_set):
            return "promo"
        if "writing" in domain_set:
            return "writing"
        if "web" in domain_set or "youtube" in domain_set:
            if pipeline_kind == "review":
                return "review"
        if "web" in domain_set or "youtube" in domain_set:
            return "media"
        raise ValueError("Could not infer pipeline kind from project domains.")

    def _pipeline_kind_allowed(self, project_domains: list[str], pipeline_kind: str) -> bool:
        domain_set = set(project_domains)
        if pipeline_kind == "writing":
            return "writing" in domain_set
        if pipeline_kind == "media":
            return "web" in domain_set or "youtube" in domain_set
        if pipeline_kind == "review":
            return "web" in domain_set or "youtube" in domain_set
        if pipeline_kind == "promo":
            return "writing" in domain_set and ("web" in domain_set or "youtube" in domain_set)
        return False
