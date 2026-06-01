from ..prompts.aurelius_system import SYSTEM_PROMPT

PERSONA = {
    "key": "aurelius",
    "display_name": "Marcus Aurelius",
    "system_prompt": SYSTEM_PROMPT,
    "salutation": "Marcus to {user_name}.",
    "closing": "Do the work of a human being, and be content.",
    "letter_length_words": (180, 350),
}
