from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Optional

from agents.registry import get_active_workforces, get_gate_agents
from workflows.pipeline import PipelineResult, StudioPipeline
from workflows.planner import PipelineStep, StudioPlan, StudioPlanner

from .base import BaseCoordinator


class LocalCoordinator(BaseCoordinator):
    provider = "local"

    def __init__(self):
        self.planner = StudioPlanner()
        self.pipeline = StudioPipeline()

    def _build_workforce_context(self, project_domains: list[str]) -> dict:
        workforces = get_active_workforces(project_domains)
        gates = get_gate_agents(project_domains)
        return {"workforces": workforces, "gates": gates}

    def build_plan(
        self,
        task: str,
        project_domains: list[str],
        pipeline_kind: Optional[str] = None,
        context: Optional[dict] = None,
    ) -> StudioPlan:
        return self.planner.create_plan(
            task=task,
            project_domains=project_domains,
            pipeline_kind=pipeline_kind,
            context=context,
        )

    def build_custom_plan(
        self,
        task: str,
        project_domains: list[str],
        steps: list[PipelineStep],
        context: Optional[dict] = None,
    ) -> StudioPlan:
        return self.planner.create_custom_plan(
            task=task,
            project_domains=project_domains,
            steps=steps,
            context=context,
        )

    async def run_pipeline(
        self,
        task: str,
        project,
        db,
        run_id: Optional[str] = None,
        pipeline_kind: Optional[str] = None,
        context: Optional[dict] = None,
        event_callback: Optional[Callable[[str, dict], Awaitable[None]]] = None,
    ) -> PipelineResult:
        plan = self.build_plan(
            task=task,
            project_domains=list(project.domains or []),
            pipeline_kind=pipeline_kind,
            context=context,
        )
        workforce_context = self._build_workforce_context(list(project.domains or []))
        return await self.pipeline.execute_pipeline(
            plan=plan,
            project=project,
            db=db,
            run_id=run_id,
            workforces=workforce_context["workforces"],
            gates=workforce_context["gates"],
            context=context or {},
            event_callback=event_callback,
        )

    async def run_custom_pipeline(
        self,
        task: str,
        steps: list[PipelineStep],
        project,
        db,
        run_id: Optional[str] = None,
        context: Optional[dict] = None,
        event_callback: Optional[Callable[[str, dict], Awaitable[None]]] = None,
    ) -> PipelineResult:
        plan = self.build_custom_plan(
            task=task,
            project_domains=list(project.domains or []),
            steps=steps,
            context=context,
        )
        workforce_context = self._build_workforce_context(list(project.domains or []))
        return await self.pipeline.execute_pipeline(
            plan=plan,
            project=project,
            db=db,
            run_id=run_id,
            workforces=workforce_context["workforces"],
            gates=workforce_context["gates"],
            context=context or {},
            event_callback=event_callback,
        )
