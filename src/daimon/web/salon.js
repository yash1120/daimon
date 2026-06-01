/* ==========================================================================
 * salon.js — the Salon view.
 *
 * Pose ONE question to several philosophers; they answer together. Submits to
 * POST /api/salon → { question, sample, responses:[{key, display_name, body}] }.
 *
 * UX:
 *  - Real <label> for the question; Ctrl/Cmd+Enter submits; aria-live results.
 *  - Multi-select chips choose who answers (default: all 5).
 *  - Loading state: skeleton cards + the background dodecahedron "pulses".
 *  - Responses render as cards arranged on a gentle arc (grid on mobile), each
 *    with the philosopher's sigil, a distinct-but-harmonious accent, name in
 *    Playfair, answer in Libre Baskerville; cards stagger in 30–50ms.
 *  - sample:true → a small "add a Groq key for live answers" chip.
 *
 * Depends on window.Daimon (exported by app.js): api, sigilHref, REDUCE,
 * hasGsap, displayNameFor. Resilient if those load late.
 * ========================================================================== */
(function () {
  "use strict";

  const gsap = window.gsap;

  const els = {
    form: document.getElementById("salon-form"),
    input: document.getElementById("salon-question"),
    chips: document.getElementById("salon-chips"),
    submit: document.getElementById("salon-submit"),
    message: document.getElementById("salon-message"),
    loading: document.getElementById("salon-loading"),
    results: document.getElementById("salon-results"),
    resultsTitle: document.getElementById("salon-results-title"),
    sampleChip: document.getElementById("salon-sample-chip"),
  };

  // Distinct but harmonious accents (gold / violet / cream variants), keyed by
  // philosopher so each card reads as a different "voice" around the table.
  const ACCENTS = {
    seneca: "#C9A24B",      // gold
    aurelius: "#E0BE6E",    // gold-bright
    nietzsche: "#818CF8",   // violet-bright
    camus: "#6366F1",       // violet
    weil: "#ECE7DC",        // cream
  };
  const DEFAULT_ACCENT = "#C9A24B";

  let philosophers = [];     // [{key, display_name}]
  let selected = {};         // key -> bool
  let submitting = false;
  let built = false;

  function D() { return window.Daimon || {}; }
  function reduce() { return !!D().REDUCE; }
  function useGsap() { return !!(D().hasGsap && gsap && !reduce()); }
  function sigilHref(key) {
    return D().sigilHref ? D().sigilHref(key) : "#sigil-default";
  }

  // ---- Build the philosopher chips (multi-select; default all on) ----
  function buildChips(list) {
    philosophers = (list || []).slice();
    if (!philosophers.length) return;
    els.chips.innerHTML = "";
    selected = {};

    philosophers.forEach(function (p) {
      selected[p.key] = true;

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "salon-chip is-on";
      chip.setAttribute("role", "checkbox");
      chip.setAttribute("aria-checked", "true");
      chip.setAttribute("data-key", p.key);
      chip.style.setProperty("--accent", ACCENTS[p.key] || DEFAULT_ACCENT);

      const sig = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      sig.setAttribute("viewBox", "0 0 24 24");
      sig.setAttribute("width", "18");
      sig.setAttribute("height", "18");
      sig.setAttribute("fill", "none");
      sig.setAttribute("stroke", "currentColor");
      sig.setAttribute("stroke-width", "1.4");
      sig.setAttribute("stroke-linecap", "round");
      sig.setAttribute("stroke-linejoin", "round");
      sig.setAttribute("aria-hidden", "true");
      sig.classList.add("salon-chip__sigil");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", sigilHref(p.key));
      sig.appendChild(use);

      const label = document.createElement("span");
      label.className = "salon-chip__name";
      label.textContent = p.display_name;

      chip.appendChild(sig);
      chip.appendChild(label);
      chip.addEventListener("click", function () { toggleChip(p.key, chip); });
      els.chips.appendChild(chip);
    });
    built = true;
  }

  function toggleChip(key, chip) {
    // Never let the user deselect the very last philosopher.
    const onCount = Object.keys(selected).filter(function (k) { return selected[k]; }).length;
    if (selected[key] && onCount <= 1) return;
    selected[key] = !selected[key];
    chip.classList.toggle("is-on", selected[key]);
    chip.setAttribute("aria-checked", selected[key] ? "true" : "false");
  }

  function selectedKeys() {
    return philosophers
      .map(function (p) { return p.key; })
      .filter(function (k) { return selected[k]; });
  }

  function setMessage(text, kind) {
    els.message.textContent = text || "";
    els.message.classList.remove("is-error");
    if (kind === "error") els.message.classList.add("is-error");
  }

  // ---- Loading state ----
  function setLoading(on) {
    submitting = on;
    els.submit.classList.toggle("is-loading", on);
    els.submit.disabled = on;
    els.loading.hidden = !on;
    if (on) {
      els.results.innerHTML = "";
      els.resultsTitle.hidden = true;
      els.sampleChip.hidden = true;
    }
    // Pulse the background dodecahedron while the salon "thinks".
    if (window.DaimonBG && typeof window.DaimonBG.pulse === "function") {
      window.DaimonBG.pulse(on);
    }
  }

  // ---- Submit ----
  function submit(e) {
    if (e) e.preventDefault();
    if (submitting) return;
    const question = els.input.value.trim();
    if (!question) {
      setMessage("Please write a question for the salon.", "error");
      els.input.classList.add("is-invalid");
      els.input.focus();
      return;
    }
    els.input.classList.remove("is-invalid");
    setMessage("", null);

    const keys = selectedKeys();
    setLoading(true);

    const api = D().api;
    const req = api
      ? api("/api/salon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: question, philosophers: keys }),
        })
      : fetch("/api/salon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: question, philosophers: keys }),
        }).then(function (r) {
          if (!r.ok) throw new Error("Request failed: " + r.status);
          return r.json();
        });

    req
      .then(function (data) {
        setLoading(false);
        renderResults(data);
      })
      .catch(function (err) {
        setLoading(false);
        setMessage(
          (err && err.message) ? err.message : "The salon could not be convened. Please try again.",
          "error"
        );
      });
  }

  // ---- Render responses as an arc of cards ----
  function renderResults(data) {
    const responses = (data && data.responses) || [];
    els.results.innerHTML = "";
    els.sampleChip.hidden = !(data && data.sample);

    if (!responses.length) {
      els.resultsTitle.hidden = true;
      setMessage("No answers came back. Try posing the question again.", "error");
      return;
    }

    els.resultsTitle.textContent = "“" + (data.question || "").trim() + "”";
    els.resultsTitle.hidden = false;

    const n = responses.length;
    const cards = [];
    responses.forEach(function (r, i) {
      const card = makeCard(r, i, n);
      els.results.appendChild(card);
      cards.push(card);
    });

    // Entrance: stagger 30–50ms. Reduced motion → cards are already visible.
    if (useGsap()) {
      gsap.set(cards, { opacity: 0, y: 18 });
      gsap.to(cards, {
        opacity: 1,
        y: 0,
        duration: 0.5,
        ease: "power3.out",
        stagger: 0.045,
      });
    } else {
      cards.forEach(function (c) { c.style.opacity = "1"; });
    }

    // Move focus to the results heading for screen-reader users.
    try { els.resultsTitle.setAttribute("tabindex", "-1"); els.resultsTitle.focus(); } catch (_) {}
  }

  function makeCard(r, i, n) {
    const accent = ACCENTS[r.key] || DEFAULT_ACCENT;
    const card = document.createElement("article");
    card.className = "salon-card";
    card.style.setProperty("--accent", accent);

    // Gentle arc offset on wide screens (handled mostly via CSS nth-child, but
    // we also set a custom prop so the curve scales with the count).
    const mid = (n - 1) / 2;
    const lift = Math.round(Math.abs(i - mid) * 14); // outer cards sit lower
    card.style.setProperty("--arc-lift", lift + "px");

    const head = document.createElement("header");
    head.className = "salon-card__head";

    const sigWrap = document.createElement("span");
    sigWrap.className = "salon-card__sigil";
    sigWrap.setAttribute("aria-hidden", "true");
    const sig = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    sig.setAttribute("viewBox", "0 0 24 24");
    sig.setAttribute("width", "22");
    sig.setAttribute("height", "22");
    sig.setAttribute("fill", "none");
    sig.setAttribute("stroke", "currentColor");
    sig.setAttribute("stroke-width", "1.4");
    sig.setAttribute("stroke-linecap", "round");
    sig.setAttribute("stroke-linejoin", "round");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", sigilHref(r.key));
    sig.appendChild(use);
    sigWrap.appendChild(sig);

    const name = document.createElement("h4");
    name.className = "salon-card__name";
    name.textContent = r.display_name || (D().displayNameFor ? D().displayNameFor(r.key) : r.key);

    head.appendChild(sigWrap);
    head.appendChild(name);

    const rule = document.createElement("span");
    rule.className = "salon-card__rule";
    rule.setAttribute("aria-hidden", "true");

    const body = document.createElement("p");
    body.className = "salon-card__body";
    body.textContent = String(r.body || "").trim();

    card.appendChild(head);
    card.appendChild(rule);
    card.appendChild(body);
    return card;
  }

  // ---- Events ----
  function bind() {
    if (els.form) els.form.addEventListener("submit", submit);
    if (els.input) {
      els.input.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
      els.input.addEventListener("input", function () {
        if (els.input.value.trim()) {
          els.input.classList.remove("is-invalid");
          if (els.message.classList.contains("is-error")) setMessage("", null);
        }
      });
    }
  }

  // ---- Public hooks used by app.js ----
  window.DaimonSalon = {
    onPhilosophers: function (list) { buildChips(list); },
    onEnter: function () {
      // First time the user opens the salon, focus the question field.
      if (els.input && !els.input.value) {
        // Defer so it happens after the view transition settles.
        setTimeout(function () { try { els.input.focus(); } catch (_) {} }, reduce() ? 0 : 350);
      }
      // Fallback: if chips never got built (philosophers loaded before us), try.
      if (!built && D().philosophers) buildChips(D().philosophers());
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
