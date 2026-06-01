"""Salon mode — pose one question to several philosophers at once.

Each philosopher answers independently and in parallel, grounded by RAG in
their own corpus. Needs a live LLM (GROQ_API_KEY); the web layer supplies a
sample fallback so the salon is demoable offline.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from langchain_core.messages import HumanMessage, SystemMessage

from .config import USER_NAME
from .llm import get_llm
from .personas import available_personas, get_persona


def _grounding(question: str, key: str) -> list[str]:
    try:
        from .rag import retrieve as rag_retrieve

        return [r["text"] for r in rag_retrieve(question, philosopher=key, k=2)]
    except Exception:
        return []


def _salon_user_msg(question: str, grounding: list[str], user_name: str) -> str:
    g = ""
    if grounding:
        joined = "\n\n".join(f"- {p}" for p in grounding)
        g = (
            "\nFRAGMENTS OF YOUR OWN THOUGHT (let these inform your reply in fresh "
            f"words; do not quote or cite):\n{joined}\n"
        )
    return (
        f"You are seated in a salon among other philosophers. {user_name} has put "
        f'this question to the gathering:\n\n"{question}"\n'
        f"{g}\n"
        "Answer aloud in your own unmistakable voice - roughly 110-160 words. "
        "Speak directly and concretely, as in living conversation. For THIS reply "
        "only: do NOT open with a salutation, do NOT sign off, do NOT use markdown. "
        "Begin speaking immediately."
    )


def _respond(key: str, question: str, user_name: str) -> dict:
    persona = get_persona(key)
    llm = get_llm(temperature=0.8)
    system = persona["system_prompt"].replace("{user_name}", user_name)
    user = _salon_user_msg(question, _grounding(question, key), user_name)
    resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
    return {
        "key": key,
        "display_name": persona["display_name"],
        "body": resp.content.strip(),
    }


def hold_salon(
    question: str,
    philosophers: list[str] | None = None,
    user_name: str | None = None,
) -> list[dict]:
    """Return each philosopher's spoken answer to one question (run in parallel)."""
    name = user_name or USER_NAME
    valid = available_personas()
    keys = [k for k in (philosophers or valid) if k in valid] or valid
    with ThreadPoolExecutor(max_workers=min(5, len(keys))) as ex:
        results = list(ex.map(lambda k: _respond(k, question, name), keys))
    order = {k: i for i, k in enumerate(keys)}
    results.sort(key=lambda r: order.get(r["key"], 0))
    return results
