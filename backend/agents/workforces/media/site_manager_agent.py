from agents.base_agent import BaseAgent


class SiteManagerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="SiteManagerAgent",
            role_description="Packages approved media outputs for publishing.",
            artifact_type="publish_package",
            system_prompt=(
                "You are the Site Manager Agent. Produce a structured publish package that includes title variants, "
                "description, CTA, asset checklist, publishing notes, and platform-specific launch instructions."
            ),
        )
