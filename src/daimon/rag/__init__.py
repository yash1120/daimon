"""RAG: ground letters in the philosophers' own public-domain writings."""

from functools import lru_cache

from .retriever import Retriever


@lru_cache(maxsize=1)
def get_retriever() -> Retriever:
    return Retriever()


def retrieve(query: str, philosopher: str | None = None, k: int = 3) -> list[dict]:
    """Return up to k grounding passages: [{"text", "philosopher", "score"}]."""
    return get_retriever().retrieve(query, philosopher=philosopher, k=k)


__all__ = ["Retriever", "get_retriever", "retrieve"]
