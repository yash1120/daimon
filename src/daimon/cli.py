from __future__ import annotations

import sys
from datetime import datetime

import click
from rich.console import Console
from rich.panel import Panel

from .config import USER_NAME
from .db import (
    init_db,
    latest_philosopher_letter,
    recent_letters,
    save_letter,
)
from .graph import generate_letter
from .personas import available_personas, get_persona

console = Console()


@click.group()
def cli():
    """Daimon — daily letters from philosophers."""


@cli.command()
def init():
    """Initialize the local database."""
    init_db()
    console.print("[green]Daimon initialized.[/green]")
    console.print(f"Available philosophers: {', '.join(available_personas())}")
    console.print("\nGet your first letter: [bold]daimon write[/bold]")


@cli.command()
@click.option(
    "--philosopher", "-p", default="seneca",
    help="Which philosopher writes you.",
)
def write(philosopher: str):
    """Generate today's letter from the philosopher."""
    init_db()  # idempotent
    persona = get_persona(philosopher)

    with console.status(f"[dim]{persona['display_name']} is writing...[/dim]"):
        result = generate_letter(philosopher)

    letter = result["final"]
    letter_id = save_letter(philosopher=philosopher, role="philosopher", body=letter)

    console.print()
    console.print(
        Panel(
            letter,
            title=f"[bold]Letter #{letter_id} — from {persona['display_name']}[/bold]",
            subtitle=(
                f"[dim]{datetime.now().strftime('%d %B %Y')} · "
                f"{result['letter_type']}[/dim]"
            ),
            border_style="cyan",
            padding=(1, 2),
        )
    )
    console.print("\n[dim]Reply when you're ready:[/dim] [bold]daimon reply[/bold]")


@cli.command()
@click.option(
    "--philosopher", "-p", default="seneca",
    help="Which philosopher you're replying to.",
)
def reply(philosopher: str):
    """Write a reply to the philosopher's most recent letter."""
    init_db()
    last = latest_philosopher_letter(philosopher)
    if not last:
        console.print(
            f"[yellow]No letter from {philosopher} yet. "
            "Run [bold]daimon write[/bold] first.[/yellow]"
        )
        sys.exit(1)

    console.print(
        Panel(
            last["body"],
            title=f"[dim]Replying to letter #{last['id']}[/dim]",
            border_style="dim",
            padding=(1, 2),
        )
    )
    console.print()
    console.print(
        "[bold]Your reply[/bold] "
        "(finish with Ctrl-Z then Enter on Windows, or Ctrl-D on Mac/Linux):"
    )
    console.print()

    lines: list[str] = []
    try:
        while True:
            lines.append(input())
    except EOFError:
        pass

    body = "\n".join(lines).strip()
    if not body:
        console.print("[yellow]Empty reply — nothing saved.[/yellow]")
        sys.exit(0)

    reply_id = save_letter(
        philosopher=philosopher, role="user", body=body, in_reply_to=last["id"]
    )
    console.print(f"\n[green]Reply #{reply_id} saved.[/green]")
    console.print("Run [bold]daimon write[/bold] when you want their next letter.")


@cli.command()
@click.option("--philosopher", "-p", default="seneca")
@click.option("-n", default=10, help="How many letters to show.")
def log(philosopher: str, n: int):
    """Show recent correspondence."""
    init_db()
    letters = recent_letters(philosopher, n=n)
    if not letters:
        console.print(
            f"[yellow]No correspondence with {philosopher} yet.[/yellow]"
        )
        return
    for L in letters:
        if L["role"] == "philosopher":
            who = get_persona(philosopher)["display_name"]
            color = "cyan"
        else:
            who = USER_NAME
            color = "yellow"
        console.print(
            Panel(
                L["body"],
                title=f"[{color}]#{L['id']} — {who}[/{color}]",
                subtitle=f"[dim]{L['created_at']}[/dim]",
                border_style=color,
                padding=(1, 2),
            )
        )


@cli.command()
@click.option("--host", default="127.0.0.1", help="Bind host.")
@click.option("--port", default=8000, help="Bind port.")
@click.option("--reload", is_flag=True, help="Auto-reload on code changes (dev).")
def web(host: str, port: int, reload: bool):
    """Launch the Daimon web UI (FastAPI + 3D reading experience)."""
    import uvicorn

    init_db()
    console.print(
        f"[cyan]Daimon[/cyan] web UI -> [bold]http://{host}:{port}[/bold]  "
        "([dim]Ctrl-C to stop[/dim])"
    )
    uvicorn.run("daimon.api:app", host=host, port=port, reload=reload)


@cli.command()
@click.option("--philosopher", "-p", default="seneca", help="Whose correspondence to mine.")
@click.option("--open", "open_browser", is_flag=True, help="Open the graph in your browser.")
@click.option("--llm", is_flag=True, help="Use the LLM extractor (needs GROQ_API_KEY).")
@click.option("--neo4j", "use_neo4j", is_flag=True, help="Also mirror into Neo4j (needs NEO4J_* env).")
def themes(philosopher: str, open_browser: bool, llm: bool, use_neo4j: bool):
    """Build a graph of the recurring themes in your replies."""
    from pathlib import Path

    from .themes import build_theme_graph, render_graph

    init_db()
    with console.status("[dim]Mining your replies for themes...[/dim]"):
        store = build_theme_graph(philosopher, use_llm=llm, use_neo4j=use_neo4j)
        out = Path(__file__).parent / "themes" / "theme_graph.html"
        path = render_graph(store, str(out))

    n = store.to_networkx().number_of_nodes()
    if n == 0:
        console.print(
            "[yellow]No themes yet — reply to a few letters first "
            "([bold]daimon reply[/bold]), then run this again.[/yellow]"
        )
    else:
        console.print(f"[green]Theme graph built[/green] — {n} concepts.")
    console.print(f"[dim]Graph:[/dim] {path}")
    if open_browser:
        import webbrowser

        webbrowser.open(Path(path).resolve().as_uri())


@cli.command()
@click.option("--philosopher", "-p", default="seneca", help="Which philosopher writes.")
@click.option("--to", default=None, help="Recipient email (defaults to DAIMON_TO_EMAIL).")
@click.option("--dry-run", is_flag=True, help="Render and preview without sending.")
def send(philosopher: str, to: str | None, dry_run: bool):
    """Generate today's letter and email it (via Resend)."""
    import os

    from .delivery.email_send import send_email
    from .delivery.template import render_letter_email

    init_db()
    persona = get_persona(philosopher)
    try:
        with console.status(f"[dim]{persona['display_name']} is writing...[/dim]"):
            result = generate_letter(philosopher)
    except RuntimeError as e:
        console.print(f"[red]{e}[/red]")
        sys.exit(1)

    body = result["final"]
    save_letter(philosopher=philosopher, role="philosopher", body=body)
    html = render_letter_email(
        persona["display_name"], body, datetime.now().strftime("%d %B %Y")
    )
    to_addr = to or os.getenv("DAIMON_TO_EMAIL")
    if not to_addr and not dry_run:
        console.print(
            "[yellow]No recipient. Pass --to, set DAIMON_TO_EMAIL, or use --dry-run.[/yellow]"
        )
        sys.exit(1)
    res = send_email(
        to_addr or "preview@local",
        f"A letter from {persona['display_name']}",
        html,
        dry_run=True if dry_run else None,
    )
    console.print(res)


@cli.command()
@click.argument("question")
@click.option(
    "--philosophers", "-p", default=None,
    help="Comma-separated keys, e.g. seneca,nietzsche (default: all).",
)
def salon(question: str, philosophers: str | None):
    """Pose one question to several philosophers at once."""
    from .salon import hold_salon

    keys = [k.strip() for k in philosophers.split(",")] if philosophers else None
    try:
        with console.status("[dim]The salon is deliberating...[/dim]"):
            responses = hold_salon(question, keys)
    except RuntimeError as e:
        console.print(f"[red]{e}[/red]")
        sys.exit(1)

    console.print()
    console.print(
        Panel(
            question,
            title="[bold yellow]The question[/bold yellow]",
            border_style="yellow",
            padding=(1, 2),
        )
    )
    for r in responses:
        console.print(
            Panel(
                r["body"],
                title=f"[cyan]{r['display_name']}[/cyan]",
                border_style="cyan",
                padding=(1, 2),
            )
        )


if __name__ == "__main__":
    cli()
