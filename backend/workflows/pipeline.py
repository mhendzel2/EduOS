from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Optional

from agents.base_agent import AgentRequest
from config import settings
from database_models import ProjectRecord
from services.media_tools import get_project_media_tools_context
from services.memory import get_memory_context, update_bibles_from_artifact
from services.orchestration import persist_artifact
from services.review_models import build_review_agent_model_overrides
from workflows.gate import evaluate_gate
from workflows.planner import PipelineStep, StudioPlan
from workflows.state import SharedState


@dataclass
class PipelineResult:
    plan: StudioPlan
    results: list[dict[str, Any]] = field(default_factory=list)
    final_output: str = ""
    success: bool = True
    errors: list[str] = field(default_factory=list)


class StudioPipeline:
    async def execute_pipeline(
        self,
        plan: StudioPlan,
        project: ProjectRecord,
        db,
        workforces: dict[str, dict],
        gates: dict[str, Any],
        run_id: Optional[str] = None,
        context: Optional[dict] = None,
        event_callback: Optional[Callable[[str, dict], Awaitable[None]]] = None,
    ) -> PipelineResult:
        state = SharedState(task=plan.task, context=context or {})
        result = PipelineResult(plan=plan)
        current_context = dict(context or {})
        if plan.pipeline_kind == "review":
            current_context["agent_model_overrides"] = {
                **dict(current_context.get("agent_model_overrides") or {}),
                **build_review_agent_model_overrides(),
            }

        for step in plan.steps:
            missing = [artifact for artifact in step.requires_artifacts if artifact not in state.artifacts]
            if missing:
                error = f"Missing required artifacts for {step.workforce}.{step.agent_id}: {missing}"
                result.errors.append(error)
                result.success = False
                if event_callback:
                    await event_callback(
                        "pipeline.step.failed",
                        {"step_num": step.step_num, "agent": f"{step.workforce}.{step.agent_id}", "error": error},
                    )
                break

            if event_callback:
                await event_callback(
                    "pipeline.step.started",
                    {
                        "step_num": step.step_num,
                        "agent": f"{step.workforce}.{step.agent_id}",
                        "description": step.description,
                    },
                )

            agent = workforces[step.workforce][step.agent_id]
            agent_context = {
                **current_context,
                **get_memory_context(project, db=db),
                **get_project_media_tools_context(project, db=db),
                "project_id": project.id,
                "project_name": project.name,
                "project_description": project.description,
                "domains": list(project.domains or []),
                "artifacts": dict(state.artifacts),
                "pipeline_kind": plan.pipeline_kind,
                "agent_slug": f"{step.workforce}.{step.agent_id}",
                "requested_agent": f"{step.workforce}.{step.agent_id}",
            }
            agent_input = self._build_agent_input(plan.task, step, state)

            response = await agent.process(
                AgentRequest(
                    session_id=run_id or project.id,
                    user_input=agent_input,
                    context=agent_context,
                )
            )

            step_payload = {
                "step_num": step.step_num,
                "agent": f"{step.workforce}.{step.agent_id}",
                "description": step.description,
                "artifact_type": step.artifact_type,
                "content": response.content,
                "metadata": response.metadata,
                "is_gate": step.is_gate,
            }

            if step.is_gate:
                source_artifact = state.artifacts.get(step.gate_input_artifact or "", response.content)
                gate_result = await evaluate_gate(
                    gate_agent=agent,
                    artifact_content=source_artifact,
                    artifact_type=step.gate_input_artifact or step.artifact_type or "gate_input",
                    project_context=agent_context,
                    story_bible=project.story_bible or {},
                    brand_bible=project.brand_bible or {},
                )
                step_payload["gate_result"] = gate_result.model_dump()

                if event_callback:
                    await event_callback(
                        "pipeline.gate.completed",
                        {
                            "step_num": step.step_num,
                            "agent": f"{step.workforce}.{step.agent_id}",
                            "verdict": gate_result.verdict.model_dump(),
                        },
                    )

                if not gate_result.verdict.passed and gate_result.verdict.blocking:
                    result.errors.append(gate_result.verdict.reason)
                    result.success = False
                    result.results.append(step_payload)
                    if event_callback:
                        await event_callback(
                            "pipeline.gate.failed",
                            {
                                "step_num": step.step_num,
                                "agent": f"{step.workforce}.{step.agent_id}",
                                "reason": gate_result.verdict.reason,
                                "revisions": gate_result.verdict.revisions,
                            },
                        )
                    break

            if step.artifact_type:
                artifact = persist_artifact(
                    db=db,
                    project_id=project.id,
                    run_id=run_id,
                    artifact_type=step.artifact_type,
                    content=response.content,
                    metadata={
                        "agent": f"{step.workforce}.{step.agent_id}",
                        "step_num": step.step_num,
                        "pipeline_kind": plan.pipeline_kind,
                        **response.metadata,
                    },
                )
                state.update(step.artifact_type, response.content, f"{step.workforce}.{step.agent_id}")
                step_payload["artifact_id"] = artifact.id
                if settings.BIBLE_AUTO_UPDATE:
                    update_bibles_from_artifact(project, step.artifact_type, response.content)
                    db.add(project)
                    db.commit()
                    db.refresh(project)

            result.results.append(step_payload)
            result.final_output = response.content

            if event_callback:
                await event_callback(
                    "pipeline.step.completed",
                    {
                        "step_num": step.step_num,
                        "agent": f"{step.workforce}.{step.agent_id}",
                        "artifact_type": step.artifact_type,
                        "is_gate": step.is_gate,
                    },
                )

        if result.errors:
            result.success = False
        return result

    def _build_agent_input(self, task: str, step: PipelineStep, state: SharedState) -> str:
        if step.gate_input_artifact:
            artifact_content = state.artifacts.get(step.gate_input_artifact, "")
            return artifact_content or task
        if step.requires_artifacts:
            sections = [task]
            for artifact in step.requires_artifacts:
                if artifact in state.artifacts:
                    sections.append(f"[{artifact}]\n{state.artifacts[artifact]}")
            return "\n\n".join(sections)
        return task
