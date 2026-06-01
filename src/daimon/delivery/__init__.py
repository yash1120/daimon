"""Daimon delivery — email rendering, sending, and the daily cron entrypoint.

This package is additive: it depends on the existing public surface of
``daimon`` (``graph.generate_letter``, ``db.init_db`` / ``db.save_letter``,
``config.USER_NAME``) but does not modify it.
"""

from .email_send import send_email
from .template import render_letter_email

__all__ = ["send_email", "render_letter_email"]
