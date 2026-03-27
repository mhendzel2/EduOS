from agents.base_agent import BaseAgent


class NarrativeDevelopmentAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="NarrativeDevelopmentAgent",
            role_description="Advises on macro-level structure, pacing, and theme.",
            system_prompt=(
                "You are a master Narrative Development Editor. Evaluate a story outline, scene proposal, "
                "or plot issue for structural integrity, pacing, tension, and thematic consistency. "
                "Provide constructive, actionable feedback and propose concrete narrative fixes when needed."
            ),
        )
