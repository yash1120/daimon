/* ==========================================================================
 * bookmarks.js — the "Saved" view.
 *
 * Lists the letters this visitor has starred. Fetches GET /api/bookmarks →
 *   [{ id, philosopher, display_name, role, body, created_at }]
 * and renders them as cards (the same visual language as the timeline). Clicking
 * a card opens that letter in the reading view (window.Daimon.openLetter).
 * An elegant empty state invites the visitor to star a letter.
 *
 * The star toggle on the reading view (app.js) calls invalidate() when the set
 * changes, so re-entering the view always reflects the latest stars.
 *
 * Depends on window.Daimon (exported by app.js): api, openLetter, generateLetter,
 * displayNameFor, REDUCE, hasGsap. Resilient if those load late.
 * ========================================================================== */
(function () {
  "use strict";

  const gsap = window.gsap;

  const els = {
    list: document.getElementById("saved-list"),
    loading: document.getElementById("saved-loading"),
    empty: document.getElementById("saved-empty"),
    emptyCta: document.getElementById("saved-empty-cta"),
  };

  if (!els.list) return;

  let loadedOnce = false;
  let fetching = false;
  let dirty = true;          // needs a refetch on next entry?

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
  function displayNameFor(key, fallback) {
    if (D().displayNameFor) return D().displayNameFor(key) || fallback || key;
    return fallback || key;
  }

  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try {
      return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    } catch (e) {
      return d.toDateString();
    }
  }

  function showLoading() {
    hide(els.empty);
    hide(els.list);
    if (!loadedOnce) show(els.loading);
  }
  function showEmpty() {
    hide(els.loading);
    hide(els.list);
    show(els.empty);
  }
  function showList() {
    hide(els.loading);
    hide(els.empty);
    show(els.list);
  }

  // ---- A saved letter card (mirrors the timeline card language) ----
  function makeCard(L) {
    const isUser = L.role === "user";
    const li = document.createElement("li");
    li.className = "saved-card-item";

    const card = document.createElement("button");
    card.type = "button";
    card.className = "saved-card" + (isUser ? " saved-card--user" : "");
    const who = isUser ? "You" : displayNameFor(L.philosopher, L.display_name);
    card.setAttribute("aria-label",
      "Open " + (isUser ? "your reply" : who + "'s letter") +
      " from " + formatDate(L.created_at));

    const meta = document.createElement("div");
    meta.className = "saved-card__meta";

    const sigWrap = document.createElement("span");
    sigWrap.className = "saved-card__sigil";
    sigWrap.setAttribute("aria-hidden", "true");
    const sig = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    sig.setAttribute("viewBox", "0 0 24 24");
    sig.setAttribute("width", "20");
    sig.setAttribute("height", "20");
    sig.setAttribute("fill", "none");
    sig.setAttribute("stroke", "currentColor");
    sig.setAttribute("stroke-width", "1.4");
    sig.setAttribute("stroke-linecap", "round");
    sig.setAttribute("stroke-linejoin", "round");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", D().sigilHref ? D().sigilHref(L.philosopher) : "#sigil-default");
    sig.appendChild(use);
    sigWrap.appendChild(sig);

    const role = document.createElement("span");
    role.className = "saved-card__role";
    role.textContent = who;

    const date = document.createElement("span");
    date.className = "saved-card__date";
    date.textContent = formatDate(L.created_at);

    meta.appendChild(sigWrap);
    meta.appendChild(role);
    meta.appendChild(date);

    const excerpt = document.createElement("p");
    excerpt.className = "saved-card__excerpt";
    excerpt.textContent = String(L.body || "").replace(/\s+/g, " ").trim();

    card.appendChild(meta);
    card.appendChild(excerpt);
    card.addEventListener("click", function () {
      if (D().openLetter) D().openLetter(L.id);
    });

    li.appendChild(card);
    return li;
  }

  function render(list) {
    els.list.innerHTML = "";
    if (!Array.isArray(list) || !list.length) {
      showEmpty();
      return;
    }
    const frag = document.createDocumentFragment();
    const cards = [];
    list.forEach(function (L) {
      const item = makeCard(L);
      frag.appendChild(item);
      cards.push(item);
    });
    els.list.appendChild(frag);
    showList();
    loadedOnce = true;

    if (useGsap() && cards.length) {
      gsap.set(cards, { opacity: 0, y: 14 });
      gsap.to(cards, { opacity: 1, y: 0, duration: 0.42, ease: "power3.out", stagger: 0.04 });
    } else {
      cards.forEach(function (c) { c.style.opacity = "1"; });
    }
  }

  function onEnter() {
    // If nothing changed since the last successful render, keep what's shown.
    if (!dirty && loadedOnce) return;
    if (fetching) return;
    fetching = true;
    showLoading();

    api("/api/bookmarks")
      .then(function (data) {
        fetching = false;
        dirty = false;
        render(data || []);
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

  // ---- Public hooks used by app.js ----
  window.DaimonBookmarks = {
    onEnter: onEnter,
    // Called by app.js when a letter is starred/unstarred elsewhere.
    invalidate: function () { dirty = true; },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
