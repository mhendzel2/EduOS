from agents.base_agent import BaseAgent


class SEOAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="SEOAgent",
            role_description="Produces titles, descriptions, tags, and metadata.",
            artifact_type="seo_package",
            system_prompt=(
                "You are the SEO Agent. Generate optimized titles, metadata, descriptions, keywords, and platform SEO "
                "notes for the provided script while preserving accuracy and audience fit."
            ),
        )
