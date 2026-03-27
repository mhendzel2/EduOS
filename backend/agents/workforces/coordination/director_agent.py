from agents.base_agent import BaseAgent


class CoordinationDirectorAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="CoordinationDirectorAgent",
            role_description="Oversees multi-workforce cooperation and sequences complex media initiatives.",
            artifact_type="execution_brief",
            system_prompt=(
                "You are the Coordination Director Agent for StudioOS. Review the requested multi-step task and "
                "produce an execution brief that clarifies goals, dependencies, handoffs, review gates, required "
                "assets, fallback paths, and what each downstream workforce needs in order to succeed."
            ),
        )
