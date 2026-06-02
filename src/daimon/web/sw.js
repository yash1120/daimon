/* ==========================================================================
 * sw.js — Daimon service worker (installable + offline app shell).
 *
 * Strategy:
 *   - install : pre-cache the app shell into a versioned cache, then activate
 *               immediately (skipWaiting).
 *   - activate: delete any caches that aren't the current version; take control
 *               of open clients at once (clients.claim).
 *   - fetch   : GET only.
 *       • /api/*            → network-first, NEVER cached (letters / prefs must
 *                             be live; offline fails gracefully → the app's own
 *                             error handling shows a gentle message).
 *       • navigations       → cache-first on the app shell ("/") with a network
 *                             fallback (so the SPA opens offline).
 *       • same-origin static→ cache-first, then network (and cache the result).
 *       • everything else   → straight to the network (CDN libs, fonts, etc.).
 *
 * Bump CACHE when the shell changes so old caches are cleaned on activate.
 * ========================================================================== */
"use strict";

const CACHE = "daimon-v1";

// The app shell: the document + the CSS/JS modules + the PWA assets. Same paths
// the page requests (so cache hits line up). CDN libs (three/gsap) and Google
// Fonts are intentionally left to the network/HTTP cache — never pre-cached.
const SHELL = [
  "/",
  "/static/styles.css",
  "/static/three-bg.js",
  "/static/salon.js",
  "/static/philosophy.js",
  "/static/about.js",
  "/static/settings.js",
  "/static/search.js",
  "/static/bookmarks.js",
  "/static/stats.js",
  "/static/share.js",
  "/static/onboarding.js",
  "/static/app.js",
  "/static/icon.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // addAll is atomic; if any single asset 404s the whole install fails. Add
      // them individually so one missing/optional file can't break offline.
      return Promise.all(
        SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: "reload" })).catch(function () {
            /* skip an asset that isn't available — non-fatal */
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE) return caches.delete(key);
          return null;
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;

  // Only ever handle GET; let the browser do POST/PUT/etc. untouched.
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // API: network-first and NEVER cached. Letters / prefs must always be live;
  // when offline this rejects and the app shows its own graceful error.
  if (sameOrigin && url.pathname.indexOf("/api/") === 0) {
    event.respondWith(fetch(req));
    return;
  }

  // Navigations (opening the app): serve the cached shell first so it opens
  // offline, falling back to the network, then to the cached "/" as a last
  // resort. (mode === "navigate" covers address-bar loads + in-app reloads.)
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match("/").then(function (cached) {
        const network = fetch(req)
          .then(function (resp) {
            if (resp && resp.ok && resp.type === "basic") {
              const copy = resp.clone();
              caches.open(CACHE).then(function (cache) { cache.put("/", copy); });
            }
            return resp;
          })
          .catch(function () {
            return cached || caches.match("/");
          });
        return cached || network;
      })
    );
    return;
  }

  // Same-origin static assets (/static/*, /manifest.webmanifest, the icon):
  // cache-first, then network (and cache a copy for next time).
  if (sameOrigin) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (resp) {
          if (resp && resp.ok && resp.type === "basic") {
            const copy = resp.clone();
            caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
          }
          return resp;
        });
      })
    );
    return;
  }

  // Cross-origin (CDN scripts, Google Fonts): leave to the network / HTTP cache.
});
