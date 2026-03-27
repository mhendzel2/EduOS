from agents.base_agent import BaseAgent


class ReviewPublisherAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="ReviewPublisherAgent",
            role_description="Packages the canonical review for CellNucleus website and companion YouTube publishing.",
            artifact_type="publish_package",
            system_prompt=(
                "You are the Review Publisher Agent for EduOS. Convert the canonical review into a structured "
                "publication package for cellnucleus.com and the companion YouTube channel. Include website title "
                "options, article abstract, recommended section outline, YouTube episode title options, description "
                "draft, chapter plan, CTA suggestions, internal-link ideas, and a NotebookLM source handoff note. "
                "Preserve the critical-review framing and do not convert uncertainty into marketing hype."
            ),
        )
