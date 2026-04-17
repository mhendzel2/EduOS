"""
Claim graph store — accuracy audit trail for EduOS.

Indexes discrete scientific claims that have been evaluated by the
AccuracyReviewerAgent. Each ClaimNode records whether the claim passed or
failed the LSI gate, the evidence it was checked against, and methodological
rigor metadata from the source document.

This lets downstream agents (review_synthesizer, review_publisher) query the
verified-claims ledger for a production run rather than re-checking from scratch.

Storage: a separate ChromaDB collection named "claim_graph".
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

logger = logging.getLogger(__name__)

EvidenceType = Literal["direct", "correlative", "inferred", "assumed", "unknown"]
LSIVerdict = Literal["passed", "failed", "needs_caveat", "ambiguous"]


@dataclass
class ClaimNode:
    """A single scientific claim with provenance and accuracy verdict."""

    claim_text: str
    verdict: LSIVerdict
    evidence_type: EvidenceType = "unknown"

    # Provenance
    source_document_id: str = ""
    source_section: str = ""          # e.g. "abstract", "results", "discussion"
    figure_ref: str = ""              # e.g. "Fig 2A"
    doi: str = ""
    pmid: str = ""
    is_preprint: bool = False

    # Rigor signal from methodological fingerprinting
    rigor_score: float = 0.0
    rigor_flags: list[str] = field(default_factory=list)

    # Accuracy review context
    run_id: str = ""                  # StudioPipeline run identifier
    project_id: str = ""
    revision_instruction: str = ""    # populated when verdict != "passed"

    id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def to_chroma_metadata(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "evidence_type": self.evidence_type,
            "source_document_id": self.source_document_id,
            "source_section": self.source_section,
            "figure_ref": self.figure_ref,
            "doi": self.doi,
            "pmid": self.pmid,
            "is_preprint": self.is_preprint,
            "rigor_score": round(self.rigor_score, 3),
            "rigor_flags": "|".join(self.rigor_flags),
            "run_id": self.run_id,
            "project_id": self.project_id,
            "revision_instruction": self.revision_instruction,
        }


class ClaimGraphStore:
    """Persist and query ClaimNodes for a production run."""

    def __init__(self, path: Optional[str] = None):
        from config import settings
        self._path = path or settings.VECTOR_DB_PATH
        self._client = None
        self._collection = None
        self._initialized = False

    def _initialize(self) -> None:
        if self._initialized:
            return
        try:
            import chromadb
            import chromadb.utils.embedding_functions as ef

            ollama_ef = ef.OllamaEmbeddingFunction(
                url=f"{__import__('config').settings.OLLAMA_BASE_URL}/api/embeddings",
                model_name="specter2",
            )
            self._client = chromadb.PersistentClient(path=self._path)
            self._collection = self._client.get_or_create_collection(
                name="claim_graph",
                embedding_function=ollama_ef,
                metadata={"hnsw:space": "cosine"},
            )
            self._initialized = True
            logger.info("ClaimGraphStore initialised at %s", self._path)
        except Exception as exc:
            logger.warning("ClaimGraphStore initialisation failed, using memory fallback: %s", exc)
            self._memory: dict[str, ClaimNode] = {}
            self._initialized = True

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def add_claims(self, nodes: list[ClaimNode]) -> list[str]:
        """Persist a batch of ClaimNodes. Returns their IDs."""
        self._initialize()
        if not nodes:
            return []

        if self._collection is not None:
            try:
                self._collection.add(
                    ids=[n.id for n in nodes],
                    documents=[n.claim_text for n in nodes],
                    metadatas=[n.to_chroma_metadata() for n in nodes],
                )
                return [n.id for n in nodes]
            except Exception as exc:
                logger.error("ClaimGraphStore.add_claims failed: %s", exc)
                return []
        else:
            for n in nodes:
                self._memory[n.id] = n
            return [n.id for n in nodes]

    def add_claim(self, node: ClaimNode) -> str:
        """Persist a single ClaimNode. Returns its ID."""
        ids = self.add_claims([node])
        return ids[0] if ids else ""

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def query_by_run(self, run_id: str, verdict: Optional[LSIVerdict] = None) -> list[ClaimNode]:
        """Return all claims for a given pipeline run, optionally filtered by verdict."""
        self._initialize()
        filters: dict = {"run_id": run_id}
        if verdict:
            filters["verdict"] = verdict
        return self._query(where=filters)

    def query_by_project(self, project_id: str, verdict: Optional[LSIVerdict] = None) -> list[ClaimNode]:
        """Return all claims for a project, optionally filtered by verdict."""
        self._initialize()
        filters: dict = {"project_id": project_id}
        if verdict:
            filters["verdict"] = verdict
        return self._query(where=filters)

    def query_similar(self, claim_text: str, n_results: int = 10) -> list[ClaimNode]:
        """Return claims semantically similar to *claim_text*."""
        self._initialize()
        if self._collection is not None:
            try:
                count = self._collection.count()
                if count == 0:
                    return []
                results = self._collection.query(
                    query_texts=[claim_text],
                    n_results=min(n_results, count),
                )
                return self._results_to_nodes(results)
            except Exception as exc:
                logger.error("ClaimGraphStore.query_similar failed: %s", exc)
                return []
        # memory fallback
        query_lower = claim_text.lower()
        return [
            n for n in self._memory.values()
            if query_lower[:30] in n.claim_text.lower()
        ][:n_results]

    def count(self) -> int:
        self._initialize()
        if self._collection is not None:
            return self._collection.count()
        return len(self._memory) if hasattr(self, "_memory") else 0

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _query(self, where: dict) -> list[ClaimNode]:
        if self._collection is not None:
            try:
                count = self._collection.count()
                if count == 0:
                    return []
                results = self._collection.get(where=where)
                return self._results_to_nodes_get(results)
            except Exception as exc:
                logger.error("ClaimGraphStore._query failed: %s", exc)
                return []
        # memory fallback
        return [
            n for n in self._memory.values()
            if all(getattr(n, k, None) == v for k, v in where.items())
        ]

    def _results_to_nodes(self, results: dict) -> list[ClaimNode]:
        nodes = []
        if not results or not results.get("ids") or not results["ids"][0]:
            return nodes
        for i, nid in enumerate(results["ids"][0]):
            meta = results["metadatas"][0][i] if results.get("metadatas") else {}
            doc = results["documents"][0][i] if results.get("documents") else ""
            nodes.append(self._meta_to_node(nid, doc, meta))
        return nodes

    def _results_to_nodes_get(self, results: dict) -> list[ClaimNode]:
        nodes = []
        if not results or not results.get("ids"):
            return nodes
        for i, nid in enumerate(results["ids"]):
            meta = results["metadatas"][i] if results.get("metadatas") else {}
            doc = results["documents"][i] if results.get("documents") else ""
            nodes.append(self._meta_to_node(nid, doc, meta))
        return nodes

    @staticmethod
    def _meta_to_node(nid: str, claim_text: str, meta: dict) -> ClaimNode:
        return ClaimNode(
            id=nid,
            claim_text=claim_text,
            verdict=meta.get("verdict", "ambiguous"),
            evidence_type=meta.get("evidence_type", "unknown"),
            source_document_id=meta.get("source_document_id", ""),
            source_section=meta.get("source_section", ""),
            figure_ref=meta.get("figure_ref", ""),
            doi=meta.get("doi", ""),
            pmid=meta.get("pmid", ""),
            is_preprint=bool(meta.get("is_preprint", False)),
            rigor_score=float(meta.get("rigor_score", 0.0)),
            rigor_flags=meta.get("rigor_flags", "").split("|") if meta.get("rigor_flags") else [],
            run_id=meta.get("run_id", ""),
            project_id=meta.get("project_id", ""),
            revision_instruction=meta.get("revision_instruction", ""),
        )


# ---------------------------------------------------------------------------
# Convenience: build ClaimNodes from AccuracyReviewerAgent output
# ---------------------------------------------------------------------------

def claims_from_accuracy_report(
    report: dict,
    *,
    run_id: str = "",
    project_id: str = "",
    source_document_id: str = "",
    rigor_score: float = 0.0,
    rigor_flags: Optional[list[str]] = None,
) -> list[ClaimNode]:
    """Convert an AccuracyReviewerAgent JSON gate result into ClaimNodes.

    Expected *report* keys (from GATE_APPENDIX):
        passed, reason, revisions, unsupported_claims, overclaimed_statements

    Produces one ClaimNode per revision instruction (failed claims) plus one
    summary node for the overall verdict.
    """
    nodes: list[ClaimNode] = []
    passed: bool = bool(report.get("passed", False))
    reason: str = str(report.get("reason", ""))
    revisions: list[str] = list(report.get("revisions") or [])

    overall_verdict: LSIVerdict = "passed" if passed else "failed"

    # One node per failed/revision claim
    for rev in revisions:
        nodes.append(ClaimNode(
            claim_text=rev,
            verdict="failed",
            evidence_type="inferred",
            source_document_id=source_document_id,
            rigor_score=rigor_score,
            rigor_flags=rigor_flags or [],
            run_id=run_id,
            project_id=project_id,
            revision_instruction=rev,
        ))

    # Summary node for the gate result
    nodes.append(ClaimNode(
        claim_text=reason or ("Gate passed" if passed else "Gate failed"),
        verdict=overall_verdict,
        evidence_type="direct",
        source_document_id=source_document_id,
        rigor_score=rigor_score,
        rigor_flags=rigor_flags or [],
        run_id=run_id,
        project_id=project_id,
    ))

    return nodes
