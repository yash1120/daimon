/* ==========================================================================
 * onboarding.js — a one-time, first-visit welcome overlay.
 *
 * Shown ONLY on the first visit: gated by a localStorage flag
 * ('daimon.onboarded'). A few reverent steps introduce Daimon (daily letters,
 * replies, the salon, a philosophy taking shape) and end with the name prompt.
 * "Begin" finishes (POSTs the name if given, sets the flag); "Skip" dismisses.
 * It never shows again once dismissed, and never shows to anyone who has
 * already set a name (returning visitors / existing users).
 *
 * a11y / motion:
 *   - role="dialog", aria-modal; focus moves in, is trapped, restored on close.
 *   - Esc and "Skip" both close (and set the flag).
 *   - prefers-reduced-motion → fade only (no slide/scale), via CSS + a flag here.
 *
 * Depends (softly) on window.Daimon: api, setName, REDUCE. Resilient if those
 * load late (the name POST falls back to a plain fetch).
 * ========================================================================== */
(function () {
  "use strict";

  const FLAG = "daimon.onboarded";

  const els = {
    overlay: document.getElementById("onboard-overlay"),
    dialog: document.getElementById("onboard-dialog"),
    steps: Array.prototype.slice.call(document.querySelectorAll(".onboard__step")),
    dots: Array.prototype.slice.call(document.querySelectorAll(".onboard__dot")),
    next: document.getElementById("onboard-next"),
    skip: document.getElementById("onboard-skip"),
    nameForm: document.getElementById("onboard-name-form"),
    nameInput: document.getElementById("onboard-name"),
  };

  // Bail quietly if the markup isn't present.
  if (!els.overlay || !els.dialog || !els.steps.length) return;

  function D() { return window.Daimon || {}; }
  function reduce() { return !!D().REDUCE; }

  function api(path, opts) {
    if (D().api) return D().api(path, opts);
    return fetch(path, opts).then(function (r) {
      if (!r.ok) throw new Error("Request failed: " + r.status);
      return r.json();
    });
  }

  // localStorage may throw (private mode / disabled). Treat any failure to READ
  // as "already onboarded" so we never nag when we can't remember the choice.
  function hasOnboarded() {
    try { return localStorage.getItem(FLAG) === "1"; }
    catch (_) { return true; }
  }
  function markOnboarded() {
    try { localStorage.setItem(FLAG, "1"); } catch (_) { /* non-fatal */ }
  }

  let isOpen = false;
  let lastFocused = null;
  let step = 0;
  let finished = false;

  // ---- Steps ----
  function showStep(i) {
    step = Math.max(0, Math.min(els.steps.length - 1, i));
    els.steps.forEach(function (s, idx) {
      const on = idx === step;
      s.hidden = !on;
      s.classList.toggle("is-active", on);
    });
    els.dots.forEach(function (d, idx) {
      d.classList.toggle("is-on", idx <= step);
    });
    const last = step === els.steps.length - 1;
    if (els.next) els.next.textContent = last ? "Begin" : "Next";

    // Focus the name field on the final step; otherwise keep focus on Next.
    if (last && els.nameInput) {
      setTimeout(function () { try { els.nameInput.focus(); } catch (_) {} }, 20);
    } else if (els.next) {
      setTimeout(function () { try { els.next.focus(); } catch (_) {} }, 20);
    }
  }

  function advance() {
    if (step < els.steps.length - 1) {
      showStep(step + 1);
    } else {
      finish();
    }
  }

  // ---- Finish (Begin): save the name if given, set the flag, close. ----
  function finish() {
    if (finished) return;
    finished = true;
    markOnboarded();

    const name = els.nameInput ? els.nameInput.value.trim().slice(0, 60) : "";
    if (name) {
      api("/api/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name }),
      }).then(function (data) {
        const saved = (data && typeof data.name === "string") ? data.name : name;
        if (D().setName) D().setName(saved);
        if (window.DaimonSettings && window.DaimonSettings.reflect) {
          window.DaimonSettings.reflect({ name: saved });
        }
      }).catch(function () { /* name is optional — never block dismissal */ });
    }
    close();
  }

  // ---- Skip: set the flag and close without saving a name. ----
  function skip() {
    if (finished) return;
    finished = true;
    markOnboarded();
    close();
  }

  // ---- Focus trap (mirrors settings.js / search.js) ----
  function focusables() {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),' +
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
  function onKeydown(e) {
    if (e.key === "Escape") { e.preventDefault(); skip(); return; }
    // Enter on the name field advances/finishes rather than reloading.
    if (e.key === "Enter" && e.target === els.nameInput) {
      e.preventDefault();
      advance();
      return;
    }
    trap(e);
  }

  // ---- Open / close ----
  function open() {
    if (isOpen) return;
    isOpen = true;
    lastFocused = document.activeElement;

    showStep(0);
    els.overlay.hidden = false;
    requestAnimationFrame(function () { els.overlay.classList.add("is-open"); });
    document.body.classList.add("modal-open");
    document.addEventListener("keydown", onKeydown, true);

    setTimeout(function () {
      try { (els.next || els.dialog).focus(); } catch (_) {}
    }, 30);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    els.overlay.classList.remove("is-open");
    document.body.classList.remove("modal-open");
    document.removeEventListener("keydown", onKeydown, true);

    const finishClose = function () {
      els.overlay.hidden = true;
      try { if (lastFocused && lastFocused.focus) lastFocused.focus(); } catch (_) {}
    };
    if (reduce()) finishClose();
    else setTimeout(finishClose, 200);
  }

  // ---- Events ----
  function bind() {
    if (els.next) els.next.addEventListener("click", advance);
    if (els.skip) els.skip.addEventListener("click", skip);
    // The name form's submit (Enter in the field) → advance/finish, no reload.
    if (els.nameForm) {
      els.nameForm.addEventListener("submit", function (e) {
        e.preventDefault();
        advance();
      });
    }
    // Backdrop click does NOT dismiss (avoid accidental skips on first run);
    // the explicit Skip / Begin / Esc are the ways out.
  }

  bind();

  // Public hook: app.js decides whether to show it once prefs are known (so we
  // can suppress it for anyone who already has a name saved server-side).
  window.DaimonOnboarding = {
    // Show on first visit only, and only if the visitor has no saved name.
    maybeShow: function (opts) {
      opts = opts || {};
      if (hasOnboarded()) { markOnboarded(); return; }
      if (opts.hasName) { markOnboarded(); return; } // returning user → never show
      open();
    },
    open: open,
    close: close,
  };
})();
