from ..prompts.nietzsche_system import SYSTEM_PROMPT

PERSONA = {
    "key": "nietzsche",
    "display_name": "Friedrich Nietzsche",
    "system_prompt": SYSTEM_PROMPT,
    "salutation": "From the mountains, to {user_name}—",
    "closing": "Become who you are, and dance upon the abyss!",
    "letter_length_words": (180, 350),
}
