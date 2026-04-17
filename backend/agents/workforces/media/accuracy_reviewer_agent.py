import json
import logging
import re

from agents.base_agent import BaseAgent
from backend.storage.vector_store import VectorStore

logger = logging.getLogger(__name__)

GATE_APPENDIX = """
You are a MANDATORY Quality Gate for the PI's educational content. End your response with a JSON block in this exact format:
```json
{
  "passed": true,
  "reason": "one-sentence summary of the verdict",
  "revisions": ["specific revision instruction 1", "specific revision instruction 2"],
  "unsupported_claims": 0,
  "overclaimed_statements": 0,
  "confidence": 0.0,
  "needs_caveat": false
}
```
CRITICAL RUBRIC - You must FAIL the content if it violates any of these:
1. LSI SUPPORT: All mechanistic claims must be retrievably supported in the Living Source Index (Retrieved Passages).
2. UNCERTAINTY: Uncertainty language must be used where field consensus is absent (do not state hypotheses as fact).
3. FALSE PRECISION: No false precision in quantitative claims without citing the measurement parameters.
4. LABEL ALIGNMENT: All figures described in text strictly align with data parameters without extrapolation.

Set "needs_caveat": true (without failing) when the claim is supported but the source study has low methodological
rigor (e.g. overexpression-only, critically low n, no statistical test). The educational content must then
include an explicit caveat about the study's limitations.
"""

_RE_JSON_BLOCK = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL)


def _parse_gate_json(text: str) -> dict:
    m = _RE_JSON_BLOCK.search(text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    return {}


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

        # --- Hybrid RAG injection ---
        try:
            results = await self.vector_store.search(payload_text[:1000], n_results=6)
            retrieved_baseline = [res.document.content for res in results]
        except Exception:
            results = []
            retrieved_baseline = []

        if "retrieved_passages" in request.context:
            passages = request.context.pop("retrieved_passages")
            retrieved_baseline.extend(
                [str(p.get("content") if isinstance(p, dict) else p) for p in passages]
            )

        # --- Rigor signal from chunk metadata ---
        rigor_lines: list[str] = []
        aggregate_rigor_score: float = 0.0
        aggregate_rigor_flags: list[str] = []

        for res in results:
            meta = res.document.metadata or {}
            score = float(meta.get("mf_rigor_score", 0.0))
            flags_raw = str(meta.get("mf_rigor_flags", ""))
            flags = [f for f in flags_raw.split("|") if f]
            section = meta.get("section", "")
            if score > 0 or flags:
                rigor_lines.append(
                    f"  - [{section or 'unknown section'}] rigor={score:.2f} flags={flags or 'none'}"
                )
                if score > aggregate_rigor_score:
                    aggregate_rigor_score = score
                for f in flags:
                    if f not in aggregate_rigor_flags:
                        aggregate_rigor_flags.append(f)

        passages_block = "## Retrieved Evidence Grounding (LSI)\n" + "\n\n".join(set(retrieved_baseline[:15]))

        rigor_block = ""
        if rigor_lines:
            flag_str = ", ".join(aggregate_rigor_flags) if aggregate_rigor_flags else "none"
            rigor_block = (
                "\n\n## Source Methodological Rigor Signal\n"
                f"Aggregate rigor score: {aggregate_rigor_score:.2f} | Flags: {flag_str}\n"
                "Per-chunk detail:\n" + "\n".join(rigor_lines) + "\n\n"
                "INSTRUCTION: If rigor score < 0.40 or flags include 'critically_low_n', "
                "'overexpression_without_endogenous_validation', or 'no_statistical_test_reported', "
                "set needs_caveat=true in the gate JSON even if the claim is factually supported. "
                "The educational script must then include a caveat about study limitations."
            )

        original_prompt = self.system_prompt
        self.system_prompt = (
            f"{original_prompt}\n\n{passages_block}{rigor_block}\n\n"
            "CRITICAL RULE: If a factual/mechanistic claim in the text is not supported by these exact "
            "passages, you must fail it to prevent hallucination."
        )

        try:
            result = await super().process(request)
        finally:
            self.system_prompt = original_prompt

        # --- Persist to claim graph ---
        self._persist_to_claim_graph(
            result=result,
            request=request,
            rigor_score=aggregate_rigor_score,
            rigor_flags=aggregate_rigor_flags,
        )

        return result

    def _persist_to_claim_graph(self, result, request, rigor_score: float, rigor_flags: list[str]) -> None:
        try:
            from storage.claim_graph_store import ClaimGraphStore, claims_from_accuracy_report

            output_text = ""
            if hasattr(result, "output") and result.output:
                output_text = str(result.output)
            elif hasattr(result, "content"):
                output_text = str(result.content)

            gate_json = _parse_gate_json(output_text)
            if not gate_json:
                return

            run_id = str(getattr(request, "run_id", "") or request.context.get("run_id", ""))
            project_id = str(getattr(request, "project_id", "") or request.context.get("project_id", ""))

            nodes = claims_from_accuracy_report(
                gate_json,
                run_id=run_id,
                project_id=project_id,
                rigor_score=rigor_score,
                rigor_flags=rigor_flags,
            )

            store = ClaimGraphStore()
            store.add_claims(nodes)
            logger.debug(
                "AccuracyReviewerAgent: persisted %d claim nodes to claim_graph (run=%s)",
                len(nodes),
                run_id,
            )
        except Exception as exc:
            logger.warning("AccuracyReviewerAgent: claim graph persistence failed: %s", exc)
