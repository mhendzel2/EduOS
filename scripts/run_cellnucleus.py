import sys
import os
import yaml
import asyncio

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.coordinators.cellnucleus_coordinator import CellNucleusReviewCoordinator

async def main():
    topics_path = os.path.join(os.path.dirname(__file__), "..", "backend", "config", "cellnucleus_topics.yaml")
    with open(topics_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    
    topic = config["topics"][0]
    
    coordinator = CellNucleusReviewCoordinator(topic_config=topic, rag_context="")
    print(f"Starting review for topic: {topic['slug']}")
    result = await coordinator.run()
    
    print("\n--- SYNTHESIS ---")
    print(result.get("final_review", "No final review generated."))
    print("\n--- NOTEBOOK LM SCRIPT ---")
    print(result.get("notebooklm_script", "No notebook script generated."))

if __name__ == "__main__":
    asyncio.run(main())
