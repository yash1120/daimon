"""Offline test suite — no live LLM, no network. Safe to run in CI."""
import daimon.db as db
from daimon.about import ABOUT
from daimon.limits import check_and_consume
from daimon.personas import available_personas, get_persona
from daimon.rag import retrieve
from daimon.themes import extract_concepts

FIVE = {"seneca", "aurelius", "nietzsche", "camus", "weil"}


def setup_module(_):
    db.init_db()


def test_five_personas():
    keys = set(available_personas())
    assert FIVE.issubset(keys)
    for k in keys:
        p = get_persona(k)
        assert p["display_name"] and len(p["system_prompt"]) > 200


def test_about_profiles():
    assert FIVE.issubset(set(ABOUT.keys()))
    for info in ABOUT.values():
        assert info["dates"] and info["bio"] and info["ideas"] and info["works"]


def test_rag_retrieve():
    res = retrieve("how should I use my time", philosopher="seneca", k=3)
    assert res and "text" in res[0] and res[0]["philosopher"] == "seneca"


def test_extract_concepts():
    cs = set(extract_concepts("I fear death and waste my time, yet I crave freedom."))
    assert {"death", "time", "freedom"}.issubset(cs)


def test_db_isolation_bookmarks_search_stats_prefs():
    a, b = "sessA", "sessB"
    lid = db.save_letter("seneca", "philosopher", "Hello, friend.", session_id=a)
    db.save_letter("seneca", "user", "I fear death and time.", session_id=a)

    assert len(db.recent_letters("seneca", n=10, session_id=a)) == 2
    assert len(db.recent_letters("seneca", n=10, session_id=b)) == 0  # isolation

    db.set_bookmark(lid, a, True)
    assert any(x["id"] == lid for x in db.list_bookmarks(a))
    assert db.list_bookmarks(b) == []

    assert any("death" in x["body"].lower() for x in db.search_letters(a, "death"))
    assert db.search_letters(b, "death") == []

    s = db.stats(a)
    assert s["letters"] == 1 and s["replies"] == 1 and s["streak"] >= 1

    db.set_prefs(a, name="Yash", theme="light", tts=True, default_philosopher="seneca")
    p = db.get_prefs(a)
    assert p["name"] == "Yash" and p["theme"] == "light" and p["tts"] is True


def test_rate_limit_blocks():
    ok1, _ = check_and_consume("rl-session", cost=1)
    assert ok1
    ok2, msg = check_and_consume("rl-session", cost=10**9)
    assert ok2 is False and msg


def test_api_smoke():
    try:
        from fastapi.testclient import TestClient
    except Exception:
        return  # httpx not installed -> skip the HTTP-layer smoke
    from daimon.api import app

    c = TestClient(app)
    assert c.get("/api/philosophers").status_code == 200
    assert len(c.get("/api/about").json()) >= 5
    assert c.get("/api/health").json()["status"] == "ok"
    assert c.get("/api/me").json()["name"] == ""
    assert c.post("/api/me", json={"name": "Test"}).json()["name"] == "Test"
    assert "concepts" in c.get("/api/philosophy").json()
    assert c.get("/api/search", params={"q": "x"}).status_code == 200
    assert "letters" in c.get("/api/stats").json()
    assert "theme" in c.get("/api/prefs").json()
