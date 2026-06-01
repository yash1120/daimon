"""Offline tests for the theme graph package.

These are deterministic and never touch the network or an LLM. Run with:

    python -m pytest src/daimon/themes/tests.py -q

Kept inside the package so the feature is self-verifying without editing any
files outside ``src/daimon/themes/``.
"""

from __future__ import annotations

import os
import tempfile

from daimon.themes import build_theme_graph, extract_concepts, render_graph
from daimon.themes.store import GraphStore


# --------------------------------------------------------------------- extract
def test_extract_basic():
    got = set(
        extract_concepts(
            "I am afraid of death and how little time I have, yet I crave freedom."
        )
    )
    assert {"death", "fear", "freedom", "time"} <= got


def test_extract_stemming_and_synonyms():
    assert "death" in extract_concepts("everyone is mortal and will die one day")
    assert "time" in extract_concepts("I am always so busy, rushing from one thing to the next")
    assert "fear" in extract_concepts("a vague anxiety I cannot name")
    assert "anger" in extract_concepts("the resentment I feel keeps boiling over")


def test_extract_empty_and_no_match():
    assert extract_concepts("") == []
    assert extract_concepts("xyzzy qwerty zzz") == []


def test_extract_returns_sorted_unique():
    out = extract_concepts("death death dying mortal grave")
    assert out == sorted(set(out))
    assert out.count("death") <= 1


def test_extract_never_calls_llm_by_default(monkeypatch):
    # If anything tried to import/use the LLM, this would blow up loudly.
    import daimon.themes.extract as ex

    def _boom(*_a, **_k):
        raise AssertionError("LLM must not be used in the default path")

    monkeypatch.setattr(ex, "_extract_with_llm", _boom)
    assert "freedom" in extract_concepts("I want freedom")


# ----------------------------------------------------------------------- store
def test_store_add_reply_weights_and_edges():
    store = GraphStore(path=os.path.join(tempfile.gettempdir(), "tg_test.json"))
    store.add_reply(1, ["death", "time", "freedom"])
    store.add_reply(2, ["death", "time"])
    store.add_reply(3, ["death"])

    g = store.to_networkx()
    assert g.nodes["death"]["weight"] == 3
    assert g.nodes["time"]["weight"] == 2
    assert g.nodes["freedom"]["weight"] == 1
    # death-time co-occurred in replies 1 and 2.
    assert g["death"]["time"]["weight"] == 2
    assert g["death"]["freedom"]["weight"] == 1


def test_store_duplicate_reply_ignored():
    store = GraphStore(path=os.path.join(tempfile.gettempdir(), "tg_dup.json"))
    store.add_reply(1, ["death", "time"])
    store.add_reply(1, ["death", "time"])  # same id -> ignored
    assert store.to_networkx().nodes["death"]["weight"] == 1


def test_store_top_concepts():
    store = GraphStore(path=os.path.join(tempfile.gettempdir(), "tg_top.json"))
    store.add_reply(1, ["death", "time", "fear"])
    store.add_reply(2, ["death", "time"])
    store.add_reply(3, ["death"])
    top = store.top_concepts(2)
    assert top[0] == ("death", 3)
    assert top[1] == ("time", 2)


def test_store_save_load_roundtrip():
    path = os.path.join(tempfile.gettempdir(), "tg_round.json")
    store = GraphStore(path=path)
    store.add_reply(1, ["death", "time", "freedom"])
    store.add_reply(2, ["death", "fear"])
    store.save()

    reloaded = GraphStore(path=path).load()
    g = reloaded.to_networkx()
    assert g.number_of_nodes() == 4
    assert g.nodes["death"]["weight"] == 2
    assert g["death"]["time"]["weight"] == 1
    # Re-adding a previously-seen reply id is still ignored after load.
    reloaded.add_reply(1, ["death"])
    assert reloaded.to_networkx().nodes["death"]["weight"] == 2


def test_store_load_missing_file_is_empty():
    path = os.path.join(tempfile.gettempdir(), "tg_does_not_exist_42.json")
    if os.path.exists(path):
        os.remove(path)
    store = GraphStore(path=path).load()
    assert store.to_networkx().number_of_nodes() == 0


# ------------------------------------------------------------------------- viz
def test_render_populated_graph():
    path = os.path.join(tempfile.gettempdir(), "tg_render.json")
    out = os.path.join(tempfile.gettempdir(), "tg_render.html")
    store = GraphStore(path=path)
    store.add_reply(1, ["death", "time", "freedom"])
    store.add_reply(2, ["death", "fear"])
    result = render_graph(store, out)
    assert result == out
    assert os.path.exists(out)
    assert os.path.getsize(out) > 0
    text = open(out, encoding="utf-8").read().lower()
    # Should be a real vis-network page, not the placeholder.
    assert "no themes yet" not in text


def test_render_empty_graph_placeholder():
    out = os.path.join(tempfile.gettempdir(), "tg_empty.html")
    store = GraphStore(path=os.path.join(tempfile.gettempdir(), "tg_empty.json"))
    result = render_graph(store, out)
    assert os.path.exists(result)
    text = open(result, encoding="utf-8").read()
    assert "No themes yet" in text


# ------------------------------------------------------------------------ build
def test_build_theme_graph_offline(monkeypatch):
    # Stub the DB so the test does not depend on real rows.
    import daimon.db as db

    fake_rows = [
        {"id": 1, "role": "user", "body": "I fear death and time slips away.", "created_at": "x"},
        {"id": 2, "role": "philosopher", "body": "Consider virtue, friend.", "created_at": "x"},
        {"id": 3, "role": "user", "body": "I crave freedom but feel such anger.", "created_at": "x"},
    ]
    monkeypatch.setattr(db, "recent_letters", lambda *_a, **_k: fake_rows)

    store = build_theme_graph("seneca")
    g = store.to_networkx()
    # Only user rows contribute. 'virtue' (philosopher row) must be absent.
    assert "virtue" not in g.nodes
    assert {"death", "time", "freedom", "fear", "anger"} <= set(g.nodes)
