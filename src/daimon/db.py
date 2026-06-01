"""Storage layer — driver-agnostic.

Default: a local SQLite file (great for the CLI and local dev).
Durable deploy: set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) and the same code
talks to a Turso / libSQL database (an embedded replica that syncs to the
cloud), so a visitor's letters and philosophy survive Space restarts.

Rows are returned as plain dicts built from explicit column lists, so the code
works identically on stdlib sqlite3 (tuples) and libSQL (tuples) — no reliance
on sqlite3.Row.
"""
import os
import sqlite3
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import DB_PATH

_TABLES = [
    """CREATE TABLE IF NOT EXISTS letters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        philosopher TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('philosopher', 'user')),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        in_reply_to INTEGER REFERENCES letters(id),
        session_id TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS prefs (
        session_id TEXT PRIMARY KEY,
        user_name TEXT
    )""",
]
_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_letters_philosopher ON letters(philosopher)",
    "CREATE INDEX IF NOT EXISTS idx_letters_created_at ON letters(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_letters_session ON letters(session_id)",
]

TURSO_URL = os.getenv("TURSO_DATABASE_URL") or None
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN") or None
# Local replica file for the embedded-replica mode (ephemeral; re-synced on boot).
_REPLICA = os.getenv("TURSO_REPLICA_PATH") or os.path.join(
    tempfile.gettempdir(), "daimon-replica.db"
)

_booted = False  # have we pulled the cloud state since process start?


def _turso_ready() -> bool:
    """Turso is usable only if its URL is set AND the driver is importable.

    The libsql driver has no Windows wheel, so a local Windows box with the env
    var set must still fall back to SQLite rather than crash on import.
    """
    if not TURSO_URL:
        return False
    try:
        import libsql_experimental  # noqa: F401

        return True
    except Exception:
        return False


_USE_TURSO = _turso_ready()
if TURSO_URL and not _USE_TURSO:
    print(
        "[daimon] WARNING: TURSO_DATABASE_URL is set but the libsql driver is not "
        "installed here -> falling back to local SQLite (not durable). Install the "
        "'turso' extra on a platform with a wheel (e.g. the Linux deploy).",
        flush=True,
    )


def backend() -> str:
    return "turso" if _USE_TURSO else "sqlite"


def _raw_connect():
    if _USE_TURSO:
        import libsql_experimental as libsql  # from the 'turso' extra

        return libsql.connect(_REPLICA, sync_url=TURSO_URL, auth_token=TURSO_TOKEN)
    return sqlite3.connect(DB_PATH)


@contextmanager
def connect():
    """Yield a connection. For Turso, pull cloud state on first use and push
    after every transaction so writes are durable across restarts."""
    global _booted
    conn = _raw_connect()
    turso = _USE_TURSO
    try:
        if turso and not _booted:
            try:
                conn.sync()  # pull latest from the cloud once per process
                _booted = True
            except Exception:
                pass
        yield conn
        conn.commit()
        if turso:
            try:
                conn.sync()  # push this transaction to the cloud
            except Exception:
                pass
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _dicts(cur, cols: list[str]) -> list[dict]:
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _one(cur, cols: list[str]) -> dict | None:
    row = cur.fetchone()
    return dict(zip(cols, row)) if row else None


def init_db() -> None:
    with connect() as conn:
        for stmt in _TABLES:
            conn.execute(stmt)
        # Migrate databases that predate session_id BEFORE creating its index.
        try:
            cols = [r[1] for r in conn.execute("PRAGMA table_info(letters)").fetchall()]
            if "session_id" not in cols:
                conn.execute("ALTER TABLE letters ADD COLUMN session_id TEXT")
        except Exception:
            pass
        for stmt in _INDEXES:
            conn.execute(stmt)


def save_letter(
    philosopher: str,
    role: str,
    body: str,
    in_reply_to: int | None = None,
    session_id: str | None = None,
) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO letters (philosopher, role, body, created_at, in_reply_to, session_id)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (philosopher, role, body, now, in_reply_to, session_id),
        )
        rid = getattr(cur, "lastrowid", None)
        if rid is None:
            rid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        return rid


def recent_letters(
    philosopher: str, n: int = 6, session_id: str | None = None
) -> list[dict]:
    """The n most recent letters for one correspondence, oldest-first."""
    cols = ["id", "role", "body", "created_at"]
    sql = "SELECT id, role, body, created_at FROM letters WHERE philosopher = ?"
    params: list = [philosopher]
    if session_id is not None:
        sql += " AND session_id = ?"
        params.append(session_id)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(n)
    with connect() as conn:
        cur = conn.execute(sql, tuple(params))
        return list(reversed(_dicts(cur, cols)))


def latest_user_reply(philosopher: str, session_id: str | None = None) -> dict | None:
    cols = ["id", "body", "created_at"]
    sql = (
        "SELECT id, body, created_at FROM letters"
        " WHERE philosopher = ? AND role = 'user'"
    )
    params: list = [philosopher]
    if session_id is not None:
        sql += " AND session_id = ?"
        params.append(session_id)
    sql += " ORDER BY id DESC LIMIT 1"
    with connect() as conn:
        return _one(conn.execute(sql, tuple(params)), cols)


def latest_philosopher_letter(
    philosopher: str, session_id: str | None = None
) -> dict | None:
    cols = ["id", "body", "created_at"]
    sql = (
        "SELECT id, body, created_at FROM letters"
        " WHERE philosopher = ? AND role = 'philosopher'"
    )
    params: list = [philosopher]
    if session_id is not None:
        sql += " AND session_id = ?"
        params.append(session_id)
    sql += " ORDER BY id DESC LIMIT 1"
    with connect() as conn:
        return _one(conn.execute(sql, tuple(params)), cols)


def get_letter(letter_id: int) -> dict | None:
    cols = ["id", "philosopher", "role", "body", "created_at", "in_reply_to", "session_id"]
    with connect() as conn:
        cur = conn.execute(
            "SELECT id, philosopher, role, body, created_at, in_reply_to, session_id"
            " FROM letters WHERE id = ?",
            (letter_id,),
        )
        return _one(cur, cols)


def user_replies(session_id: str | None, limit: int = 1000) -> list[dict]:
    """All of a visitor's own replies (across philosophers), newest first.

    This is the raw material for tracking the person's own philosophy.
    """
    cols = ["id", "philosopher", "body", "created_at"]
    sql = "SELECT id, philosopher, body, created_at FROM letters WHERE role = 'user'"
    params: list = []
    if session_id is not None:
        sql += " AND session_id = ?"
        params.append(session_id)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        return _dicts(conn.execute(sql, tuple(params)), cols)


def set_user_name(session_id: str, name: str) -> None:
    """Remember what this visitor wishes to be called (per session)."""
    with connect() as conn:
        conn.execute(
            "INSERT INTO prefs (session_id, user_name) VALUES (?, ?)"
            " ON CONFLICT(session_id) DO UPDATE SET user_name = excluded.user_name",
            (session_id, name),
        )


def get_user_name(session_id: str | None) -> str | None:
    if not session_id:
        return None
    with connect() as conn:
        cur = conn.execute(
            "SELECT user_name FROM prefs WHERE session_id = ?", (session_id,)
        )
        row = cur.fetchone()
        return row[0] if row and row[0] else None
