"""Daimon web API — a FastAPI app serving the contemplative reading UI.

This module is intentionally self-contained and read-only with respect to the
rest of the package: it *imports* from db / graph / personas but never mutates
them. It also degrades gracefully when no LLM key is configured, returning a
bundled in-voice SAMPLE letter so the whole UI is demoable with zero setup.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .db import (
    backend,
    get_letter as db_get_letter,
    get_user_name,
    init_db,
    latest_philosopher_letter,
    recent_letters,
    save_letter,
    set_user_name,
    user_replies,
)
from .limits import check_and_consume
from .personas import available_personas, get_persona

WEB_DIR = Path(__file__).parent / "web"

app = FastAPI(title="Daimon", description="Daily letters from the philosophers.")

# Ensure the schema exists before the first request (important on fresh deploys,
# where the very first call may be GET /api/me before any letter is generated).
init_db()
print(f"[daimon] storage backend: {backend()}", flush=True)

# Permissive CORS — convenience for local development / demoing.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Per-visitor session (anonymous cookie) so each person has their own letters. #
# --------------------------------------------------------------------------- #
SID_COOKIE = "daimon_sid"
_SID_MAX_AGE = 60 * 60 * 24 * 365  # one year


def _new_sid() -> str:
    return uuid.uuid4().hex


def session_id(request: Request, response: Response) -> str:
    """FastAPI dependency: read the visitor's session cookie, minting one if absent."""
    sid = request.cookies.get(SID_COOKIE)
    if not sid:
        sid = _new_sid()
        response.set_cookie(
            SID_COOKIE, sid, max_age=_SID_MAX_AGE, httponly=True, samesite="lax"
        )
    return sid


# --------------------------------------------------------------------------- #
# Bundled SAMPLE letters — used when no live LLM is available.                  #
# Each is a tasteful, ~150-word, in-voice placeholder so the UI demos offline. #
# --------------------------------------------------------------------------- #
SAMPLE_LETTERS: dict[str, str] = {
    "seneca": (
        "Seneca to you, greetings.\n\n"
        "You ask how to find calm amid so much noise. I will tell you what I "
        "have learned, though I am still its pupil. We suffer more often in "
        "imagination than in reality; the mind, left unguarded, runs ahead to "
        "meet a thousand griefs that never arrive.\n\n"
        "This morning I watched a slave carry water across the courtyard, "
        "spilling not a drop, his whole attention on the vessel. There is your "
        "philosophy entire: to carry the present hour without spilling it into "
        "dread of the next. Do not ask whether the day will be long. Ask only "
        "what this hour requires, and give it that.\n\n"
        "Begin small. Reclaim one hour today and call it your own. The rest "
        "will follow, as a path follows the first stone laid.\n\n"
        "Vale."
    ),
    "aurelius": (
        "Marcus to you.\n\n"
        "At dawn, when you rise unwillingly, say to yourself: I am rising to do "
        "the work of a human being. Why should I complain, if I am going out to "
        "do that for which I was made, and for the sake of which I was brought "
        "into the world?\n\n"
        "The obstacle in your path is not separate from the path. What stands "
        "in the way becomes the way. The mind adapts and converts to its own "
        "purposes the obstacle to our acting. The impediment to action advances "
        "action.\n\n"
        "Waste no more time arguing about what a good person should be. Be one. "
        "Each thing you do, do as if it were the last thing you would do, free "
        "of all carelessness and willful turning away from reason.\n\n"
        "Do the work of a human being, and be content."
    ),
    "nietzsche": (
        "From the mountains, to you—\n\n"
        "You write to me of weariness, of a life that feels too heavy. Good! "
        "Then you have something worth carrying. The weak seek a life without "
        "weight; the strong ask only that the burden be their own.\n\n"
        "I have been walking these heights since morning, and the air is thin "
        "and clear and merciless. Up here one learns that what does not kill us "
        "makes us stronger — but only if we say Yes to it, only if we will it "
        "again and again, eternally.\n\n"
        "Do not seek to be comforted. Seek to become hard where you must, and "
        "tender where you can choose to be. Build your house on the slopes of "
        "Vesuvius. Send your ships into uncharted seas.\n\n"
        "Become who you are, and dance upon the abyss!"
    ),
    "camus": (
        "Cher ami,\n\n"
        "You ask whether life is worth the trouble of living it. This, I think, "
        "is the only question that matters — and the only honest answer begins "
        "by refusing to lie.\n\n"
        "The world is silent. It owes us no meaning, returns no answer to our "
        "longing. And yet — this morning the sea was the colour of beaten "
        "metal, and a man sold oranges on the quay, singing. There is the "
        "absurd, and there is the orange-seller, and somehow both are true.\n\n"
        "I have come to believe we must imagine Sisyphus happy. The struggle "
        "itself toward the heights is enough to fill a heart. One does not need "
        "hope to act; one needs only to begin, and to refuse despair.\n\n"
        "There is the sun, and there is our task; that is enough."
    ),
    "weil": (
        "To you,\n\n"
        "You tell me your attention scatters like spilled grain, and you cannot "
        "gather it. Do not force it. Attention is not effort of the muscles; it "
        "is a waiting, an emptying, a turning of the whole soul toward what is.\n\n"
        "The simplest task, done with full attention, is a prayer. To look at a "
        "thing as it truly is — a face, a tree, a line of arithmetic — and to "
        "want nothing from it but the truth of it: this is the rarest and most "
        "difficult thing.\n\n"
        "Do not seek consolation. Seek only to see clearly, and to love what "
        "you see for its own sake and not your own. The light enters wherever "
        "the soul has been made empty enough to receive it.\n\n"
        "Attend, and be filled with light."
    ),
}

DEFAULT_SAMPLE = (
    "My friend,\n\n"
    "These words reach you as a sample — the local muse, not the living one. "
    "Set a GROQ_API_KEY in your environment and the philosopher will write to "
    "you in earnest, drawing on the day and on all you have said in return.\n\n"
    "Until then, take this small counsel: the examined hour is never wasted. "
    "Begin where you are, with what you have. The rest will come.\n\n"
    "Vale."
)


def _sample_body(philosopher: str) -> str:
    return SAMPLE_LETTERS.get(philosopher, DEFAULT_SAMPLE)


# Short, in-voice salon answers for the offline demo (paraphrase, not quotation).
SAMPLE_SALON: dict[str, str] = {
    "seneca": (
        "Time is the one thing we treat as worthless and then mourn as priceless. "
        "Decide what this hour is for, give it that wholly, and let tomorrow keep "
        "its own troubles. The examined hour is never wasted."
    ),
    "aurelius": (
        "Ask first what part of this lies within your power and what part does not, "
        "and spend your strength only on the former. The obstacle before you is not "
        "in your way; rightly met, it becomes the way. Then act, and be content."
    ),
    "nietzsche": (
        "Do not ask to be spared the weight - ask that the burden be your own, and "
        "learn to dance beneath it. What does not destroy you, if you will it again "
        "and again, becomes your strength. Make of your life a work you would live "
        "a thousand times."
    ),
    "camus": (
        "The world will give you no answer, and that silence is the beginning of "
        "honesty, not despair. Refuse both the lie of false hope and the surrender "
        "of giving up; live instead in lucid revolt. Picture Sisyphus at his stone, "
        "and imagine him happy."
    ),
    "weil": (
        "Turn the whole of your attention toward the thing itself, wanting nothing "
        "from it but its truth. Such attention, even upon the smallest task, is "
        "already a kind of prayer. Do not fill the emptiness with consolation; "
        "leave it open, and light will enter."
    ),
}


def _sample_salon(keys: list[str]) -> list[dict]:
    return [
        {
            "key": k,
            "display_name": _display_name(k),
            "body": SAMPLE_SALON.get(k, DEFAULT_SAMPLE),
        }
        for k in keys
    ]


def _display_name(philosopher: str) -> str:
    try:
        return get_persona(philosopher)["display_name"]
    except Exception:
        return philosopher.title()


def _fetch_letter(letter_id: int) -> dict | None:
    return db_get_letter(letter_id)


# --------------------------------------------------------------------------- #
# Pydantic request models                                                      #
# --------------------------------------------------------------------------- #
class GenerateRequest(BaseModel):
    philosopher: str = Field(default="seneca")


class ReplyRequest(BaseModel):
    philosopher: str = Field(default="seneca")
    in_reply_to: int | None = None
    body: str = ""


class SalonRequest(BaseModel):
    question: str = ""
    philosophers: list[str] | None = None


class MeRequest(BaseModel):
    name: str = ""


# --------------------------------------------------------------------------- #
# Page + static asset routes                                                   #
# --------------------------------------------------------------------------- #
@app.get("/", include_in_schema=False)
def index(request: Request) -> FileResponse:
    resp = FileResponse(WEB_DIR / "index.html")
    if not request.cookies.get(SID_COOKIE):
        resp.set_cookie(
            SID_COOKIE, _new_sid(), max_age=_SID_MAX_AGE, httponly=True, samesite="lax"
        )
    return resp


# Serve the whole web/ folder at /static (styles.css, app.js, three-bg.js, …).
# index.html references assets as /static/<file>.
app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


# --------------------------------------------------------------------------- #
# JSON API                                                                     #
# --------------------------------------------------------------------------- #
@app.get("/api/philosophers")
def list_philosophers() -> list[dict]:
    out: list[dict] = []
    for key in available_personas():
        persona = get_persona(key)
        out.append({"key": key, "display_name": persona["display_name"]})
    return out


@app.get("/api/letters")
def list_letters(
    philosopher: str = "seneca", limit: int = 50, sid: str = Depends(session_id)
) -> list[dict]:
    limit = max(1, min(limit, 500))
    letters = recent_letters(philosopher, n=limit, session_id=sid)
    return [
        {
            "id": L["id"],
            "role": L["role"],
            "body": L["body"],
            "created_at": L["created_at"],
        }
        for L in letters
    ]


@app.get("/api/letters/{letter_id}")
def get_letter(letter_id: int, sid: str = Depends(session_id)) -> dict:
    letter = _fetch_letter(letter_id)
    if letter is None or letter.get("session_id") != sid:
        raise HTTPException(status_code=404, detail="Letter not found")
    return {
        "id": letter["id"],
        "philosopher": letter["philosopher"],
        "role": letter["role"],
        "body": letter["body"],
        "created_at": letter["created_at"],
        "display_name": _display_name(letter["philosopher"]),
    }


@app.post("/api/generate")
def generate(req: GenerateRequest, sid: str = Depends(session_id)) -> dict:
    philosopher = req.philosopher or "seneca"

    # Validate the philosopher key up front (clear 404 rather than a 500).
    try:
        get_persona(philosopher)
    except Exception:
        raise HTTPException(
            status_code=404, detail=f"Unknown philosopher '{philosopher}'"
        )

    allowed, message = check_and_consume(sid, cost=1)
    if not allowed:
        raise HTTPException(status_code=429, detail=message)

    init_db()

    sample = False
    try:
        # Imported lazily so a broken/absent LLM stack can't stop the app
        # from importing, and so the sample path stays available regardless.
        from .graph import generate_letter

        result = generate_letter(
            philosopher, session_id=sid, user_name=get_user_name(sid)
        )
        body = (result.get("final") or "").strip()
        if not body:
            raise RuntimeError("Empty letter returned")
    except Exception:
        # Any failure (no GROQ_API_KEY, network, import error, …) → SAMPLE.
        body = _sample_body(philosopher)
        sample = True

    letter_id = save_letter(philosopher, "philosopher", body, session_id=sid)
    stored = _fetch_letter(letter_id)
    created_at = stored["created_at"] if stored else datetime.now(timezone.utc).isoformat()

    return {
        "id": letter_id,
        "philosopher": philosopher,
        "display_name": _display_name(philosopher),
        "body": body,
        "created_at": created_at,
        "sample": sample,
    }


@app.post("/api/reply")
def reply(req: ReplyRequest, sid: str = Depends(session_id)) -> dict:
    body = (req.body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Reply body must not be empty")

    philosopher = req.philosopher or "seneca"
    init_db()

    in_reply_to = req.in_reply_to
    if in_reply_to is None:
        # Best-effort: thread under the latest philosopher letter if present.
        last = latest_philosopher_letter(philosopher, session_id=sid)
        if last:
            in_reply_to = last["id"]

    reply_id = save_letter(philosopher, "user", body, in_reply_to, session_id=sid)
    return {"id": reply_id}


@app.post("/api/salon")
def salon(req: SalonRequest, sid: str = Depends(session_id)) -> dict:
    """Pose one question to several philosophers; each answers in their own voice."""
    question = (req.question or "").strip()
    if not question:
        raise HTTPException(status_code=422, detail="Question must not be empty")

    valid = available_personas()
    keys = [k for k in (req.philosophers or valid) if k in valid] or valid

    allowed, message = check_and_consume(sid, cost=len(keys))
    if not allowed:
        raise HTTPException(status_code=429, detail=message)

    sample = False
    try:
        from .salon import hold_salon

        responses = hold_salon(question, keys, user_name=get_user_name(sid))
        if not responses:
            raise RuntimeError("No responses")
    except Exception:
        responses = _sample_salon(keys)
        sample = True

    return {"question": question, "sample": sample, "responses": responses}


@app.get("/api/me")
def get_me(sid: str = Depends(session_id)) -> dict:
    """What this visitor is called (empty string if they haven't said)."""
    return {"name": get_user_name(sid) or ""}


@app.post("/api/me")
def set_me(req: MeRequest, sid: str = Depends(session_id)) -> dict:
    """Remember what this visitor wishes the philosophers to call them."""
    name = (req.name or "").strip()[:60]
    if name:
        set_user_name(sid, name)
    return {"name": name}


@app.get("/api/health")
def health() -> dict:
    """Report the active storage backend and whether a DB read works.
    Use this to confirm Turso is live on the deployed Space."""
    ok = True
    try:
        user_replies("__health__", limit=1)  # cheap read; exercises a real connect
    except Exception:
        ok = False
    return {"status": "ok" if ok else "degraded", "backend": backend()}


@app.get("/api/philosophy")
def philosophy(sid: str = Depends(session_id)) -> dict:
    """The recurring concepts in THIS visitor's own replies — their philosophy
    taking shape over time. Computed on demand from their stored replies."""
    from collections import Counter

    from .themes import extract_concepts

    replies = user_replies(sid, limit=1000)
    counts: Counter = Counter()
    cooc: Counter = Counter()
    for r in replies:
        concepts = sorted(set(extract_concepts(r.get("body", "") or "")))
        counts.update(concepts)
        for i in range(len(concepts)):
            for j in range(i + 1, len(concepts)):
                cooc[(concepts[i], concepts[j])] += 1

    return {
        "total_replies": len(replies),
        "concepts": [{"name": k, "weight": v} for k, v in counts.most_common(40)],
        "edges": [
            {"source": a, "target": b, "weight": w}
            for (a, b), w in cooc.most_common(60)
        ],
    }
