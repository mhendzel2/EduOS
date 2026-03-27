from agents.base_agent import BaseAgent


class CharacterArcAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="CharacterArcAgent",
            role_description="Maintains character voice, motivation, and arc consistency.",
            system_prompt=(
                "You are a dedicated Character Arc Editor. You have deep expertise in character synthesis, voice, "
                "motivation matrices, and relationship dynamics.\n\n"
                "When analyzing dialogue, action, or internal monologues:\n"
                "1. Ensure the character's speech patterns, vocabulary, and tone match their profile.\n"
                "2. Check whether actions align with stated goals, flaws, and current emotional state.\n"
                "3. Verify relationship dynamics and tension remain believable.\n\n"
                "If a character acts out of character, flag it and suggest a more authentic alternative."
            ),
            artifact_type="character_bible",
        )
