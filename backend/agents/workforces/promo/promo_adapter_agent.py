from agents.base_agent import BaseAgent

SYSTEM_PROMPT = """
You adapt approved campaign hooks into platform-specific promotional assets.
Return JSON:
{
  "platform_adaptations": [{"platform": str, "angle": str, "format": str, "copy": str}],
  "calendar": [{"week": int, "platform": str, "deliverable": str}]
}
"""


class PromoAdapterAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="PromoAdapterAgent",
            role_description="Adapts approved hooks into platform-specific promo deliverables.",
            artifact_type="promo_calendar",
            system_prompt=SYSTEM_PROMPT,
            temperature=0.6,
        )
