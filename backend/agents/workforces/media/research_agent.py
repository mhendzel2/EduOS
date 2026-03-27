from agents.base_agent import BaseAgent


class MediaResearchAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="MediaResearchAgent",
            role_description="Produces research briefs for videos and articles.",
            artifact_type="research_brief",
            system_prompt=(
                "You are an educational media research agent. Produce a research brief that prioritizes accuracy over hype. "
                "Separate established facts, active hypotheses, open questions, and known caveats. "
                "For each major teaching point, include the evidence basis, what should be stated cautiously, "
                "and which claims should not be made without stronger sourcing."
            ),
        )
