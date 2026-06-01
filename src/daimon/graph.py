from __future__ import annotations

from datetime import datetime, timezone
from typing import TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from .config import USER_NAME
from .db import latest_philosopher_letter, latest_user_reply, recent_letters
from .llm import get_llm
from .personas import get_persona


class LetterState(TypedDict, total=False):
    philosopher: str
    session_id: str | None
    user_name: str | None
    persona: dict
    history: list[dict]
    user_reply: dict | None
    last_letter: dict | None
    letter_type: str
    brief: str
    draft: str
    final: str


def load_context_node(state: LetterState) -> LetterState:
    p = state["philosopher"]
    sid = state.get("session_id")
    return {
        **state,
        "persona": get_persona(p),
        "history": recent_letters(p, n=6, session_id=sid),
        "user_reply": latest_user_reply(p, session_id=sid),
        "last_letter": latest_philosopher_letter(p, session_id=sid),
    }


def planner_node(state: LetterState) -> LetterState:
    history = state["history"]
    user_reply = state["user_reply"]
    last_letter = state["last_letter"]

    if not history:
        letter_type = "opening"
        brief = (
            "First letter in the correspondence. Introduce yourself warmly. "
            "Choose a small theme — perhaps the practice of writing itself, "
            "or the value of taking one small thing each day seriously."
        )
    elif user_reply and (not last_letter or user_reply["id"] > last_letter["id"]):
        letter_type = "response"
        snippet = user_reply["body"][:600]
        brief = (
            "The friend has just replied. Open by acknowledging what they wrote, "
            f"then enlarge into a related reflection.\n\nTheir reply:\n\"{snippet}\""
        )
    else:
        letter_type = "provocation"
        brief = (
            "The friend has been silent since your last letter. Write a fresh "
            "observation from your day — a concrete moment that becomes a "
            "meditation. Do not mention their silence."
        )
    return {**state, "letter_type": letter_type, "brief": brief}


def _grounding_passages(philosopher: str, brief: str) -> list[str]:
    """Retrieve passages from the philosopher's own works to ground the letter.

    Fails open: if retrieval is unavailable, the letter is written without
    grounding (philosophers with no corpus simply return nothing).
    """
    try:
        from .rag import retrieve as rag_retrieve

        return [r["text"] for r in rag_retrieve(brief, philosopher=philosopher, k=3)]
    except Exception:
        return []


def drafter_node(state: LetterState) -> LetterState:
    llm = get_llm(temperature=0.85)
    persona = state["persona"]

    history_str = "\n\n".join(
        f"[{h['role'].upper()}, prior]\n{h['body']}" for h in state["history"]
    ) or "(no prior correspondence)"

    grounding = _grounding_passages(state["philosopher"], state["brief"])
    grounding_str = ""
    if grounding:
        joined = "\n\n".join(f"- {g}" for g in grounding)
        grounding_str = (
            "\nPASSAGES FROM YOUR OWN WRITINGS (let these steep the spirit, "
            "imagery, and themes of your letter — render them in fresh words; "
            f"do NOT quote verbatim or cite):\n{joined}\n"
        )

    name = state.get("user_name") or USER_NAME
    system = persona["system_prompt"].replace("{user_name}", name)
    user_msg = (
        f"PLANNER BRIEF: {state['brief']}\n\n"
        f"RECENT CORRESPONDENCE (oldest first):\n{history_str}\n"
        f"{grounding_str}\n"
        f"Write the next letter now. Today's date in our era: "
        f"{datetime.now(timezone.utc).strftime('%d %B %Y')}."
    )

    response = llm.invoke([SystemMessage(content=system), HumanMessage(content=user_msg)])
    return {**state, "draft": response.content}


def polisher_node(state: LetterState) -> LetterState:
    text = state["draft"].strip()
    # Strip accidental markdown fences if the model emitted any.
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0].strip()
    return {**state, "final": text}


def build_graph():
    g = StateGraph(LetterState)
    g.add_node("load_context", load_context_node)
    g.add_node("planner", planner_node)
    g.add_node("drafter", drafter_node)
    g.add_node("polisher", polisher_node)

    g.add_edge(START, "load_context")
    g.add_edge("load_context", "planner")
    g.add_edge("planner", "drafter")
    g.add_edge("drafter", "polisher")
    g.add_edge("polisher", END)

    return g.compile()


def generate_letter(
    philosopher: str = "seneca",
    session_id: str | None = None,
    user_name: str | None = None,
) -> dict:
    graph = build_graph()
    return graph.invoke(
        {"philosopher": philosopher, "session_id": session_id, "user_name": user_name}
    )
