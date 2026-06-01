import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import DB_PATH

TABLES = """
CREATE TABLE IF NOT EXISTS letters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    philosopher TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('philosopher', 'user')),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    in_reply_to INTEGER REFERENCES letters(id),
    session_id TEXT
);

CREATE TABLE IF NOT EXISTS prefs (
    session_id TEXT PRIMARY KEY,
    user_name TEXT
);
"""

INDEXES = """
CREATE INDEX IF NOT EXISTS idx_letters_philosopher ON letters(philosopher);
CREATE INDEX IF NOT EXISTS idx_letters_created_at ON letters(created_at);
CREATE INDEX IF NOT EXISTS idx_letters_session ON letters(session_id);
"""


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(TABLES)
        # Migrate databases that predate the session_id column BEFORE building
        # the session index (which would otherwise fail on the old schema).
        cols = [r[1] for r in conn.execute("PRAGMA table_info(letters)").fetchall()]
        if "session_id" not in cols:
            conn.execute("ALTER TABLE letters ADD COLUMN session_id TEXT")
        conn.executescript(INDEXES)


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
        return cur.lastrowid


def recent_letters(
    philosopher: str, n: int = 6, session_id: str | None = None
) -> list[dict]:
    """The n most recent letters for one correspondence, oldest-first.

    When session_id is given, only that visitor's letters are returned;
    when None (CLI / local use), the philosopher's whole history is returned.
    """
    sql = "SELECT id, role, body, created_at FROM letters WHERE philosopher = ?"
    params: list = [philosopher]
    if session_id is not None:
        sql += " AND session_id = ?"
        params.append(session_id)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(n)
    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in reversed(rows)]


def latest_user_reply(philosopher: str, session_id: str | None = None) -> dict | None:
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
        row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None


def latest_philosopher_letter(
    philosopher: str, session_id: str | None = None
) -> dict | None:
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
        row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None


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
        row = conn.execute(
            "SELECT user_name FROM prefs WHERE session_id = ?", (session_id,)
        ).fetchone()
        return row["user_name"] if row and row["user_name"] else None
