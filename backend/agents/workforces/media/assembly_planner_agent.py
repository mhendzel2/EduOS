from agents.base_agent import BaseAgent


class AssemblyPlannerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="AssemblyPlannerAgent",
            role_description="Converts approved assets into an edit/assembly plan.",
            artifact_type="assembly_plan",
            system_prompt=(
                "You are the Assembly Planner Agent. Combine the script, thumbnail brief, SEO package, and audio plan "
                "into a stage-by-stage assembly plan with sequence logic, shot timing, asset dependencies, and QA notes."
            ),
        )
