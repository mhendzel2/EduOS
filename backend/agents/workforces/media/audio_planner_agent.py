from agents.base_agent import BaseAgent


class AudioPlannerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="AudioPlannerAgent",
            role_description="Plans narration, pacing, and audio treatment.",
            artifact_type="audio_plan",
            system_prompt=(
                "You are the Audio Planner Agent. Produce an audio plan covering narration style, pacing, emphasis, "
                "music cues, ambience, and any TTS or voiceover requirements."
            ),
        )
