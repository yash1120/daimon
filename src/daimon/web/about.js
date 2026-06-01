/* ==========================================================================
 * about.js — the "About" view.
 *
 * A gallery of the five philosophers; the visitor selects one and reads their
 * profile. Fetches GET /api/about → an ordered array of:
 *   { key, display_name, dates, school, essence, bio, ideas[], works[],
 *     quote|null, note? }
 * and renders two coordinated parts:
 *   - a GALLERY of selectable medallion cards (real <button>s; aria-pressed),
 *     each a gold-ringed coin bearing the philosopher's sigil + monogram, the
 *     name (Playfair), dates, and the one-line essence,
 *   - a DETAIL PANEL for the selected philosopher: a larger medallion, name +
 *     dates + school, the bio (Libre Baskerville), "Key ideas" and "Major
 *     works" lists, an optional pull-quote (<blockquote>), and — for Camus /
 *     Weil — a small italic copyright disclaimer.
 *
 * Portraits: each is a rendered MEDALLION (sigil + monogram on parchment) by
 * default. If a real image exists at /static/portraits/<key>.{jpg,png,webp}
 * it is preferred (object-fit: cover, same round frame); a failed load falls
 * back to the medallion with no broken-image icon.
 *
 * Depends on window.Daimon (exported by app.js): api, sigilHref, REDUCE,
 * hasGsap. Resilient if those load late.
 * ========================================================================== */
(function () {
  "use strict";

  const gsap = window.gsap;
  const SVGNS = "http://www.w3.org/2000/svg";
  const XLINK = "http://www.w3.org/1999/xlink";

  const els = {
    view: document.getElementById("view-about"),
    gallery: document.getElementById("about-gallery"),
    detail: document.getElementById("about-detail"),
    loading: document.getElementById("about-loading"),
    error: document.getElementById("about-error"),
  };

  // Distinct-but-harmonious accents per philosopher — the SAME palette the
  // salon uses, so the medallions read as one coherent set of coins.
  const ACCENTS = {
    seneca: "#C9A24B",      // gold
    aurelius: "#E0BE6E",    // gold-bright
    nietzsche: "#818CF8",   // violet-bright
    camus: "#6366F1",       // violet
    weil: "#ECE7DC",        // cream
  };
  const DEFAULT_ACCENT = "#C9A24B";

  // Candidate real-image extensions, tried in order before the medallion.
  const IMG_EXTS = ["jpg", "png", "webp"];

  let people = [];           // [{key, display_name, ...}]
  let selectedKey = null;
  let built = false;
  let fetching = false;

  function D() { return window.Daimon || {}; }
  function reduce() { return !!D().REDUCE; }
  function useGsap() { return !!(D().hasGsap && gsap && !reduce()); }
  function sigilHref(key) {
    return D().sigilHref ? D().sigilHref(key) : "#sigil-default";
  }
  function api(path) {
    if (D().api) return D().api(path);
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error("Request failed: " + r.status);
      return r.json();
    });
  }
  function accentFor(key) { return ACCENTS[key] || DEFAULT_ACCENT; }

  // Initials in Playfair for the monogram, e.g. "Lucius Annaeus Seneca" → "LS".
  function monogram(name) {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    const first = words[0].charAt(0);
    const last = words[words.length - 1].charAt(0);
    return (first + last).toUpperCase();
  }

  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  // ---- Medallion: gold-ringed parchment disc with sigil + monogram. ----
  // Returns a wrapper <span class="medallion"> whose accent is set by CSS var.
  // We attempt a real photo first; on error the <img> is removed and the
  // medallion (already in the DOM behind it) shows through.
  function buildMedallion(p, variant) {
    const accent = accentFor(p.key);
    const wrap = document.createElement("span");
    wrap.className = "medallion medallion--" + (variant || "card");
    wrap.style.setProperty("--accent", accent);
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", "Portrait of " + (p.display_name || p.key));

    // Inline SVG coin: outer gold ring, inner parchment field, sigil, monogram.
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "medallion__art");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.innerHTML =
      '<circle class="medallion__ring" cx="60" cy="60" r="57" />' +
      '<circle class="medallion__rim" cx="60" cy="60" r="51" />' +
      '<circle class="medallion__field" cx="60" cy="60" r="49" />';

    // Sigil (reused from the inline defs), seated in the upper field.
    const sig = document.createElementNS(SVGNS, "svg");
    sig.setAttribute("class", "medallion__sigil");
    sig.setAttribute("viewBox", "0 0 24 24");
    sig.setAttribute("x", "38");
    sig.setAttribute("y", "26");
    sig.setAttribute("width", "44");
    sig.setAttribute("height", "44");
    sig.setAttribute("fill", "none");
    sig.setAttribute("stroke", "currentColor");
    sig.setAttribute("stroke-width", "1.4");
    sig.setAttribute("stroke-linecap", "round");
    sig.setAttribute("stroke-linejoin", "round");
    const use = document.createElementNS(SVGNS, "use");
    use.setAttribute("href", sigilHref(p.key));
    use.setAttributeNS(XLINK, "xlink:href", sigilHref(p.key));
    sig.appendChild(use);
    svg.appendChild(sig);

    // Monogram (Playfair), seated below the sigil.
    const mono = document.createElementNS(SVGNS, "text");
    mono.setAttribute("class", "medallion__monogram");
    mono.setAttribute("x", "60");
    mono.setAttribute("y", "92");
    mono.setAttribute("text-anchor", "middle");
    mono.textContent = monogram(p.display_name);
    svg.appendChild(mono);

    wrap.appendChild(svg);

    // Try a real photograph; on success it covers the medallion, on error it
    // removes itself so the medallion shows (never a broken-image icon).
    attachRealPhoto(wrap, p);
    return wrap;
  }

  // Probe extensions in order; the first that loads is shown over the coin.
  function attachRealPhoto(wrap, p) {
    const img = document.createElement("img");
    img.className = "medallion__photo";
    img.alt = "Portrait of " + (p.display_name || p.key);
    img.decoding = "async";
    img.loading = "lazy";
    let i = 0;

    function tryNext() {
      if (i >= IMG_EXTS.length) {
        // No real photo found — drop the <img>; medallion remains.
        if (img.parentNode) img.parentNode.removeChild(img);
        return;
      }
      const ext = IMG_EXTS[i++];
      img.src = "/static/portraits/" + p.key + "." + ext;
    }

    img.addEventListener("error", tryNext);
    img.addEventListener("load", function () {
      // A real image loaded: reveal it (parchment art stays underneath).
      wrap.classList.add("has-photo");
    });

    wrap.appendChild(img);
    tryNext();
  }

  // ---- Gallery of selectable medallion cards ----
  function buildGallery() {
    els.gallery.innerHTML = "";
    const frag = document.createDocumentFragment();

    people.forEach(function (p) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "about-card";
      card.style.setProperty("--accent", accentFor(p.key));
      card.setAttribute("data-key", p.key);
      card.setAttribute("aria-pressed", "false");
      card.setAttribute("aria-label", (p.display_name || p.key) + " — " + (p.essence || ""));

      card.appendChild(buildMedallion(p, "card"));

      const name = document.createElement("span");
      name.className = "about-card__name";
      name.textContent = p.display_name || p.key;

      const dates = document.createElement("span");
      dates.className = "about-card__dates";
      dates.textContent = p.dates || "";

      const essence = document.createElement("span");
      essence.className = "about-card__essence";
      essence.textContent = p.essence || "";

      card.appendChild(name);
      card.appendChild(dates);
      card.appendChild(essence);

      card.addEventListener("click", function () { select(p.key); });
      frag.appendChild(card);
    });

    els.gallery.appendChild(frag);
  }

  // ---- Detail panel for the selected philosopher ----
  function renderDetail(p) {
    els.detail.innerHTML = "";
    els.detail.style.setProperty("--accent", accentFor(p.key));

    const head = document.createElement("div");
    head.className = "about-detail__head";

    head.appendChild(buildMedallion(p, "detail"));

    const headText = document.createElement("div");
    headText.className = "about-detail__headtext";

    const name = document.createElement("h3");
    name.className = "about-detail__name";
    name.textContent = p.display_name || p.key;
    headText.appendChild(name);

    const meta = document.createElement("p");
    meta.className = "about-detail__meta";
    const parts = [];
    if (p.dates) parts.push(p.dates);
    if (p.school) parts.push(p.school);
    meta.textContent = parts.join("  ·  ");
    headText.appendChild(meta);

    head.appendChild(headText);
    els.detail.appendChild(head);

    // Bio paragraph (prose).
    if (p.bio) {
      const bio = document.createElement("p");
      bio.className = "about-detail__bio";
      bio.textContent = p.bio;
      els.detail.appendChild(bio);
    }

    // Optional pull-quote — only for public-domain authors (quote non-null).
    if (p.quote) {
      const fig = document.createElement("figure");
      fig.className = "about-detail__quote";
      const bq = document.createElement("blockquote");
      bq.className = "about-quote";
      bq.textContent = "“" + String(p.quote).trim() + "”";
      const cite = document.createElement("figcaption");
      cite.className = "about-quote__cite";
      cite.textContent = "— " + (p.display_name || p.key);
      fig.appendChild(bq);
      fig.appendChild(cite);
      els.detail.appendChild(fig);
    }

    // Two lists side by side: Key ideas + Major works.
    const cols = document.createElement("div");
    cols.className = "about-detail__cols";
    cols.appendChild(makeList("Key ideas", p.ideas, "ideas"));
    cols.appendChild(makeList("Major works", p.works, "works"));
    els.detail.appendChild(cols);

    // Unobtrusive copyright disclaimer (present only for Camus & Weil).
    if (p.note) {
      const note = document.createElement("p");
      note.className = "about-detail__note";
      note.textContent = p.note;
      els.detail.appendChild(note);
    }

    // Entrance: opacity (+ small rise when motion allowed). Reduced motion or
    // no GSAP → fade only, no transform.
    if (useGsap()) {
      const bits = Array.prototype.slice.call(els.detail.children);
      gsap.fromTo(
        bits,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.42, ease: "power3.out", stagger: 0.05 }
      );
    } else {
      els.detail.style.opacity = "1";
    }
  }

  function makeList(heading, items, kind) {
    const sec = document.createElement("section");
    sec.className = "about-list about-list--" + kind;

    const h = document.createElement("h4");
    h.className = "about-list__heading";
    h.textContent = heading;
    sec.appendChild(h);

    const ul = document.createElement("ul");
    ul.className = "about-list__items";
    (items || []).forEach(function (text) {
      const li = document.createElement("li");
      li.className = "about-list__item";
      li.textContent = String(text);
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    return sec;
  }

  // ---- Selection ----
  function select(key) {
    const p = people.find(function (x) { return x.key === key; });
    if (!p) return;
    selectedKey = key;

    // Reflect selected state on the gallery cards (aria-pressed + class).
    Array.prototype.forEach.call(
      els.gallery.querySelectorAll(".about-card"),
      function (card) {
        const on = card.getAttribute("data-key") === key;
        card.classList.toggle("is-selected", on);
        card.setAttribute("aria-pressed", on ? "true" : "false");
      }
    );

    renderDetail(p);
    show(els.detail);
  }

  // ---- Fetch + build (once) ----
  function load() {
    if (built || fetching) return;
    fetching = true;
    show(els.loading);
    hide(els.error);
    hide(els.detail);

    api("/api/about")
      .then(function (data) {
        fetching = false;
        people = Array.isArray(data) ? data : [];
        hide(els.loading);
        if (!people.length) {
          show(els.error);
          return;
        }
        buildGallery();
        built = true;
        // Default to the first philosopher selected.
        select(people[0].key);
      })
      .catch(function () {
        fetching = false;
        hide(els.loading);
        show(els.error);
      });
  }

  // ---- Public hook used by app.js ----
  window.DaimonAbout = {
    onEnter: function () { load(); },
  };
})();
