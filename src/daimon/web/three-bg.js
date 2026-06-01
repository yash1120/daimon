/* ==========================================================================
 * three-bg.js — ambient, layered 3D backdrop for Daimon.
 *
 * Layers (back → front), all very low opacity so text always wins:
 *   1. A large, slowly rotating WIREFRAME DODECAHEDRON (Plato's solid for the
 *      cosmos) glowing faintly in gold, deep in the scene.
 *   2. A sparse STARFIELD / constellation with a few thin connecting lines,
 *      suggesting a celestial map / orrery. Very subtle.
 *   3. The original drifting INK-MOTE field — soft dust in library light,
 *      additive, cream / gold / faint-violet.
 * Eased mouse-parallax moves the layers at different rates (depth). A CSS
 * vignette (in styles.css) frames the whole.
 *
 * PERFORMANCE: DPR capped at 2; counts scale down on small viewports; the rAF
 * loop pauses on document.hidden (visibilitychange) and resumes on focus.
 *
 * REDUCED MOTION (critical): if prefers-reduced-motion is set we render ONE
 * static frame (dodecahedron + motes + stars positioned, no rotation/drift)
 * and never start the loop; mouse parallax is disabled. Forced motion is a
 * documented nausea risk, so this is honoured strictly.
 *
 * Public API (used by app.js for the Salon loading state):
 *   window.DaimonBG.pulse(on)  — gently brighten/expand the dodecahedron while
 *                                the salon is "thinking" (no-op under reduced
 *                                motion, where it just nudges opacity once).
 * ========================================================================== */
(function () {
  "use strict";

  const canvas = document.getElementById("bg-canvas");
  if (!canvas || typeof THREE === "undefined") return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = window.matchMedia("(max-width: 640px)").matches;

  // ---- Palette (mirrors the CSS design tokens) ----
  const GOLD = 0xc9a24b;
  const COLORS = [
    new THREE.Color(0xece7dc), // cream
    new THREE.Color(0xc9a24b), // gold
    new THREE.Color(0xe0be6e), // gold-bright
    new THREE.Color(0x6366f1), // faint violet
  ];

  // ---- Scene / camera / renderer ----
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    62,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );
  camera.position.z = 26;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: false,
      alpha: true,
      powerPreference: "low-power",
    });
  } catch (e) {
    // No WebGL — leave the CSS gradient background as-is.
    return;
  }
  renderer.setClearColor(0x000000, 0);

  const DPR_CAP = 2;
  function pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, DPR_CAP);
  }

  // ---- Counts scale with viewport (cap down on mobile) ----
  function moteCount() {
    const w = window.innerWidth;
    if (w < 640) return 520;
    if (w < 1024) return 900;
    return 1300;
  }
  function starCount() {
    return isMobile ? 70 : 150;
  }

  const SPREAD_X = 60;
  const SPREAD_Y = 40;
  const SPREAD_Z = 34;

  // ======================================================================
  // Layer 1 — wireframe dodecahedron (Plato's cosmos), deep in the scene
  // ======================================================================
  const cosmos = new THREE.Group();
  cosmos.position.set(0, 1.5, -22); // sit well behind the mote field
  scene.add(cosmos);

  // Base opacities (kept low so the solid never competes with text).
  const DODECA_BASE_OPACITY = 0.14;
  const DODECA_GLOW_OPACITY = 0.07;

  const dodecaGeo = new THREE.DodecahedronGeometry(13, 0);
  const dodecaWire = new THREE.LineSegments(
    new THREE.EdgesGeometry(dodecaGeo),
    new THREE.LineBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: DODECA_BASE_OPACITY,
      depthWrite: false,
    })
  );
  cosmos.add(dodecaWire);

  // A faint inner solid gives the wireframe a little volume/glow.
  const dodecaGlow = new THREE.Mesh(
    dodecaGeo,
    new THREE.MeshBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: DODECA_GLOW_OPACITY,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    })
  );
  cosmos.add(dodecaGlow);

  // Tilt for a more interesting silhouette.
  cosmos.rotation.set(0.5, 0.3, 0.08);

  // ======================================================================
  // Layer 2 — sparse starfield + a few constellation lines (celestial map)
  // ======================================================================
  const celestial = new THREE.Group();
  celestial.position.z = -14;
  scene.add(celestial);

  let starGeo, starMat, starPoints;
  let lineGeo, lineMat, lineSegments;

  function buildCelestial() {
    if (starPoints) {
      celestial.remove(starPoints);
      starGeo.dispose();
      starMat.dispose();
    }
    if (lineSegments) {
      celestial.remove(lineSegments);
      lineGeo.dispose();
      lineMat.dispose();
    }

    const n = starCount();
    const starPos = new Float32Array(n * 3);
    const SX = 90, SY = 60, SZ = 10;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * SX;
      const y = (Math.random() - 0.5) * SY;
      const z = (Math.random() - 0.5) * SZ;
      starPos[i * 3] = x;
      starPos[i * 3 + 1] = y;
      starPos[i * 3 + 2] = z;
      pts.push(new THREE.Vector3(x, y, z));
    }

    starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    starMat = new THREE.PointsMaterial({
      color: 0xece7dc,
      size: isMobile ? 0.5 : 0.55,
      sizeAttenuation: true,
      map: makeSprite(),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    starPoints = new THREE.Points(starGeo, starMat);
    celestial.add(starPoints);

    // Thin "orrery" lines linking a handful of nearby stars — sparse on purpose.
    const linePositions = [];
    const maxLinks = isMobile ? 10 : 22;
    const used = new Set();
    for (let k = 0; k < maxLinks; k++) {
      const a = Math.floor(Math.random() * pts.length);
      if (used.has(a)) continue;
      // nearest neighbour to `a`
      let best = -1, bestD = Infinity;
      for (let b = 0; b < pts.length; b++) {
        if (b === a) continue;
        const d = pts[a].distanceTo(pts[b]);
        if (d < bestD) { bestD = d; best = b; }
      }
      if (best >= 0 && bestD < 26) {
        used.add(a); used.add(best);
        linePositions.push(pts[a].x, pts[a].y, pts[a].z);
        linePositions.push(pts[best].x, pts[best].y, pts[best].z);
      }
    }
    lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePositions), 3));
    lineMat = new THREE.LineBasicMaterial({
      color: 0xc9a24b,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    lineSegments = new THREE.LineSegments(lineGeo, lineMat);
    celestial.add(lineSegments);
  }

  // ======================================================================
  // Layer 3 — drifting ink-mote field (the original)
  // ======================================================================
  let geometry, material, points;
  let velocities;

  function buildField() {
    if (points) {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
    }

    const count = moteCount();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * SPREAD_X;
      positions[i3 + 1] = (Math.random() - 0.5) * SPREAD_Y;
      positions[i3 + 2] = (Math.random() - 0.5) * SPREAD_Z;

      // Weighted colour pick: mostly cream/gold, a little violet.
      const r = Math.random();
      let c;
      if (r < 0.5) c = COLORS[0];
      else if (r < 0.78) c = COLORS[1];
      else if (r < 0.92) c = COLORS[2];
      else c = COLORS[3];
      colors[i3] = c.r;
      colors[i3 + 1] = c.g;
      colors[i3 + 2] = c.b;

      scales[i] = 0.6 + Math.random() * 1.8;

      // Extremely slow, low-velocity drift.
      velocities[i3] = (Math.random() - 0.5) * 0.012;
      velocities[i3 + 1] = 0.004 + Math.random() * 0.012; // gentle upward bias
      velocities[i3 + 2] = (Math.random() - 0.5) * 0.008;
    }

    geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));

    material = new THREE.PointsMaterial({
      size: 0.42,
      sizeAttenuation: true,
      map: makeSprite(),
      vertexColors: true,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    points = new THREE.Points(geometry, material);
    scene.add(points);
  }

  // Soft round sprite (radial gradient) so motes/stars look like diffused light.
  let _sprite = null;
  function makeSprite() {
    if (_sprite) return _sprite;
    const size = 64;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    _sprite = new THREE.CanvasTexture(c);
    _sprite.needsUpdate = true;
    return _sprite;
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ---- Mouse parallax (eased; disabled under reduced motion) ----
  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };

  function onPointerMove(e) {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    target.x = nx * 2.2;
    target.y = -ny * 1.6;
  }

  // ---- Salon "thinking" pulse (brighten + breathe the dodecahedron) ----
  let pulsing = false;
  const DaimonBG = {
    pulse: function (on) {
      pulsing = !!on;
      if (!pulsing) {
        // settle back to base on the next frames; if reduced-motion, snap now.
        if (reduceMotion) {
          dodecaWire.material.opacity = DODECA_BASE_OPACITY;
          dodecaGlow.material.opacity = DODECA_GLOW_OPACITY;
          cosmos.scale.setScalar(1);
          renderOnce();
        }
      } else if (reduceMotion) {
        // One static nudge so there's *some* feedback without animation.
        dodecaWire.material.opacity = 0.26;
        dodecaGlow.material.opacity = 0.16;
        renderOnce();
      }
    },
  };
  window.DaimonBG = DaimonBG;

  // ---- Animation loop ----
  let rafId = null;
  let running = false;
  const clock = new THREE.Clock();

  function step() {
    const count = velocities.length / 3;
    const pos = geometry.attributes.position.array;
    const dt = Math.min(clock.getDelta(), 0.05) * 60; // normalize to ~60fps
    const t = clock.elapsedTime;

    // --- motes drift + wrap ---
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      pos[i3] += velocities[i3] * dt;
      pos[i3 + 1] += velocities[i3 + 1] * dt;
      pos[i3 + 2] += velocities[i3 + 2] * dt;

      if (pos[i3 + 1] > SPREAD_Y / 2) pos[i3 + 1] = -SPREAD_Y / 2;
      if (pos[i3] > SPREAD_X / 2) pos[i3] = -SPREAD_X / 2;
      else if (pos[i3] < -SPREAD_X / 2) pos[i3] = SPREAD_X / 2;
      if (pos[i3 + 2] > SPREAD_Z / 2) pos[i3 + 2] = -SPREAD_Z / 2;
      else if (pos[i3 + 2] < -SPREAD_Z / 2) pos[i3 + 2] = SPREAD_Z / 2;
    }
    geometry.attributes.position.needsUpdate = true;

    // whole mote field rotates almost imperceptibly
    points.rotation.y += 0.0006 * dt;

    // --- dodecahedron: slow multi-axis rotation ---
    cosmos.rotation.y += 0.0011 * dt;
    cosmos.rotation.x += 0.0005 * dt;
    cosmos.rotation.z += 0.0002 * dt;

    // --- salon pulse: breathe brightness + scale toward targets ---
    const wireTarget = pulsing ? 0.34 : DODECA_BASE_OPACITY;
    const glowTarget = pulsing ? 0.18 : DODECA_GLOW_OPACITY;
    dodecaWire.material.opacity += (wireTarget - dodecaWire.material.opacity) * 0.06;
    dodecaGlow.material.opacity += (glowTarget - dodecaGlow.material.opacity) * 0.06;
    const breathe = pulsing ? 1 + Math.sin(t * 2.2) * 0.045 : 1;
    const sTarget = (pulsing ? 1.06 : 1) * breathe;
    const cs = cosmos.scale.x + (sTarget - cosmos.scale.x) * 0.08;
    cosmos.scale.setScalar(cs);

    // --- celestial layer drifts very slowly the other way ---
    celestial.rotation.z += 0.00012 * dt;

    // --- eased camera parallax across layers (different depths => different rates) ---
    current.x += (target.x - current.x) * 0.04;
    current.y += (target.y - current.y) * 0.04;
    camera.position.x = current.x;
    camera.position.y = current.y;
    // Counter-move the deepest layers slightly so parallax reads as depth.
    cosmos.position.x = current.x * -0.35;
    cosmos.position.y = 1.5 + current.y * -0.35;
    celestial.position.x = current.x * -0.18;
    celestial.position.y = current.y * -0.18;
    camera.lookAt(scene.position);

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(step);
  }

  function renderOnce() {
    renderer.render(scene, camera);
  }

  function start() {
    if (running || reduceMotion) return;
    running = true;
    clock.getDelta(); // reset delta so we don't jump after a pause
    rafId = requestAnimationFrame(step);
  }

  function stop() {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ---- Init ----
  buildField();
  buildCelestial();
  resize();

  let resizeTimer = null;
  window.addEventListener("resize", function () {
    resize();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      buildField();      // rebuild so density matches the new viewport bucket
      buildCelestial();
      if (!running) renderOnce();
    }, 250);
  });

  if (reduceMotion) {
    // Static frame: position everything once, render once, no loop, no parallax.
    renderOnce();
  } else {
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    // Pause when the tab is hidden; resume on focus.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else start();
    });

    start();
  }
})();
