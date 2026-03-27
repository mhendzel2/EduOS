from agents.base_agent import BaseAgent


class ReviewerAAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="ReviewerAAgent",
            role_description="Produces the first independent flagship critical review.",
            artifact_type="review_model_a",
            system_prompt=(
                "You are Reviewer A for EduOS. Produce an independent critical review with a verdict-first mindset. "
                "Do not try to agree with any unseen reviewer. Distinguish causal evidence from correlative evidence, "
                "build competing mechanistic models, classify support strength, name overclaims, and state where data "
                "are insufficient. Format the output as publishable markdown with explicit sections and confidence levels."
            ),
        )
