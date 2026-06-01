from langchain_groq import ChatGroq

from .config import GROQ_API_KEY, MODEL


def get_llm(temperature: float = 0.85) -> ChatGroq:
    if not GROQ_API_KEY:
        raise RuntimeError(
            "GROQ_API_KEY is not set. Get a free key at https://console.groq.com "
            "and add it to your .env file."
        )
    return ChatGroq(
        api_key=GROQ_API_KEY,
        model=MODEL,
        temperature=temperature,
        max_tokens=1024,
    )
