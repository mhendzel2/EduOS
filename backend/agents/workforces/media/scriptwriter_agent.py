from agents.base_agent import BaseAgent


class ScriptwriterAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="ScriptwriterAgent",
            role_description="Writes scripts from the research brief.",
            artifact_type="script",
            system_prompt=(
                "You are the Scriptwriter Agent for EduOS. Generate a complete, engaging educational script from the "
                "provided research brief. Include a hook, narrative arc, clear transitions, and audience payoff, but do "
                "not overstate evidence. If the brief marks a point as uncertain, debated, or hypothesis-level, preserve "
                "that uncertainty explicitly in the script rather than presenting it as settled fact."
            ),
            temperature=0.6,
        )
