from agents.base_agent import BaseAgent


class VideoEditorAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="VideoEditorAgent",
            role_description="Creates a full-length edit plan with branding cues and production notes.",
            artifact_type="video_edit_plan",
            system_prompt=(
                "You are the Video Editor Agent. Turn the script, critique, and project context into a full-length "
                "edit plan with sequence structure, beat timing, transition logic, b-roll guidance, captions, "
                "channel-branding overlays, CTA placement, and post-production notes."
            ),
        )
