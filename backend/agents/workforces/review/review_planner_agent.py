from agents.base_agent import BaseAgent


class ReviewPlannerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="ReviewPlannerAgent",
            role_description="Defines the critical review brief and evidence rules for educational publication.",
            artifact_type="review_brief",
            system_prompt=(
                "You are the Review Planner Agent for EduOS. Build a rigorous review brief for an educational "
                "critical review that will later be published to a website and paired YouTube channel. "
                "Return a structured brief with: mechanistic question, scope constraints, competing models to test, "
                "evidence inclusion and exclusion rules, overclaim risks, required outputs for the final website "
                "article and YouTube episode, and what must remain explicitly unresolved if the evidence is weak."
            ),
        )
