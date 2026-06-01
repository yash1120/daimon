from . import seneca
from . import aurelius
from . import nietzsche
from . import camus
from . import weil

_PERSONAS = {
    "seneca": seneca.PERSONA,
    "aurelius": aurelius.PERSONA,
    "nietzsche": nietzsche.PERSONA,
    "camus": camus.PERSONA,
    "weil": weil.PERSONA,
}


def available_personas() -> list[str]:
    return list(_PERSONAS.keys())


def get_persona(key: str) -> dict:
    if key not in _PERSONAS:
        raise ValueError(
            f"Unknown philosopher '{key}'. Available: {', '.join(available_personas())}"
        )
    return _PERSONAS[key]
