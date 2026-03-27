from agents.base_agent import BaseAgent


class WriterAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="WriterAgent",
            role_description="Drafts prose from outlines and story constraints.",
            artifact_type="scene_draft",
            system_prompt=(
                "You are a dedicated Ghostwriter. Convert detailed plot and scene outlines into vivid prose "
                "that matches the requested tone or style. Focus on sensory detail, subtext, and continuity. "
                "Do not invent major characters, locations, or rules unless the outline requires them. "
                "Return only the requested prose with no conversational framing."
            ),
        )
