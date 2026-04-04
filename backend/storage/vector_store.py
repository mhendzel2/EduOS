import logging
import uuid
import math
from collections import Counter
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from config import settings
from services.turboquant_compressor import TurboQuantCompressor

logger = logging.getLogger(__name__)


@dataclass
class Document:
    content: str
    metadata: dict = field(default_factory=dict)
    id: Optional[str] = None
    embedding: Optional[List[float]] = None

    def __post_init__(self):
        if self.id is None:
            self.id = str(uuid.uuid4())


@dataclass
class SearchResult:
    document: Document
    score: float
    metadata: dict = field(default_factory=dict)


class VectorStore:
    def __init__(
        self,
        path: Optional[str] = None,
        collection_name: str = "research_docs",
        compressor: Optional[TurboQuantCompressor] = None,
        temporary: bool = False,
    ):
        self.path = path or settings.VECTOR_DB_PATH
        self.collection_name = collection_name
        self.compressor = compressor
        self.temporary = temporary
        self._client = None
        self._collection = None
        self._initialized = False

    def _metadata_with_turboquant(self, doc: Document) -> dict:
        metadata = dict(doc.metadata or {})
        if self.compressor is None or doc.embedding is None:
            return metadata
        try:
            metadata["turboquant_sketch"] = self.compressor.compress_vector(doc.embedding)
        except Exception as exc:
            logger.debug("TurboQuant sketch generation failed for %s: %s", doc.id, exc)
        return metadata

    def _initialize(self):
        """Lazily initialize ChromaDB client."""
        if self._initialized:
            return
        try:
            import chromadb
            import chromadb.utils.embedding_functions as embedding_functions
            
            # Configure Ollama Embedding function natively to Chroma with Specter2 for scientific context
            ollama_ef = embedding_functions.OllamaEmbeddingFunction(
                url=f"{settings.OLLAMA_BASE_URL}/api/embeddings",
                model_name="specter2",  # Hybrid Model Upgrade - Scientific Semantic Target
            )

            if getattr(self, "temporary", False):
                self._client = chromadb.EphemeralClient()
                logger.info("Initialized temporary Ephemeral RAG VectorStore")
            else:
                self._client = chromadb.PersistentClient(path=self.path)
                logger.info(f"VectorStore initialized at {self.path}")

            self._collection = self._client.get_or_create_collection(
                name=self.collection_name,
                embedding_function=ollama_ef,
                metadata={"hnsw:space": "cosine"},
            )
            self._initialized = True
        except ImportError:
            logger.warning("ChromaDB not available, using in-memory fallback")
            self._use_memory_fallback()
        except Exception as e:
            logger.warning(f"ChromaDB initialization failed: {e}, using in-memory fallback")
            self._use_memory_fallback()

    def _use_memory_fallback(self):
        """Use simple in-memory storage as fallback."""
        self._memory_store: Dict[str, Document] = {}
        self._initialized = True

    async def add_documents(self, documents: List[Document]) -> List[str]:
        """Add documents to the vector store."""
        self._initialize()
        ids = []

        if self._collection is not None:
            try:
                doc_ids = [doc.id for doc in documents]
                doc_contents = [doc.content for doc in documents]
                doc_metadatas = [self._metadata_with_turboquant(doc) for doc in documents]

                self._collection.add(
                    ids=doc_ids,
                    documents=doc_contents,
                    metadatas=doc_metadatas,
                )
                ids = doc_ids
            except Exception as e:
                logger.error(f"Error adding documents to ChromaDB: {e}")
                raise
        else:
            # Memory fallback
            for doc in documents:
                doc.metadata = self._metadata_with_turboquant(doc)
                self._memory_store[doc.id] = doc
                ids.append(doc.id)

        return ids

    async def search(
        self,
        query: str,
        n_results: int = 5,
        filters: Optional[Dict] = None,
    ) -> List[SearchResult]:
        """Perform semantic search."""
        self._initialize()

        if self._collection is not None:
            try:
                collection_count = self._collection.count()
                if collection_count == 0:
                    return []
                query_params = {
                    "query_texts": [query],
                    "n_results": min(n_results, collection_count),
                }
                if filters:
                    query_params["where"] = filters

                # Over-retrieve for Hybrid BM25 Sparse Re-ranking
                deep_retrieve_n = min(n_results * 5, collection_count)
                query_params["n_results"] = deep_retrieve_n
                results = self._collection.query(**query_params)

                search_results = []
                if results and results["ids"] and results["ids"][0]:
                    docs_content = results["documents"][0]
                    # Calc average doc length for BM25 tuning
                    avg_dl = sum(len(c.split()) for c in docs_content) / len(docs_content) if docs_content else 1.0
                    
                    for i, doc_id in enumerate(results["ids"][0]):
                        content = docs_content[i]
                        doc = Document(
                            id=doc_id,
                            content=content,
                            metadata=results["metadatas"][0][i] if results.get("metadatas") else {},
                        )
                        distance = results["distances"][0][i] if results.get("distances") else 0.0
                        dense_score = 1.0 - distance
                        
                        # Apply local BM25 scoring over the retrieved chunks strictly verifying explicit terms
                        sparse_score = self._compute_bm25_score(query, content, avg_dl)
                        
                        # Hybrid interpolation weighing keyword matches (0.4) heavily against deep semantics (0.6)
                        # The biological entities will explode the sparse score upwards upon exact ID alignments
                        hybrid_score = (dense_score * 0.6) + (min(sparse_score / 10.0, 1.0) * 0.4)
                        
                        search_results.append(SearchResult(document=doc, score=hybrid_score, metadata=doc.metadata))
                
                # Sort descending by hybrid payload and enforce requested constraints
                search_results.sort(key=lambda x: x.score, reverse=True)
                return search_results[:n_results]
            except Exception as e:
                logger.error(f"Search error: {e}")
                return []
            # Memory fallback: simple keyword search
            results = []
            query_lower = query.lower()
            for doc in self._memory_store.values():
                if query_lower in doc.content.lower():
                    results.append(SearchResult(document=doc, score=0.8, metadata=doc.metadata))
            return results[:n_results]

    def _compute_bm25_score(self, query: str, doc_content: str, avg_doc_length: float, k1: float = 1.5, b: float = 0.75) -> float:
        # Simplistic runtime BM25 implementation for on-the-fly exact term re-ranking
        q_terms = [t for t in query.lower().split() if len(t) > 2]
        if not q_terms: return 0.0
        
        doc_terms = [t for t in doc_content.lower().split() if len(t) > 2]
        doc_len = len(doc_terms)
        if doc_len == 0: return 0.0
        
        term_freqs = Counter(doc_terms)
        score = 0.0
        # Pseudo-IDF (idf assumed to be 1.0 for simplicity within a heavily pruned dense chunk)
        for term in q_terms:
            tf = term_freqs.get(term, 0)
            score += (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc_len / (avg_doc_length or 1.0)))
        return score

    async def delete_document(self, doc_id: str) -> bool:
        """Delete a document by ID."""
        self._initialize()

        if self._collection is not None:
            try:
                self._collection.delete(ids=[doc_id])
                return True
            except Exception as e:
                logger.error(f"Delete error: {e}")
                return False
        else:
            if doc_id in self._memory_store:
                del self._memory_store[doc_id]
                return True
            return False

    async def get_document(self, doc_id: str) -> Optional[Document]:
        """Retrieve a document by ID."""
        self._initialize()

        if self._collection is not None:
            try:
                result = self._collection.get(ids=[doc_id])
                if result and result["ids"]:
                    return Document(
                        id=result["ids"][0],
                        content=result["documents"][0] if result.get("documents") else "",
                        metadata=result["metadatas"][0] if result.get("metadatas") else {},
                    )
            except Exception as e:
                logger.error(f"Get document error: {e}")
        else:
            return self._memory_store.get(doc_id)
        return None

    async def count(self) -> int:
        """Return the number of documents in the store."""
        self._initialize()
        if self._collection is not None:
            return self._collection.count()
        return len(self._memory_store) if hasattr(self, "_memory_store") else 0
