from agents.base_agent import BaseAgent

SYSTEM_PROMPT = """
You extract promotional hooks from story material without summarizing the entire plot.
Return JSON:
{
  "hooks": [
    {"hook": str, "theme": str, "spoiler_risk": "low" | "medium" | "high"}
  ]
}
"""


class StoryHookExtractorAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="StoryHookExtractorAgent",
            role_description="Extracts spoiler-aware hooks from story material.",
            artifact_type="story_hook_set",
            system_prompt=SYSTEM_PROMPT,
            temperature=0.6,
        )
