"""HTML email rendering for Daimon letters.

The single public function :func:`render_letter_email` produces a complete,
self-contained HTML document styled to match Daimon's literary dark/parchment
aesthetic. All CSS is inline (no <style> blocks, no external assets) because
most email clients strip <style>/<head> rules and block remote resources.
"""

from __future__ import annotations

import html as _html
import re as _re

# Palette — kept in sync with Daimon's literary aesthetic.
_BG_DARK = "#0E1320"        # outer background (near-black navy)
_PARCHMENT = "#F5ECD9"      # card background
_INK = "#2B2620"            # primary serif text (warm near-black)
_INK_SOFT = "#5C5345"       # muted footer / subtitle text
_GOLD = "#C9A24B"           # thin divider + accents
_SERIF = "Georgia, 'Times New Roman', Times, serif"


def _paragraphs_to_html(body: str) -> str:
    """Convert a plain-text letter into inline-styled <p>/<br> HTML.

    Blank lines separate paragraphs; single newlines within a paragraph
    become <br>. The text is HTML-escaped first so a stray ``<`` or ``&``
    in the letter can never break the markup.
    """
    normalized = body.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return (
            f'<p style="margin:0;font-family:{_SERIF};font-size:17px;'
            f'line-height:1.75;color:{_INK};">&nbsp;</p>'
        )

    # Split on one-or-more blank lines into paragraph blocks.
    blocks = [b for b in _re.split(r"\n\s*\n", normalized) if b.strip()]
    parts: list[str] = []
    for block in blocks:
        escaped = _html.escape(block.strip())
        # Preserve intra-paragraph line breaks.
        escaped = escaped.replace("\n", "<br>")
        parts.append(
            f'<p style="margin:0 0 18px 0;font-family:{_SERIF};font-size:17px;'
            f'line-height:1.75;color:{_INK};">{escaped}</p>'
        )
    return "\n".join(parts)


def render_letter_email(philosopher_display: str, body: str, date_str: str) -> str:
    """Render a complete HTML email for one philosopher's letter.

    Args:
        philosopher_display: Heading name, e.g. ``"Seneca"`` or
            ``"Marcus Aurelius"``.
        body: The letter text (plain text; newlines preserved as paragraphs).
        date_str: A human-readable date, e.g. ``"01 June 2026"``.

    Returns:
        A full ``<!DOCTYPE html>`` document string with inline CSS only.
    """
    name = _html.escape(philosopher_display.strip() or "Daimon")
    date_safe = _html.escape(date_str.strip())
    body_html = _paragraphs_to_html(body)

    # Note: inline CSS only. Tables are used for layout to maximise email-client
    # compatibility (Outlook/Gmail ignore many block-level CSS rules).
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<title>A letter from {name}</title>
</head>
<body style="margin:0;padding:0;background-color:{_BG_DARK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" \
style="background-color:{_BG_DARK};padding:32px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" \
style="max-width:600px;width:100%;">
        <tr>
          <td style="padding:0 0 18px 0;text-align:center;font-family:{_SERIF};\
font-size:12px;letter-spacing:3px;text-transform:uppercase;color:{_GOLD};">
            Daimon
          </td>
        </tr>
        <tr>
          <td style="background-color:{_PARCHMENT};border-radius:6px;\
padding:44px 40px;box-shadow:0 10px 30px rgba(0,0,0,0.45);">
            <h1 style="margin:0 0 6px 0;font-family:{_SERIF};font-size:30px;\
font-weight:normal;letter-spacing:0.5px;color:{_INK};text-align:center;">
              {name}
            </h1>
            <p style="margin:0 0 22px 0;font-family:{_SERIF};font-size:13px;\
font-style:italic;color:{_INK_SOFT};text-align:center;">
              {date_safe}
            </p>
            <hr style="border:0;border-top:1px solid {_GOLD};width:80px;\
margin:0 auto 28px auto;">
            {body_html}
            <hr style="border:0;border-top:1px solid {_GOLD};width:80px;\
margin:30px auto 18px auto;">
            <p style="margin:0;font-family:{_SERIF};font-size:12px;\
font-style:italic;color:{_INK_SOFT};text-align:center;">
              A daily letter from the works of the philosophers.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 8px 0 8px;text-align:center;font-family:{_SERIF};\
font-size:11px;line-height:1.6;color:#6E7687;">
            You are receiving this because you subscribed to Daimon.<br>
            Reply in your terminal with <span style="color:{_GOLD};">daimon reply</span>.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>"""
