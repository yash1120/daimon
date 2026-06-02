/* ==========================================================================
 * search.js — search the visitor's own correspondence.
 *
 * An overlay (opened from the nav magnifier) with a single search field. As the
 * visitor types (debounced ~250ms) it calls GET /api/search?q=<text> and renders
 * the matches as a list — philosopher name, date, and a snippet with the match
 * highlighted. Clicking a result opens that letter in the reading view (via
 * window.Daimon.openLetter) and closes the overlay.
 *
 * UX / a11y:
 *  - role="dialog", aria-modal; focus moves to the input on open, is trapped
 *    while open, and is restored to the opener (the nav magnifier) on close.
 *  - Esc closes; clicking the backdrop closes.
 *  - Empty query → a quiet hint, never an error.
 *  - Results announce via an aria-live status ("3 results", "No matches").
 *  - Each result is a real <button> with a ≥44px target.
 *
 * Depends on window.Daimon (exported by app.js): api, openLetter, displayNameFor,
 * REDUCE. Resilient if those load late (falls back to a plain fetch).
 * ========================================================================== */
(function () {
  "use strict";

  const els = {
    openBtn: document.getElementById("nav-search"),
    overlay: document.getElementById("search-overlay"),
    dialog: document.getElementById("search-dialog"),
    input: document.getElementById("search-input"),
    closeBtn: document.getElementById("search-close"),
    results: document.getElementById("search-results"),
    status: document.getElementById("search-status"),
    hint: document.getElementById("search-hint"),
  };

  // Bail quietly if the markup isn't present.
  if (!els.overlay || !els.dialog || !els.input) return;

  const DEBOUNCE_MS = 250;
  const SNIPPET_PAD = 60;     // chars of context on each side of the match

  let isOpen = false;
  let lastFocused = null;
  let debounceTimer = null;
  let reqSeq = 0;             // guards against out-of-order responses
  let lastQuery = "";

  function D() { return window.Daimon || {}; }
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

  function setStatus(text) {
    if (els.status) els.status.textContent = text || "";
  }

  // ---- Snippet around the first match, with the match wrapped in <mark>. ----
  // Returns a DocumentFragment (text nodes + a <mark>) so we never inject HTML
  // from user content.
  function snippetFragment(body, query) {
    const text = String(body || "").replace(/\s+/g, " ").trim();
    const q = String(query || "").trim();
    const frag = document.createDocumentFragment();
    if (!text) return frag;

    const idx = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (idx < 0 || !q) {
      // No match position (shouldn't happen for a hit) → leading excerpt.
      frag.appendChild(document.createTextNode(
        text.length > SNIPPET_PAD * 2 ? text.slice(0, SNIPPET_PAD * 2) + "…" : text
      ));
      return frag;
    }

    let start = Math.max(0, idx - SNIPPET_PAD);
    let end = Math.min(text.length, idx + q.length + SNIPPET_PAD);
    const pre = (start > 0 ? "…" : "") + text.slice(start, idx);
    const mid = text.slice(idx, idx + q.length);
    const post = text.slice(idx + q.length, end) + (end < text.length ? "…" : "");

    frag.appendChild(document.createTextNode(pre));
    const mark = document.createElement("mark");
    mark.className = "search-result__mark";
    mark.textContent = mid;
    frag.appendChild(mark);
    frag.appendChild(document.createTextNode(post));
    return frag;
  }

  // ---- Render the results list ----
  function renderResults(list, query) {
    els.results.innerHTML = "";
    if (!Array.isArray(list) || !list.length) {
      setStatus(query ? "No letters match “" + query + "”." : "");
      return;
    }
    setStatus(list.length === 1 ? "1 result." : list.length + " results.");

    const frag = document.createDocumentFragment();
    list.forEach(function (L) {
      const li = document.createElement("li");
      li.className = "search-result";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-result__btn";
      const who = L.role === "user" ? "You" : displayNameFor(L.philosopher, L.display_name);
      btn.setAttribute("aria-label", "Open " +
        (L.role === "user" ? "your reply" : who + "'s letter") +
        " from " + formatDate(L.created_at));

      const meta = document.createElement("div");
      meta.className = "search-result__meta";
      const name = document.createElement("span");
      name.className = "search-result__name";
      name.textContent = who;
      const date = document.createElement("span");
      date.className = "search-result__date";
      date.textContent = formatDate(L.created_at);
      meta.appendChild(name);
      meta.appendChild(date);

      const snip = document.createElement("p");
      snip.className = "search-result__snippet";
      snip.appendChild(snippetFragment(L.body, query));

      btn.appendChild(meta);
      btn.appendChild(snip);
      btn.addEventListener("click", function () { openResult(L.id); });

      li.appendChild(btn);
      frag.appendChild(li);
    });
    els.results.appendChild(frag);
  }

  function openResult(id) {
    close();
    if (D().openLetter) D().openLetter(id);
    else if (D().goTo) D().goTo("reading");
  }

  // ---- Run a search (debounced caller below) ----
  function runSearch(query) {
    const q = String(query || "").trim();
    lastQuery = q;
    if (!q) {
      els.results.innerHTML = "";
      setStatus("");
      return;
    }
    setStatus("Searching…");
    const seq = ++reqSeq;
    api("/api/search?q=" + encodeURIComponent(q))
      .then(function (data) {
        if (seq !== reqSeq) return;       // a newer query superseded this one
        renderResults(data || [], q);
      })
      .catch(function () {
        if (seq !== reqSeq) return;
        els.results.innerHTML = "";
        setStatus("Search is unavailable just now. Please try again.");
      });
  }

  function onInput() {
    clearTimeout(debounceTimer);
    const q = els.input.value;
    if (!q.trim()) {
      // Empty → clear immediately (no need to wait / call the API).
      clearTimeout(debounceTimer);
      reqSeq++;
      els.results.innerHTML = "";
      setStatus("");
      return;
    }
    debounceTimer = setTimeout(function () { runSearch(q); }, DEBOUNCE_MS);
  }

  // ---- Focus trap ----
  function focusables() {
    const sel = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]),' +
      ' [tabindex]:not([tabindex="-1"])';
    return Array.prototype.slice.call(els.dialog.querySelectorAll(sel))
      .filter(function (el) {
        return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
      });
  }
  function trap(e) {
    if (e.key !== "Tab") return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ---- Open / close ----
  function open() {
    if (isOpen) return;
    isOpen = true;
    lastFocused = document.activeElement;

    els.overlay.hidden = false;
    requestAnimationFrame(function () { els.overlay.classList.add("is-open"); });
    document.body.classList.add("modal-open");
    if (els.openBtn) els.openBtn.setAttribute("aria-expanded", "true");

    // Focus the field; preserve any prior query so re-opening picks up where
    // the visitor left off.
    setTimeout(function () {
      try { els.input.focus(); els.input.select(); } catch (_) {}
    }, 30);

    document.addEventListener("keydown", onKeydown, true);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    clearTimeout(debounceTimer);
    els.overlay.classList.remove("is-open");
    document.body.classList.remove("modal-open");
    if (els.openBtn) els.openBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKeydown, true);

    const reduce = !!D().REDUCE;
    const finish = function () {
      els.overlay.hidden = true;
      try { (lastFocused || els.openBtn).focus(); } catch (_) {}
    };
    if (reduce) finish();
    else setTimeout(finish, 180);
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      // Esc clears a query first; a second Esc (empty) closes — gentle.
      if (els.input.value) {
        els.input.value = "";
        reqSeq++;
        els.results.innerHTML = "";
        setStatus("");
        try { els.input.focus(); } catch (_) {}
        return;
      }
      close();
      return;
    }
    trap(e);
  }

  // ---- Events ----
  function bind() {
    if (els.closeBtn) els.closeBtn.addEventListener("click", close);
    els.input.addEventListener("input", onInput);
    // Pressing Enter shouldn't reload anything; just run immediately.
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(debounceTimer);
        runSearch(els.input.value);
      }
    });
    // Click the backdrop (outside the dialog) closes.
    els.overlay.addEventListener("mousedown", function (e) {
      if (e.target === els.overlay) close();
    });
  }

  // ---- Public hooks used by app.js ----
  window.DaimonSearch = {
    open: open,
    close: close,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
