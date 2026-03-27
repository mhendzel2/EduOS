"""
Analytics agents — NOT YET IMPLEMENTED.
"""
from agents.base_agent import BaseAgent

NOT_IMPLEMENTED_SYSTEM_PROMPT = """
You are a planning agent for analytics integrations. You do NOT have access to real platform data.
Return a JSON object describing:
1. What data source would be required
2. Which metrics would be pulled
3. The expected query shape
4. Recommended actions once real data becomes available
Always make clear this is a planning response, not real analytics.
"""


class TrafficAnalystStub(BaseAgent):
    NOT_IMPLEMENTED = True

    def __init__(self):
        super().__init__(
            name="TrafficAnalystStub",
            role_description="Describes future YouTube/GA traffic data needs.",
            system_prompt=NOT_IMPLEMENTED_SYSTEM_PROMPT,
        )


class TrendMonitorStub(BaseAgent):
    NOT_IMPLEMENTED = True

    def __init__(self):
        super().__init__(
            name="TrendMonitorStub",
            role_description="Describes future trend-monitoring data needs.",
            system_prompt=NOT_IMPLEMENTED_SYSTEM_PROMPT,
        )
