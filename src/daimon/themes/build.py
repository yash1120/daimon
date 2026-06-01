"""Build the theme graph from the user's replies."""

from __future__ import annotations

from .extract import extract_concepts
from .store import GraphStore


def build_theme_graph(
    philosopher: str = "seneca",
    *,
    use_llm: bool = False,
    use_neo4j: bool = False,
) -> GraphStore:
    """Build (and persist) a theme graph from the user's replies.

    Reads up to the 1000 most recent letters for ``philosopher`` via
    :func:`daimon.db.recent_letters`, keeps only ``role == 'user'`` rows,
    extracts concepts from each reply, populates a :class:`GraphStore`, saves it
    to disk, and returns it.

    Parameters
    ----------
    philosopher:
        Which correspondence to mine (defaults to ``"seneca"``).
    use_llm:
        Forwarded to :func:`extract_concepts`. Off by default; never used in
        tests.
    use_neo4j:
        When ``True`` and the Neo4j env vars are present, mirror into Neo4j.

    Returns
    -------
    GraphStore
        The populated, saved store. May be empty if there are no user replies.
    """
    # Imported lazily so importing this package never requires the DB/config.
    from .. import db

    store = GraphStore(use_neo4j=use_neo4j)

    rows = db.recent_letters(philosopher, n=1000)
    for row in rows:
        if row.get("role") != "user":
            continue
        body = row.get("body") or ""
        concepts = extract_concepts(body, use_llm=use_llm)
        if concepts:
            store.add_reply(row.get("id"), concepts)

    store.save()
    return store
