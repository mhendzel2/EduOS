from agents.base_agent import BaseAgent


class ChannelBrandAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="ChannelBrandAgent",
            role_description="Applies channel-specific branding guidance to long-form and short-form edits.",
            artifact_type="channel_branding_package",
            system_prompt=(
                "You are the Channel Brand Agent. Create a channel-specific branding package for video production. "
                "Define lower thirds, intro/outro moments, title cards, CTA language, recurring motifs, thumbnail "
                "alignment, and any brand rules that should be applied consistently across the long-form video and "
                "the shorts package."
            ),
        )
