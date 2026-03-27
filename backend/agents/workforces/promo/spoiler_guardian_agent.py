from agents.base_agent import BaseAgent

SYSTEM_PROMPT = """
You are the Spoiler Guardian. Review proposed promotional hooks and determine whether they reveal unsafe plot details.
End your response with a JSON block in this exact format:
```json
{
  "passed": true,
  "reason": "one-sentence summary of your verdict",
  "revisions": ["specific revision instruction 1", "specific revision instruction 2"]
}
```
Only pass if the hooks preserve anticipation without exposing twists, reveals, or late-stage outcomes.
"""


class SpoilerGuardianAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="SpoilerGuardianAgent",
            role_description="Acts as the spoiler-clearance gate for promo hooks.",
            artifact_type="spoiler_cleared_hooks",
            system_prompt=SYSTEM_PROMPT,
            is_gate=True,
            temperature=0.4,
        )
