"""Daily cron entrypoint: generate today's letter and email it.

Run as::

    python -m daimon.delivery.daily

Flow:
    1. Resolve the philosopher from ``DAIMON_PHILOSOPHER`` (default "seneca").
    2. ``init_db()`` (idempotent).
    3. ``generate_letter(philosopher)`` -> take ``result["final"]``.
    4. ``save_letter(philosopher, "philosopher", body)``.
    5. Render the HTML email and ``send_email(...)`` to ``DAIMON_TO_EMAIL``.

Graceful degradation:
    * If ``GROQ_API_KEY`` is missing, log and exit 0 (so a secret-less CI run
      does not fail the workflow).
    * Email sending defers to ``send_email``'s dry-run logic, so a missing
      ``RESEND_API_KEY`` simply prints the payload instead of sending.

Importing this module has no side effects; the run logic lives in ``main()``
behind an ``if __name__ == "__main__"`` guard.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

from .email_send import send_email
from .template import render_letter_email


def _resolve_display_name(philosopher: str) -> str:
    """Best-effort human-readable name for the philosopher.

    Uses the persona registry's ``display_name`` when available; otherwise
    falls back to a title-cased key (e.g. "seneca" -> "Seneca"). Never raises.
    """
    try:
        from ..personas import get_persona

        return get_persona(philosopher).get("display_name") or philosopher.title()
    except Exception:
        return philosopher.replace("_", " ").title()


def _groq_key_present() -> bool:
    """True if a Groq API key is configured (env or daimon.config)."""
    if os.getenv("GROQ_API_KEY"):
        return True
    try:
        from .. import config

        return bool(getattr(config, "GROQ_API_KEY", None))
    except Exception:
        return False


def main() -> int:
    """Run the daily letter pipeline. Returns a process exit code."""
    philosopher = os.getenv("DAIMON_PHILOSOPHER", "seneca").strip() or "seneca"
    display_name = _resolve_display_name(philosopher)

    # Guard the live LLM call: without a key, exit cleanly so CI stays green.
    if not _groq_key_present():
        print(
            "[daimon.delivery.daily] GROQ_API_KEY not set — skipping letter "
            "generation and exiting cleanly (no email sent). Set GROQ_API_KEY "
            "to enable the daily letter."
        )
        return 0

    # Imported lazily so that simply importing this module (e.g. in CI smoke
    # tests) never pulls in langgraph / network-capable code.
    from ..db import init_db, save_letter
    from ..graph import generate_letter

    init_db()

    print(f"[daimon.delivery.daily] Generating letter from {display_name!r}...")
    try:
        result = generate_letter(philosopher)
    except Exception as exc:  # LLM/runtime failure — don't crash the cron hard
        print(f"[daimon.delivery.daily] ERROR generating letter: {exc}")
        return 1

    body = (result or {}).get("final")
    if not body or not str(body).strip():
        print("[daimon.delivery.daily] ERROR — generator returned an empty letter.")
        return 1
    body = str(body).strip()

    letter_id = save_letter(philosopher, "philosopher", body)
    print(f"[daimon.delivery.daily] Saved letter #{letter_id}.")

    date_str = datetime.now(timezone.utc).strftime("%d %B %Y")
    html = render_letter_email(display_name, body, date_str)

    to_email = os.getenv("DAIMON_TO_EMAIL", "")
    subject = f"A letter from {display_name}"
    send_result = send_email(to=to_email, subject=subject, html=html)

    if "error" in send_result:
        print(f"[daimon.delivery.daily] Email step reported an error: {send_result['error']}")
        return 1

    print("[daimon.delivery.daily] Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
