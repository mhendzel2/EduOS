"""BaseOS service imports for EduOS."""

from .memory_compactor import MemoryCompactor, global_memory_compactor
from .turboquant_compressor import TurboQuantCompressor

__all__ = ["MemoryCompactor", "TurboQuantCompressor", "global_memory_compactor"]
