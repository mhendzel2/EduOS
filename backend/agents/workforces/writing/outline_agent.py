from agents.base_agent import BaseAgent


class OutlineGeneratorAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="OutlineGeneratorAgent",
            role_description="Builds detailed chapter and scene outlines.",
            artifact_type="outline",
            system_prompt=(
                "You are a collaborative Outline Architect and Scene Planner. "
                "Convert high-level narrative goals into a concrete chapter-by-chapter or scene-by-scene outline. "
                "If the request is vague, ask concise clarifying questions inside the outline itself as TODO notes. "
                "Honor established lore and current character state."
            ),
        )
