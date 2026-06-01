"""Send Daimon letters via the Resend REST API (https://resend.com).

Free-tier friendly. The only hard dependency is ``requests`` (already
installed). Configuration is read from the environment *at call time* so
that callers/tests can toggle behaviour with env vars without re-importing:

    RESEND_API_KEY   — Resend API key. If unset, sending is forced to dry-run.
    DAIMON_FROM_EMAIL — sender, default "Daimon <onboarding@resend.dev>".
    DAIMON_TO_EMAIL   — default recipient (used by the daily cron).
    DAIMON_DRY_RUN    — set to "1" to force dry-run even with a key present.

Dry-run mode never touches the network: it returns and prints a small summary
dict. Network/HTTP errors are returned as ``{"error": ...}`` dicts rather than
raised, so an unattended cron run degrades gracefully instead of crashing.
"""

from __future__ import annotations

import os

import requests

RESEND_ENDPOINT = "https://api.resend.com/emails"
DEFAULT_FROM_EMAIL = "Daimon <onboarding@resend.dev>"
_REQUEST_TIMEOUT_SECONDS = 30


def _env_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _resolve_dry_run(explicit: bool | None, api_key: str | None) -> bool:
    """Decide whether to run in dry-run mode.

    An explicit ``dry_run`` argument always wins. Otherwise dry-run is on
    when the API key is missing OR when ``DAIMON_DRY_RUN`` is truthy.
    """
    if explicit is not None:
        return explicit
    if not api_key:
        return True
    return _env_truthy(os.getenv("DAIMON_DRY_RUN"))


def send_email(
    to: str,
    subject: str,
    html: str,
    *,
    dry_run: bool | None = None,
) -> dict:
    """Send an HTML email through Resend, or simulate it in dry-run mode.

    Args:
        to: Recipient address. Falls back to ``DAIMON_TO_EMAIL`` if empty.
        subject: Email subject line.
        html: Full HTML body.
        dry_run: Force dry-run on/off. When ``None`` (default), dry-run is
            inferred: on if ``RESEND_API_KEY`` is unset or ``DAIMON_DRY_RUN``
            is truthy.

    Returns:
        A dict. In dry-run mode::

            {"dry_run": True, "to": ..., "subject": ..., "html_len": ...}

        On success, the Resend JSON response (typically ``{"id": "..."}``).
        On any failure, ``{"error": "...", ...}`` — never raises for network
        or non-2xx responses.
    """
    api_key = os.getenv("RESEND_API_KEY")
    from_email = os.getenv("DAIMON_FROM_EMAIL", DEFAULT_FROM_EMAIL)
    recipient = to or os.getenv("DAIMON_TO_EMAIL") or ""

    effective_dry_run = _resolve_dry_run(dry_run, api_key)

    if effective_dry_run:
        summary = {
            "dry_run": True,
            "to": recipient,
            "subject": subject,
            "html_len": len(html or ""),
        }
        print(
            f"[daimon.delivery] DRY RUN — would email "
            f"to={recipient!r} subject={subject!r} html_len={summary['html_len']} "
            f"(no network call made)"
        )
        return summary

    if not recipient:
        msg = "No recipient: pass `to` or set DAIMON_TO_EMAIL."
        print(f"[daimon.delivery] ERROR — {msg}")
        return {"error": msg}

    payload = {
        "from": from_email,
        "to": recipient,
        "subject": subject,
        "html": html,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(
            RESEND_ENDPOINT,
            json=payload,
            headers=headers,
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:  # network failure, DNS, timeout
        msg = f"Request to Resend failed: {exc}"
        print(f"[daimon.delivery] ERROR — {msg}")
        return {"error": msg}

    # Parse body defensively — Resend returns JSON, but don't assume it.
    try:
        data = resp.json()
    except ValueError:
        data = {"raw": resp.text}

    if not resp.ok:  # non-2xx — log, don't raise
        print(
            f"[daimon.delivery] ERROR — Resend returned HTTP {resp.status_code}: "
            f"{data}"
        )
        return {"error": f"HTTP {resp.status_code}", "status": resp.status_code, "response": data}

    print(
        f"[daimon.delivery] SENT — to={recipient!r} subject={subject!r} "
        f"id={data.get('id') if isinstance(data, dict) else None}"
    )
    return data if isinstance(data, dict) else {"response": data}
