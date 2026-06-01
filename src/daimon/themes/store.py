"""Graph storage for the theme graph.

Default backend is an in-memory ``networkx`` graph that persists to JSON.
Nodes are concepts (with a ``weight`` = how often the concept appeared) and,
optionally, reply nodes. Edges connect concepts that co-occurred within the
same reply, with ``weight`` = co-occurrence count.

An optional Neo4j mirror is available behind a flag and is only attempted when
the ``NEO4J_URI`` (plus ``NEO4J_USER`` / ``NEO4J_PASSWORD``) environment
variables are present. Its absence is handled silently.
"""

from __future__ import annotations

import json
import os
from itertools import combinations
from pathlib import Path

import networkx as nx

# Canonical on-disk location for the persisted graph.
DEFAULT_GRAPH_PATH = Path(__file__).with_name("theme_graph.json")


class GraphStore:
    """A weighted co-occurrence graph of recurring concepts.

    Parameters
    ----------
    path:
        Where ``save()``/``load()`` read and write JSON. Defaults to
        ``src/daimon/themes/theme_graph.json``.
    include_letter_nodes:
        When ``True``, each reply is also added as a ``letter:<id>`` node linked
        (via ``MENTIONS`` edges) to the concepts it contains. Defaults to
        ``False`` to keep the concept graph clean for visualisation.
    use_neo4j:
        When ``True`` *and* the Neo4j env vars are present, every ``add_reply``
        is also mirrored into Neo4j. Otherwise this is a no-op.
    """

    def __init__(
        self,
        path: str | os.PathLike | None = None,
        *,
        include_letter_nodes: bool = False,
        use_neo4j: bool = False,
    ) -> None:
        self.path = Path(path) if path is not None else DEFAULT_GRAPH_PATH
        self.include_letter_nodes = include_letter_nodes
        self.graph = nx.Graph()
        self._seen_replies: set[str] = set()

        self._neo4j = None
        if use_neo4j:
            self._neo4j = _maybe_open_neo4j()

    # ------------------------------------------------------------------ core
    def add_reply(self, reply_id, concepts: list[str]) -> None:
        """Record one reply's concepts into the graph.

        Increments concept node weights, increments co-occurrence edge weights
        for every pair of concepts in the reply, and (optionally) adds a letter
        node. Calling twice with the same ``reply_id`` is idempotent-safe in the
        sense that it simply re-accumulates — callers should pass each reply
        once. Duplicate reply ids are skipped to keep builds re-runnable.
        """
        rid = str(reply_id)
        if rid in self._seen_replies:
            return
        self._seen_replies.add(rid)

        # De-duplicate concepts within the reply but keep deterministic order.
        unique = sorted(set(c for c in concepts if c))

        for c in unique:
            if self.graph.has_node(c):
                self.graph.nodes[c]["weight"] += 1
            else:
                self.graph.add_node(c, kind="concept", weight=1)

        for a, b in combinations(unique, 2):
            if self.graph.has_edge(a, b):
                self.graph[a][b]["weight"] += 1
            else:
                self.graph.add_edge(a, b, weight=1)

        if self.include_letter_nodes and unique:
            lnode = f"letter:{rid}"
            self.graph.add_node(lnode, kind="letter", weight=1)
            for c in unique:
                self.graph.add_edge(lnode, c, weight=1, kind="mentions")

        if self._neo4j is not None:
            _mirror_to_neo4j(self._neo4j, rid, unique)

    def to_networkx(self) -> nx.Graph:
        """Return the underlying ``networkx.Graph`` (live reference)."""
        return self.graph

    def top_concepts(self, n: int = 10) -> list[tuple[str, int]]:
        """Return the ``n`` most frequent concepts as ``(name, weight)`` pairs."""
        concepts = [
            (node, data.get("weight", 0))
            for node, data in self.graph.nodes(data=True)
            if data.get("kind") == "concept"
        ]
        concepts.sort(key=lambda kv: (-kv[1], kv[0]))
        return concepts[:n]

    # --------------------------------------------------------------- persist
    def save(self, path: str | os.PathLike | None = None) -> str:
        """Serialise the graph to JSON. Returns the path written."""
        target = Path(path) if path is not None else self.path
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "directed": False,
            "seen_replies": sorted(self._seen_replies),
            "nodes": [
                {"id": node, **data} for node, data in self.graph.nodes(data=True)
            ],
            "edges": [
                {"source": u, "target": v, **data}
                for u, v, data in self.graph.edges(data=True)
            ],
        }
        target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return str(target)

    def load(self, path: str | os.PathLike | None = None) -> "GraphStore":
        """Load a previously saved graph from JSON. Returns ``self``.

        Missing or empty files yield an empty graph rather than an error, so
        callers can always ``load()`` defensively.
        """
        target = Path(path) if path is not None else self.path
        self.graph = nx.Graph()
        self._seen_replies = set()
        if not target.exists() or target.stat().st_size == 0:
            return self
        try:
            payload = json.loads(target.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return self
        for node in payload.get("nodes", []):
            node = dict(node)
            nid = node.pop("id")
            self.graph.add_node(nid, **node)
        for edge in payload.get("edges", []):
            edge = dict(edge)
            u = edge.pop("source")
            v = edge.pop("target")
            self.graph.add_edge(u, v, **edge)
        self._seen_replies = set(payload.get("seen_replies", []))
        return self

    # ----------------------------------------------------------------- neo4j
    def close(self) -> None:
        """Close the Neo4j driver if one was opened. Safe to call always."""
        if self._neo4j is not None:
            try:
                self._neo4j.close()
            finally:
                self._neo4j = None

    def __enter__(self) -> "GraphStore":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


# ---------------------------------------------------------------------------
# Optional Neo4j helpers. These are only reached when ``use_neo4j=True`` AND the
# environment is configured. They never run in the test suite.
# ---------------------------------------------------------------------------

def _maybe_open_neo4j():  # pragma: no cover - requires live Neo4j + env
    """Open a Neo4j driver iff env vars are present; else return ``None``."""
    uri = os.getenv("NEO4J_URI")
    user = os.getenv("NEO4J_USER")
    password = os.getenv("NEO4J_PASSWORD")
    if not (uri and user and password):
        return None
    try:
        from neo4j import GraphDatabase

        driver = GraphDatabase.driver(uri, auth=(user, password))
        driver.verify_connectivity()
        return driver
    except Exception:
        # If anything goes wrong, fall back to networkx-only silently.
        return None


def _mirror_to_neo4j(driver, reply_id: str, concepts: list[str]) -> None:  # pragma: no cover
    """Mirror one reply's concepts/edges into Neo4j via MERGE."""
    if not concepts:
        return
    with driver.session() as session:
        session.execute_write(_neo4j_write_reply, reply_id, concepts)


def _neo4j_write_reply(tx, reply_id: str, concepts: list[str]) -> None:  # pragma: no cover
    # MERGE concept nodes and bump their weight.
    tx.run(
        """
        UNWIND $concepts AS name
        MERGE (c:Concept {name: name})
        ON CREATE SET c.weight = 1
        ON MATCH SET c.weight = coalesce(c.weight, 0) + 1
        """,
        concepts=concepts,
    )
    # MERGE CO_OCCURS relationships for every unordered pair, bumping weight.
    pairs = [list(p) for p in combinations(sorted(set(concepts)), 2)]
    if pairs:
        tx.run(
            """
            UNWIND $pairs AS pair
            MATCH (a:Concept {name: pair[0]})
            MATCH (b:Concept {name: pair[1]})
            MERGE (a)-[r:CO_OCCURS]-(b)
            ON CREATE SET r.weight = 1
            ON MATCH SET r.weight = coalesce(r.weight, 0) + 1
            """,
            pairs=pairs,
        )
