"""
Nomenclature resolver for cell biology synonyms.

Normalises common gene/protein alias variants to their HGNC canonical symbol
before text is embedded, preventing the same biological entity from fragmenting
across multiple ChromaDB nodes due to naming inconsistency.
"""
from __future__ import annotations

import re
from typing import Optional

# ---------------------------------------------------------------------------
# Synonym table  —  alias -> HGNC canonical symbol
# Extend at runtime with add_synonyms().
# ---------------------------------------------------------------------------
_SYNONYM_MAP: dict[str, str] = {
    # KAT8 / NSL complex
    "mof": "KAT8",
    "myst1": "KAT8",
    "kat8": "KAT8",
    "nsl1": "KANSL1",
    "kansl1": "KANSL1",
    "mcm3ap": "KANSL1",
    "nsl2": "KANSL2",
    "kansl2": "KANSL2",
    "nsl3": "KANSL3",
    "kansl3": "KANSL3",
    # p53 pathway
    "p53": "TP53",
    "tp53": "TP53",
    "p21": "CDKN1A",
    "cdkn1a": "CDKN1A",
    "waf1": "CDKN1A",
    "cip1": "CDKN1A",
    "mdm2": "MDM2",
    "hdm2": "MDM2",
    # Histone marks / writers
    "ezh2": "EZH2",
    "kmt6": "EZH2",
    "kmt6a": "EZH2",
    "dot1l": "DOT1L",
    "kmt4": "DOT1L",
    "set7": "SETD7",
    "set9": "SETD7",
    "setd7": "SETD7",
    "kmt7": "SETD7",
    "nsd2": "NSD2",
    "whsc1": "NSD2",
    "mmset": "NSD2",
    "nsd1": "NSD1",
    "nsd3": "NSD3",
    "whsc1l1": "NSD3",
    # CBP/p300
    "cbp": "CREBBP",
    "crebbp": "CREBBP",
    "p300": "EP300",
    "ep300": "EP300",
    # SWI/SNF
    "brg1": "SMARCA4",
    "smarca4": "SMARCA4",
    "brm": "SMARCA2",
    "smarca2": "SMARCA2",
    "snf5": "SMARCB1",
    "smarcb1": "SMARCB1",
    "ini1": "SMARCB1",
    # Polycomb
    "ring1b": "RNF2",
    "rnf2": "RNF2",
    "ring1a": "RING1",
    "ring1": "RING1",
    "bmi1": "BMI1",
    "pcgf4": "BMI1",
    "suz12": "SUZ12",
    "eed": "EED",
    # MLL/COMPASS
    "mll1": "KMT2A",
    "kmt2a": "KMT2A",
    "mll2": "KMT2D",
    "kmt2d": "KMT2D",
    "mll3": "KMT2C",
    "kmt2c": "KMT2C",
    "mll4": "KMT2B",
    "kmt2b": "KMT2B",
    "set1a": "SETD1A",
    "setd1a": "SETD1A",
    "set1b": "SETD1B",
    "setd1b": "SETD1B",
    # Chromatin readers / effectors
    "brd4": "BRD4",
    "brd2": "BRD2",
    "brd3": "BRD3",
    "brdt": "BRDT",
    "hp1a": "CBX5",
    "cbx5": "CBX5",
    "hp1b": "CBX1",
    "cbx1": "CBX1",
    "hp1g": "CBX3",
    "cbx3": "CBX3",
    # Core histones (common aliases)
    "h3k27me3": "H3K27me3",
    "h3k4me3": "H3K4me3",
    "h3k36me3": "H3K36me3",
    "h3k9me3": "H3K9me3",
    "h3k27ac": "H3K27ac",
    "h4k16ac": "H4K16ac",
    "h3k4me1": "H3K4me1",
    # Cell cycle
    "rb": "RB1",
    "rb1": "RB1",
    "e2f1": "E2F1",
    "cdk2": "CDK2",
    "cdk4": "CDK4",
    "cdk6": "CDK6",
    "cyclin d1": "CCND1",
    "ccnd1": "CCND1",
    "cyclin e1": "CCNE1",
    "ccne1": "CCNE1",
    # Apoptosis
    "bcl2": "BCL2",
    "bax": "BAX",
    "bad": "BAD",
    "bcl-xl": "BCL2L1",
    "bcl2l1": "BCL2L1",
    "casp3": "CASP3",
    "caspase-3": "CASP3",
    "casp9": "CASP9",
    "caspase-9": "CASP9",
    # Signalling
    "erk1": "MAPK3",
    "erk2": "MAPK1",
    "mapk3": "MAPK3",
    "mapk1": "MAPK1",
    "mek1": "MAP2K1",
    "mek2": "MAP2K2",
    "map2k1": "MAP2K1",
    "map2k2": "MAP2K2",
    "akt1": "AKT1",
    "pkb": "AKT1",
    "pi3k": "PIK3CA",
    "pik3ca": "PIK3CA",
    "mtor": "MTOR",
    "frap1": "MTOR",
    # DNA damage / repair
    "atr": "ATR",
    "atm": "ATM",
    "chk1": "CHEK1",
    "chek1": "CHEK1",
    "chk2": "CHEK2",
    "chek2": "CHEK2",
    "brca1": "BRCA1",
    "brca2": "BRCA2",
    "rad51": "RAD51",
    # Transcription factors
    "myc": "MYC",
    "c-myc": "MYC",
    "n-myc": "MYCN",
    "mycn": "MYCN",
    "max": "MAX",
    "oct4": "POU5F1",
    "pou5f1": "POU5F1",
    "sox2": "SOX2",
    "nanog": "NANOG",
    "klf4": "KLF4",
}

# Build a regex for whole-word replacements (case-insensitive)
# Sorted longest first to avoid partial matches
_ALIASES_SORTED = sorted(_SYNONYM_MAP.keys(), key=len, reverse=True)
_PATTERN: Optional[re.Pattern] = None


def _build_pattern() -> re.Pattern:
    escaped = [re.escape(a) for a in _ALIASES_SORTED]
    return re.compile(r"\b(" + "|".join(escaped) + r")\b", re.IGNORECASE)


def _get_pattern() -> re.Pattern:
    global _PATTERN
    if _PATTERN is None:
        _PATTERN = _build_pattern()
    return _PATTERN


def resolve_text(text: str) -> str:
    """Replace known aliases with their HGNC canonical symbol in *text*.

    Preserves original casing context — replaces alias with canonical form.
    """
    def _replace(m: re.Match) -> str:
        return _SYNONYM_MAP[m.group(0).lower()]

    return _get_pattern().sub(_replace, text)


def add_synonyms(mapping: dict[str, str]) -> None:
    """Extend the synonym table at runtime and invalidate the cached pattern.

    Args:
        mapping: dict of {alias_lowercase: canonical_symbol}
    """
    global _PATTERN
    _SYNONYM_MAP.update({k.lower(): v for k, v in mapping.items()})
    # Rebuild alias list and invalidate pattern
    _ALIASES_SORTED.clear()
    _ALIASES_SORTED.extend(sorted(_SYNONYM_MAP.keys(), key=len, reverse=True))
    _PATTERN = None


def canonical(term: str) -> str:
    """Return the canonical symbol for *term*, or *term* unchanged if unknown."""
    return _SYNONYM_MAP.get(term.lower(), term)
