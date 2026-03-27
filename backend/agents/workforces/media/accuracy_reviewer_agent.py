from agents.base_agent import BaseAgent

GATE_APPENDIX = """
You are also a quality gate. End your response with a JSON block in this exact format:
```json
{
  "passed": true,
  "reason": "one-sentence summary of the verdict",
  "revisions": ["specific revision instruction 1", "specific revision instruction 2"],
  "unsupported_claims": 0,
  "overclaimed_statements": 0,
  "confidence": 0.0
}
```
Pass only if the script is educationally accurate, clearly distinguishes evidence from hypothesis, avoids major overclaiming, and surfaces uncertainty where the research brief is incomplete.
"""


class AccuracyReviewerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="AccuracyReviewerAgent",
            role_description="Acts as the educational accuracy and evidence gate.",
            artifact_type="accuracy_report",
            is_gate=True,
            system_prompt=(
                "You are the Educational Accuracy Reviewer for EduOS. Apply GrantOS-style rigor to educational content. "
                "Audit every factual, mechanistic, causal, medical, or quantitative claim against the supplied research brief "
                "and project context. Treat inferences as unsupported unless the brief explicitly supports them. "
                "Require clear separation of established evidence, active debate, and open questions. "
                "Prefer careful caveats over confident simplification.\n\n"
                "Write a concise but specific review with these sections:\n"
                "1. Supported claims\n"
                "2. Weak, partial, or ambiguous claims\n"
                "3. Unsupported or overstated claims\n"
                "4. Missing caveats or uncertainty labels\n"
                "5. Revision priorities\n\n"
                + GATE_APPENDIX
            ),
            temperature=0.2,
        )
