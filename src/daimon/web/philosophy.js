/* ==========================================================================
 * philosophy.js — the "Your philosophy" view.
 *
 * A living picture of the recurring ideas in THIS visitor's own replies.
 * Fetches GET /api/philosophy →
 *   { total_replies, concepts:[{name, weight}], edges:[{source,target,weight}] }
 * and renders, in order of prominence:
 *   - a one-line count ("drawn from your N replies"),
 *   - a WEIGHTED FIELD of concept chips (size + gold intensity ∝ weight) — the
 *     centrepiece, a quiet constellation of the person's mind,
 *   - a faint 2D CONCEPT MAP (SVG): nodes (size ∝ weight) joined by gold lines
 *     for co-occurring pairs. Deterministic layout — static, never animated —
 *     and aria-hidden (the list below is the accessible representation),
 *   - a plain readable <ul> list for screen readers (always rendered).
 * Empty state when total_replies === 0 or no concepts: an elegant invitation
 * with a button that opens today's letter.
 *
 * Depends on window.Daimon (exported by app.js): api, REDUCE, hasGsap,
 * generateLetter, goTo. Resilient if those load late.
 * ========================================================================== */
(function () {
  "use strict";

  const gsap = window.gsap;

  const els = {
    count: document.getElementById("philosophy-count"),
    loading: document.getElementById("philosophy-loading"),
    empty: document.getElementById("philosophy-empty"),
    emptyCta: document.getElementById("philosophy-empty-cta"),
    content: document.getElementById("philosophy-content"),
    map: document.getElementById("philosophy-map"),
    svg: document.getElementById("philosophy-svg"),
    field: document.getElementById("philosophy-field"),
    list: document.getElementById("philosophy-list"),
  };

  const SVGNS = "http://www.w3.org/2000/svg";

  // Logical viewBox for the constellation; the SVG scales to fit its box.
  const VB_W = 760;
  const VB_H = 440;

  let loadedOnce = false;     // have we ever successfully drawn something?
  let fetching = false;

  function D() { return window.Daimon || {}; }
  function reduce() { return !!D().REDUCE; }
  function useGsap() { return !!(D().hasGsap && gsap && !reduce()); }

  function api(path) {
    if (D().api) return D().api(path);
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error("Request failed: " + r.status);
      return r.json();
    });
  }

  // ---- View-state toggles ----
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  function showLoading() {
    hide(els.empty);
    hide(els.content);
    // Only flash the skeleton on the first load; on re-entry keep prior result
    // visible to avoid a jarring blank flash.
    if (!loadedOnce) show(els.loading);
  }

  function showEmpty() {
    hide(els.loading);
    hide(els.content);
    show(els.empty);
    if (els.count) els.count.textContent = "";
  }

  function showContent() {
    hide(els.loading);
    hide(els.empty);
    show(els.content);
  }

  // ---- Entry point (called by app.js when the view opens) ----
  function onEnter() {
    if (fetching) return;
    fetching = true;
    showLoading();

    api("/api/philosophy")
      .then(function (data) {
        fetching = false;
        render(data || {});
      })
      .catch(function () {
        fetching = false;
        // A failed lookup must never leave a broken graph: fall back to the
        // empty invitation (unless we already have a good render on screen).
        if (!loadedOnce) showEmpty();
      });
  }

  // ---- Render ----
  function render(data) {
    const total = Math.max(0, Number(data.total_replies) || 0);
    const concepts = Array.isArray(data.concepts) ? data.concepts.slice() : [];
    const edges = Array.isArray(data.edges) ? data.edges.slice() : [];

    if (total === 0 || concepts.length === 0) {
      showEmpty();
      return;
    }

    // Count line: "drawn from your N replies".
    if (els.count) {
      els.count.textContent =
        "drawn from your " + total + (total === 1 ? " reply" : " replies");
    }

    buildField(concepts);
    buildList(concepts);
    buildMap(concepts, edges);

    showContent();
    loadedOnce = true;

    // Gentle entrance: chips fade/rise with a small stagger. Reduced motion or
    // no GSAP → already visible (opacity set in CSS fallback below). The map is
    // ALWAYS static — we never animate nodes.
    const chips = Array.prototype.slice.call(els.field.querySelectorAll(".philosophy-chip"));
    if (useGsap() && chips.length) {
      gsap.set(chips, { opacity: 0, y: 12 });
      gsap.to(chips, {
        opacity: 1, y: 0, duration: 0.45, ease: "power3.out", stagger: 0.035,
      });
    } else {
      chips.forEach(function (c) { c.style.opacity = "1"; });
    }
  }

  // Normalise a weight to 0..1 across the current set (min→0, max→1).
  function scaleFn(concepts) {
    let min = Infinity, max = -Infinity;
    concepts.forEach(function (c) {
      const w = Number(c.weight) || 0;
      if (w < min) min = w;
      if (w > max) max = w;
    });
    const span = max - min;
    return function (w) {
      if (span <= 0) return 1; // all equal → all prominent
      return (((Number(w) || 0) - min) / span);
    };
  }

  // ---- Weighted field of chips (the centrepiece) ----
  function buildField(concepts) {
    els.field.innerHTML = "";
    const t = scaleFn(concepts);
    const frag = document.createDocumentFragment();

    concepts.forEach(function (c) {
      const tt = t(c.weight);                 // 0..1 prominence
      const chip = document.createElement("span");
      chip.className = "philosophy-chip";
      // CSS reads --t to scale font-size, padding, weight, and gold intensity.
      chip.style.setProperty("--t", tt.toFixed(3));
      chip.setAttribute("data-concept", c.name);

      const label = document.createElement("span");
      label.className = "philosophy-chip__label";
      label.textContent = c.name;
      chip.appendChild(label);

      // Hovering a chip highlights its matching node in the map (and vice
      // versa) — a quiet link between the two representations.
      chip.addEventListener("mouseenter", function () { highlight(c.name, true); });
      chip.addEventListener("mouseleave", function () { highlight(c.name, false); });

      frag.appendChild(chip);
    });
    els.field.appendChild(frag);
  }

  // ---- Plain readable list (the accessible representation) ----
  function buildList(concepts) {
    els.list.innerHTML = "";
    const frag = document.createDocumentFragment();
    concepts.forEach(function (c) {
      const w = Number(c.weight) || 0;
      const li = document.createElement("li");
      li.className = "philosophy-list__item";

      const name = document.createElement("span");
      name.className = "philosophy-list__name";
      name.textContent = c.name;

      const cnt = document.createElement("span");
      cnt.className = "philosophy-list__count";
      cnt.textContent = w === 1 ? "1 reply" : w + " replies";

      li.appendChild(name);
      li.appendChild(cnt);
      frag.appendChild(li);
    });
    els.list.appendChild(frag);
  }

  // ---- Constellation map (decorative; deterministic, static) ----
  // Layout: a golden-angle spiral so the most-weighted concepts (first in the
  // list) sit near the centre and the rest fan outward — calm and balanced
  // without any physics. We draw edges first (behind), then nodes on top.
  const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad

  function buildMap(concepts, edges) {
    const svg = els.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 " + VB_W + " " + VB_H);

    const n = concepts.length;
    const t = scaleFn(concepts);

    const cx = VB_W / 2;
    const cy = VB_H / 2;
    // Spiral radius scaled to fill the box with a comfortable margin.
    const maxR = Math.min(VB_W, VB_H) / 2 - 54;
    const pos = {};            // concept name -> {x, y, r}

    concepts.forEach(function (c, i) {
      // r grows with sqrt(i) for an even areal spread; angle by golden ratio.
      const frac = n > 1 ? i / (n - 1) : 0;
      const radius = maxR * Math.sqrt(frac);
      const ang = i * GOLDEN;
      const x = cx + radius * Math.cos(ang);
      const y = cy + radius * Math.sin(ang);
      // Node size ∝ weight (6px..15px radius).
      const nodeR = 6 + t(c.weight) * 9;
      pos[c.name] = { x: x, y: y, r: nodeR };
    });

    // Edges (faint gold lines), behind the nodes. Skip any referencing a
    // concept we didn't place (defensive).
    const gEdges = document.createElementNS(SVGNS, "g");
    gEdges.setAttribute("class", "philosophy-edges");
    edges.forEach(function (e) {
      const a = pos[e.source];
      const b = pos[e.target];
      if (!a || !b) return;
      const line = document.createElementNS(SVGNS, "line");
      line.setAttribute("x1", a.x.toFixed(1));
      line.setAttribute("y1", a.y.toFixed(1));
      line.setAttribute("x2", b.x.toFixed(1));
      line.setAttribute("y2", b.y.toFixed(1));
      line.setAttribute("class", "philosophy-edge");
      line.setAttribute("data-a", e.source);
      line.setAttribute("data-b", e.target);
      gEdges.appendChild(line);
    });
    svg.appendChild(gEdges);

    // Nodes + their labels, on top.
    const gNodes = document.createElementNS(SVGNS, "g");
    gNodes.setAttribute("class", "philosophy-nodes");
    concepts.forEach(function (c) {
      const p = pos[c.name];
      const tt = t(c.weight);

      const grp = document.createElementNS(SVGNS, "g");
      grp.setAttribute("class", "philosophy-node");
      grp.setAttribute("data-concept", c.name);
      grp.style.setProperty("--t", tt.toFixed(3));

      const dot = document.createElementNS(SVGNS, "circle");
      dot.setAttribute("cx", p.x.toFixed(1));
      dot.setAttribute("cy", p.y.toFixed(1));
      dot.setAttribute("r", p.r.toFixed(1));
      dot.setAttribute("class", "philosophy-node__dot");

      const txt = document.createElementNS(SVGNS, "text");
      txt.setAttribute("x", p.x.toFixed(1));
      txt.setAttribute("y", (p.y + p.r + 13).toFixed(1));
      txt.setAttribute("text-anchor", "middle");
      txt.setAttribute("class", "philosophy-node__label");
      txt.textContent = c.name;

      grp.appendChild(dot);
      grp.appendChild(txt);
      gNodes.appendChild(grp);
    });
    svg.appendChild(gNodes);
  }

  // Cross-highlight chip ↔ node ↔ its edges by concept name.
  function highlight(name, on) {
    if (els.svg) {
      const node = els.svg.querySelector('.philosophy-node[data-concept="' + cssEsc(name) + '"]');
      if (node) node.classList.toggle("is-hot", on);
      const edges = els.svg.querySelectorAll('.philosophy-edge[data-a="' + cssEsc(name) + '"], .philosophy-edge[data-b="' + cssEsc(name) + '"]');
      Array.prototype.forEach.call(edges, function (e) { e.classList.toggle("is-hot", on); });
    }
    if (els.field) {
      const chip = els.field.querySelector('.philosophy-chip[data-concept="' + cssEsc(name) + '"]');
      if (chip) chip.classList.toggle("is-hot", on);
    }
  }

  // Minimal attribute-selector escaper (concepts are lowercase words, but be
  // safe against quotes/backslashes just in case).
  function cssEsc(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  // ---- Events ----
  function bind() {
    if (els.emptyCta) {
      els.emptyCta.addEventListener("click", function () {
        // Open today's letter (same action as the hero / timeline CTAs).
        if (D().generateLetter) D().generateLetter();
        else if (D().goTo) D().goTo("reading");
      });
    }
  }

  // ---- Public hook used by app.js ----
  window.DaimonPhilosophy = {
    onEnter: onEnter,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
