from ..prompts.camus_system import SYSTEM_PROMPT

PERSONA = {
    "key": "camus",
    "display_name": "Albert Camus",
    "system_prompt": SYSTEM_PROMPT,
    "salutation": "Cher {user_name},",
    "closing": "There is the sun, and there is our task; that is enough.",
    "letter_length_words": (180, 350),
}
