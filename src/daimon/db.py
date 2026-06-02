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
        session_id TEXT,
        bookmarked INTEGER DEFAULT 0
    )""",
    """CREATE TABLE IF NOT EXISTS prefs (
        session_id TEXT PRIMARY KEY,
        user_name TEXT,
        theme TEXT,
        tts INTEGER DEFAULT 0,
        default_philosopher TEXT
    )""",
]

# columns added after the original schema shipped -> migrated in init_db
_MIGRATIONS = {
    "letters": {"session_id": "TEXT", "bookmarked": "INTEGER DEFAULT 0"},
    "prefs": {"theme": "TEXT", "tts": "INTEGER DEFAULT 0", "default_philosopher": "TEXT"},
}
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


def _ensure_columns(conn, table: str, coldefs: dict[str, str]) -> None:
    existing = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    for col, decl in coldefs.items():
        if col not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


def init_db() -> None:
    with connect() as conn:
        for stmt in _TABLES:
            conn.execute(stmt)
        # Migrate older databases (add any columns introduced after first ship)
        # BEFORE creating indexes that may reference them.
        try:
            for table, coldefs in _MIGRATIONS.items():
                _ensure_columns(conn, table, coldefs)
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
    cols = ["id", "philosopher", "role", "body", "created_at", "in_reply_to",
            "session_id", "bookmarked"]
    with connect() as conn:
        cur = conn.execute(
            "SELECT id, philosopher, role, body, created_at, in_reply_to,"
            " session_id, bookmarked FROM letters WHERE id = ?",
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


def set_bookmark(letter_id: int, session_id: str | None, on: bool) -> None:
    with connect() as conn:
        if session_id is not None:
            conn.execute(
                "UPDATE letters SET bookmarked = ? WHERE id = ? AND session_id = ?",
                (1 if on else 0, letter_id, session_id),
            )
        else:
            conn.execute(
                "UPDATE letters SET bookmarked = ? WHERE id = ?",
                (1 if on else 0, letter_id),
            )


def list_bookmarks(session_id: str | None, limit: int = 200) -> list[dict]:
    cols = ["id", "philosopher", "role", "body", "created_at"]
    sql = ("SELECT id, philosopher, role, body, created_at FROM letters"
           " WHERE bookmarked = 1")
    params: list = []
    if session_id is not None:
        sql += " AND session_id = ?"
        params.append(session_id)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        return _dicts(conn.execute(sql, tuple(params)), cols)


def search_letters(session_id: str | None, q: str, limit: int = 50) -> list[dict]:
    cols = ["id", "philosopher", "role", "body", "created_at"]
    sql = ("SELECT id, philosopher, role, body, created_at FROM letters"
           " WHERE body LIKE ?")
    params: list = [f"%{q}%"]
    if session_id is not None:
        sql += " AND session_id = ?"
        params.append(session_id)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        return _dicts(conn.execute(sql, tuple(params)), cols)


def stats(session_id: str | None) -> dict:
    where = "WHERE session_id = ?" if session_id is not None else "WHERE 1=1"
    p: tuple = (session_id,) if session_id is not None else ()
    with connect() as conn:
        letters = conn.execute(
            f"SELECT COUNT(*) FROM letters {where} AND role='philosopher'", p
        ).fetchone()[0]
        replies = conn.execute(
            f"SELECT COUNT(*) FROM letters {where} AND role='user'", p
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT philosopher, COUNT(*) FROM letters {where} AND role='philosopher'"
            " GROUP BY philosopher", p
        ).fetchall()
        by_phil = {r[0]: r[1] for r in rows}
        dates = [r[0][:10] for r in conn.execute(
            f"SELECT created_at FROM letters {where}", p
        ).fetchall() if r[0]]

    days = sorted(set(dates))
    streak = 0
    if days:
        from datetime import date, timedelta

        dset = set(days)
        cur = date.fromisoformat(days[-1])
        while cur.isoformat() in dset:
            streak += 1
            cur = cur - timedelta(days=1)
    return {
        "letters": letters,
        "replies": replies,
        "active_days": len(days),
        "streak": streak,
        "by_philosopher": by_phil,
    }


def get_prefs(session_id: str | None) -> dict:
    out = {"name": "", "theme": "", "tts": False, "default_philosopher": ""}
    if not session_id:
        return out
    with connect() as conn:
        cur = conn.execute(
            "SELECT user_name, theme, tts, default_philosopher FROM prefs"
            " WHERE session_id = ?",
            (session_id,),
        )
        row = cur.fetchone()
    if row:
        out["name"] = row[0] or ""
        out["theme"] = row[1] or ""
        out["tts"] = bool(row[2])
        out["default_philosopher"] = row[3] or ""
    return out


def set_prefs(session_id: str, **fields) -> None:
    if "name" in fields:
        fields["user_name"] = fields.pop("name")
    if "tts" in fields:
        fields["tts"] = 1 if fields["tts"] else 0
    allowed = {"user_name", "theme", "tts", "default_philosopher"}
    fields = {k: v for k, v in fields.items() if k in allowed}
    if not fields:
        return
    with connect() as conn:
        conn.execute("INSERT OR IGNORE INTO prefs (session_id) VALUES (?)", (session_id,))
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE prefs SET {sets} WHERE session_id = ?",
            (*fields.values(), session_id),
        )
