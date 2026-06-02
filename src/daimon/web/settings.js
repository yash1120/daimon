/* ==========================================================================
 * settings.js — the Settings modal.
 *
 * A focus-trapped dialog opened from the nav gear. Fields:
 *   - Name (what the philosophers call you) — kept in sync with the hero field,
 *   - Theme (Dark / Light / Auto) — applied live via window.Daimon.applyTheme,
 *   - Read aloud (TTS auto-read) — a role="switch" toggle,
 *   - Default philosopher — a <select> of the five.
 *
 * Values load from GET /api/prefs (handed in by app.js via onPrefs); a Save
 * button persists the whole form via POST /api/prefs and confirms with an
 * aria-live message. Changes also apply live so the page reflects them at once.
 *
 * Esc closes; focus is trapped while open and restored to the opener on close.
 *
 * Depends on window.Daimon (exported by app.js): api, applyTheme, setName,
 * setTts, setDefaultPhilosopher, displayNameFor. Resilient if those load late.
 * ========================================================================== */
(function () {
  "use strict";

  const els = {
    openBtn: document.getElementById("nav-settings"),
    overlay: document.getElementById("settings-overlay"),
    dialog: document.getElementById("settings-dialog"),
    closeBtn: document.getElementById("settings-close"),
    form: document.getElementById("settings-form"),
    name: document.getElementById("settings-name"),
    themeRadios: Array.prototype.slice.call(
      document.querySelectorAll('input[name="theme"]')
    ),
    tts: document.getElementById("settings-tts"),
    defaultPhil: document.getElementById("settings-default-phil"),
    save: document.getElementById("settings-save"),
    status: document.getElementById("settings-status"),
  };

  // Bail quietly if the markup isn't present (keeps the rest of the app safe).
  if (!els.overlay || !els.dialog || !els.form) return;

  let lastFocused = null;     // element to restore focus to on close
  let isOpen = false;
  let saving = false;
  let statusTimer = null;
  let prefsLoaded = false;
  let pendingPrefs = null;    // prefs that arrived before the form was ready

  function D() { return window.Daimon || {}; }
  function api(path, opts) {
    if (D().api) return D().api(path, opts);
    return fetch(path, opts).then(function (r) {
      if (!r.ok) throw new Error("Request failed: " + r.status);
      return r.json();
    });
  }

  // ---- Populate the form from a prefs object ----
  function fillForm(prefs) {
    prefs = prefs || {};
    if (els.name) els.name.value = (prefs.name != null) ? String(prefs.name) : "";
    setThemeRadio(typeof prefs.theme === "string" ? prefs.theme : "");
    setSwitch(!!prefs.tts);
    if (els.defaultPhil && prefs.default_philosopher) {
      // Only set if the option exists (list may load slightly later).
      const has = Array.prototype.some.call(els.defaultPhil.options, function (o) {
        return o.value === prefs.default_philosopher;
      });
      if (has) els.defaultPhil.value = prefs.default_philosopher;
    }
    prefsLoaded = true;
  }

  function setThemeRadio(value) {
    const v = (value === "dark" || value === "light") ? value : "";
    els.themeRadios.forEach(function (r) { r.checked = (r.value === v); });
  }

  function selectedTheme() {
    let v = "";
    els.themeRadios.forEach(function (r) { if (r.checked) v = r.value; });
    return v; // "", "dark", "light"
  }

  // ---- The read-aloud switch (role="switch") ----
  function setSwitch(on) {
    if (!els.tts) return;
    els.tts.setAttribute("aria-checked", on ? "true" : "false");
    els.tts.classList.toggle("is-on", on);
  }
  function switchOn() {
    return els.tts && els.tts.getAttribute("aria-checked") === "true";
  }

  // ---- Default-philosopher select (built from the philosopher list) ----
  function buildPhilOptions(list, current) {
    if (!els.defaultPhil) return;
    els.defaultPhil.innerHTML = "";
    (list || []).forEach(function (p) {
      const opt = document.createElement("option");
      opt.value = p.key;
      opt.textContent = p.display_name || p.key;
      els.defaultPhil.appendChild(opt);
    });
    // Prefer a saved pref; else the app's current philosopher.
    const pref = pendingPrefs && pendingPrefs.default_philosopher;
    const want = (pref && optionExists(pref)) ? pref : current;
    if (want && optionExists(want)) els.defaultPhil.value = want;
  }
  function optionExists(key) {
    return els.defaultPhil && Array.prototype.some.call(
      els.defaultPhil.options, function (o) { return o.value === key; }
    );
  }

  // ---- Status (aria-live) ----
  function setStatus(text, kind) {
    if (!els.status) return;
    els.status.textContent = text || "";
    els.status.classList.remove("is-error", "is-success");
    if (kind === "error") els.status.classList.add("is-error");
    else if (kind === "success") els.status.classList.add("is-success");
  }

  // ---- Focus trap ----
  function focusables() {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),' +
      ' select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
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

    // Re-sync from the latest known prefs each time it opens, then refetch to be
    // current (cheap, and keeps multi-tab edits honest).
    if (pendingPrefs) fillForm(pendingPrefs);
    api("/api/prefs")
      .then(function (data) {
        pendingPrefs = data || pendingPrefs;
        fillForm(pendingPrefs);
      })
      .catch(function () { /* keep whatever we have */ });

    els.overlay.hidden = false;
    // Defer the class + focus a frame so the transition can play.
    requestAnimationFrame(function () {
      els.overlay.classList.add("is-open");
    });
    document.body.classList.add("modal-open");
    if (els.openBtn) els.openBtn.setAttribute("aria-expanded", "true");
    setStatus("", null);

    // Focus the dialog (then the first field) once visible.
    setTimeout(function () {
      try { (els.name || els.dialog).focus(); } catch (_) {}
    }, 30);

    document.addEventListener("keydown", onKeydown, true);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    els.overlay.classList.remove("is-open");
    document.body.classList.remove("modal-open");
    if (els.openBtn) els.openBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKeydown, true);

    // Hide after the transition; restore focus to the opener.
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
      close();
      return;
    }
    trap(e);
  }

  // ---- Save (POST /api/prefs) ----
  function save(e) {
    if (e) e.preventDefault();
    if (saving) return;

    const patch = {
      name: els.name ? els.name.value.trim().slice(0, 60) : "",
      theme: selectedTheme(),
      tts: switchOn(),
      default_philosopher: els.defaultPhil ? els.defaultPhil.value : "",
    };

    saving = true;
    if (els.save) {
      els.save.classList.add("is-loading");
      els.save.disabled = true;
    }
    setStatus("", null);

    api("/api/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then(function (data) {
        data = data || patch;
        pendingPrefs = data;
        applyLive(data);
        if (els.save) {
          els.save.classList.remove("is-loading");
          els.save.classList.add("is-success");
        }
        setStatus("Your settings have been saved.", "success");
        clearTimeout(statusTimer);
        statusTimer = setTimeout(function () {
          if (els.save) {
            els.save.classList.remove("is-success");
            els.save.disabled = false;
          }
          saving = false;
        }, 1400);
      })
      .catch(function (err) {
        if (els.save) {
          els.save.classList.remove("is-loading");
          els.save.disabled = false;
        }
        saving = false;
        setStatus(
          (err && err.message) ? err.message : "Could not save your settings.",
          "error"
        );
      });
  }

  // Apply saved prefs live across the app (no reload).
  function applyLive(prefs) {
    const d = D();
    if (typeof d.applyTheme === "function") d.applyTheme(typeof prefs.theme === "string" ? prefs.theme : "");
    if (typeof d.setName === "function") d.setName(prefs.name || "");
    if (typeof d.setTts === "function") d.setTts(!!prefs.tts);
    if (typeof d.setDefaultPhilosopher === "function" && prefs.default_philosopher) {
      d.setDefaultPhilosopher(prefs.default_philosopher);
    }
  }

  // ---- Live theme preview when the radios change (still needs Save to persist
  //      — but previewing is friendlier than waiting). ----
  function bind() {
    if (els.openBtn) els.openBtn.addEventListener("click", open);
    if (els.closeBtn) els.closeBtn.addEventListener("click", close);
    if (els.form) els.form.addEventListener("submit", save);

    // Click the backdrop (outside the dialog) closes.
    els.overlay.addEventListener("mousedown", function (e) {
      if (e.target === els.overlay) close();
    });

    // The read-aloud switch toggles on click / Space / Enter.
    if (els.tts) {
      els.tts.addEventListener("click", function () { setSwitch(!switchOn()); });
      els.tts.addEventListener("keydown", function (e) {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          setSwitch(!switchOn());
        }
      });
    }

    // Preview theme immediately as the user picks a radio.
    els.themeRadios.forEach(function (r) {
      r.addEventListener("change", function () {
        if (r.checked && D().applyTheme) D().applyTheme(r.value);
      });
    });
  }

  // ---- Public hooks used by app.js ----
  window.DaimonSettings = {
    // Full prefs arrived (called on boot by app.js).
    onPrefs: function (prefs) {
      pendingPrefs = prefs || {};
      fillForm(pendingPrefs);
    },
    // Philosopher list arrived → build the default-philosopher select.
    onPhilosophers: function (list, current) {
      buildPhilOptions(list, current);
      // If prefs already arrived, make sure the saved default is reflected.
      if (pendingPrefs) fillForm(pendingPrefs);
    },
    // app.js calls this to keep the form in sync when a value changes elsewhere
    // (e.g. the hero name field, the nav philosopher select, the theme toggle).
    reflect: function (patch) {
      patch = patch || {};
      if (!pendingPrefs) pendingPrefs = {};
      if ("name" in patch) {
        pendingPrefs.name = patch.name || "";
        if (els.name) els.name.value = pendingPrefs.name;
      }
      if ("theme" in patch) {
        pendingPrefs.theme = (patch.theme === "dark" || patch.theme === "light") ? patch.theme : "";
        setThemeRadio(pendingPrefs.theme);
      }
      if ("tts" in patch) {
        pendingPrefs.tts = !!patch.tts;
        setSwitch(pendingPrefs.tts);
      }
      if ("default_philosopher" in patch) {
        pendingPrefs.default_philosopher = patch.default_philosopher || "";
        if (optionExists(pendingPrefs.default_philosopher)) {
          els.defaultPhil.value = pendingPrefs.default_philosopher;
        }
      }
    },
    open: open,
    close: close,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
