/* ==========================================================================
 * app.js — Daimon single-page app.
 * Four views (hero / reading / timeline / salon) toggled in JS. GSAP drives an
 * "ink wash" transition between views (directional ease in/out + a full-screen
 * --ink-900 sweep), fully gated behind prefers-reduced-motion (opacity-only
 * fades, no wash, no translate there). Transitions are interruptible.
 * ========================================================================== */
(function () {
  "use strict";

  const gsap = window.gsap;
  const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasGsap = typeof gsap !== "undefined";

  // Logical ordering of views: forward = enter from the right/below,
  // backward = enter from the left/above (continuity of direction).
  const VIEW_ORDER = {
    hero: 0, reading: 1, timeline: 2, salon: 3, saved: 4,
    philosophy: 5, stats: 6, about: 7,
  };

  // Map a philosopher key to its inline SVG sigil id (defined in index.html).
  const SIGIL_KEYS = ["seneca", "aurelius", "nietzsche", "camus", "weil"];
  function sigilHref(key) {
    return "#sigil-" + (SIGIL_KEYS.indexOf(key) >= 0 ? key : "default");
  }

  // ---- DOM refs ----
  const body = document.body;
  const els = {
    select: document.getElementById("philosopher-select"),
    navNew: document.getElementById("nav-new-letter"),
    navTabs: Array.prototype.slice.call(document.querySelectorAll(".nav-tab")),
    inkWash: document.getElementById("ink-wash"),

    viewHero: document.getElementById("view-hero"),
    viewReading: document.getElementById("view-reading"),
    viewTimeline: document.getElementById("view-timeline"),
    viewSalon: document.getElementById("view-salon"),
    viewSaved: document.getElementById("view-saved"),
    viewPhilosophy: document.getElementById("view-philosophy"),
    viewStats: document.getElementById("view-stats"),
    viewAbout: document.getElementById("view-about"),

    heroRead: document.getElementById("hero-read"),
    heroBrowse: document.getElementById("hero-browse"),
    heroSalon: document.getElementById("hero-salon"),
    heroAnims: Array.prototype.slice.call(document.querySelectorAll("#view-hero [data-anim]")),

    letterSigilUse: document.getElementById("letter-sigil-use"),

    loading: document.getElementById("reading-loading"),
    letter: document.getElementById("letter"),
    author: document.getElementById("letter-author"),
    date: document.getElementById("letter-date"),
    bodyEl: document.getElementById("letter-body"),
    sampleChip: document.getElementById("letter-sample-chip"),

    replyForm: document.getElementById("reply-form"),
    replyText: document.getElementById("reply-text"),
    replySubmit: document.getElementById("reply-submit"),
    replyMessage: document.getElementById("reply-message"),

    timelineList: document.getElementById("timeline-list"),
    timelineEmpty: document.getElementById("timeline-empty"),
    timelineEmptyCta: document.getElementById("timeline-empty-cta"),
    timelineSub: document.getElementById("timeline-sub"),

    nameForm: document.getElementById("name-form"),
    nameInput: document.getElementById("name-input"),
    nameSave: document.getElementById("name-save"),
    nameStatus: document.getElementById("name-status"),
    brandFor: document.getElementById("brand-for"),

    themeToggle: document.getElementById("nav-theme-toggle"),

    // Optional topic field (hero)
    topicToggle: document.getElementById("topic-toggle"),
    topicPanel: document.getElementById("topic-panel"),
    topicInput: document.getElementById("topic-input"),

    // Read-aloud (TTS) on the reading view
    listenBtn: document.getElementById("letter-listen"),

    // Bookmark / star toggle on the reading view
    bookmarkBtn: document.getElementById("letter-bookmark"),

    // Search affordance in the nav (opens the search overlay)
    searchBtn: document.getElementById("nav-search"),

    // Further reading (citations)
    sources: document.getElementById("further-reading"),
    sourcesList: document.getElementById("sources-list"),
  };

  // ---- App state ----
  const state = {
    philosopher: "seneca",
    philosophers: [],
    currentLetterId: null,
    currentBookmarked: false,   // is the currently shown letter starred?
    name: "",
    theme: "",          // "", "dark", "light" — "" means follow system (auto)
    tts: false,         // auto-read newly generated letters aloud
    letterText: "",     // plain text of the current letter (for TTS)
    sample: false,      // is the current letter a sample?
  };

  // ---- Helpers ----
  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      if (!r.ok) {
        return r
          .json()
          .catch(function () { return {}; })
          .then(function (j) {
            const err = new Error(j.detail || ("Request failed: " + r.status));
            err.status = r.status;
            throw err;
          });
      }
      return r.json();
    });
  }

  function displayNameFor(key) {
    const p = state.philosophers.find(function (x) { return x.key === key; });
    return p ? p.display_name : key;
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try {
      return d.toLocaleDateString(undefined, {
        year: "numeric", month: "long", day: "numeric",
      });
    } catch (e) {
      return d.toDateString();
    }
  }

  // Split a letter into paragraphs, preserving line breaks; sign-off on its
  // own line (short trailing lines like "Vale." get the .signoff style).
  function renderBody(text) {
    els.bodyEl.innerHTML = "";
    const blocks = String(text || "")
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)
      .map(function (b) { return b.trim(); })
      .filter(Boolean);

    const frag = document.createDocumentFragment();
    blocks.forEach(function (block, idx) {
      const lines = block.split(/\n/);
      const isLast = idx === blocks.length - 1;
      const looksLikeSignoff =
        isLast && lines.length === 1 && lines[0].length <= 60;

      const p = document.createElement("p");
      if (looksLikeSignoff) p.className = "signoff";
      lines.forEach(function (line, li) {
        if (li > 0) p.appendChild(document.createElement("br"));
        p.appendChild(document.createTextNode(line));
      });
      frag.appendChild(p);
    });
    els.bodyEl.appendChild(frag);
    return Array.prototype.slice.call(els.bodyEl.querySelectorAll("p"));
  }

  // ---- Theme (dark / light "parchment day" / auto) ----
  // The saved pref is "", "dark", or "light". "" = follow the system. We set a
  // concrete data-theme on <html> ("dark"|"light") so CSS overrides apply, and
  // remember the *preference* (which may be "") in state for round-tripping.
  const rootEl = document.documentElement;
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)");

  function resolvedTheme(pref) {
    if (pref === "dark" || pref === "light") return pref;
    return sysDark.matches ? "dark" : "light";
  }

  // Apply a *preference* ("", "dark", "light") to the document + nav button.
  function applyTheme(pref) {
    state.theme = (pref === "dark" || pref === "light") ? pref : "";
    const resolved = resolvedTheme(state.theme);
    rootEl.setAttribute("data-theme", resolved);
    const metaCs = document.querySelector('meta[name="color-scheme"]');
    if (metaCs) metaCs.setAttribute("content", resolved === "light" ? "light dark" : "dark light");
    if (els.themeToggle) {
      const next = resolved === "dark" ? "light" : "dark";
      els.themeToggle.setAttribute(
        "aria-label",
        "Switch to " + next + " theme"
      );
      els.themeToggle.setAttribute("title", "Switch to " + next + " theme");
    }
  }

  // Follow the system when (and only when) the preference is "auto" ("").
  sysDark.addEventListener("change", function () {
    if (!state.theme) applyTheme("");
  });

  // The nav button flips between the two *concrete* themes and persists it.
  function toggleTheme() {
    const resolved = resolvedTheme(state.theme);
    const next = resolved === "dark" ? "light" : "dark";
    applyTheme(next);
    persistPrefs({ theme: next });
    if (window.DaimonSettings && window.DaimonSettings.reflect) {
      window.DaimonSettings.reflect({ theme: next });
    }
  }

  // Persist a subset of prefs without blocking the UI; failures are silent
  // (prefs are an enhancement, never load-bearing).
  function persistPrefs(patch) {
    return api("/api/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(function () { /* non-fatal */ });
  }

  // ---- Read-aloud (Web Speech API) ----
  const synth = ("speechSynthesis" in window) ? window.speechSynthesis : null;
  let speaking = false;
  let speakUtter = null;

  function ttsSupported() { return !!synth; }

  function setListenState(on) {
    speaking = on;
    if (!els.listenBtn) return;
    els.listenBtn.classList.toggle("is-speaking", on);
    els.listenBtn.setAttribute("aria-pressed", on ? "true" : "false");
    const label = els.listenBtn.querySelector(".letter-listen__label");
    if (label) label.textContent = on ? "Stop" : "Listen";
    els.listenBtn.setAttribute("aria-label", on ? "Stop reading aloud" : "Listen to this letter");
  }

  function stopSpeaking() {
    if (!synth) return;
    try { synth.cancel(); } catch (_) {}
    speakUtter = null;
    setListenState(false);
  }

  function speakLetter() {
    if (!synth || !state.letterText) return;
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(state.letterText);
    u.rate = 0.95;       // a calm, unhurried pace
    u.pitch = 1;
    u.lang = document.documentElement.lang || "en";
    u.onend = function () { if (speakUtter === u) setListenState(false); };
    u.onerror = function () { if (speakUtter === u) setListenState(false); };
    speakUtter = u;
    setListenState(true);
    try { synth.speak(u); } catch (_) { setListenState(false); }
  }

  function toggleSpeaking() {
    if (speaking) stopSpeaking();
    else speakLetter();
  }

  // ---- Bookmark / star the current letter ----
  // The star reflects state.currentBookmarked. It posts to
  // POST /api/letters/{id}/bookmark {on} and reflects the returned state.
  // Shown only when a real, saved letter is on screen (hidden for the error /
  // "could not be delivered" placeholder, which has no id).
  let bookmarking = false;

  function reflectBookmark(on) {
    state.currentBookmarked = !!on;
    if (!els.bookmarkBtn) return;
    els.bookmarkBtn.classList.toggle("is-saved", !!on);
    els.bookmarkBtn.setAttribute("aria-pressed", on ? "true" : "false");
    els.bookmarkBtn.setAttribute(
      "aria-label", on ? "Remove this letter from saved" : "Save this letter"
    );
    const label = els.bookmarkBtn.querySelector(".letter-bookmark__label");
    if (label) label.textContent = on ? "Saved" : "Save";
  }

  // Show/initialise the star for a letter with a known id + bookmarked flag.
  function setupBookmark(id, bookmarked) {
    if (!els.bookmarkBtn) return;
    if (id == null) {
      els.bookmarkBtn.hidden = true;
      return;
    }
    els.bookmarkBtn.hidden = false;
    els.bookmarkBtn.disabled = false;
    bookmarking = false;
    reflectBookmark(!!bookmarked);
  }

  function toggleBookmark() {
    if (bookmarking) return;
    const id = state.currentLetterId;
    if (id == null) return;
    const next = !state.currentBookmarked;

    // Optimistic: reflect immediately, roll back on failure.
    bookmarking = true;
    reflectBookmark(next);
    if (els.bookmarkBtn) els.bookmarkBtn.disabled = true;

    api("/api/letters/" + id + "/bookmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: next }),
    })
      .then(function (data) {
        reflectBookmark(data && typeof data.bookmarked === "boolean" ? data.bookmarked : next);
        // Keep the Saved view fresh if it has already been built.
        if (window.DaimonBookmarks && window.DaimonBookmarks.invalidate) {
          window.DaimonBookmarks.invalidate();
        }
      })
      .catch(function () {
        reflectBookmark(!next); // roll back
      })
      .then(function () {
        bookmarking = false;
        if (els.bookmarkBtn) els.bookmarkBtn.disabled = false;
      });
  }

  // ---- Further reading (citations) ----
  function renderSources(sources) {
    if (!els.sources || !els.sourcesList) return;
    els.sourcesList.innerHTML = "";
    const list = Array.isArray(sources) ? sources.filter(function (s) {
      return s && String(s.text || "").trim();
    }) : [];

    if (!list.length) {
      els.sources.hidden = true;
      els.sources.open = false;
      return;
    }

    const frag = document.createDocumentFragment();
    list.forEach(function (s) {
      const li = document.createElement("li");
      li.className = "source";

      const fig = document.createElement("figure");
      fig.className = "source__fig";

      const quote = document.createElement("blockquote");
      quote.className = "source__text";
      quote.textContent = String(s.text || "").trim();
      fig.appendChild(quote);

      const who = s.philosopher
        ? (displayNameFor(s.philosopher) || s.philosopher)
        : "";
      if (who) {
        const cite = document.createElement("figcaption");
        cite.className = "source__cite";
        cite.textContent = "— " + who;
        fig.appendChild(cite);
      }

      li.appendChild(fig);
      frag.appendChild(li);
    });
    els.sourcesList.appendChild(frag);
    els.sources.hidden = false;
  }

  // ---- View switching: GSAP "ink wash" transition (directional) ----
  const VIEWS = {
    hero: els.viewHero,
    reading: els.viewReading,
    timeline: els.viewTimeline,
    salon: els.viewSalon,
    saved: els.viewSaved,
    philosophy: els.viewPhilosophy,
    stats: els.viewStats,
    about: els.viewAbout,
  };

  let currentView = "hero";
  let transitioning = false;
  let activeTL = null; // the in-flight transition timeline (so we can kill it)

  function syncNav(name) {
    body.setAttribute("data-view", name);
    els.navTabs.forEach(function (tab) {
      const active = tab.getAttribute("data-nav") === name;
      tab.classList.toggle("is-active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
  }

  // Snap helper: hide every view except `name`, show `name`.
  function hardSwap(name) {
    Object.keys(VIEWS).forEach(function (k) {
      const v = VIEWS[k];
      if (k === name) { v.hidden = false; v.style.opacity = "1"; v.style.transform = ""; }
      else { v.hidden = true; }
    });
  }

  function showView(name) {
    const next = VIEWS[name];
    if (!next || name === currentView) {
      // Still make sure nav reflects the requested view.
      if (next) { syncNav(name); }
      return;
    }
    const prevName = currentView;
    const prev = VIEWS[prevName];
    currentView = name;
    syncNav(name);

    // Stop any read-aloud when navigating away from the letter.
    if (prevName === "reading" && name !== "reading") stopSpeaking();

    // Reduced motion OR no GSAP → simple opacity fade, no wash, no translate.
    if (!hasGsap || REDUCE) {
      hardSwap(name);
      if (hasGsap) gsap.fromTo(next, { opacity: 0 }, { opacity: 1, duration: 0.001 });
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    // Direction: forward (right/below) vs backward (left/above).
    const dir = (VIEW_ORDER[name] >= VIEW_ORDER[prevName]) ? 1 : -1;

    // Interruptible: a prior transition may still be mid-flight. Kill its
    // timeline (whose deferred callbacks would otherwise un-hide a stale view)
    // and any tweens on the wash + views, then synchronously normalise state:
    // hide EVERY view except the incoming `next` and the outgoing `prev`, so we
    // can never end up with two views showing.
    if (activeTL) { activeTL.kill(); activeTL = null; }
    const allViews = Object.keys(VIEWS).map(function (k) { return VIEWS[k]; });
    gsap.killTweensOf(allViews.concat([els.inkWash]));
    Object.keys(VIEWS).forEach(function (k) {
      const v = VIEWS[k];
      if (k === name || k === prevName) return;
      v.hidden = true;
      gsap.set(v, { clearProps: "transform,opacity" });
    });
    transitioning = true;

    const ENTER = 0.5;
    const EXIT = ENTER * 0.65; // exit ~65% of enter

    // Outgoing view eases out toward the logical direction.
    if (prev && prev !== next && !prev.hidden) {
      gsap.to(prev, {
        opacity: 0,
        x: -18 * dir,
        duration: EXIT,
        ease: "power2.in",
        onComplete: function () { prev.hidden = true; gsap.set(prev, { clearProps: "transform,opacity" }); },
      });
    }

    // Ink-wash sweep: a quick veil of --ink-900 that wipes in then out.
    els.inkWash.style.transformOrigin = dir > 0 ? "left center" : "right center";
    gsap.set(els.inkWash, { autoAlpha: 1, scaleX: 0 });
    activeTL = gsap.timeline({ onComplete: function () { activeTL = null; } })
      .to(els.inkWash, { scaleX: 1, duration: 0.26, ease: "power2.in" })
      .add(function () {
        // Reveal the incoming view mid-wash (behind the veil).
        next.hidden = false;
        gsap.set(next, { opacity: 1, x: 22 * dir });
        window.scrollTo({ top: 0, behavior: "auto" });
      })
      .to(els.inkWash, { scaleX: 0, transformOrigin: dir > 0 ? "right center" : "left center", duration: 0.3, ease: "power2.out" })
      .add(function () { gsap.set(els.inkWash, { autoAlpha: 0 }); });

    // Incoming view eases in from the logical direction.
    gsap.fromTo(
      next,
      { opacity: 0, x: 22 * dir },
      {
        opacity: 1,
        x: 0,
        duration: ENTER,
        ease: "power3.out",
        delay: 0.12,
        onComplete: function () { gsap.set(next, { clearProps: "transform,opacity" }); transitioning = false; },
      }
    );
  }

  // ---- Hero entrance ----
  function animateHero() {
    if (!hasGsap || REDUCE) {
      els.heroAnims.forEach(function (el) { el.style.opacity = "1"; });
      return;
    }
    gsap.set(els.heroAnims, { opacity: 0, y: 22 });
    gsap.to(els.heroAnims, {
      opacity: 1, y: 0, duration: 0.5, ease: "power3.out", stagger: 0.08, delay: 0.1,
    });
  }

  // ---- Reading view: reveal a letter ----
  // opts.autoRead — allow TTS auto-read if the pref is on (only for freshly
  // generated letters, never on first page load without interaction).
  function revealLetter(data, opts) {
    opts = opts || {};
    stopSpeaking(); // never carry speech across letters
    state.currentLetterId = data.id;
    state.sample = !!data.sample;
    els.author.textContent = data.display_name || displayNameFor(data.philosopher);
    els.date.textContent = formatDate(data.created_at);
    els.sampleChip.hidden = !data.sample;
    if (els.letterSigilUse) {
      els.letterSigilUse.setAttribute("href", sigilHref(data.philosopher || state.philosopher));
    }

    const paras = renderBody(data.body);

    // Capture plain text + author for read-aloud; toggle the Listen button.
    const author = els.author.textContent || "";
    state.letterText = (author ? author + ". " : "") + String(data.body || "").replace(/\s+/g, " ").trim();
    if (els.listenBtn) {
      els.listenBtn.hidden = !ttsSupported();
      setListenState(false);
    }

    // Share: a real letter with text is on screen → offer share-as-image.
    if (window.DaimonShare && window.DaimonShare.setAvailable) {
      window.DaimonShare.setAvailable(!!state.letterText);
    }

    // Further reading: render only when sources are present.
    renderSources(data.sources);

    // Star: show + initialise from the letter's bookmarked flag (the generate
    // response omits it → defaults to false, which is correct for a brand-new
    // letter; opened letters carry the real flag from GET /api/letters/{id}).
    setupBookmark(data.id, data.bookmarked);

    els.loading.hidden = true;
    els.letter.hidden = false;

    // Auto-read a freshly generated letter when the user has TTS on (requires a
    // prior user gesture, which generating a letter always is).
    if (opts.autoRead && state.tts && ttsSupported() && state.letterText) {
      speakLetter();
    }

    if (!hasGsap || REDUCE) {
      els.letter.style.opacity = "1";
      paras.forEach(function (p) { p.style.opacity = "1"; });
      return;
    }

    const tl = gsap.timeline();
    tl.fromTo(
      els.letter,
      { opacity: 0, scale: 0.98, y: 16 },
      { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: "power3.out" }
    );
    gsap.set(paras, { opacity: 0, y: 8 });
    tl.to(
      paras,
      { opacity: 1, y: 0, duration: 0.4, ease: "power2.out", stagger: 0.03 },
      "-=0.25"
    );
  }

  function showLoading() {
    els.letter.hidden = true;
    els.loading.hidden = false;
  }

  // ---- Generate a new letter ----
  let generating = false;
  function generateLetter() {
    if (generating) return;
    generating = true;
    showView("reading");
    showLoading();
    resetReplyForm();

    // Optional topic: only sent when the visitor has typed one.
    const topic = els.topicInput ? els.topicInput.value.trim() : "";
    const payload = { philosopher: state.philosopher };
    if (topic) payload.topic = topic;

    api("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (data) {
        revealLetter(data, { autoRead: true });
      })
      .catch(function (err) {
        els.loading.hidden = true;
        els.letter.hidden = false;
        clearLetterExtras();
        els.author.textContent = "A letter could not be delivered";
        els.date.textContent = "";
        renderBody(
          "Something interrupted the post. Please try again in a moment.\n\n" +
          (err && err.message ? "(" + err.message + ")" : "")
        );
        els.letter.style.opacity = "1";
      })
      .then(function () {
        generating = false;
      });
  }

  // Hide TTS + sources + star for an error/placeholder letter (no id to act on).
  function clearLetterExtras() {
    stopSpeaking();
    state.letterText = "";
    state.currentLetterId = null;
    if (els.listenBtn) els.listenBtn.hidden = true;
    if (window.DaimonShare && window.DaimonShare.setAvailable) {
      window.DaimonShare.setAvailable(false);
    }
    setupBookmark(null, false);
    renderSources([]);
  }

  // ---- Open an existing letter (from the timeline) ----
  function openLetter(id) {
    showView("reading");
    showLoading();
    resetReplyForm();
    api("/api/letters/" + id)
      .then(function (data) {
        // Existing stored letters carry no sample flag and no sources via this
        // endpoint — reveal without auto-read and with no citations.
        data.sample = false;
        data.sources = [];
        revealLetter(data);
      })
      .catch(function () {
        els.loading.hidden = true;
        els.letter.hidden = false;
        clearLetterExtras();
        renderBody("That letter could not be found.");
        els.letter.style.opacity = "1";
      });
  }

  // ---- Reply composer ----
  function resetReplyForm() {
    els.replyText.value = "";
    els.replyText.classList.remove("is-invalid");
    setReplyMessage("", null);
    els.replySubmit.classList.remove("is-loading", "is-success");
    els.replySubmit.disabled = false;
  }

  function setReplyMessage(text, kind) {
    els.replyMessage.textContent = text;
    els.replyMessage.classList.remove("is-error", "is-success");
    if (kind === "error") els.replyMessage.classList.add("is-error");
    else if (kind === "success") els.replyMessage.classList.add("is-success");
  }

  function submitReply(e) {
    e.preventDefault();
    const value = els.replyText.value.trim();
    if (!value) {
      els.replyText.classList.add("is-invalid");
      setReplyMessage("Please write a few words before sending.", "error");
      els.replyText.focus();
      return;
    }
    els.replyText.classList.remove("is-invalid");
    setReplyMessage("", null);

    els.replySubmit.classList.add("is-loading");
    els.replySubmit.disabled = true;

    api("/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        philosopher: state.philosopher,
        in_reply_to: state.currentLetterId,
        body: value,
      }),
    })
      .then(function () {
        els.replySubmit.classList.remove("is-loading");
        els.replySubmit.classList.add("is-success");
        setReplyMessage("Your reply has been sent.", "success");
        els.replyText.value = "";
        setTimeout(function () {
          els.replySubmit.classList.remove("is-success");
          els.replySubmit.disabled = false;
        }, 1600);
      })
      .catch(function (err) {
        els.replySubmit.classList.remove("is-loading");
        els.replySubmit.disabled = false;
        setReplyMessage(
          (err && err.message) ? err.message : "Could not send your reply.",
          "error"
        );
      });
  }

  // ---- Timeline ----
  let timelineObserver = null;

  function buildTimeline() {
    els.timelineSub.textContent =
      "Your letters with " + displayNameFor(state.philosopher) + ", oldest first.";
    els.timelineList.innerHTML = "";

    return api("/api/letters?philosopher=" + encodeURIComponent(state.philosopher) + "&limit=100")
      .then(function (letters) {
        if (!letters.length) {
          els.timelineEmpty.hidden = false;
          return;
        }
        els.timelineEmpty.hidden = true;

        const frag = document.createDocumentFragment();
        letters.forEach(function (L) {
          frag.appendChild(makeTimelineItem(L));
        });
        els.timelineList.appendChild(frag);
        observeTimelineItems();
      })
      .catch(function () {
        els.timelineEmpty.hidden = false;
      });
  }

  function makeTimelineItem(L) {
    const isUser = L.role === "user";
    const li = document.createElement("li");
    li.className = "tl-item " + (isUser ? "tl-item--user" : "tl-item--phil");

    const node = document.createElement("span");
    node.className = "tl-item__node";
    node.setAttribute("aria-hidden", "true");

    const card = document.createElement("button");
    card.type = "button";
    card.className = "tl-card";
    card.setAttribute("aria-label",
      "Open " + (isUser ? "your reply" : displayNameFor(state.philosopher) + "'s letter") +
      " from " + formatDate(L.created_at));

    const meta = document.createElement("div");
    meta.className = "tl-card__meta";
    const role = document.createElement("span");
    role.className = "tl-card__role";
    role.textContent = isUser ? "You" : displayNameFor(state.philosopher);
    const date = document.createElement("span");
    date.className = "tl-card__date";
    date.textContent = formatDate(L.created_at);
    meta.appendChild(role);
    meta.appendChild(date);

    const excerpt = document.createElement("p");
    excerpt.className = "tl-card__excerpt";
    excerpt.textContent = String(L.body || "").replace(/\s+/g, " ").trim();

    card.appendChild(meta);
    card.appendChild(excerpt);
    card.addEventListener("click", function () { openLetter(L.id); });

    li.appendChild(node);
    li.appendChild(card);
    return li;
  }

  function observeTimelineItems() {
    const items = Array.prototype.slice.call(els.timelineList.querySelectorAll(".tl-item"));
    if (REDUCE || !("IntersectionObserver" in window)) {
      items.forEach(function (it) { it.classList.add("is-in"); });
      return;
    }
    if (timelineObserver) timelineObserver.disconnect();
    let revealed = 0;
    timelineObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          const el = entry.target;
          // 30–50ms stagger as items scroll into view.
          const delay = Math.min(revealed, 6) * 40;
          revealed++;
          setTimeout(function () { el.classList.add("is-in"); }, delay);
          timelineObserver.unobserve(el);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.1 });
    items.forEach(function (it) { timelineObserver.observe(it); });
  }

  // ---- Name personalisation (optional; server defaults to "Friend") ----
  function setNameStatus(text, kind) {
    if (!els.nameStatus) return;
    els.nameStatus.textContent = text || "";
    els.nameStatus.classList.remove("is-error");
    if (kind === "error") els.nameStatus.classList.add("is-error");
  }

  // Reflect the saved name in state + the subtle "for {name}" line by the brand,
  // and keep the hero field and the settings field in sync.
  function reflectName(name, opts) {
    opts = opts || {};
    state.name = name || "";
    if (els.brandFor) {
      if (state.name) {
        els.brandFor.textContent = state.name;
        els.brandFor.hidden = false;
      } else {
        els.brandFor.textContent = "";
        els.brandFor.hidden = true;
      }
    }
    if (opts.syncInputs !== false) {
      if (els.nameInput && els.nameInput.value !== state.name) els.nameInput.value = state.name;
      if (window.DaimonSettings && window.DaimonSettings.reflect) {
        window.DaimonSettings.reflect({ name: state.name });
      }
    }
  }

  // On load: fetch prefs (name + theme + tts + default philosopher) in one call.
  // Theme is applied as early as possible to avoid a flash; the default
  // philosopher is consumed by loadPhilosophers via state.
  let initialPrefsDefaultPhil = "";
  function loadPrefs() {
    return api("/api/prefs")
      .then(function (data) {
        data = data || {};
        applyTheme(typeof data.theme === "string" ? data.theme : "");
        state.tts = !!data.tts;
        initialPrefsDefaultPhil = (data && data.default_philosopher) ? String(data.default_philosopher) : "";

        const name = (data && data.name) ? String(data.name) : "";
        if (els.nameInput) els.nameInput.value = name;
        reflectName(name);
        if (name) setNameStatus("Welcome back, " + name + ".", null);

        // Hand the full prefs to the settings module for its form.
        if (window.DaimonSettings && window.DaimonSettings.onPrefs) {
          window.DaimonSettings.onPrefs(data);
        }

        // First-visit onboarding: only when no name is saved (returning users
        // who have set a name never see it). Gated further by a localStorage
        // flag inside the module, so it shows at most once.
        if (window.DaimonOnboarding && window.DaimonOnboarding.maybeShow) {
          window.DaimonOnboarding.maybeShow({ hasName: !!name });
        }
      })
      .catch(function () {
        /* Optional feature — a failed lookup must never block the page. */
      });
  }

  let savingName = false;
  function saveName(e) {
    if (e) e.preventDefault();
    if (savingName || !els.nameInput) return;
    const name = els.nameInput.value.trim().slice(0, 60);

    savingName = true;
    els.nameSave.classList.add("is-loading");
    els.nameSave.disabled = true;

    api("/api/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name }),
    })
      .then(function (data) {
        const saved = (data && typeof data.name === "string") ? data.name : name;
        if (els.nameInput) els.nameInput.value = saved;
        reflectName(saved);
        els.nameSave.classList.remove("is-loading");
        els.nameSave.classList.add("is-success");
        setNameStatus(
          saved
            ? "Your letters are addressed to " + saved + "."
            : "No name set — the philosophers will simply call you Friend.",
          null
        );
        setTimeout(function () {
          els.nameSave.classList.remove("is-success");
          els.nameSave.disabled = false;
          savingName = false;
        }, 1400);
      })
      .catch(function (err) {
        els.nameSave.classList.remove("is-loading");
        els.nameSave.disabled = false;
        savingName = false;
        setNameStatus(
          (err && err.message) ? err.message : "Could not save your name.",
          "error"
        );
      });
  }

  // ---- Philosopher select ----
  function loadPhilosophers() {
    return api("/api/philosophers").then(function (list) {
      state.philosophers = list;
      els.select.innerHTML = "";
      list.forEach(function (p) {
        const opt = document.createElement("option");
        opt.value = p.key;
        opt.textContent = p.display_name;
        els.select.appendChild(opt);
      });
      if (list.length) {
        const hasDefault = initialPrefsDefaultPhil &&
          list.some(function (p) { return p.key === initialPrefsDefaultPhil; });
        const hasSeneca = list.some(function (p) { return p.key === "seneca"; });
        state.philosopher = hasDefault
          ? initialPrefsDefaultPhil
          : (hasSeneca ? "seneca" : list[0].key);
        els.select.value = state.philosopher;
      }
      // Let the settings module fill its own select once names are known.
      if (window.DaimonSettings && window.DaimonSettings.onPhilosophers) {
        window.DaimonSettings.onPhilosophers(list, state.philosopher);
      }
    });
  }

  // Change the active philosopher from anywhere (e.g. settings) and keep the
  // nav select + timeline in sync.
  function setPhilosopher(key) {
    if (!key) return;
    state.philosopher = key;
    if (els.select && els.select.value !== key) els.select.value = key;
    if (currentView === "timeline") buildTimeline();
  }

  // Navigate to a named view, running its side-effects (build timeline, etc).
  function goTo(name) {
    showView(name);
    if (name === "timeline") buildTimeline();
    if (name === "salon" && window.DaimonSalon) window.DaimonSalon.onEnter();
    if (name === "saved" && window.DaimonBookmarks) window.DaimonBookmarks.onEnter();
    if (name === "philosophy" && window.DaimonPhilosophy) window.DaimonPhilosophy.onEnter();
    if (name === "stats" && window.DaimonStats) window.DaimonStats.onEnter();
    if (name === "about" && window.DaimonAbout) window.DaimonAbout.onEnter();
  }

  // ---- Wire events ----
  function bindEvents() {
    els.select.addEventListener("change", function () {
      setPhilosopher(els.select.value);
      if (window.DaimonSettings && window.DaimonSettings.reflect) {
        window.DaimonSettings.reflect({ default_philosopher: els.select.value });
      }
    });

    els.navNew.addEventListener("click", generateLetter);
    els.heroRead.addEventListener("click", generateLetter);

    // Quick theme toggle in the nav.
    if (els.themeToggle) els.themeToggle.addEventListener("click", toggleTheme);

    // Optional topic field (expandable): toggle open, submit on Enter.
    if (els.topicToggle && els.topicPanel) {
      els.topicToggle.addEventListener("click", function () {
        const open = els.topicPanel.hidden;
        els.topicPanel.hidden = !open;
        els.topicToggle.setAttribute("aria-expanded", open ? "true" : "false");
        if (open && els.topicInput) {
          try { els.topicInput.focus(); } catch (_) {}
        }
      });
    }
    if (els.topicInput) {
      els.topicInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          generateLetter();
        }
      });
    }

    // Read-aloud (Listen / Stop) on the reading view.
    if (els.listenBtn) els.listenBtn.addEventListener("click", toggleSpeaking);

    // Star / bookmark the current letter.
    if (els.bookmarkBtn) els.bookmarkBtn.addEventListener("click", toggleBookmark);

    // Search affordance in the nav → open the search overlay.
    if (els.searchBtn) {
      els.searchBtn.addEventListener("click", function () {
        if (window.DaimonSearch && window.DaimonSearch.open) window.DaimonSearch.open();
      });
    }

    els.heroBrowse.addEventListener("click", function () { goTo("timeline"); });
    if (els.heroSalon) els.heroSalon.addEventListener("click", function () { goTo("salon"); });
    els.timelineEmptyCta.addEventListener("click", generateLetter);

    // Name personalisation: submit on Save click or Enter (both fire form submit).
    if (els.nameForm) els.nameForm.addEventListener("submit", saveName);
    // Clear an error message once the visitor starts typing again.
    if (els.nameInput) {
      els.nameInput.addEventListener("input", function () {
        if (els.nameStatus && els.nameStatus.classList.contains("is-error")) {
          setNameStatus("", null);
        }
      });
    }

    els.replyForm.addEventListener("submit", submitReply);
    // Validate on blur (not on each keystroke).
    els.replyText.addEventListener("blur", function () {
      if (els.replyText.value.trim()) {
        els.replyText.classList.remove("is-invalid");
        if (els.replyMessage.classList.contains("is-error")) setReplyMessage("", null);
      }
    });

    // View tabs in the nav (Home / Letters / Salon).
    els.navTabs.forEach(function (tab) {
      tab.addEventListener("click", function () { goTo(tab.getAttribute("data-nav")); });
    });

    // Brand / nav-home links (the logo).
    document.querySelectorAll("a[data-nav='hero']").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        goTo("hero");
      });
    });
  }

  // ---- Shared API for sibling modules (salon.js, settings.js) ----
  // Keeps a single fetch wrapper / philosopher list / sigil map across modules.
  window.Daimon = {
    api: api,
    sigilHref: sigilHref,
    REDUCE: REDUCE,
    hasGsap: hasGsap,
    goTo: goTo,
    generateLetter: generateLetter,
    openLetter: openLetter,          // (id) — open a stored letter in the reading view
    displayNameFor: displayNameFor,
    philosophers: function () { return state.philosophers; },

    // Used by settings.js to apply changes live (without a reload).
    applyTheme: applyTheme,                // ("", "dark", "light")
    setName: function (name) { reflectName(name); },
    setTts: function (on) { state.tts = !!on; },
    setDefaultPhilosopher: setPhilosopher, // (key)
    currentName: function () { return state.name; },
  };

  // Stop any read-aloud if the tab is hidden (don't keep talking in background).
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopSpeaking();
  });
  window.addEventListener("pagehide", stopSpeaking);

  // ---- Service worker (PWA: installable + offline) ----
  // Registered after load so it never competes with first paint, and wrapped so
  // a failure (unsupported / blocked / file 404) can never break the app.
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      navigator.serviceWorker.register("/sw.js").catch(function () { /* non-fatal */ });
    } catch (_) { /* non-fatal */ }
  }
  if (document.readyState === "complete") {
    registerServiceWorker();
  } else {
    window.addEventListener("load", registerServiceWorker);
  }

  // ---- Boot ----
  function boot() {
    bindEvents();
    animateHero();
    // Load prefs first (theme + tts + name + default philosopher), THEN the
    // philosopher list — so the saved default selects correctly. A failed prefs
    // call resolves (never rejects), so this can't block the list.
    loadPrefs()
      .then(loadPhilosophers)
      .then(function () {
        if (window.DaimonSalon) window.DaimonSalon.onPhilosophers(state.philosophers);
      })
      .catch(function () {
        // Even if the list fails, leave a sensible default in the select.
        const opt = document.createElement("option");
        opt.value = "seneca";
        opt.textContent = "Lucius Annaeus Seneca";
        els.select.appendChild(opt);
        if (window.DaimonSalon) {
          window.DaimonSalon.onPhilosophers([{ key: "seneca", display_name: "Lucius Annaeus Seneca" }]);
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
