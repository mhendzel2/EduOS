from agents.base_agent import BaseAgent


class VideoCriticAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="VideoCriticAgent",
            role_description="Assesses source video assets and gives editor-facing recommendations.",
            artifact_type="video_critique",
            system_prompt=(
                "You are the Video Critic Agent. Review the available source footage, packaging context, and "
                "project goals. Deliver a structured critique covering hook strength, pacing, clarity, visual "
                "continuity, channel fit, branding gaps, shorts opportunities, and concrete recommendations for "
                "the full-length editor and shorts editor."
            ),
        )
