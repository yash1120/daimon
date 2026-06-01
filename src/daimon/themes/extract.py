"""Concept extraction from free text.

Default mode is deterministic and offline: a curated philosophy concept lexicon
matched case-insensitively against the text, with light stemming via substring
triggers and synonym mapping (e.g. "afraid" -> fear, "dying" -> death).

An optional ``use_llm=True`` branch is provided that lazily imports the project's
LLM. It is NEVER exercised by the test suite and must not be relied upon for the
core path.
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Curated concept lexicon.
#
# Maps each canonical concept -> list of trigger tokens. A trigger matches when
# it appears as a whole word OR as a prefix of a word (cheap stemming), so
# "fear" also catches "fears"/"fearful" and "die" catches "dies"/"died".
# Multi-word triggers (e.g. "the body") are matched as substrings.
# ---------------------------------------------------------------------------

CONCEPT_LEXICON: dict[str, list[str]] = {
    "death": [
        "death", "die", "dying", "died", "dies", "dead", "mortal",
        "mortality", "grave", "funeral", "perish", "demise", "deceased",
    ],
    "time": [
        "time", "busy", "hurry", "hurried", "rush", "rushing", "deadline",
        "schedule", "clock", "hour", "fleeting", "transient", "impermanence",
        "moment", "procrastinat",
    ],
    "freedom": [
        "freedom", "free", "liberty", "liberation", "liberate", "autonomy",
        "independence", "independent", "unconstrained",
    ],
    "fear": [
        "fear", "afraid", "scared", "scare", "anxious", "anxiety", "dread",
        "terror", "terrified", "worry", "worried", "worries", "panic",
        "frightened", "apprehensi",
    ],
    "virtue": [
        "virtue", "virtuous", "integrity", "honesty", "honourable",
        "honorable", "righteous", "uprightness", "character", "moral",
    ],
    "friendship": [
        "friendship", "friend", "companion", "companionship", "kinship",
        "fellowship", "comrade",
    ],
    "anger": [
        "anger", "angry", "rage", "wrath", "fury", "furious", "irritat",
        "resentment", "resentful", "indignation", "bitter", "bitterness",
    ],
    "desire": [
        "desire", "crave", "craving", "longing", "long for", "yearn",
        "wanting", "lust", "appetite", "greed", "greedy", "covet", "want",
    ],
    "meaning": [
        "meaning", "meaningful", "meaningless", "purpose", "purposeless",
        "significance", "absurd", "absurdity", "nihilis", "pointless",
        "futile", "futility",
    ],
    "suffering": [
        "suffer", "suffering", "pain", "painful", "anguish", "torment",
        "misery", "miserable", "agony", "hardship", "affliction", "hurt",
    ],
    "duty": [
        "duty", "obligation", "obligated", "responsibility", "responsible",
        "ought", "burden", "commitment",
    ],
    "justice": [
        "justice", "just", "injustice", "unjust", "fairness", "fair",
        "unfair", "equity", "equitable", "rights",
    ],
    "love": [
        "love", "loving", "beloved", "affection", "tenderness", "intimacy",
        "intimate", "devotion", "romance", "romantic",
    ],
    "solitude": [
        "solitude", "alone", "lonely", "loneliness", "isolation", "isolated",
        "withdrawal", "seclusion", "solitary", "hermit",
    ],
    "ambition": [
        "ambition", "ambitious", "aspiration", "aspire", "striving",
        "achievement", "achieve", "success", "successful", "status",
        "promotion", "career",
    ],
    "doubt": [
        "doubt", "doubtful", "uncertain", "uncertainty", "skeptic",
        "sceptic", "questioning", "hesitat", "unsure", "confusion",
        "confused", "indecision",
    ],
    "change": [
        "change", "changing", "transform", "transition", "flux", "shift",
        "shifting", "impermanent", "evolve", "evolving", "becoming",
    ],
    "the body": [
        "the body", "bodily", "flesh", "physical", "illness", "sick",
        "sickness", "disease", "exercise", "health", "fatigue", "tired",
        "exhaust", "ageing", "aging",
    ],
    "work": [
        "work", "working", "labour", "labor", "toil", "job", "occupation",
        "vocation", "craft", "profession", "productivity", "productive",
    ],
    "happiness": [
        "happiness", "happy", "joy", "joyful", "contentment", "content",
        "delight", "cheerful", "bliss", "fulfilment", "fulfillment",
        "flourish", "eudaimonia", "well-being", "wellbeing",
    ],
    "fate": [
        "fate", "fated", "destiny", "destined", "providence", "luck",
        "lucky", "chance", "fortune", "misfortune", "inevitab",
    ],
    "control": [
        "control", "controlling", "uncontroll", "acceptance", "accept",
        "letting go", "surrender", "powerless", "helpless", "discipline",
        "self-control", "restraint",
    ],
    "memory": [
        "memory", "memories", "remember", "remembering", "remembrance",
        "recollection", "nostalgia", "nostalgic", "the past", "reminisce",
        "forget", "forgetting",
    ],
    "courage": [
        "courage", "courageous", "brave", "bravery", "boldness", "bold",
        "valour", "valor", "fortitude", "daring", "resolve",
    ],
    "ego": [
        "ego", "pride", "proud", "vanity", "vain", "arrogance", "arrogant",
        "self-importance", "selfish", "narcissis", "conceit",
    ],
    "wisdom": [
        "wisdom", "wise", "prudence", "prudent", "insight", "understanding",
        "sagacity", "discernment", "philosophy", "philosophical",
    ],
    "hope": [
        "hope", "hopeful", "hopeless", "optimism", "optimistic", "expectation",
        "anticipation", "longing for the future",
    ],
    "doubt_of_self": [],  # placeholder kept empty intentionally; see note below
}

# Drop any intentionally-empty buckets so they never match.
CONCEPT_LEXICON = {k: v for k, v in CONCEPT_LEXICON.items() if v}

# Pre-split triggers into single-word (prefix-matchable) vs multi-word
# (substring-matchable) for efficient matching.
_WORD_TRIGGERS: list[tuple[str, str]] = []  # (concept, trigger)
_PHRASE_TRIGGERS: list[tuple[str, str]] = []  # (concept, trigger)
for _concept, _triggers in CONCEPT_LEXICON.items():
    for _t in _triggers:
        if " " in _t or "-" in _t:
            _PHRASE_TRIGGERS.append((_concept, _t.lower()))
        else:
            _WORD_TRIGGERS.append((_concept, _t.lower()))

_TOKEN_RE = re.compile(r"[a-z]+")


def _canonical_concepts(text: str) -> set[str]:
    """Return the set of canonical concepts triggered by ``text``."""
    if not text:
        return set()
    lowered = text.lower()
    found: set[str] = set()

    # Phrase / hyphenated triggers: substring match on the raw lowercased text.
    for concept, trigger in _PHRASE_TRIGGERS:
        if trigger in lowered:
            found.add(concept)

    # Word triggers: tokenise, then prefix-match each token against triggers.
    tokens = _TOKEN_RE.findall(lowered)
    if tokens:
        token_set = set(tokens)
        for concept, trigger in _WORD_TRIGGERS:
            if concept in found:
                continue
            # Fast path: exact token present.
            if trigger in token_set:
                found.add(concept)
                continue
            # Stemming path: trigger is a prefix of some token (len>=3 to avoid
            # spurious matches), or a token is a prefix of the trigger.
            if len(trigger) >= 3:
                for tok in tokens:
                    # token is an inflected form of the trigger ("fear"->"fearful"),
                    # or the trigger is an inflected form of a (>=4 char) token.
                    if tok.startswith(trigger) or (len(tok) >= 4 and trigger.startswith(tok)):
                        found.add(concept)
                        break
    return found


def extract_concepts(text: str, *, use_llm: bool = False) -> list[str]:
    """Extract canonical philosophy concepts from ``text``.

    Parameters
    ----------
    text:
        Free-form text (typically one of the user's replies).
    use_llm:
        When ``False`` (default) a deterministic, offline keyword lexicon is
        used. When ``True`` the project's LLM is lazily imported and asked to
        extract concepts, falling back to the deterministic path on any error.
        The LLM path is never used by the test suite.

    Returns
    -------
    list[str]
        Sorted list of unique canonical concept names.
    """
    if use_llm:
        try:
            return _extract_with_llm(text)
        except Exception:
            # Never let the optional path break the core feature.
            pass
    return sorted(_canonical_concepts(text))


# ---------------------------------------------------------------------------
# Optional LLM extractor. Imported lazily so that importing this module never
# pulls in langchain/groq, and so tests stay fully offline.
# ---------------------------------------------------------------------------

_LLM_SYSTEM = (
    "You extract recurring philosophical/emotional THEMES from a person's "
    "writing. Return ONLY a comma-separated list of short lowercase concept "
    "nouns (e.g. death, time, freedom, fear, ambition). No sentences, no "
    "explanations. Prefer the canonical single-word concept where possible."
)


def _extract_with_llm(text: str) -> list[str]:  # pragma: no cover - not run in tests
    """Use the project's Groq LLM to extract concepts.

    Falls back (by raising, handled in ``extract_concepts``) is not done here;
    this returns a parsed list or raises. Results are unioned with the
    deterministic matches so the lexicon acts as a floor.
    """
    from langchain_core.messages import HumanMessage, SystemMessage

    from ..llm import get_llm

    llm = get_llm(temperature=0.0)
    resp = llm.invoke(
        [
            SystemMessage(content=_LLM_SYSTEM),
            HumanMessage(content=text[:4000]),
        ]
    )
    raw = getattr(resp, "content", "") or ""
    parts = re.split(r"[,\n;]+", str(raw))
    concepts = {
        p.strip().lower()
        for p in parts
        if p.strip() and len(p.strip()) <= 30 and re.match(r"^[a-z][a-z \-]*$", p.strip().lower())
    }
    # Union with the deterministic lexicon so we never regress below keyword hits.
    concepts |= _canonical_concepts(text)
    return sorted(concepts)
