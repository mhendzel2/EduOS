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
The script passes only if it has a strong hook, a clear narrative arc, appropriate length, and matches brand voice.
"""


class ScriptCriticAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="ScriptCriticAgent",
            role_description="Acts as the script quality gate.",
            is_gate=True,
            system_prompt=(
                "You are the Script Critic Agent. Review a script for hook strength, viewer retention, pacing, clarity, "
                "and coherence before production begins. Respect accuracy constraints already surfaced by the educational "
                "accuracy review and avoid rewarding unsupported hype.\n\n"
                + GATE_APPENDIX
            ),
        )
