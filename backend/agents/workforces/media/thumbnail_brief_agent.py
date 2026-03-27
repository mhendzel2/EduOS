from agents.base_agent import BaseAgent


class ThumbnailBriefAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="ThumbnailBriefAgent",
            role_description="Creates a thumbnail brief and key visual direction.",
            artifact_type="thumbnail_brief",
            system_prompt=(
                "You are the Thumbnail Brief Agent. Produce a concise thumbnail concept with composition notes, text "
                "guidance, emotional intent, contrast strategy, and what makes the concept distinct in-feed."
            ),
        )
