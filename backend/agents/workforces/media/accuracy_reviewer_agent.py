from agents.base_agent import BaseAgent
from backend.storage.vector_store import VectorStore

GATE_APPENDIX = """
You are a MANDATORY Quality Gate for the PI's educational content. End your response with a JSON block in this exact format:
```json
{
  "passed": true,
  "reason": "one-sentence summary of the verdict",
  "revisions": ["specific revision instruction 1", "specific revision instruction 2"],
  "unsupported_claims": 0,
  "overclaimed_statements": 0,
  "confidence": 0.0
}
```
CRITICAL RUBRIC - You must FAIL the content if it violates any of these:
1. LSI SUPPORT: All mechanistic claims must be retrievably supported in the Living Source Index (Retrieved Passages).
2. UNCERTAINTY: Uncertainty language must be used where field consensus is absent (do not state hypotheses as fact).
3. FALSE PRECISION: No false precision in quantitative claims without citing the measurement parameters.
4. LABEL ALIGNMENT: All figures described in text strictly align with data parameters without extrapolation.
"""


class AccuracyReviewerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="AccuracyReviewerAgent",
            role_description="Acts as the educational accuracy and evidence gate.",
            artifact_type="accuracy_report",
            is_gate=True,
            system_prompt=(
                "You are the Educational Accuracy Reviewer for EduOS. Apply GrantOS-style rigor to educational content. "
                "Audit every factual, mechanistic, causal, medical, or quantitative claim against the supplied research brief "
                "and project context. Treat inferences as unsupported unless the brief explicitly supports them. "
                "Require clear separation of established evidence, active debate, and open questions. "
                "Prefer careful caveats over confident simplification.\n\n"
                "Write a concise but specific review with these sections:\n"
                "1. Supported claims\n"
                "2. Weak, partial, or ambiguous claims\n"
                "3. Unsupported or overstated claims\n"
                "4. Missing caveats or uncertainty labels\n"
                "5. Revision priorities\n\n"
                + GATE_APPENDIX
            ),
            temperature=0.2,
        )

        self.vector_store = VectorStore(collection_name="smboss_rag_global")
        
    async def process(self, request):
        payload_text = getattr(request, "input_data", str(request.context))
        
        # Enforce Native Hybrid RAG Injection against the payload chunk
        try:
            results = await self.vector_store.search(payload_text[:1000], n_results=6)
            retrieved_baseline = [res.document.content for res in results]
        except Exception:
            retrieved_baseline = []

        if "retrieved_passages" in request.context:
            passages = request.context.pop("retrieved_passages")
            retrieved_baseline.extend([str(p.get("content") if isinstance(p, dict) else p) for p in passages])
            
        passages_block = "## Retrieved Evidence Grounding (LSI)\n" + "\n\n".join(set(retrieved_baseline[:15]))
        
        original_prompt = self.system_prompt
        self.system_prompt = f"{original_prompt}\n\n{passages_block}\n\nCRITICAL RULE: If a factual/mechanistic claim in the text is not supported by these exact passages, you must fail it to prevent hallucination."
        
        try:
            return await super().process(request)
        finally:
            self.system_prompt = original_prompt
