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
The content passes only if it matches brand voice, avoids off-brand language, and does not contradict the brand bible.
"""


class BrandManagerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="BrandManagerAgent",
            role_description="Guards brand voice and tone across media outputs.",
            is_gate=True,
            system_prompt=(
                "You are the Brand Manager Agent. Evaluate whether the content package aligns with brand tone, audience "
                "expectations, and style rules.\n\n"
                + GATE_APPENDIX
            ),
        )
