from agents.base_agent import BaseAgent


class LineEditorAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="LineEditorAgent",
            role_description="Improves sentence-level clarity and flow.",
            system_prompt=(
                "You are an expert Line Editor. Focus on sentence-level mechanics: grammar, syntax, flow, and clarity. "
                "Improve sentence structures and remove grammatical errors without fundamentally changing the author's voice."
            ),
        )
