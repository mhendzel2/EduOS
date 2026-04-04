# backend/coordinators/cellnucleus_coordinator.py
# Orchestrates the 5-agent review workforce for CellNucleus.com

import asyncio
import os
from backend.agents.workforces.review.review_planner_agent import ReviewPlannerAgent
from backend.agents.workforces.review.reviewer_a_agent import ReviewerAAgent
from backend.agents.workforces.review.reviewer_b_agent import ReviewerBAgent
from backend.agents.workforces.review.review_synthesizer_agent import ReviewSynthesizerAgent
from backend.agents.workforces.review.review_publisher_agent import ReviewPublisherAgent
from backend.config import settings

def load_prompt(filename):
    path = os.path.join(os.path.dirname(__file__), "..", "config", "prompts", filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

PLANNER_SYSTEM_PROMPT = "You are the Planner Agent. Decompose the topic into task briefs for the pro and adversarial reviewers."
REVIEWER_A_SYSTEM_PROMPT = load_prompt("reviewer_a_system_prompt.txt")
REVIEWER_B_SYSTEM_PROMPT = load_prompt("reviewer_b_system_prompt.txt")
SYNTHESIZER_SYSTEM_PROMPT = load_prompt("synthesizer_system_prompt.txt")

# Model assignments — each reviewer uses a different top model
# so no single model's biases dominate the final synthesis
REVIEWER_A_MODEL  = "anthropic/claude-opus-4"      # Pro-hypothesis stance
REVIEWER_B_MODEL  = "x-ai/grok-3"                  # Devil's advocate stance
SYNTHESIZER_MODEL = "google/gemini-2.5-pro"         # Reconciler
PLANNER_MODEL     = "google/gemini-2.0-flash"       # Fast orchestration
PUBLISHER_MODEL   = "openai/gpt-4.1"               # Formatting/assembly

class CellNucleusReviewCoordinator:
    """
    Drives the 5-agent critical review pipeline for CellNucleus.com.
    Reviewer A and B run in parallel; synthesizer reconciles both outputs.
    Stores all individual model artifacts to backend/storage/reviews/.
    """

    def __init__(self, topic_config: dict, rag_context: str = ""):
        self.topic = topic_config
        self.rag_context = rag_context  # injected from ChromaDB if available
        self.artifacts = {}             # stores per-agent outputs

    async def run(self) -> dict:

        # Stage 1: Planner decomposes topic → task briefs for A and B
        planner = ReviewPlannerAgent(
            model=PLANNER_MODEL,
            system_prompt=PLANNER_SYSTEM_PROMPT
        )
        task_briefs = await planner.run(
            topic=self.topic,
            rag_context=self.rag_context
        )

        # Stage 2: Reviewer A (pro-hypothesis) and B (adversarial) run in parallel
        reviewer_a = ReviewerAAgent(
            model=REVIEWER_A_MODEL,
            system_prompt=REVIEWER_A_SYSTEM_PROMPT  # see below
        )
        reviewer_b = ReviewerBAgent(
            model=REVIEWER_B_MODEL,
            system_prompt=REVIEWER_B_SYSTEM_PROMPT
        )
        review_a, review_b = await asyncio.gather(
            reviewer_a.run(brief=task_briefs["pro_hypothesis"]),
            reviewer_b.run(brief=task_briefs["adversarial"])
        )
        self.artifacts["reviewer_a"] = review_a
        self.artifacts["reviewer_b"] = review_b

        # Stage 3: Synthesizer reconciles both into final review
        synthesizer = ReviewSynthesizerAgent(
            model=SYNTHESIZER_MODEL,
            system_prompt=SYNTHESIZER_SYSTEM_PROMPT
        )
        synthesis = await synthesizer.run(
            review_a=review_a,
            review_b=review_b,
            topic=self.topic,
            rag_context=self.rag_context
        )
        self.artifacts["synthesis"] = synthesis

        # Stage 4: Publisher formats final output + queues NotebookLM script
        publisher = ReviewPublisherAgent(model=PUBLISHER_MODEL)
        final = await publisher.run(
            synthesis=synthesis,
            topic=self.topic,
            output_formats=["markdown", "notebooklm_script", "youtube_description"]
        )

        return {
            "topic": self.topic["slug"],
            "final_review": final["markdown"],
            "notebooklm_script": final["notebooklm_script"],
            "artifacts": self.artifacts  # all individual model outputs stored
        }
