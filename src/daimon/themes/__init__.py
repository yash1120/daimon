"""Theme graph — mine the user's replies for recurring concepts.

This package extracts recurring philosophical concepts from the *user's* own
replies and builds a graph of the themes their thinking keeps returning to.

Public API:
    extract_concepts(text, *, use_llm=False) -> list[str]
    build_theme_graph(philosopher="seneca", use_llm=False, use_neo4j=False) -> GraphStore
    render_graph(store, out_path="theme_graph.html") -> str
"""

from .build import build_theme_graph
from .extract import extract_concepts
from .store import GraphStore
from .viz import render_graph

__all__ = [
    "build_theme_graph",
    "render_graph",
    "extract_concepts",
    "GraphStore",
]
