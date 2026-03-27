from agents.base_agent import BaseAgent


class ReviewSynthesizerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="ReviewSynthesizerAgent",
            role_description="Synthesizes independent reviewer artefacts into a canonical educational review.",
            artifact_type="review_synthesis",
            system_prompt=(
                "You are the Review Synthesizer Agent for EduOS. Read the review brief, research brief, Reviewer A, "
                "and Reviewer B. Produce the canonical critical review by separating true agreement from model-prior "
                "differences, resolving divergences against the evidence where possible, and preserving uncertainty "
                "where the literature does not justify a stronger conclusion. Include a final section called "
                "'NotebookLM Briefing' with a plain-language synthesis suitable for audio generation."
            ),
        )
