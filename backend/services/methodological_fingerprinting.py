"""
Methodological fingerprinting for primary literature chunks.

Extracts study design indicators from raw text (especially Methods sections)
and produces a MethodologicalFingerprint with:
  - a rigor_score  (0.0 – 1.0)
  - a rigor_flags  list  (human-readable warnings, e.g. "critically_low_n")
  - ChromaDB-compatible flat metadata via .to_metadata()

The fingerprint travels as metadata on every chunk from the same document,
giving the AccuracyReviewerAgent signal about study quality when verifying claims.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Compiled patterns
# ---------------------------------------------------------------------------

_RE_CELL_LINE = re.compile(
    r"\b(HEK293(?:T)?|HeLa|MCF-?7|U2OS|NIH3T3|Jurkat|K562|PC-?3|LNCaP|"
    r"A549|H1299|SW480|HCT116|HT-?29|PANC-?1|MDA-?MB-?231|T47D|"
    r"HAP1|RPE-?1|293T|COS-?[17]|CHO|Vero|BJ|WI-?38)\b",
    re.IGNORECASE,
)

_RE_ORGANISM = re.compile(
    r"\b(mouse|mice|rat|rats|zebrafish|drosophila|C\. elegans|yeast|"
    r"Saccharomyces cerevisiae|S\. cerevisiae|Xenopus|arabidopsis|"
    r"human|primate|non-human primate|NHP)\b",
    re.IGNORECASE,
)

_RE_ASSAY = re.compile(
    r"\b(ChIP-?seq|RNA-?seq|ATAC-?seq|CUT&RUN|CUT&TAG|Hi-?C|CLIP-?seq|"
    r"CRISPR|siRNA|shRNA|Western\s+blot|immunoblot|IP|Co-?IP|"
    r"co-?immunoprecipitation|mass\s+spec(?:trometry)?|proteomics|"
    r"FACS|flow\s+cytometry|immunofluorescence|IF|IHC|FISH|"
    r"qPCR|RT-?qPCR|qRT-?PCR|luciferase|reporter\s+assay|"
    r"two-?hybrid|EMSA|gel\s+shift|footprint(?:ing)?|"
    r"single[\s-]cell|scRNA-?seq|spatial\s+transcriptomics)\b",
    re.IGNORECASE,
)

_RE_PERTURBATION = re.compile(
    r"\b(overexpression|overexpress(?:ing|ed)?|transfect(?:ion|ed|ing)?|"
    r"knockdown|knock(?:ed)?[\s-]down|knockout|knock(?:ed)?[\s-]out|"
    r"rescue|stable\s+(?:line|expression|integration)|"
    r"inducible|doxycycline|dox-?inducible|tet-?on|tet-?off|"
    r"endogenous(?:ly)?|endogenous\s+tagging|knock-?in|tagged\s+endogenously)\b",
    re.IGNORECASE,
)

_RE_STAT_METHOD = re.compile(
    r"\b(t-?test|Student['\u2019]?s\s+t|ANOVA|Tukey|Bonferroni|"
    r"Mann[\s-]Whitney|Wilcoxon|Kruskal[\s-]Wallis|Fisher['\u2019]?s\s+exact|"
    r"chi[\s-]?squared?|log[\s-]rank|Cox\s+proportion(?:al)?|"
    r"FDR|Benjamini[\s-]Hochberg|Bonferroni|permutation\s+test|"
    r"bootstrap|linear\s+model|linear\s+mixed|DESeq2|edgeR|limma)\b",
    re.IGNORECASE,
)

# Sample-size patterns: n = 3, n=3, N = 10, three independent, triplicate
_RE_SAMPLE_SIZE = re.compile(
    r"(?:n\s*=\s*(\d+)|N\s*=\s*(\d+)|"
    r"(\d+)\s+(?:independent\s+)?(?:biological\s+)?replicates?|"
    r"(triplicate|duplicate|quadruplicate)|"
    r"(\d+)\s+(?:mice|rats|animals|patients|samples|donors|cell\s+lines))",
    re.IGNORECASE,
)

# Antibody catalog numbers: ab12345, CST#4877, sc-8629, etc.
_RE_ANTIBODY = re.compile(
    r"\b(ab\d{4,6}|CST\s*#?\s*\d{4,5}|sc-\d{3,5}|"
    r"(?:Cell\s+Signaling|Abcam|Santa\s+Cruz|Sigma|Millipore)\s+\S+)\b",
    re.IGNORECASE,
)

# Independent replicate count phrases
_RE_INDEPENDENT_REPS = re.compile(
    r"(\d+)\s+independent\s+(?:biological\s+)?(?:experiment|replicate|repeat)",
    re.IGNORECASE,
)

# Overexpression-without-endogenous markers
_RE_ENDOGENOUS = re.compile(
    r"\bendogenous(?:ly)?\b|\bknock-?in\b|\btagged\s+endogenously\b",
    re.IGNORECASE,
)
_RE_OVEREXPRESSION = re.compile(
    r"\boverexpress(?:ion|ed|ing)?\b|\btransiently\s+transfect",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Dataclass
# ---------------------------------------------------------------------------

@dataclass
class MethodologicalFingerprint:
    cell_lines: list[str] = field(default_factory=list)
    organisms: list[str] = field(default_factory=list)
    assay_types: list[str] = field(default_factory=list)
    perturbation_strategies: list[str] = field(default_factory=list)
    statistical_methods: list[str] = field(default_factory=list)
    sample_sizes: list[int] = field(default_factory=list)
    antibody_refs: list[str] = field(default_factory=list)
    independent_replicate_counts: list[int] = field(default_factory=list)
    rigor_score: float = 0.0
    rigor_flags: list[str] = field(default_factory=list)

    def to_metadata(self) -> dict:
        """Flatten to ChromaDB-compatible scalar/list metadata."""
        return {
            "mf_cell_lines": ", ".join(self.cell_lines) if self.cell_lines else "",
            "mf_organisms": ", ".join(self.organisms) if self.organisms else "",
            "mf_assay_types": ", ".join(self.assay_types) if self.assay_types else "",
            "mf_perturbations": ", ".join(self.perturbation_strategies) if self.perturbation_strategies else "",
            "mf_stat_methods": ", ".join(self.statistical_methods) if self.statistical_methods else "",
            "mf_min_sample_size": min(self.sample_sizes) if self.sample_sizes else 0,
            "mf_antibody_refs": ", ".join(self.antibody_refs) if self.antibody_refs else "",
            "mf_min_independent_reps": min(self.independent_replicate_counts) if self.independent_replicate_counts else 0,
            "mf_rigor_score": round(self.rigor_score, 3),
            "mf_rigor_flags": "|".join(self.rigor_flags) if self.rigor_flags else "",
        }

    def rigor_summary(self) -> str:
        """One-line human-readable summary for prompt injection."""
        flag_str = "; ".join(self.rigor_flags) if self.rigor_flags else "none"
        return (
            f"Rigor score: {self.rigor_score:.2f} | "
            f"Assays: {', '.join(self.assay_types) or 'unknown'} | "
            f"Min n: {min(self.sample_sizes) if self.sample_sizes else 'unreported'} | "
            f"Flags: {flag_str}"
        )


# ---------------------------------------------------------------------------
# Extraction logic
# ---------------------------------------------------------------------------

def _unique_matches(pattern: re.Pattern, text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for m in pattern.finditer(text):
        val = m.group(0).strip()
        key = val.lower()
        if key not in seen:
            seen.add(key)
            out.append(val)
    return out


def _extract_sample_sizes(text: str) -> list[int]:
    sizes: list[int] = []
    for m in _RE_SAMPLE_SIZE.finditer(text):
        for g in m.groups():
            if g and g.isdigit():
                sizes.append(int(g))
                break
        else:
            # handle 'triplicate' / 'duplicate' etc.
            word = m.group(0).lower()
            if "triplicate" in word:
                sizes.append(3)
            elif "duplicate" in word:
                sizes.append(2)
            elif "quadruplicate" in word:
                sizes.append(4)
    return sizes


def _extract_independent_reps(text: str) -> list[int]:
    return [int(m.group(1)) for m in _RE_INDEPENDENT_REPS.finditer(text)]


def _compute_rigor(fp: MethodologicalFingerprint) -> tuple[float, list[str]]:
    score = 0.0
    flags: list[str] = []

    # +0.15 per positive indicator, capped at 1.0
    if fp.cell_lines or fp.organisms:
        score += 0.10
    if fp.assay_types:
        score += 0.15
    if fp.perturbation_strategies:
        score += 0.10
    if fp.statistical_methods:
        score += 0.20
    if fp.antibody_refs:
        score += 0.10
    if fp.sample_sizes:
        score += 0.10
    if fp.independent_replicate_counts:
        score += 0.15

    # Penalise / flag problems
    min_n = min(fp.sample_sizes) if fp.sample_sizes else None
    if min_n is not None and min_n < 3:
        score = max(0.0, score - 0.20)
        flags.append("critically_low_n")
    elif min_n is None:
        flags.append("sample_size_unreported")

    min_reps = min(fp.independent_replicate_counts) if fp.independent_replicate_counts else None
    if min_reps is not None and min_reps < 3:
        score = max(0.0, score - 0.10)
        flags.append("low_independent_replicates")

    if not fp.statistical_methods:
        score = max(0.0, score - 0.10)
        flags.append("no_statistical_test_reported")

    if not fp.antibody_refs and any(
        a in ("Western blot", "immunoblot", "IP", "Co-IP", "ChIP-seq", "immunofluorescence", "IHC")
        for a in fp.assay_types
    ):
        flags.append("antibody_catalog_number_missing")

    return min(score, 1.0), flags


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fingerprint_text(
    text: str,
    *,
    methods_only: bool = False,
) -> MethodologicalFingerprint:
    """Extract a MethodologicalFingerprint from *text*.

    Args:
        text: Raw text (ideally the Methods section for best signal).
        methods_only: If True the caller asserts the text is already the
            Methods section; skips the section-detection step.
    """
    fp = MethodologicalFingerprint(
        cell_lines=_unique_matches(_RE_CELL_LINE, text),
        organisms=_unique_matches(_RE_ORGANISM, text),
        assay_types=_unique_matches(_RE_ASSAY, text),
        perturbation_strategies=_unique_matches(_RE_PERTURBATION, text),
        statistical_methods=_unique_matches(_RE_STAT_METHOD, text),
        sample_sizes=_extract_sample_sizes(text),
        antibody_refs=_unique_matches(_RE_ANTIBODY, text),
        independent_replicate_counts=_extract_independent_reps(text),
    )

    # Overexpression-without-endogenous-validation flag
    has_overexpression = bool(_RE_OVEREXPRESSION.search(text))
    has_endogenous = bool(_RE_ENDOGENOUS.search(text))
    if has_overexpression and not has_endogenous:
        # Will be captured in rigor_flags after score computation
        pass

    fp.rigor_score, fp.rigor_flags = _compute_rigor(fp)

    if has_overexpression and not has_endogenous:
        if "overexpression_without_endogenous_validation" not in fp.rigor_flags:
            fp.rigor_flags.append("overexpression_without_endogenous_validation")
            fp.rigor_score = max(0.0, fp.rigor_score - 0.10)

    return fp


def fingerprint_empty() -> MethodologicalFingerprint:
    """Return a zero-signal fingerprint for documents with no extractable methods."""
    fp = MethodologicalFingerprint()
    fp.rigor_flags = ["no_methods_section_detected"]
    return fp
