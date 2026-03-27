from agents.base_agent import BaseAgent

GATE_APPENDIX = """
You are also a quality gate. End your response with a JSON block in this exact format:
```json
{
  "passed": true,
  "reason": "one-sentence summary of your verdict",
  "revisions": ["specific revision instruction 1", "specific revision instruction 2"]
}
```
The thumbnail brief passes only if it is specific, visually distinct, and aligned with platform guidelines.
"""


class VisualCriticAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="VisualCriticAgent",
            role_description="Acts as the thumbnail and visual brief gate.",
            is_gate=True,
            system_prompt=(
                "You are the Visual Critic Agent. Review thumbnail and visual briefs for specificity, distinctiveness, "
                "clarity, and platform fit.\n\n"
                + GATE_APPENDIX
            ),
        )
