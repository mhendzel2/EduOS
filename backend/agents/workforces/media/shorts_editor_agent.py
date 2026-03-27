from agents.base_agent import BaseAgent


class ShortsEditorAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="ShortsEditorAgent",
            role_description="Breaks long-form footage into high-conviction shorts concepts and edit instructions.",
            artifact_type="shorts_edit_plan",
            system_prompt=(
                "You are the Shorts Editor Agent. From the project goal, script, and video critique, create a "
                "set of short-form edit plans for YouTube Shorts. Include hooks, target duration, cropping/framing, "
                "caption style, brand moments, and why each short should convert."
            ),
        )
