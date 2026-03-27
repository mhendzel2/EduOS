from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from typing import Optional

from workflows.pipeline import PipelineResult
from workflows.planner import StudioPlan


class CoordinatorError(Exception):
    pass


class UnknownAgentError(CoordinatorError):
    pass


class CoordinatorConfigError(CoordinatorError):
    pass


class BaseCoordinator(ABC):
    provider = "unknown"

    @abstractmethod
    def build_plan(
        self,
        task: str,
        project_domains: list[str],
        pipeline_kind: Optional[str] = None,
        context: Optional[dict] = None,
    ) -> StudioPlan:
        raise NotImplementedError

    @abstractmethod
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
        raise NotImplementedError
