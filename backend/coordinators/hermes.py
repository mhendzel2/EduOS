from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Optional, Sequence

from agents.base_agent import AgentResult
from config import settings
from workflows.pipeline import PipelineResult
from workflows.planner import ResearchPlanner

from .base import BaseCoordinator

logger = logging.getLogger(__name__)

class HermesCoordinator(BaseCoordinator):
    """
    Opt-In coordinator that acts as a bridge to the Hermes Agent runtime,
    offloading rigid orchestrations natively to its self-improving core.
    """
    provider = "hermes"

    def __init__(self, model_client: Any = None):
        planner = ResearchPlanner(model_client=model_client)
        super().__init__(planner=planner)

    async def execute_task(
        self,
        task: str,
        context: Optional[dict] = None,
        agent_name: str = "hermes",
        event_callback: Optional[Callable] = None,
    ) -> AgentResult:
        """Invokes Hermes runtime via subprocess/CLI to execute the prompt natively."""
        effective_context = dict(context or {})
        
        if event_callback:
            await event_callback("task.agent.started", {"agent": "hermes"})

        try:
            # We communicate with Hermes CLI natively. 
            # In production, this would be an API call if gateway is setup.
            proc = await asyncio.create_subprocess_exec(
                "hermes", "run", "--prompt", task,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            
            output = stdout.decode().strip()
            err_output = stderr.decode().strip()

            if proc.returncode != 0:
                raise RuntimeError(f"Hermes failed: {err_output}")

            result = AgentResult(
                success=True,
                content=output,
                agent_name="hermes",
                model_used=settings.HERMES_DEFAULT_MODEL if hasattr(settings, "HERMES_DEFAULT_MODEL") else "gemma4",
                metadata={"hermes_raw": output}
            )

        except Exception as exc:
            if event_callback:
                await event_callback("task.agent.failed", {"agent": "hermes", "error": str(exc)})
            raise

        if event_callback:
            await event_callback(
                "task.agent.completed",
                {
                    "agent": "hermes",
                    "success": result.success,
                    "model_used": result.model_used,
                },
            )
        return result

    async def run_pipeline(
        self,
        task: str,
        context: Optional[dict] = None,
        steps_override: Optional[Sequence[str]] = None,
        event_callback: Optional[Callable] = None,
    ) -> PipelineResult:
        """
        Placeholder for when hermes directly supersedes entire pipeline routing.
        For now, this delegates to single task executions wrapped as a pipeline.
        """
        agent_res = await self.execute_task(task, context=context, event_callback=event_callback)
        return PipelineResult(
            success=agent_res.success,
            final_output=agent_res.content,
            results={"_shared_state": {}},
            errors=[agent_res.error] if not agent_res.success else [],
            plan=self.build_plan(task, context, steps_override)
        )
