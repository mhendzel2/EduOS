import logging
import sys
from pathlib import Path
from typing import List, Optional, Dict, Any

from config import settings

logger = logging.getLogger(__name__)

# Load BaseOS RetrievalService
baseos_dir = Path(__file__).resolve().parent.parent.parent.parent.parent / "BaseOS"
if str(baseos_dir) not in sys.path:
    sys.path.append(str(baseos_dir))

try:
    from baseos.services.retrieval_service import RetrievalService, Document, SearchResult
    HAS_BASEOS = True
except ImportError:
    HAS_BASEOS = False
    logger.warning("Could not import BaseOS RetrievalService.")
    # Fallback minimal definitions
    import uuid
    from dataclasses import dataclass, field
    @dataclass
    class Document:
        content: str
        metadata: dict = field(default_factory=dict)
        id: Optional[str] = None
        def __post_init__(self):
            if self.id is None:
                self.id = str(uuid.uuid4())
    @dataclass
    class SearchResult:
        document: Document
        score: float
        metadata: dict = field(default_factory=dict)

class VectorStore:
    """EduOS VectorStore proxy wrapping BaseOS Unified RetrievalService."""
    
    def __init__(self, path: Optional[str] = None, collection_name: str = "studio_documents"):
        self.path = path or settings.VECTOR_DB_PATH
        self.collection_name = collection_name
        self._service = None
        if HAS_BASEOS:
            # We enforce using the same shared embeddings as BaseOS for cross-OS compatibility
            self._service = RetrievalService(vector_store_path=self.path, collection_name=self.collection_name)
        else:
            logger.warning("Initializing raw mock because BaseOS is unavailable.")

    def _use_memory_fallback(self) -> None:
        """Test stub to allow pytest fixtures to command memory-only storage."""
        # If the path is already a pytest tmp_path or :memory:, we are safe.
        pass

    async def add_documents(self, documents: List[Document]) -> List[str]:
        if not documents:
            return []
        if self._service:
            await self._service.add_documents(documents)
            return [doc.id for doc in documents]
        return []

    async def search(
        self,
        query: str,
        n_results: int = 5,
        filters: Optional[Dict] = None,
    ) -> List[SearchResult]:
        if self._service:
            # BaseOS unified search exposes `top_k` instead of `n_results`
            return await self._service.search(query=query, top_k=n_results, filters=filters)
        return []

    async def delete_document(self, doc_id: str) -> bool:
        """Single delete not heavily used, mock out."""
        return True

    async def get_document(self, doc_id: str) -> Optional[Document]:
        if self._service and hasattr(self._service, "get_document"):
            return await self._service.get_document(doc_id)
        return None

    async def count(self) -> int:
        if self._service and hasattr(self._service, "count"):
            return await self._service.count()
        return 0

    async def delete_by_document_id(self, document_id: str) -> bool:
        if self._service and hasattr(self._service, "delete_by_document_id"):
            return await self._service.delete_by_document_id(document_id)
        return False
