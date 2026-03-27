import logging
import uuid
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

from config import settings

logger = logging.getLogger(__name__)
PLACEHOLDER_TOKENS = ("your_", "example", "replace", "changeme", "here")


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
    def __init__(self, path: Optional[str] = None, collection_name: str = "research_docs"):
        self.path = path or settings.VECTOR_DB_PATH
        self.collection_name = collection_name
        self._client = None
        self._collection = None
        self._initialized = False

    def _initialize(self):
        """Lazily initialize ChromaDB client."""
        if self._initialized:
            return
        try:
            import chromadb
            import chromadb.utils.embedding_functions as embedding_functions

            self._client = chromadb.PersistentClient(path=self.path)
            embedding_function = self._build_embedding_function(embedding_functions)
            try:
                self._collection = self._client.get_or_create_collection(
                    name=self.collection_name,
                    embedding_function=embedding_function,
                    metadata={"hnsw:space": "cosine"},
                )
            except Exception as exc:
                if "embedding function conflict" not in str(exc).lower():
                    raise
                logger.warning(
                    "Resetting collection %s after embedding backend change: %s",
                    self.collection_name,
                    exc,
                )
                self._client.delete_collection(name=self.collection_name)
                self._collection = self._client.get_or_create_collection(
                    name=self.collection_name,
                    embedding_function=embedding_function,
                    metadata={"hnsw:space": "cosine"},
                )
            self._initialized = True
            logger.info(f"VectorStore initialized at {self.path}")
        except ImportError:
            logger.warning("ChromaDB not available, using in-memory fallback")
            self._use_memory_fallback()
        except Exception as e:
            logger.warning(f"ChromaDB initialization failed: {e}, using in-memory fallback")
            self._use_memory_fallback()

    def _build_embedding_function(self, embedding_functions):
        gemini_api_key = self._usable_secret(settings.GEMINI_API_KEY) or self._usable_secret(settings.GOOGLE_API_KEY)
        if gemini_api_key:
            logger.info("Using Gemini embeddings for vector store")
            return embedding_functions.GoogleGenerativeAiEmbeddingFunction(
                api_key=gemini_api_key,
                model_name=settings.GEMINI_EMBEDDING_MODEL,
            )

        openrouter_key = self._usable_secret(settings.OPENROUTER_API_KEY)
        if openrouter_key:
            logger.info("Using OpenRouter embeddings for vector store")
            return embedding_functions.OpenAIEmbeddingFunction(
                api_key=openrouter_key,
                api_base="https://openrouter.ai/api/v1",
                model_name=settings.OPENROUTER_EMBEDDING_MODEL,
                default_headers={
                    "HTTP-Referer": "https://studioos.local",
                    "X-Title": "StudioOS",
                },
            )

        try:
            logger.info("Using Ollama embeddings for vector store")
            return embedding_functions.OllamaEmbeddingFunction(
                url=f"{settings.OLLAMA_BASE_URL}/api/embeddings",
                model_name="nomic-embed-text",
            )
        except Exception as exc:
            logger.warning("Ollama embedding initialization failed: %s", exc)

        logger.info("Using Chroma default embeddings for vector store")
        return embedding_functions.DefaultEmbeddingFunction()

    @staticmethod
    def _usable_secret(value: str) -> str:
        if not value:
            return ""
        lowered = value.strip().lower()
        if any(token in lowered for token in PLACEHOLDER_TOKENS):
            return ""
        return value.strip()

    def _use_memory_fallback(self):
        """Use simple in-memory storage as fallback."""
        self._memory_store: Dict[str, Document] = {}
        self._initialized = True

    async def add_documents(self, documents: List[Document]) -> List[str]:
        """Add documents to the vector store."""
        if not documents:
            return []

        self._initialize()
        ids = []

        if self._collection is not None:
            try:
                doc_ids = [doc.id for doc in documents]
                doc_contents = [doc.content for doc in documents]
                doc_metadatas = [doc.metadata for doc in documents]

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

                results = self._collection.query(**query_params)

                search_results = []
                if results and results["ids"]:
                    for i, doc_id in enumerate(results["ids"][0]):
                        doc = Document(
                            id=doc_id,
                            content=results["documents"][0][i] if results.get("documents") else "",
                            metadata=results["metadatas"][0][i] if results.get("metadatas") else {},
                        )
                        distance = results["distances"][0][i] if results.get("distances") else 0.0
                        score = 1.0 - distance
                        search_results.append(SearchResult(document=doc, score=score, metadata=doc.metadata))
                return search_results
            except Exception as e:
                logger.error(f"Search error: {e}")
                return []
        else:
            # Memory fallback: simple keyword search
            results = []
            query_lower = query.lower()
            for doc in self._memory_store.values():
                if filters and not self._metadata_matches_filters(doc.metadata, filters):
                    continue
                if query_lower in doc.content.lower():
                    results.append(SearchResult(document=doc, score=0.8, metadata=doc.metadata))
            return results[:n_results]

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

    async def delete_by_document_id(self, document_id: str) -> bool:
        """Delete all vector entries associated with a project document."""
        self._initialize()

        if self._collection is not None:
            try:
                self._collection.delete(where={"document_id": document_id})
                return True
            except Exception as e:
                logger.error(f"Delete by document_id error: {e}")
                return False

        if not hasattr(self, "_memory_store"):
            return False

        keys_to_delete = [
            doc_id
            for doc_id, document in self._memory_store.items()
            if document.id == document_id or document.metadata.get("document_id") == document_id
        ]
        for doc_id in keys_to_delete:
            del self._memory_store[doc_id]
        return True

    @staticmethod
    def _metadata_matches_filters(metadata: Dict[str, Any], filters: Dict[str, Any]) -> bool:
        for key, value in filters.items():
            if metadata.get(key) != value:
                return False
        return True
