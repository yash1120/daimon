"""Render the theme graph to an interactive HTML page with pyvis.

Dark Daimon aesthetic: deep navy background, parchment text, gold highlights.
Node size scales with concept frequency; edge thickness scales with
co-occurrence count. The empty-graph case renders a friendly placeholder page
instead of crashing.
"""

from __future__ import annotations

from pathlib import Path

from pyvis.network import Network

# Daimon palette.
BG_COLOR = "#0E1320"      # deep navy background
FONT_COLOR = "#ECE7DC"    # parchment
GOLD = "#C9A24B"          # highlighted edges / accents
NODE_COLOR = "#7FA6C9"    # calm blue for concept nodes
LETTER_COLOR = "#5A6478"  # muted slate for optional letter nodes
EDGE_COLOR = "#3A4256"    # dim edge at rest


def _empty_html(out_path: Path, message: str) -> str:
    """Write a standalone placeholder page and return its path."""
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Daimon — Theme Graph</title>
  <style>
    html, body {{
      margin: 0; height: 100%;
      background: {BG_COLOR}; color: {FONT_COLOR};
      font-family: Georgia, "Times New Roman", serif;
      display: flex; align-items: center; justify-content: center;
      text-align: center;
    }}
    .card {{ max-width: 32rem; padding: 2rem; }}
    h1 {{ color: {GOLD}; font-weight: 500; letter-spacing: .02em; }}
    p {{ opacity: .8; line-height: 1.6; }}
  </style>
</head>
<body>
  <div class="card">
    <h1>Theme Graph</h1>
    <p>{message}</p>
  </div>
</body>
</html>
"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    return str(out_path)


def render_graph(store, out_path: str = "theme_graph.html") -> str:
    """Render ``store`` to an interactive HTML network at ``out_path``.

    Parameters
    ----------
    store:
        A :class:`~daimon.themes.store.GraphStore` (or anything exposing
        ``to_networkx()``).
    out_path:
        Destination HTML file. Returned on success.

    Returns
    -------
    str
        The path to the written HTML file.
    """
    out = Path(out_path)
    g = store.to_networkx()

    # Empty / no-concept graph -> friendly placeholder.
    concept_nodes = [
        (n, d) for n, d in g.nodes(data=True) if d.get("kind", "concept") == "concept"
    ]
    if g.number_of_nodes() == 0 or not concept_nodes:
        return _empty_html(out, "No themes yet — reply to more letters.")

    net = Network(
        height="100vh",
        width="100%",
        bgcolor=BG_COLOR,
        font_color=FONT_COLOR,
        notebook=False,
        directed=False,
        cdn_resources="in_line",
    )

    # Scale node sizes by weight.
    weights = [d.get("weight", 1) for _, d in concept_nodes]
    w_min, w_max = min(weights), max(weights)

    def _size(w: int) -> float:
        if w_max == w_min:
            return 22.0
        # Map weight linearly into a pleasant size range.
        return 14.0 + (w - w_min) / (w_max - w_min) * 34.0

    for node, data in g.nodes(data=True):
        kind = data.get("kind", "concept")
        weight = data.get("weight", 1)
        if kind == "letter":
            net.add_node(
                str(node),
                label=" ",
                title=f"Reply {str(node).split(':', 1)[-1]}",
                color=LETTER_COLOR,
                shape="dot",
                size=8,
            )
        else:
            net.add_node(
                str(node),
                label=str(node),
                title=f"{node} — mentioned {weight}×",
                color={
                    "background": NODE_COLOR,
                    "border": GOLD,
                    "highlight": {"background": GOLD, "border": GOLD},
                },
                value=weight,
                size=_size(weight),
            )

    e_weights = [d.get("weight", 1) for _, _, d in g.edges(data=True)] or [1]
    e_max = max(e_weights)
    for u, v, data in g.edges(data=True):
        ew = data.get("weight", 1)
        width = 1.0 + (ew / e_max) * 7.0
        net.add_edge(
            str(u),
            str(v),
            value=ew,
            width=width,
            title=f"co-occurred {ew}×",
            color={"color": EDGE_COLOR, "highlight": GOLD, "hover": GOLD},
        )

    # Physics + interaction tuning for a calm, readable layout.
    net.set_options(
        """
    var options = {
      "nodes": {
        "font": {"color": "%(font)s", "size": 18, "face": "Georgia"},
        "borderWidth": 2,
        "shadow": {"enabled": true, "color": "rgba(0,0,0,0.5)", "size": 12}
      },
      "edges": {
        "smooth": {"type": "continuous"},
        "color": {"inherit": false}
      },
      "interaction": {"hover": true, "tooltipDelay": 120, "navigationButtons": false},
      "physics": {
        "barnesHut": {"gravitationalConstant": -3200, "springLength": 140, "springConstant": 0.02},
        "minVelocity": 0.6,
        "stabilization": {"iterations": 220}
      }
    }
    """
        % {"font": FONT_COLOR}
    )

    out.parent.mkdir(parents=True, exist_ok=True)

    # ``write_html`` is the most portable way to emit the file across pyvis
    # versions (avoids notebook/template-path quirks). Some older builds only
    # have ``save_graph``; fall back to that, then to a manual write.
    html_str = None
    try:
        net.write_html(str(out), notebook=False)
    except TypeError:
        try:
            net.write_html(str(out))
        except Exception:
            html_str = net.generate_html()
    except Exception:
        try:
            html_str = net.generate_html()
        except Exception:
            net.save_graph(str(out))

    if html_str is not None:
        out.write_text(html_str, encoding="utf-8")

    return str(out)
