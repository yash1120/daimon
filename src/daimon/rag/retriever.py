"""Retrieval over public-domain philosopher corpora.

Two backends behind one interface:
- ``chroma``: vector search via chromadb's default local embeddings.
- ``tfidf``: scikit-learn TF-IDF + cosine similarity (no model download, fully offline).

Chroma is attempted first; if it is unavailable (not installed, or its embedding
model cannot be fetched offline) the retriever transparently falls back to TF-IDF.
"""

from __future__ import annotations

import os
from pathlib import Path

CORPUS_DIR = Path(__file__).parent / "corpus"
CHROMA_DIR = Path(__file__).parent / ".chroma"
COLLECTION = "daimon_corpus"


def _load_passages() -> list[dict]:
    """Each blank-line-separated paragraph in corpus/<philosopher>.txt is one passage."""
    passages: list[dict] = []
    if not CORPUS_DIR.exists():
        return passages
    for path in sorted(CORPUS_DIR.glob("*.txt")):
        philosopher = path.stem
        text = path.read_text(encoding="utf-8")
        for i, chunk in enumerate(p.strip() for p in text.split("\n\n")):
            if chunk and not chunk.startswith("#"):  # skip provenance headers
                passages.append(
                    {"id": f"{philosopher}-{i}", "philosopher": philosopher, "text": chunk}
                )
    return passages


class Retriever:
    def __init__(self, force_backend: str | None = None, persist_dir: str | Path | None = None):
        self.passages = _load_passages()
        self.num_passages = len(self.passages)
        self._persist_dir = str(persist_dir or CHROMA_DIR)
        self.backend: str = "none"
        self._collection = None
        self._tfidf = None
        self._matrix = None

        if force_backend == "tfidf":
            self._init_tfidf()
        elif force_backend == "chroma":
            self._init_chroma()  # explicit request: raise if it cannot
        else:
            # Auto: chroma vector search by default (DAIMON_RAG_BACKEND=chroma).
            # chromadb fetches a ~79MB embedding model on first use; if that
            # download/init fails we fall back to TF-IDF (instant, offline).
            # Set DAIMON_RAG_BACKEND=tfidf to skip vectors entirely.
            choice = os.getenv("DAIMON_RAG_BACKEND", "chroma").strip().lower()
            if choice == "chroma":
                try:
                    self._init_chroma()
                except Exception:
                    self._init_tfidf()
            else:
                self._init_tfidf()

    # ---- backends -------------------------------------------------------
    def _init_chroma(self) -> None:
        import chromadb  # may raise ImportError

        client = chromadb.PersistentClient(path=self._persist_dir)
        col = client.get_or_create_collection(name=COLLECTION)
        if self.passages and col.count() != len(self.passages):
            # (Re)embed only when the corpus changed — warm starts are instant.
            # This also triggers the embedding model load, so any offline
            # failure surfaces here and we fall back to TF-IDF.
            col.upsert(
                ids=[p["id"] for p in self.passages],
                documents=[p["text"] for p in self.passages],
                metadatas=[{"philosopher": p["philosopher"]} for p in self.passages],
            )
        self._collection = col
        self.backend = "chroma"

    def _init_tfidf(self) -> None:
        from sklearn.feature_extraction.text import TfidfVectorizer

        self._tfidf = TfidfVectorizer(stop_words="english")
        corpus = [p["text"] for p in self.passages] or [""]
        self._matrix = self._tfidf.fit_transform(corpus)
        self.backend = "tfidf"

    # ---- query ----------------------------------------------------------
    def retrieve(self, query: str, philosopher: str | None = None, k: int = 3) -> list[dict]:
        if not self.passages or not query.strip():
            return []
        if self.backend == "chroma":
            return self._retrieve_chroma(query, philosopher, k)
        return self._retrieve_tfidf(query, philosopher, k)

    def _retrieve_chroma(self, query, philosopher, k) -> list[dict]:
        where = {"philosopher": philosopher} if philosopher else None
        res = self._collection.query(query_texts=[query], n_results=k, where=where)
        docs = (res.get("documents") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]
        out = []
        for doc, meta, dist in zip(docs, metas, dists):
            out.append(
                {
                    "text": doc,
                    "philosopher": (meta or {}).get("philosopher", ""),
                    "score": round(1.0 - float(dist), 4),  # cosine distance -> similarity
                }
            )
        return out

    def _retrieve_tfidf(self, query, philosopher, k) -> list[dict]:
        from sklearn.metrics.pairwise import cosine_similarity

        sims = cosine_similarity(self._tfidf.transform([query]), self._matrix)[0]
        ranked = sorted(range(len(self.passages)), key=lambda i: sims[i], reverse=True)
        out = []
        for i in ranked:
            p = self.passages[i]
            if philosopher and p["philosopher"] != philosopher:
                continue
            if sims[i] <= 0:
                continue
            out.append(
                {"text": p["text"], "philosopher": p["philosopher"], "score": round(float(sims[i]), 4)}
            )
            if len(out) >= k:
                break
        return out
