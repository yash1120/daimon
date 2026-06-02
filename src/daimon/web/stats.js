/* ==========================================================================
 * stats.js — the "Journey" view.
 *
 * A small dashboard of the visitor's correspondence. Fetches GET /api/stats →
 *   { letters, replies, active_days, streak, by_philosopher: {"<Name>": n, ...} }
 * and renders:
 *   - four headline tiles: letters received, replies written, active days, and a
 *     reading streak (with a small inline-SVG flame),
 *   - a per-philosopher breakdown as labelled bars (bar width ∝ count; pure CSS,
 *     no chart library). The bars carry accessible text (name + count) too.
 * An elegant empty state when there's no activity yet (no letters and no replies).
 *
 * Depends on window.Daimon (exported by app.js): api, generateLetter, REDUCE,
 * hasGsap. Resilient if those load late.
 * ========================================================================== */
(function () {
  "use strict";

  const gsap = window.gsap;

  const els = {
    loading: document.getElementById("stats-loading"),
    empty: document.getElementById("stats-empty"),
    emptyCta: document.getElementById("stats-empty-cta"),
    content: document.getElementById("stats-content"),
    numbers: document.getElementById("stats-numbers"),
    bars: document.getElementById("stats-bars"),
  };

  if (!els.content || !els.numbers) return;

  let loadedOnce = false;
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

  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  function showLoading() {
    hide(els.empty);
    hide(els.content);
    if (!loadedOnce) show(els.loading);
  }
  function showEmpty() {
    hide(els.loading);
    hide(els.content);
    show(els.empty);
  }
  function showContent() {
    hide(els.loading);
    hide(els.empty);
    show(els.content);
  }

  // ---- A small inline SVG for the streak tile (a flame; no emoji). ----
  function flameSvg() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d",
      "M12 3c.6 2.5-.4 4.1-1.6 5.4C9 9.9 7.5 11.4 7.5 14a4.5 4.5 0 0 0 9 0c0-1.6-.7-2.9-1.4-3.9-.4 .7-1 1.2-1.7 1.3 .8-2 .2-4.2-1.4-5.9 0 1.4-.7 2.2-1.5 2.9C12.6 6.4 12.7 4.4 12 3z");
    svg.appendChild(path);
    return svg;
  }

  // ---- Headline number tiles ----
  function makeTile(value, label, opts) {
    opts = opts || {};
    const li = document.createElement("li");
    li.className = "stat-tile" + (opts.accent ? " stat-tile--streak" : "");

    const num = document.createElement("span");
    num.className = "stat-tile__num";
    if (opts.flame) {
      const flameWrap = document.createElement("span");
      flameWrap.className = "stat-tile__flame";
      flameWrap.appendChild(flameSvg());
      num.appendChild(flameWrap);
    }
    num.appendChild(document.createTextNode(String(value)));

    const lbl = document.createElement("span");
    lbl.className = "stat-tile__label";
    lbl.textContent = label;

    li.appendChild(num);
    li.appendChild(lbl);
    return li;
  }

  function buildNumbers(s) {
    els.numbers.innerHTML = "";
    const letters = Math.max(0, Number(s.letters) || 0);
    const replies = Math.max(0, Number(s.replies) || 0);
    const activeDays = Math.max(0, Number(s.active_days) || 0);
    const streak = Math.max(0, Number(s.streak) || 0);

    const frag = document.createDocumentFragment();
    frag.appendChild(makeTile(letters, letters === 1 ? "letter received" : "letters received"));
    frag.appendChild(makeTile(replies, replies === 1 ? "reply written" : "replies written"));
    frag.appendChild(makeTile(activeDays, activeDays === 1 ? "active day" : "active days"));
    frag.appendChild(makeTile(streak, streak === 1 ? "day streak" : "day streak", { flame: true, accent: true }));
    els.numbers.appendChild(frag);
  }

  // ---- Per-philosopher breakdown as labelled bars ----
  function buildBars(byPhil) {
    els.bars.innerHTML = "";
    const entries = Object.keys(byPhil || {})
      .map(function (k) { return { name: k, count: Math.max(0, Number(byPhil[k]) || 0) }; })
      .filter(function (e) { return e.count > 0; })
      .sort(function (a, b) { return b.count - a.count; });

    if (!entries.length) {
      // No philosopher letters yet (e.g. only replies) — hide the section.
      els.bars.parentElement.hidden = true;
      return;
    }
    els.bars.parentElement.hidden = false;

    const max = entries.reduce(function (m, e) { return Math.max(m, e.count); }, 1);
    const frag = document.createDocumentFragment();
    const fills = [];

    entries.forEach(function (e) {
      const li = document.createElement("li");
      li.className = "stat-bar";

      const head = document.createElement("div");
      head.className = "stat-bar__head";
      const name = document.createElement("span");
      name.className = "stat-bar__name";
      name.textContent = e.name;
      const count = document.createElement("span");
      count.className = "stat-bar__count";
      count.textContent = String(e.count);
      count.setAttribute("aria-hidden", "true");
      head.appendChild(name);
      head.appendChild(count);

      const track = document.createElement("div");
      track.className = "stat-bar__track";
      // Accessible meter semantics; visible text already lives in the head.
      track.setAttribute("role", "img");
      track.setAttribute("aria-label",
        e.name + ": " + e.count + (e.count === 1 ? " letter" : " letters"));
      const fill = document.createElement("span");
      fill.className = "stat-bar__fill";
      const pct = Math.round((e.count / max) * 100);
      // Start collapsed; animate to width (or set immediately when reduced).
      fill.style.width = useGsap() ? "0%" : pct + "%";
      fill.setAttribute("data-pct", pct);
      track.appendChild(fill);
      fills.push(fill);

      li.appendChild(head);
      li.appendChild(track);
      frag.appendChild(li);
    });
    els.bars.appendChild(frag);

    if (useGsap() && fills.length) {
      gsap.to(fills, {
        width: function (i, el) { return el.getAttribute("data-pct") + "%"; },
        duration: 0.6,
        ease: "power3.out",
        stagger: 0.05,
      });
    }
  }

  function render(s) {
    s = s || {};
    const letters = Math.max(0, Number(s.letters) || 0);
    const replies = Math.max(0, Number(s.replies) || 0);

    // Nothing at all yet → the invitation.
    if (letters === 0 && replies === 0) {
      showEmpty();
      return;
    }

    buildNumbers(s);
    buildBars(s.by_philosopher || {});
    showContent();
    loadedOnce = true;

    // Gentle entrance for the tiles (the bars animate their own width above).
    const tiles = Array.prototype.slice.call(els.numbers.querySelectorAll(".stat-tile"));
    if (useGsap() && tiles.length) {
      gsap.set(tiles, { opacity: 0, y: 14 });
      gsap.to(tiles, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out", stagger: 0.06 });
    } else {
      tiles.forEach(function (t) { t.style.opacity = "1"; });
    }
  }

  function onEnter() {
    if (fetching) return;
    fetching = true;
    showLoading();
    api("/api/stats")
      .then(function (data) {
        fetching = false;
        render(data || {});
      })
      .catch(function () {
        fetching = false;
        if (!loadedOnce) showEmpty();
      });
  }

  function bind() {
    if (els.emptyCta) {
      els.emptyCta.addEventListener("click", function () {
        if (D().generateLetter) D().generateLetter();
        else if (D().goTo) D().goTo("reading");
      });
    }
  }

  // ---- Public hook used by app.js ----
  window.DaimonStats = {
    onEnter: onEnter,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
