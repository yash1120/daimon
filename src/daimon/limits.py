"""In-memory rate limiting to protect the shared Groq key on a public deploy.

Two windows: a per-visitor hourly cap and a global daily cap. Counts are kept
in memory (fine for a single-worker Space); they reset on restart. All limits
are env-configurable.
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

SESSION_PER_HOUR = int(os.getenv("DAIMON_RATE_SESSION_PER_HOUR", "20"))
GLOBAL_PER_DAY = int(os.getenv("DAIMON_RATE_GLOBAL_PER_DAY", "500"))

_HOUR = 3600
_DAY = 86400

_lock = threading.Lock()
_session_hits: dict[str, deque] = defaultdict(deque)
_global_hits: deque = deque()


def check_and_consume(session_id: str, cost: int = 1) -> tuple[bool, str]:
    """Try to spend `cost` units. Returns (allowed, message_if_blocked)."""
    now = time.time()
    sid = session_id or "anon"
    with _lock:
        dq = _session_hits[sid]
        while dq and now - dq[0] > _HOUR:
            dq.popleft()
        while _global_hits and now - _global_hits[0] > _DAY:
            _global_hits.popleft()

        if len(dq) + cost > SESSION_PER_HOUR:
            return False, (
                "You've reached this demo's hourly limit. The philosophers need "
                "a little rest — please try again later."
            )
        if len(_global_hits) + cost > GLOBAL_PER_DAY:
            return False, (
                "The salon is at capacity for today. Please come back tomorrow."
            )

        for _ in range(cost):
            dq.append(now)
            _global_hits.append(now)
        return True, ""
