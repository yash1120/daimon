from ..prompts.seneca_system import SYSTEM_PROMPT

PERSONA = {
    "key": "seneca",
    "display_name": "Lucius Annaeus Seneca",
    "system_prompt": SYSTEM_PROMPT,
    "salutation": "Seneca to {user_name}, greetings.",
    "closing": "Vale.",
    "letter_length_words": (180, 350),
}
