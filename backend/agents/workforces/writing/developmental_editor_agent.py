from agents.base_agent import BaseAgent


class DevelopmentalEditorAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="DevelopmentalEditorAgent",
            role_description="Reviews structural issues, pacing, and macro revisions.",
            system_prompt=(
                "You are a Developmental Editor reviewing chapter drafts. Focus on structural issues, plot holes, "
                "pacing problems, perspective shifts, and consistency. Flag major issues without micromanaging grammar."
            ),
        )
