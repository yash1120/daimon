/* ==========================================================================
 * share.js — share the current letter as a beautiful image card.
 *
 * The "Share" button on the reading view renders the letter on screen to an
 * offscreen <canvas>: a parchment card with a thin inner frame, the
 * philosopher's name (serif), the date in small caps, the letter body
 * word-wrapped with comfortable leading, and a small "Daimon" wordmark + a tiny
 * gold orbit mark in the corner. The card grows to fit the text; very long
 * letters are truncated gracefully with "… read the rest at Daimon".
 *
 * It then opens a small dialog offering:
 *   - Share  — via navigator.share with the PNG as a File (only when the
 *              platform reports it can share files), and
 *   - Download — an <a download="daimon-letter.png"> (always available).
 * When Web Share with files is unsupported, the dialog simply offers Download.
 *
 * The card reads the rendered DOM (#letter-author / #letter-date /
 * #letter-body), so it always matches what the visitor sees and needs no app
 * state. The palette is the on-brand parchment look in both themes.
 *
 * Depends (softly) on window.Daimon: REDUCE. Resilient if it loads late.
 * ========================================================================== */
(function () {
  "use strict";

  const shareBtn = document.getElementById("letter-share");
  const letterEl = document.getElementById("letter");
  const authorEl = document.getElementById("letter-author");
  const dateEl = document.getElementById("letter-date");
  const bodyEl = document.getElementById("letter-body");

  // Bail quietly if the reading view isn't present.
  if (!shareBtn || !bodyEl) return;

  function D() { return window.Daimon || {}; }
  function reduce() { return !!D().REDUCE; }

  // ---- Card palette + geometry (parchment, on-brand in either theme) ----
  const CARD = {
    W: 1080,
    PAD: 96,             // outer padding
    FRAME_INSET: 40,     // inner frame inset from the card edge
    BG: "#F5ECD9",       // --paper
    BG_EDGE: "#E7DBC0",  // --paper-edge
    INK: "#2A2118",      // --ink-text
    INK_SOFT: "#5A4F3F", // --ink-text-soft
    DATE: "#8a7a55",
    GOLD: "#C9A24B",
    FRAME: "rgba(140,120,80,.5)",
    BODY_SIZE: 34,
    BODY_LEADING: 1.78,
    AUTHOR_SIZE: 58,
    MAX_BODY_LINES: 42,  // cap before truncating very long letters
  };

  // Serif stacks: prefer the loaded web font; always have a web-safe fallback
  // because canvas can't depend on the @font-face being ready.
  let displayFont = "'Georgia', 'Times New Roman', serif";
  let proseFont = "'Georgia', 'Times New Roman', serif";

  // If the web fonts are available once document.fonts is ready, use them for a
  // closer match to the on-screen letter.
  function refreshFonts() {
    try {
      if (document.fonts && document.fonts.check) {
        if (document.fonts.check("600 58px 'Playfair Display'")) {
          displayFont = "'Playfair Display', Georgia, 'Times New Roman', serif";
        }
        if (document.fonts.check("400 34px 'Libre Baskerville'")) {
          proseFont = "'Libre Baskerville', Georgia, 'Times New Roman', serif";
        }
      }
    } catch (_) { /* keep fallbacks */ }
  }
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(refreshFonts).catch(function () {});
  }

  // ---- Word-wrap a paragraph to a max pixel width ----
  function wrapParagraph(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
        // A single word longer than the line: hard-break it by characters.
        while (ctx.measureText(line).width > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // ---- Read the current letter from the rendered DOM ----
  function readLetter() {
    const author = (authorEl && authorEl.textContent || "").trim();
    const date = (dateEl && dateEl.textContent || "").trim();
    // Each <p> in the body is a paragraph; <br> within becomes a space-join via
    // textContent. Empty paragraphs are dropped.
    const paras = Array.prototype.slice.call(bodyEl.querySelectorAll("p"))
      .map(function (p) { return (p.textContent || "").replace(/\s+/g, " ").trim(); })
      .filter(Boolean);
    return { author: author, date: date, paras: paras };
  }

  // ---- Build the canvas for a letter; returns the <canvas> ----
  function renderCard(letter) {
    refreshFonts();
    const W = CARD.W;
    const contentW = W - CARD.PAD * 2;

    // Measure pass on a scratch context to compute the wrapped body + height.
    const scratch = document.createElement("canvas").getContext("2d");

    // Body: wrap each paragraph; blank line between paragraphs.
    scratch.font = "400 " + CARD.BODY_SIZE + "px " + proseFont;
    let bodyLines = [];   // { text, gap } gap=true → paragraph spacer
    letter.paras.forEach(function (para, i) {
      if (i > 0) bodyLines.push({ gap: true });
      wrapParagraph(scratch, para, contentW).forEach(function (l) {
        bodyLines.push({ text: l });
      });
    });

    // Truncate very long letters gracefully.
    let truncated = false;
    if (bodyLines.length > CARD.MAX_BODY_LINES) {
      bodyLines = bodyLines.slice(0, CARD.MAX_BODY_LINES);
      // Trim a trailing gap, then mark truncation.
      while (bodyLines.length && bodyLines[bodyLines.length - 1].gap) bodyLines.pop();
      truncated = true;
    }

    const lineH = Math.round(CARD.BODY_SIZE * CARD.BODY_LEADING);
    const gapH = Math.round(lineH * 0.55);

    // Vertical rhythm of the header block.
    const yStart = CARD.PAD + 24;          // top of header
    let headH = 0;
    headH += CARD.AUTHOR_SIZE + 18;        // author line
    headH += 28;                            // meander rule
    headH += 30;                            // date line
    headH += 56;                            // space before body

    let bodyH = 0;
    bodyLines.forEach(function (ln) { bodyH += ln.gap ? gapH : lineH; });
    if (truncated) bodyH += lineH;          // the "… read the rest" line

    const footH = 96;                       // wordmark + mark
    const H = Math.round(yStart + headH + bodyH + footH + CARD.PAD);

    // Hi-DPI: draw at 2× for crisp text, keep CSS-independent (export size = 2×).
    const SCALE = 2;
    const canvas = document.createElement("canvas");
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    const ctx = canvas.getContext("2d");
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = "alphabetic";

    // Parchment background (subtle vertical wash, like the on-screen paper).
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, CARD.BG);
    grad.addColorStop(1, CARD.BG_EDGE);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // A soft highlight at the top edge.
    const hi = ctx.createLinearGradient(0, 0, 0, H * 0.25);
    hi.addColorStop(0, "rgba(255,252,244,.55)");
    hi.addColorStop(1, "rgba(255,252,244,0)");
    ctx.fillStyle = hi;
    ctx.fillRect(0, 0, W, H * 0.25);

    // Thin inner frame.
    ctx.strokeStyle = CARD.FRAME;
    ctx.lineWidth = 2;
    ctx.strokeRect(
      CARD.FRAME_INSET, CARD.FRAME_INSET,
      W - CARD.FRAME_INSET * 2, H - CARD.FRAME_INSET * 2
    );
    // A fainter second hairline for a "pressed" double-rule look.
    ctx.strokeStyle = "rgba(140,120,80,.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      CARD.FRAME_INSET + 8, CARD.FRAME_INSET + 8,
      W - (CARD.FRAME_INSET + 8) * 2, H - (CARD.FRAME_INSET + 8) * 2
    );

    const cx = W / 2;
    let y = yStart;

    // Author (centred serif).
    ctx.fillStyle = CARD.INK;
    ctx.textAlign = "center";
    ctx.font = "600 " + CARD.AUTHOR_SIZE + "px " + displayFont;
    y += CARD.AUTHOR_SIZE;
    ctx.fillText(letter.author || "A letter", cx, y, contentW);

    // Greek-key-ish gold rule (a simple gradient line with end dots — a calm
    // stand-in for the on-screen meander, which is heavy to redraw on canvas).
    y += 30;
    const ruleW = 260;
    const rg = ctx.createLinearGradient(cx - ruleW / 2, 0, cx + ruleW / 2, 0);
    rg.addColorStop(0, "rgba(201,162,75,0)");
    rg.addColorStop(0.5, CARD.GOLD);
    rg.addColorStop(1, "rgba(201,162,75,0)");
    ctx.strokeStyle = rg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - ruleW / 2, y);
    ctx.lineTo(cx + ruleW / 2, y);
    ctx.stroke();
    ctx.fillStyle = CARD.GOLD;
    ctx.beginPath();
    ctx.arc(cx, y, 3.2, 0, Math.PI * 2);
    ctx.fill();

    // Date in small caps (uppercased + letter-spacing approximation).
    y += 44;
    if (letter.date) {
      ctx.fillStyle = CARD.DATE;
      ctx.font = "500 22px " + "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
      drawSpacedText(ctx, letter.date.toUpperCase(), cx, y, 3, "center");
    }

    // Body (left-aligned within the content column).
    y += 56;
    ctx.textAlign = "left";
    ctx.fillStyle = CARD.INK;
    ctx.font = "400 " + CARD.BODY_SIZE + "px " + proseFont;
    const bodyX = CARD.PAD;
    bodyLines.forEach(function (ln) {
      if (ln.gap) { y += gapH; return; }
      y += lineH;
      ctx.fillText(ln.text, bodyX, y - lineH * 0.25);
    });
    if (truncated) {
      y += lineH;
      ctx.fillStyle = CARD.INK_SOFT;
      ctx.font = "italic 400 " + CARD.BODY_SIZE + "px " + proseFont;
      ctx.fillText("… read the rest at Daimon", bodyX, y - lineH * 0.25);
    }

    // Footer: a tiny gold orbit mark + the "Daimon" wordmark, bottom-left;
    // a small "daimon.app"-style hint bottom-right is omitted to stay reverent.
    drawWordmark(ctx, CARD.PAD, H - CARD.PAD + 8);

    return canvas;
  }

  // Draw text with manual letter-spacing (ctx.letterSpacing isn't universal).
  function drawSpacedText(ctx, text, x, y, spacing, align) {
    const chars = String(text).split("");
    let total = 0;
    chars.forEach(function (ch) { total += ctx.measureText(ch).width + spacing; });
    total -= spacing;
    let startX = x;
    if (align === "center") startX = x - total / 2;
    const prevAlign = ctx.textAlign;
    ctx.textAlign = "left";
    let cxp = startX;
    chars.forEach(function (ch) {
      ctx.fillText(ch, cxp, y);
      cxp += ctx.measureText(ch).width + spacing;
    });
    ctx.textAlign = prevAlign;
  }

  // The small Daimon wordmark + orbit glyph (echoes the nav brand).
  function drawWordmark(ctx, x, baselineY) {
    const r = 16;                 // orbit radius
    const gcx = x + r;
    const gcy = baselineY - r + 2;
    ctx.save();
    ctx.strokeStyle = CARD.GOLD;
    ctx.fillStyle = CARD.GOLD;
    ctx.lineWidth = 2.4;
    // orbit
    ctx.beginPath();
    ctx.arc(gcx, gcy, r, 0, Math.PI * 2);
    ctx.stroke();
    // core
    ctx.beginPath();
    ctx.arc(gcx, gcy, 3.4, 0, Math.PI * 2);
    ctx.fill();
    // satellite mote
    ctx.beginPath();
    ctx.arc(gcx + r * 0.95, gcy - r * 0.95, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = CARD.INK;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "600 34px " + displayFont;
    ctx.fillText("Daimon", x + r * 2 + 16, baselineY);
    ctx.restore();
  }

  // ---- canvas → Blob (Promise) ----
  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      try {
        if (canvas.toBlob) {
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error("Could not render image."));
          }, "image/png");
        } else {
          // Very old fallback: data URL → Blob.
          const data = canvas.toDataURL("image/png");
          const bin = atob(data.split(",")[1]);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: "image/png" }));
        }
      } catch (e) { reject(e); }
    });
  }

  // ==========================================================================
  // The share dialog (built once, reused). Reuses .modal-overlay / .modal so it
  // matches Settings / Search; focus-trapped, Esc/backdrop closes.
  // ==========================================================================
  let overlay, dialog, previewImg, shareActionBtn, downloadLink, statusEl, closeBtn;
  let built = false;
  let isOpen = false;
  let lastFocused = null;
  let currentBlob = null;
  let currentUrl = null;        // object URL for the preview + download

  function buildDialog() {
    if (built) return;
    built = true;

    overlay = document.createElement("div");
    overlay.className = "modal-overlay share-overlay";
    overlay.hidden = true;

    dialog = document.createElement("div");
    dialog.className = "modal share-modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "share-modal-title");
    dialog.tabIndex = -1;

    // Head
    const head = document.createElement("div");
    head.className = "modal__head";
    const title = document.createElement("h2");
    title.className = "modal__title";
    title.id = "share-modal-title";
    title.textContent = "Share this letter";
    closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "icon-btn modal__close";
    closeBtn.setAttribute("aria-label", "Close share");
    closeBtn.innerHTML =
      '<span class="icon-btn__icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
      '<path d="M6 6l12 12M18 6L6 18" /></svg></span>';
    head.appendChild(title);
    head.appendChild(closeBtn);

    // Body: preview + actions
    const wrap = document.createElement("div");
    wrap.className = "share-modal__body";

    const figure = document.createElement("div");
    figure.className = "share-preview";
    previewImg = document.createElement("img");
    previewImg.className = "share-preview__img";
    previewImg.alt = "Preview of the letter as a shareable image";
    figure.appendChild(previewImg);

    const actions = document.createElement("div");
    actions.className = "share-modal__actions";

    shareActionBtn = document.createElement("button");
    shareActionBtn.type = "button";
    shareActionBtn.className = "btn btn--gold";
    shareActionBtn.hidden = true;     // shown only when file-share is supported
    shareActionBtn.innerHTML =
      '<span class="btn__icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />' +
      '<path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4" /></svg></span>' +
      '<span class="btn__label">Share</span>';

    downloadLink = document.createElement("a");
    downloadLink.className = "btn btn--ghost";
    downloadLink.setAttribute("download", "daimon-letter.png");
    downloadLink.setAttribute("role", "button");
    downloadLink.innerHTML =
      '<span class="btn__icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 4v11M7.5 11l4.5 4 4.5-4" /><path d="M5 19h14" /></svg></span>' +
      '<span class="btn__label">Download</span>';

    actions.appendChild(shareActionBtn);
    actions.appendChild(downloadLink);

    statusEl = document.createElement("p");
    statusEl.className = "share-modal__status";
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");

    wrap.appendChild(figure);
    wrap.appendChild(actions);
    wrap.appendChild(statusEl);

    dialog.appendChild(head);
    dialog.appendChild(wrap);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Wire events
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) close();
    });
    shareActionBtn.addEventListener("click", doShare);
  }

  // ---- Focus trap (mirrors settings.js / search.js) ----
  function focusables() {
    const sel = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.prototype.slice.call(dialog.querySelectorAll(sel))
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
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    trap(e);
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.classList.remove("is-error");
    if (kind === "error") statusEl.classList.add("is-error");
  }

  // Can the platform share files? (Feature-detect with the actual file.)
  function canShareFiles(file) {
    try {
      return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    } catch (_) { return false; }
  }

  function open() {
    buildDialog();
    if (isOpen) return;
    isOpen = true;
    lastFocused = document.activeElement;

    overlay.hidden = false;
    requestAnimationFrame(function () { overlay.classList.add("is-open"); });
    document.body.classList.add("modal-open");
    document.addEventListener("keydown", onKeydown, true);

    setTimeout(function () { try { closeBtn.focus(); } catch (_) {} }, 30);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.remove("is-open");
    document.body.classList.remove("modal-open");
    document.removeEventListener("keydown", onKeydown, true);

    const finish = function () {
      overlay.hidden = true;
      try { (lastFocused || shareBtn).focus(); } catch (_) {}
    };
    if (reduce()) finish();
    else setTimeout(finish, 180);
  }

  // Revoke a previous object URL (avoid leaking blobs across opens).
  function revoke() {
    if (currentUrl) { try { URL.revokeObjectURL(currentUrl); } catch (_) {} currentUrl = null; }
  }

  function doShare() {
    if (!currentBlob) return;
    const file = new File([currentBlob], "daimon-letter.png", { type: "image/png" });
    if (!canShareFiles(file)) { setStatus("Sharing isn’t available — use Download instead."); return; }
    navigator.share({
      files: [file],
      title: "A letter from Daimon",
      text: "A letter from the philosophers, via Daimon.",
    }).then(function () {
      setStatus("Shared.");
    }).catch(function (err) {
      // AbortError = the user dismissed the sheet; that's fine, stay quiet.
      if (err && err.name === "AbortError") { setStatus(""); return; }
      setStatus("Could not share — you can still download the image.", "error");
    });
  }

  // ---- The button handler: render the card, then open the dialog ----
  let busy = false;
  function onShareClick() {
    if (busy) return;
    if (letterEl && letterEl.hidden) return;     // no letter on screen
    const letter = readLetter();
    if (!letter.paras.length) return;            // nothing to render

    busy = true;
    shareBtn.disabled = true;
    shareBtn.classList.add("is-loading");

    // Render + encode. Wrap in a microtask so the button state paints first.
    Promise.resolve().then(function () {
      const canvas = renderCard(letter);
      return canvasToBlob(canvas);
    }).then(function (blob) {
      revoke();
      currentBlob = blob;
      currentUrl = URL.createObjectURL(blob);

      buildDialog();
      previewImg.src = currentUrl;
      downloadLink.href = currentUrl;

      // Offer Share only when the platform can share this file.
      const file = new File([blob], "daimon-letter.png", { type: "image/png" });
      const fileShare = canShareFiles(file);
      shareActionBtn.hidden = !fileShare;
      setStatus(fileShare ? "" : "Tip: Download saves the image to your device.");

      open();
    }).catch(function () {
      setStatus("Could not create the image just now.", "error");
      // Still open so the user sees the message if the dialog was built.
      if (built) open();
    }).then(function () {
      busy = false;
      shareBtn.disabled = false;
      shareBtn.classList.remove("is-loading");
    });
  }

  shareBtn.addEventListener("click", onShareClick);

  // Public hooks: app.js shows/hides the button alongside the letter (it knows
  // whether a real letter with text is on screen).
  window.DaimonShare = {
    // Show or hide the Share affordance for the current letter.
    setAvailable: function (on) {
      shareBtn.hidden = !on;
    },
    open: onShareClick,
  };
})();
