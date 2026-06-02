"""Test setup: use a throwaway local SQLite DB and never touch Turso."""
import os
import tempfile

_TEST_DB = os.path.join(tempfile.gettempdir(), "daimon_pytest.db")
os.environ["DAIMON_DB"] = _TEST_DB
os.environ.pop("TURSO_DATABASE_URL", None)
os.environ.pop("TURSO_AUTH_TOKEN", None)
os.environ.setdefault("DAIMON_RAG_BACKEND", "tfidf")  # no model download in CI

if os.path.exists(_TEST_DB):
    os.remove(_TEST_DB)
