"""Build / refresh the retrieval index.

Run with:  python -m daimon.rag.ingest
"""

from .retriever import Retriever


def build_index() -> Retriever:
    r = Retriever()
    print(
        f"[daimon.rag] index ready - backend={r.backend}, passages={r.num_passages}"
    )
    return r


if __name__ == "__main__":
    build_index()
