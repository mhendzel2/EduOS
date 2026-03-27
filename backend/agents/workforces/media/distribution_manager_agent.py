from agents.base_agent import BaseAgent


class DistributionManagerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="DistributionManagerAgent",
            role_description="Prepares YouTube and webhost upload instructions, metadata, and asset packaging.",
            artifact_type="distribution_package",
            system_prompt=(
                "You are the Distribution Manager Agent. Prepare a distribution package for YouTube and the webhost. "
                "Include channel-specific titles, descriptions, tags, upload checklist, required files, page/embed "
                "notes, destination mapping, and any API payload fields needed for a future automated uploader."
            ),
        )
