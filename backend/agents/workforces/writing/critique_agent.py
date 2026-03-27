from agents.base_agent import BaseAgent

GATE_APPENDIX = """
You are also a quality gate. After your critique, you MUST end your response with a JSON block in this exact format:
```json
{
  "passed": true,
  "reason": "one-sentence summary of your verdict",
  "revisions": ["specific revision instruction 1", "specific revision instruction 2"]
}
```
A scene passes if it is structurally coherent, character-consistent, and advances the story.
It fails if it has major plot holes, contradicts the character bible, or breaks narrative continuity.
"""


class CritiqueAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="CritiqueAgent",
            role_description="Acts as the writing quality gate before continuity approval.",
            artifact_type="edit_pass",
            is_gate=True,
            system_prompt=(
                "You are a Senior Acquisitions Editor acting as a Critique Agent. Review the draft for structural "
                "coherence, emotional integrity, character consistency, and narrative momentum. Provide a clear "
                "risk/benefit analysis of major revisions.\n\n"
                + GATE_APPENDIX
            ),
        )
