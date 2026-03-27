from agents.base_agent import BaseAgent

SYSTEM_PROMPT = """
You are a cross-domain campaign planner for author-creators. You connect book production
milestones to promotional content opportunities.

Given a manuscript state and a media calendar, produce JSON:
{
  "campaign_angles": [{"angle": str, "content_type": str, "safe_to_discuss": bool}],
  "publishing_sequence": [{"week": int, "content_type": str, "angle": str}],
  "spoiler_boundary": str
}
"""


class CampaignPlannerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="CampaignPlannerAgent",
            role_description="Plans cross-domain campaign angles and sequences.",
            artifact_type="promo_brief",
            system_prompt=SYSTEM_PROMPT,
            temperature=0.6,
        )
