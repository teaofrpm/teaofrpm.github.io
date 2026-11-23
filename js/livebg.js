/* livebg.js — v47 live chat backgrounds.
   One <canvas> per chat, each theme is a small layered "scene" (sky, parallax
   silhouettes, particles with physics, glow, little events) like a game menu
   background. Static layers are painted once per resize; only moving things are
   drawn per frame. Pauses in the background, drops quality on slow phones,
   draws a single still frame for reduced-motion users. Tap empty space = a reaction. */
(() => {
  "use strict";
  const TAU = Math.PI * 2;
  const R = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wave = (t, s = 0) => Math.sin(t + s) * 0.5 + Math.sin(t * 1.73 + s * 2.3) * 0.3 + Math.sin(t * 2.91 + s * 0.7) * 0.2;
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  const seeded = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  /* ---------------- sprites (cached, drawn once) ---------------- */
  const cache = new Map();
  const sprite = (key, w, h, draw) => { let c = cache.get(key); if (!c) { c = mk(w, h); draw(c.getContext("2d"), w, h); cache.set(key, c); } return c; };
  const glow = (c, core = 0, size = 64) => sprite(`gl${c}|${core}|${size}`, size, size, (g, s) => {
    const r = s / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, rgba(c, 1)); if (core) gr.addColorStop(core, rgba(c, 0.85));
    gr.addColorStop(Math.min(0.99, core + 0.35), rgba(c, 0.22)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  const bokeh = (c) => sprite(`bk${c}`, 96, 96, (g, s) => {
    const r = s / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, rgba(c, 0.5)); gr.addColorStop(0.7, rgba(c, 0.4)); gr.addColorStop(0.86, rgba(c, 0.62)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  const sparkle = (c) => sprite(`sp${c}`, 48, 48, (g, s) => {
    const r = s / 2, gr = g.createRadialGradient(r, r, 0, r, r, r * 0.42);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, rgba(c, 0.8)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = "lighter";
    const h = g.createLinearGradient(0, 0, s, 0); h.addColorStop(0, rgba(c, 0)); h.addColorStop(0.5, "rgba(255,255,255,.95)"); h.addColorStop(1, rgba(c, 0));
    g.fillStyle = h; g.fillRect(0, r - 0.8, s, 1.6);
    const v = g.createLinearGradient(0, 0, 0, s); v.addColorStop(0, rgba(c, 0)); v.addColorStop(0.5, "rgba(255,255,255,.95)"); v.addColorStop(1, rgba(c, 0));
    g.fillStyle = v; g.fillRect(r - 0.8, 0, 1.6, s);
  });

  function heartPath(g, x, y, s) {
    const k = s / 2;
    g.beginPath(); g.moveTo(x, y + k * 0.92);
    g.bezierCurveTo(x - k * 1.3, y + k * 0.05, x - k * 1.0, y - k * 1.12, x, y - k * 0.42);
    g.bezierCurveTo(x + k * 1.0, y - k * 1.12, x + k * 1.3, y + k * 0.05, x, y + k * 0.92);
    g.closePath();
  }
  const HEART_PAL = { red: ["#ff7a9c", "#e11d48", "#7f0d2e"], pink: ["#ffd0de", "#f472b6", "#b0135e"], rose: ["#ffe6d6", "#fb8f8f", "#b8324f"], white: ["#ffffff", "#ffe4ec", "#f0a0b8"] };
  // glossy 3D heart; `blur` makes a soft out-of-focus one for the far layer
  const heartSprite = (kind, blur = 0) => sprite(`ht${kind}${blur}`, 96, 96, (g, S) => {
    const cx = S / 2, cy = S / 2 + 2, s = S * 0.6;
    if (blur) {
      g.shadowColor = kind === "outline" ? "#f43f5e" : HEART_PAL[kind][1]; g.shadowBlur = blur; g.shadowOffsetX = 1000;
      heartPath(g, cx - 1000, cy, s * 0.92);
      if (kind === "outline") { g.lineWidth = 5; g.stroke(); } else { g.fillStyle = "#000"; g.fill(); }
      return;
    }
    if (kind === "outline") {
      heartPath(g, cx, cy, s); g.lineWidth = 4.5; g.strokeStyle = "#f43f5e"; g.shadowColor = "rgba(244,63,94,.5)"; g.shadowBlur = 6; g.stroke();
      return;
    }
    const p = HEART_PAL[kind];
    g.save(); g.shadowColor = "rgba(120,0,40,.28)"; g.shadowBlur = 8; g.shadowOffsetY = 3;
    heartPath(g, cx, cy, s);
    const gr = g.createRadialGradient(cx - s * 0.18, cy - s * 0.22, s * 0.04, cx, cy, s * 0.78);
    gr.addColorStop(0, p[0]); gr.addColorStop(0.55, p[1]); gr.addColorStop(1, p[2]);
    g.fillStyle = gr; g.fill(); g.restore();
    g.save(); heartPath(g, cx, cy, s); g.clip();
    const hl = g.createRadialGradient(cx - s * 0.2, cy - s * 0.28, 0, cx - s * 0.2, cy - s * 0.28, s * 0.34);
    hl.addColorStop(0, "rgba(255,255,255,.8)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = hl; g.fillRect(0, 0, S, S);
    g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,.22)"; heartPath(g, cx + 2, cy + 2, s * 0.96); g.stroke();
    g.restore();
    g.fillStyle = "rgba(255,255,255,.92)"; g.beginPath(); g.ellipse(cx - s * 0.27, cy - s * 0.19, s * 0.065, s * 0.04, -0.6, 0, TAU); g.fill();
  });

  /* ---------------- painting helpers ---------------- */
  function layer(S, draw) { const c = mk(S.w * S.dpr, S.h * S.dpr), g = c.getContext("2d"); g.scale(S.dpr, S.dpr); draw(g, S.w, S.h); return c; }
  function vgrad(g, w, stops, y0, y1) { const gr = g.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); g.fillStyle = gr; g.fillRect(0, y0, w, y1 - y0); }
  // midpoint-displacement skyline (mountains, hills, dunes); returns height(x)
  function ridge(g, w, bottom, base, amp, fill, rnd, o = {}) {
    const n = 64, p = new Float32Array(n + 1); p[0] = rnd(); p[n] = rnd();
    for (let step = n; step > 1; step >>= 1) { const half = step >> 1, sc = step / n; for (let i = half; i < n; i += step) p[i] = (p[i - half] + p[i + half]) / 2 + (rnd() - 0.5) * sc * (o.rough ?? 1.2); }
    let mn = Infinity, mx = -Infinity; for (const v of p) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const ys = Array.from(p, (v) => base - ((v - mn) / (mx - mn || 1)) * amp);
    const X = (i) => (i / n) * (w + 4) - 2;
    g.beginPath(); g.moveTo(-2, bottom + 2); for (let i = 0; i <= n; i++) g.lineTo(X(i), ys[i]); g.lineTo(w + 2, bottom + 2); g.closePath();
    g.fillStyle = fill; g.fill();
    if (o.rim) { g.beginPath(); for (let i = 0; i <= n; i++) i ? g.lineTo(X(i), ys[i]) : g.moveTo(X(i), ys[i]); g.strokeStyle = o.rim; g.lineWidth = o.rimW || 1; g.stroke(); }
    return (x) => { const f = clamp(((x + 2) / (w + 4)) * n, 0, n - 0.0001), i = f | 0; return ys[i] + (ys[i + 1] - ys[i]) * (f - i); };
  }
  function pine(g, x, y, hgt, col, snow) {
    const w = hgt * 0.46;
    g.fillStyle = col; g.fillRect(x - hgt * 0.03, y - hgt * 0.1, hgt * 0.06, hgt * 0.12);
    g.beginPath();
    for (let k = 0; k < 4; k++) { const by = y - hgt * (0.06 + k * 0.2), ww = (w * (1 - k * 0.22)) / 2; g.moveTo(x, by - hgt * 0.34); g.lineTo(x - ww, by); g.lineTo(x + ww, by); g.closePath(); }
    g.fill();
    if (snow) {
      g.fillStyle = snow; g.beginPath();
      for (let k = 0; k < 4; k++) { const by = y - hgt * (0.06 + k * 0.2), ww = (w * (1 - k * 0.22)) / 2, ty = by - hgt * 0.34; g.moveTo(x, ty); g.lineTo(x - ww * 0.42, ty + hgt * 0.14); g.lineTo(x - ww * 0.1, ty + hgt * 0.11); g.lineTo(x + ww * 0.3, ty + hgt * 0.13); g.closePath(); g.moveTo(x - ww, by); g.lineTo(x - ww * 0.55, by - hgt * 0.035); g.lineTo(x - ww * 0.2, by); g.closePath(); }
      g.fill();
    }
  }
  function moon(g, x, y, r, halo, crescent, shadow) {
    g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.42; g.drawImage(glow(halo, 0, 128), x - r * 7, y - r * 7, r * 14, r * 14); g.restore();
    g.save(); g.beginPath(); g.arc(x, y, r, 0, TAU); g.clip();
    const mg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r); mg.addColorStop(0, "#fffef6"); mg.addColorStop(1, "#cfd3e6");
    g.fillStyle = mg; g.fillRect(x - r, y - r, r * 2, r * 2);
    const rnd = seeded(3);
    for (let i = 0; i < 8; i++) { g.fillStyle = `rgba(120,125,160,${0.1 + rnd() * 0.14})`; g.beginPath(); g.arc(x + (rnd() - 0.5) * r * 1.4, y + (rnd() - 0.5) * r * 1.4, r * (0.06 + rnd() * 0.16), 0, TAU); g.fill(); }
    if (crescent) { g.fillStyle = shadow; g.beginPath(); g.arc(x + r * 0.48, y - r * 0.16, r * 0.96, 0, TAU); g.fill(); }
    g.restore();
  }
  function tiledPattern(g, S, size, draw) {
    const t = mk(size * S.dpr, size * S.dpr), tg = t.getContext("2d"); tg.scale(S.dpr, S.dpr); draw(tg, size);
    const pat = g.createPattern(t, "repeat");
    try { pat.setTransform(new DOMMatrix().scale(1 / S.dpr)); } catch { /* old browsers: pattern is just a bit bigger */ }
    return pat;
  }

  /* ---------------- shared effects (sparks, rings, custom bits) ---------------- */
  function burst(S, x, y, n, cols, v0, v1, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = R(0, TAU), v = R(v0, v1), life = R(0.55, 1.1) * (o.life || 1);
      S.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + (o.up || 0), g: o.g ?? 40, drag: o.drag ?? 2.2, life, max: life, size: R(1.2, 2.6) * (o.size || 1), c: pick(cols), rot: R(0, TAU), vr: R(-6, 6), kind: o.kind, col: o.col ? pick(o.col) : null });
    }
    if (S.fx.length > 500) S.fx.splice(0, S.fx.length - 500);
  }
  const ring = (S, x, y, c, r1 = 60, flat = 1) => S.fx.push({ ring: true, x, y, c, life: 0.65, max: 0.65, r0: 3, r1, flat });
  function fxRun(S, dt, custom) {
    const g = S.ctx, a = S.fx;
    for (let i = a.length - 1; i >= 0; i--) {
      const p = a[i]; p.life -= dt;
      if (p.life <= 0) { a[i] = a[a.length - 1]; a.pop(); continue; }
      const k = p.life / p.max;
      if (p.ring) {
        const r = p.r0 + (1 - k * k) * p.r1;
        g.globalAlpha = k * 0.75; g.strokeStyle = rgba(p.c, 1); g.lineWidth = 0.8 + k * 2.2;
        g.beginPath(); g.ellipse(p.x, p.y, r, r * p.flat, 0, 0, TAU); g.stroke(); continue;
      }
      const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy = p.vy * d + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.kind && custom) { custom(p, k); continue; }
      g.globalAlpha = Math.min(1, k * 1.6); const s = p.size * (0.5 + 0.5 * k) * 6;
      g.drawImage(glow(p.c, 0.18, 32), p.x - s / 2, p.y - s / 2, s, s);
    }
    g.globalAlpha = 1;
  }
  const heartXY = (u) => { const s = Math.sin(u); return [16 * s * s * s, -(13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u))]; };

  /* =================================================================
     SCENES — resize(S) paints static layers, init(S) makes particles,
     frame(S, dt) draws one frame, tap(S,x,y) / poke(S) are reactions
     ================================================================= */
  const SCENES = {};

  /* ---------- Starry night ---------- */
  const STAR_COLS = [[255, 255, 255], [200, 215, 255], [255, 236, 210], [176, 198, 255], [255, 214, 232]];
  SCENES.stars = {
    resize(S) {
      const rnd = seeded(21);
      S.sky = layer(S, (g, w, h) => {
        vgrad(g, w, [[0, "#02040d"], [0.5, "#0a1131"], [0.86, "#1b285a"], [1, "#25336b"]], 0, h);
        g.globalCompositeOperation = "lighter";
        for (const [x, y, c, a] of [[0.18, 0.28, [124, 58, 237], 0.32], [0.82, 0.48, [14, 165, 233], 0.26], [0.55, 0.12, [236, 72, 153], 0.16], [0.32, 0.72, [99, 102, 241], 0.22]]) {
          const r = Math.max(w, h) * (0.35 + rnd() * 0.2), gr = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, r);
          gr.addColorStop(0, rgba(c, a * 0.6)); gr.addColorStop(0.5, rgba(c, a * 0.16)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(0, 0, w, h);
        }
        // milky way: soft band + dust + dark lanes
        g.save(); g.translate(w / 2, h * 0.42); g.rotate(-0.55);
        const bw = Math.max(w, h) * 1.5, bh = h * 0.2;
        const lg = g.createLinearGradient(0, -bh, 0, bh); lg.addColorStop(0, "rgba(180,190,255,0)"); lg.addColorStop(0.5, "rgba(205,210,255,.11)"); lg.addColorStop(1, "rgba(180,190,255,0)");
        g.fillStyle = lg; g.fillRect(-bw / 2, -bh, bw, bh * 2);
        for (let i = 0; i < 1100; i++) { const s = 0.3 + rnd() * 0.9; g.fillStyle = `rgba(255,255,255,${0.05 + rnd() * 0.4})`; g.fillRect((rnd() - 0.5) * bw, (rnd() + rnd() + rnd() - 1.5) * bh * 0.7, s, s); }
        g.globalCompositeOperation = "source-over";
        for (let i = 0; i < 16; i++) { const x = (rnd() - 0.5) * bw, y = (rnd() - 0.5) * bh * 0.5, r = 18 + rnd() * 50, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(3,5,16,.38)"); gr.addColorStop(1, "rgba(3,5,16,0)"); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
        g.restore();
        g.globalCompositeOperation = "lighter";
        for (let i = 0; i < (w * h) / 800; i++) { const s = 0.4 + rnd() * 0.8; g.fillStyle = `rgba(255,255,255,${0.07 + rnd() * 0.35})`; g.fillRect(rnd() * w, rnd() * h * 0.9, s, s); }
        g.globalCompositeOperation = "source-over";
        moon(g, w * 0.8, h * 0.12, Math.min(w, h) * 0.052, [150, 170, 255], true, "rgba(6,10,34,.93)");
        // horizon glow + two hill layers with a few tiny house lights
        vgrad(g, w, [[0, "rgba(99,102,241,0)"], [1, "rgba(129,140,248,.28)"]], h * 0.72, h * 0.92);
        ridge(g, w, h, h * 0.92, h * 0.07, "#0a0f29", rnd, { rough: 1, rim: "rgba(150,170,255,.18)" });
        const near = ridge(g, w, h, h * 0.97, h * 0.05, "#04060f", rnd, { rough: 0.8 });
        for (let i = 0; i < 9; i++) { const x = rnd() * w, y = near(x) + 3 + rnd() * 6; g.fillStyle = "rgba(255,200,120,.9)"; g.fillRect(x, y, 1.6, 1.6); g.globalAlpha = 0.5; g.drawImage(glow([255, 180, 90], 0, 32), x - 6, y - 6, 13, 13); g.globalAlpha = 1; }
      });
    },
    init(S) {
      S.stars = Array.from({ length: Math.round(120 * S.q) }, () => ({ x: Math.random(), y: R(0, 0.86), r: Math.random() ** 3 * 1.9 + 0.5, ph: R(0, TAU), sp: R(0.6, 2.4), c: pick(STAR_COLS), z: R(0.2, 1) }));
      S.cons = Array.from({ length: 3 }, () => { const cx = R(0.12, 0.88), cy = R(0.08, 0.6); return Array.from({ length: 5 }, () => [cx + R(-0.13, 0.13), cy + R(-0.07, 0.07)]).sort((a, b) => a[0] - b[0]); });
      S.shoot = []; S.nextShoot = R(1.2, 3);
    },
    frame(S, dt) {
      const { ctx: g, w, h, t } = S;
      g.drawImage(S.sky, 0, 0, w, h);
      g.globalCompositeOperation = "lighter";
      g.lineWidth = 0.7;
      for (const c of S.cons) {
        g.strokeStyle = `rgba(170,190,255,${0.07 + 0.05 * Math.sin(t * 0.6 + c[0][0] * 9)})`;
        g.beginPath(); c.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h))); g.stroke();
        for (const [x, y] of c) g.drawImage(glow([210, 222, 255], 0.15, 32), x * w - 6, y * h - 6, 12, 12);
      }
      for (const s of S.stars) {
        s.x += s.z * dt * 0.0015; if (s.x > 1.02) s.x -= 1.04;
        const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph), a = 0.22 + 0.78 * tw * tw, x = s.x * w, y = s.y * h, r = s.r * (0.8 + 0.35 * tw);
        g.globalAlpha = a; g.drawImage(glow(s.c, 0.12, 32), x - r * 4, y - r * 4, r * 8, r * 8);
        if (s.r > 1.75) { g.globalAlpha = a * 0.65; g.drawImage(sparkle(s.c), x - r * 7, y - r * 7, r * 14, r * 14); }
      }
      g.globalAlpha = 1;
      if ((S.nextShoot -= dt) <= 0) { S.nextShoot = R(3, 8); const dir = Math.random() < 0.5 ? 1 : -1; S.shoot.push({ x: R(0.15, 0.85) * w, y: R(0.02, 0.3) * h, vx: dir * R(520, 760), vy: R(200, 320), life: 1, len: R(90, 170) }); }
      for (let i = S.shoot.length - 1; i >= 0; i--) {
        const s = S.shoot[i]; s.life -= dt * 1.15; if (s.life <= 0) { S.shoot.splice(i, 1); continue; }
        s.x += s.vx * dt; s.y += s.vy * dt;
        const sp = Math.hypot(s.vx, s.vy), ux = s.vx / sp, uy = s.vy / sp, a = Math.sin(s.life * Math.PI), tx = s.x - ux * s.len, ty = s.y - uy * s.len;
        const lg = g.createLinearGradient(s.x, s.y, tx, ty); lg.addColorStop(0, `rgba(255,255,255,${a})`); lg.addColorStop(0.3, `rgba(190,205,255,${a * 0.45})`); lg.addColorStop(1, "rgba(150,170,255,0)");
        g.strokeStyle = lg; g.lineWidth = 2; g.lineCap = "round"; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(tx, ty); g.stroke();
        g.globalAlpha = a; g.drawImage(glow([225, 232, 255], 0.2, 32), s.x - 9, s.y - 9, 18, 18); g.globalAlpha = 1;
        if (Math.random() < 0.6) S.fx.push({ x: s.x, y: s.y, vx: R(-15, 15), vy: R(-15, 15), g: 10, drag: 1.5, life: 0.7, max: 0.7, size: R(0.6, 1.2), c: [200, 215, 255], rot: 0, vr: 0 });
      }
      fxRun(S, dt);
      g.globalCompositeOperation = "source-over";
    },
    tap(S, x, y) { burst(S, x, y, 20, STAR_COLS, 50, 170, { g: 15 }); ring(S, x, y, [190, 205, 255]); },
    poke(S) { S.nextShoot = 0; },
  };

  /* ---------- Northern lights over a mountain lake ---------- */
  const CURT = [[[52, 211, 153], [167, 139, 250]], [[45, 212, 191], [96, 165, 250]], [[134, 239, 172], [244, 114, 182]]];
  const curtain = (i) => sprite(`curt${i}`, 4, 128, (g, w, h) => {
    const [lo, hi] = CURT[i], gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, rgba(hi, 0)); gr.addColorStop(0.45, rgba(hi, 0.22)); gr.addColorStop(0.8, rgba(lo, 0.75)); gr.addColorStop(0.93, "rgba(225,255,240,.95)"); gr.addColorStop(1, rgba(lo, 0));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  SCENES.northern = {
    resize(S) {
      const { w, h } = S, rnd = seeded(7); S.lake = Math.round(h * 0.8);
      S.sky = layer(S, (g) => {
        vgrad(g, w, [[0, "#01030a"], [0.5, "#031424"], [0.97, "#073241"], [1, "#04161f"]], 0, S.lake);
        vgrad(g, w, [[0, "#03141c"], [1, "#010609"]], S.lake, h);
        for (let i = 0; i < (w * h) / 700; i++) { const s = 0.4 + rnd() * 0.9; g.fillStyle = `rgba(220,240,255,${0.06 + rnd() * 0.4})`; g.fillRect(rnd() * w, rnd() * S.lake * 0.85, s, s); }
      });
      S.mtn = layer(S, (g) => {
        ridge(g, w, S.lake, S.lake - h * 0.035, h * 0.22, "#0b2134", rnd, { rough: 1.7, rim: "rgba(195,228,255,.26)", rimW: 1.3 });
        vgrad(g, w, [[0, "rgba(40,140,130,0)"], [1, "rgba(50,150,140,.2)"]], S.lake - h * 0.13, S.lake);
        ridge(g, w, S.lake, S.lake + 1, h * 0.09, "#040c15", rnd, { rough: 1.1 });
        for (let x = rnd() * 10; x < w; x += 5 + rnd() * 12) { if (rnd() < 0.35) continue; pine(g, x, S.lake + 2, 9 + rnd() * 18, "#02070d"); }
        g.fillStyle = "rgba(120,230,205,.28)"; g.fillRect(0, S.lake, w, 1);
      });
      S.refl = layer(S, (g) => {
        g.save(); g.translate(0, S.lake * 2); g.scale(1, -1); g.drawImage(S.mtn, 0, 0, w, h); g.restore();
        g.globalCompositeOperation = "destination-in"; vgrad(g, w, [[0, "rgba(0,0,0,.85)"], [1, "rgba(0,0,0,.1)"]], S.lake, h);
        g.fillRect(0, 0, 0, 0);
      });
      S.rip = Array.from({ length: 26 }, () => ({ x: R(0, w), len: R(20, 90), y: R(0, 1), sp: R(0.01, 0.04), light: Math.random() < 0.4 }));
    },
    init(S) {
      S.stars = Array.from({ length: Math.round(60 * S.q) }, () => ({ x: Math.random(), y: R(0, 0.5), r: R(0.4, 1.4), ph: R(0, TAU), sp: R(0.5, 2) }));
      S.flash = 0;
      S.curt = [
        { c: 0, y: 0.52, amp: 0.08, f1: 0.9, f2: 2.3, s1: 0.32, s2: 0.5, hgt: 0.42 },
        { c: 1, y: 0.62, amp: 0.05, f1: 1.4, f2: 3.1, s1: -0.26, s2: 0.38, hgt: 0.3 },
        { c: 2, y: 0.4, amp: 0.07, f1: 0.6, f2: 1.7, s1: 0.2, s2: -0.44, hgt: 0.34 },
      ];
    },
    frame(S, dt) {
      const { ctx: g, w, h, t } = S;
      g.drawImage(S.sky, 0, 0, w, h);
      g.globalCompositeOperation = "lighter";
      for (const s of S.stars) { g.globalAlpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph)); g.drawImage(glow([220, 240, 255], 0.15, 32), s.x * w - s.r * 3, s.y * h - s.r * 3, s.r * 6, s.r * 6); }
      const A = S.aur || (S.aur = mk(1, 1)), aw = Math.ceil(w / 3), ah = Math.ceil(S.lake / 3);
      if (A.width !== aw || A.height !== ah) { A.width = aw; A.height = ah; }
      const a = A.getContext("2d"); a.globalCompositeOperation = "source-over"; a.globalAlpha = 1; a.clearRect(0, 0, aw, ah); a.globalCompositeOperation = "lighter";
      S.flash = Math.max(0, S.flash - dt * 0.6);
      const boost = 1 + S.flash * 1.3;
      for (const c of S.curt) {
        const spr = curtain(c.c);
        for (let x = 0; x < aw; x++) {
          const u = (x / aw) * 6;
          const b = (c.y + c.amp * Math.sin(u * c.f1 + t * c.s1 + c.c * 2) + c.amp * 0.5 * Math.sin(u * c.f2 - t * c.s2)) * ah;
          const hh = c.hgt * ah * (0.7 + 0.3 * Math.sin(u * 1.3 + t * 0.4 + c.c));
          const fold = 0.5 + 0.5 * Math.sin(u * 2.1 + t * 0.5 + c.c * 3), rays = 0.62 + 0.38 * Math.sin(x * 0.9 + t * 1.6 + c.c);
          a.globalAlpha = clamp((0.12 + 0.88 * fold * fold) * rays * 0.5 * boost, 0, 1);
          a.drawImage(spr, x, b - hh, 1.6, hh);
        }
      }
      g.globalAlpha = 1; g.drawImage(A, 0, 0, aw, ah, 0, 0, aw * 3, ah * 3);
      g.globalCompositeOperation = "source-over"; g.drawImage(S.mtn, 0, 0, w, h);
      // the lake mirrors the sky (squashed), then the mountains, then ripples break it up
      g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.3;
      g.setTransform(3 * S.dpr, 0, 0, -1.5 * S.dpr, 0, (S.lake + 1.5 * ah) * S.dpr); g.drawImage(A, 0, 0); S.reset();
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 0.9; g.drawImage(S.refl, 0, 0, w, h); g.globalAlpha = 1;
      const lh = h - S.lake;
      for (const r of S.rip) { r.y = (r.y + r.sp * dt) % 1; const y = S.lake + 2 + r.y * lh, x = (r.x + Math.sin(t * 0.3 + r.len) * 10) % w; g.fillStyle = r.light ? `rgba(150,240,215,${0.07 * (1 - r.y)})` : "rgba(0,6,12,.35)"; g.fillRect(x, y, r.len * (0.4 + r.y), 1); }
      g.globalCompositeOperation = "lighter"; fxRun(S, dt); g.globalCompositeOperation = "source-over";
    },
    tap(S, x, y) { S.flash = 1; burst(S, x, y, 14, [[110, 240, 190], [170, 150, 255]], 30, 110, { g: -10 }); },
    poke(S) { S.flash = Math.max(S.flash, 0.6); },
  };

  /* ---------- Underwater (bubbles) ---------- */
  const raySpr = () => sprite("ray", 64, 256, (g, w, h) => {
    const lg = g.createLinearGradient(0, 0, w, 0); lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(0.5, "rgba(220,250,255,.5)"); lg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "destination-in"; const vg = g.createLinearGradient(0, 0, 0, h); vg.addColorStop(0, "#000"); vg.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = vg; g.fillRect(0, 0, w, h);
  });
  const bubSpr = () => sprite("bub", 64, 64, (g, s) => {
    const r = s / 2, gr = g.createRadialGradient(r, r, r * 0.2, r, r, r);
    gr.addColorStop(0, "rgba(200,240,255,.04)"); gr.addColorStop(0.75, "rgba(200,240,255,.1)"); gr.addColorStop(0.92, "rgba(225,250,255,.6)"); gr.addColorStop(1, "rgba(225,250,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    const hl = g.createRadialGradient(r * 0.68, r * 0.62, 0, r * 0.68, r * 0.62, r * 0.32); hl.addColorStop(0, "rgba(255,255,255,.95)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = hl; g.fillRect(0, 0, s, s);
    g.fillStyle = "rgba(255,255,255,.38)"; g.beginPath(); g.ellipse(r * 1.34, r * 1.38, r * 0.16, r * 0.07, -0.7, 0, TAU); g.fill();
  });
  function coral(g, x, y, size, col, rnd) {
    const br = (x, y, a, len, wd, d) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      g.strokeStyle = col; g.lineWidth = wd; g.lineCap = "round"; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.3) * len * 0.5, y + Math.sin(a + 0.3) * len * 0.5, x2, y2); g.stroke();
      if (d > 0) { br(x2, y2, a - 0.35 - rnd() * 0.35, len * 0.74, wd * 0.72, d - 1); br(x2, y2, a + 0.35 + rnd() * 0.35, len * 0.74, wd * 0.72, d - 1); }
      else { g.fillStyle = col; g.beginPath(); g.arc(x2, y2, wd * 0.9, 0, TAU); g.fill(); }
    };
    br(x, y, -Math.PI / 2 + (rnd() - 0.5) * 0.3, size * 0.4, size * 0.13, 3);
  }
  SCENES.bubbles = {
    resize(S) {
      const { w, h } = S, rnd = seeded(11);
      S.bg = layer(S, (g) => {
        vgrad(g, w, [[0, "#2db6e8"], [0.12, "#108ac7"], [0.45, "#075c94"], [0.8, "#043c66"], [1, "#022540"]], 0, h);
        ridge(g, w, h, h * 0.9, h * 0.13, "rgba(3,42,72,.6)", rnd, { rough: 1.3 });
        const sg = g.createLinearGradient(0, h * 0.88, 0, h); sg.addColorStop(0, "#2a7685"); sg.addColorStop(1, "#0d3a4c");
        S.floor = ridge(g, w, h, h * 0.94, h * 0.05, sg, rnd, { rough: 0.7, rim: "rgba(160,230,230,.25)" });
        for (let i = 0; i < 46; i++) { const x = rnd() * w, y = S.floor(x) + 3 + rnd() * (h - S.floor(x)); g.fillStyle = rnd() < 0.5 ? `rgba(8,40,55,${0.3 + rnd() * 0.3})` : `rgba(110,180,180,${0.2 + rnd() * 0.25})`; g.beginPath(); g.ellipse(x, y, 1 + rnd() * 3.5, 0.8 + rnd() * 2, 0, 0, TAU); g.fill(); }
        const cols = ["rgba(240,110,150,.6)", "rgba(255,165,95,.55)", "rgba(175,125,235,.55)", "rgba(255,120,120,.5)"];
        for (let i = 0; i < 5; i++) { const x = rnd() * w; coral(g, x, S.floor(x) + 4, 22 + rnd() * 30, cols[i % 4], rnd); }
        // a big rock with a lit top edge
        const rx = w * (0.15 + rnd() * 0.7), ry = S.floor(rx) + 6;
        g.fillStyle = "#0b3145"; g.beginPath(); g.ellipse(rx, ry, 46, 22, 0, Math.PI, TAU); g.fill();
        g.strokeStyle = "rgba(150,220,230,.2)"; g.lineWidth = 2; g.beginPath(); g.ellipse(rx, ry, 46, 22, 0, Math.PI * 1.15, Math.PI * 1.75); g.stroke();
      });
    },
    init(S) {
      S.vents = [R(0.1, 0.35), R(0.6, 0.9)];
      S.bub = Array.from({ length: Math.round(34 * S.q) }, () => this.bubble(S, true));
      S.snow = Array.from({ length: Math.round(70 * S.q) }, () => ({ x: Math.random(), y: Math.random(), r: R(0.5, 1.6), sp: R(0.004, 0.02), ph: R(0, TAU) }));
      S.rays = Array.from({ length: 6 }, (_, i) => ({ x: (i + R(0.1, 0.9)) / 6, w: R(0.07, 0.17), ph: R(0, TAU), sp: R(0.15, 0.35) }));
      S.kelp = Array.from({ length: 7 }, (_, i) => ({ x: (i + R(0.1, 0.9)) / 7, len: R(0.18, 0.42), ph: R(0, TAU), z: Math.random() }));
      S.fish = [this.fish(1, true), this.fish(1, true), this.fish(0, true)];
    },
    bubble(S, any) {
      const vent = !any && Math.random() < 0.55, r = Math.random() ** 2 * 14 + 2.5, x = vent ? pick(S.vents) * S.w + R(-6, 6) : R(0, S.w);
      return { bx: x, y: any ? R(0, S.h) : S.h + r + R(0, 40), r, ph: R(0, TAU), wob: R(1.2, 2.6), amp: R(4, 14) };
    },
    fish(school, any) {
      const dir = Math.random() < 0.5 ? 1 : -1, n = school ? 5 + ((Math.random() * 5) | 0) : 1;
      return { school, dir, x: any ? Math.random() : dir > 0 ? -0.25 : 1.25, y: school ? R(0.18, 0.55) : R(0.35, 0.72), sp: school ? R(0.025, 0.04) : R(0.03, 0.05), s: school ? R(4, 6.5) : R(9, 12), ph: R(0, TAU), n, off: Array.from({ length: n }, () => [R(-42, 42), R(-18, 18)]) };
    },
    frame(S, dt) {
      const { ctx: g, w, h, t } = S;
      g.drawImage(S.bg, 0, 0, w, h);
      g.globalCompositeOperation = "lighter"; g.lineWidth = 1.4;
      for (let k = 0; k < 7; k++) {
        const y0 = h * (0.012 + k * 0.034); g.strokeStyle = `rgba(200,245,255,${0.1 - k * 0.012})`; g.beginPath();
        for (let x = 0; x <= w + 12; x += 12) { const y = y0 + Math.sin(x * 0.035 + t * 1.3 + k * 1.7) * 4 + Math.sin(x * 0.09 - t * 0.9 + k) * 2; x ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
      const rs = raySpr();
      for (const r of S.rays) { g.save(); g.globalAlpha = 0.16 + 0.15 * Math.sin(t * r.sp * 2 + r.ph); g.translate(r.x * w, -8); g.rotate(0.18 + 0.05 * Math.sin(t * r.sp + r.ph)); g.drawImage(rs, (-r.w * w) / 2, 0, r.w * w, h * 0.95); g.restore(); }
      g.fillStyle = "rgba(210,240,255,.35)";
      for (const p of S.snow) { p.y += p.sp * dt; if (p.y > 1) p.y -= 1; g.fillRect((p.x + 0.012 * Math.sin(t * 0.5 + p.ph)) * w, p.y * h, p.r, p.r); }
      g.globalCompositeOperation = "source-over";
      for (const f of S.fish) this.drawFish(S, f, dt);
      for (const k of S.kelp) this.drawKelp(S, k);
      const bs = bubSpr();
      for (let i = S.bub.length - 1; i >= 0; i--) {
        const b = S.bub[i]; b.y -= (24 + b.r * 4.5) * dt;
        const x = b.bx + Math.sin(t * b.wob + b.ph) * b.amp, sq = 1 + 0.07 * Math.sin(t * 7 + b.ph), d = b.r * 2.2;
        g.drawImage(bs, x - (d * sq) / 2, b.y - d / sq / 2, d * sq, d / sq);
        if (b.y < -b.r * 2) { if (b.r > 7) ring(S, x, h * 0.02, [210, 245, 255], 18, 0.35); if (b.tmp) S.bub.splice(i, 1); else Object.assign(b, this.bubble(S)); }
      }
      g.globalCompositeOperation = "lighter"; fxRun(S, dt); g.globalCompositeOperation = "source-over";
    },
    drawKelp(S, k) {
      const { ctx: g, h, t } = S, x0 = k.x * S.w, segs = 14, L = (k.len * h) / segs;
      let x = x0, y = S.floor(x0) + 4;
      const col = k.z < 0.5 ? "rgba(10,72,62,.75)" : "rgba(24,112,82,.92)";
      g.strokeStyle = col; g.fillStyle = col; g.lineCap = "round";
      for (let i = 0; i < segs; i++) {
        const a = -Math.PI / 2 + Math.sin(t * 0.9 + k.ph + i * 0.45) * 0.045 * i + Math.sin(t * 0.4 + k.ph) * 0.12;
        const nx = x + Math.cos(a) * L, ny = y + Math.sin(a) * L;
        g.lineWidth = 7 * (1 - i / segs) + 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        if (i % 2 === 1 && i < segs - 1) { const side = i % 4 === 1 ? 1 : -1; g.beginPath(); g.ellipse(nx + side * 6, ny, 7 * (1 - i / segs) + 3, 2.6, a + side * 0.9, 0, TAU); g.fill(); }
        x = nx; y = ny;
      }
    },
    drawFish(S, f, dt) {
      const { ctx: g, w, h, t } = S;
      f.x += f.dir * f.sp * dt;
      if (f.x < -0.3 || f.x > 1.3) Object.assign(f, this.fish(f.school, false));
      for (let i = 0; i < f.n; i++) {
        const x = f.x * w + f.off[i][0], y = f.y * h + f.off[i][1] + Math.sin(t * 1.5 + i + f.ph) * 3, s = f.s, wag = Math.sin(t * 9 + i * 1.3 + f.ph) * 0.35;
        g.save(); g.translate(x, y); g.scale(f.dir, 1);
        if (f.school) g.fillStyle = "rgba(4,34,58,.45)";
        else { const gr = g.createLinearGradient(0, -s * 0.5, 0, s * 0.5); gr.addColorStop(0, "#ffb661"); gr.addColorStop(1, "#ee5f1c"); g.fillStyle = gr; }
        g.beginPath(); g.ellipse(0, 0, s, s * 0.48, 0, 0, TAU); g.fill();
        g.beginPath(); g.moveTo(-s * 0.85, 0); g.lineTo(-s * 1.55, -s * 0.5 + wag * s * 0.3); g.lineTo(-s * 1.55, s * 0.5 + wag * s * 0.3); g.closePath(); g.fill();
        if (!f.school) {
          g.beginPath(); g.moveTo(-s * 0.2, -s * 0.42); g.quadraticCurveTo(s * 0.1, -s * 0.85, s * 0.35, -s * 0.4); g.fill();
          g.save(); g.beginPath(); g.ellipse(0, 0, s, s * 0.48, 0, 0, TAU); g.clip();
          g.fillStyle = "rgba(255,255,255,.95)"; g.fillRect(-s * 0.18, -s, s * 0.22, s * 2); g.fillRect(s * 0.42, -s, s * 0.14, s * 2);
          g.strokeStyle = "rgba(20,10,5,.6)"; g.lineWidth = 0.8; g.strokeRect(-s * 0.18, -s, s * 0.22, s * 2); g.restore();
          g.fillStyle = "#101010"; g.beginPath(); g.arc(s * 0.64, -s * 0.1, s * 0.09, 0, TAU); g.fill();
          g.fillStyle = "#fff"; g.beginPath(); g.arc(s * 0.66, -s * 0.13, s * 0.03, 0, TAU); g.fill();
        }
        g.restore();
      }
    },
    tap(S, x, y) { for (let i = 0; i < 12; i++) S.bub.push({ tmp: 1, bx: x + R(-12, 12), y: y + R(-8, 8), r: R(2, 7), ph: R(0, TAU), wob: R(2, 4), amp: R(2, 6) }); ring(S, x, y, [200, 245, 255], 40); if (S.bub.length > 90) S.bub.splice(0, S.bub.length - 90); },
    poke(S) { for (let i = 0; i < 9; i++) S.bub.push({ tmp: 1, bx: S.w / 2 + R(-30, 30), y: S.h + R(0, 60), r: R(2, 8), ph: R(0, TAU), wob: R(1.5, 3), amp: R(3, 8) }); },
  };

  /* ---------- Sakura (blossom branch, tumbling petals, gusts) ---------- */
  const petalSpr = (v) => sprite(`pt${v}`, 48, 48, (g, s) => {
    g.translate(s / 2, s / 2);
    g.beginPath(); g.moveTo(0, 18); g.bezierCurveTo(-16, 8, -14, -12, -4, -18); g.lineTo(0, -13); g.lineTo(4, -18); g.bezierCurveTo(14, -12, 16, 8, 0, 18); g.closePath();
    const c = v ? ["#fff7fb", "#fbcfe8", "#f9a8d4"] : ["#ffffff", "#fde2ee", "#f4a3c4"], gr = g.createRadialGradient(0, 14, 1, 0, 0, 22);
    gr.addColorStop(0, c[0]); gr.addColorStop(0.55, c[1]); gr.addColorStop(1, c[2]); g.fillStyle = gr; g.fill();
    g.strokeStyle = "rgba(236,72,153,.2)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 16); g.quadraticCurveTo(1.5, 0, 0, -12); g.stroke();
  });
  function blossom(g, x, y, r, rot) {
    g.save(); g.translate(x, y); g.rotate(rot);
    for (let i = 0; i < 5; i++) {
      g.rotate(TAU / 5); g.beginPath(); g.ellipse(0, -r * 0.55, r * 0.42, r * 0.58, 0, 0, TAU);
      const gr = g.createLinearGradient(0, 0, 0, -r * 1.1); gr.addColorStop(0, "#f472b6"); gr.addColorStop(0.35, "#fbcfe8"); gr.addColorStop(1, "#fff6fa"); g.fillStyle = gr; g.fill();
    }
    g.fillStyle = "#db2777"; g.beginPath(); g.arc(0, 0, r * 0.2, 0, TAU); g.fill();
    g.fillStyle = "#fde68a"; for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6; g.beginPath(); g.arc(Math.cos(a) * r * 0.34, Math.sin(a) * r * 0.34, r * 0.065, 0, TAU); g.fill(); }
    g.restore();
  }
  SCENES.sakura = {
    resize(S) {
      const { w, h } = S, rnd = seeded(5), dark = S.dark;
      S.bg = layer(S, (g) => {
        vgrad(g, w, dark ? [[0, "#1c0814"], [0.6, "#341024"], [1, "#4a1832"]] : [[0, "#fff8fb"], [0.6, "#ffe7f0"], [1, "#fbd1e1"]], 0, h);
        if (dark) moon(g, w * 0.78, h * 0.14, Math.min(w, h) * 0.05, [255, 180, 210], false);
        else { g.globalAlpha = 0.7; g.drawImage(glow([255, 205, 215], 0, 128), w * 0.75 - 150, h * 0.15 - 150, 300, 300); g.globalAlpha = 1; g.fillStyle = "rgba(255,246,240,.9)"; g.beginPath(); g.arc(w * 0.75, h * 0.15, Math.min(w, h) * 0.07, 0, TAU); g.fill(); }
        // distant snow-capped mountain in the haze
        const fx = w * 0.62, fy = h * 0.82, fw = w * 0.95, fh = h * 0.22;
        g.beginPath(); g.moveTo(fx - fw / 2, fy); g.quadraticCurveTo(fx - fw * 0.17, fy - fh * 0.55, fx - fw * 0.07, fy - fh); g.lineTo(fx + fw * 0.07, fy - fh); g.quadraticCurveTo(fx + fw * 0.17, fy - fh * 0.55, fx + fw / 2, fy); g.closePath();
        g.fillStyle = dark ? "rgba(110,50,95,.55)" : "rgba(205,160,198,.42)"; g.fill();
        g.save(); g.clip(); g.fillStyle = dark ? "rgba(240,215,235,.4)" : "rgba(255,255,255,.85)"; g.beginPath(); g.moveTo(fx - fw * 0.2, fy - fh * 0.62);
        for (let i = 0; i <= 8; i++) g.lineTo(fx - fw * 0.2 + (i / 8) * fw * 0.4, fy - fh * (i % 2 ? 0.7 : 0.6)); g.lineTo(fx + fw * 0.2, fy - fh * 1.1); g.lineTo(fx - fw * 0.2, fy - fh * 1.1); g.closePath(); g.fill(); g.restore();
        vgrad(g, w, [[0, dark ? "rgba(52,16,36,0)" : "rgba(255,231,240,0)"], [1, dark ? "rgba(52,16,36,.7)" : "rgba(255,231,240,.85)"]], h * 0.66, h * 0.86);
        ridge(g, w, h, h * 0.9, h * 0.06, dark ? "#3a1428" : "#f6c2d6", rnd, { rough: 0.8 });
        S.groundY = ridge(g, w, h, h * 0.97, h * 0.04, dark ? "#2a0e1d" : "#f0afc8", rnd, { rough: 0.6 });
      });
      S.bw = w; S.bh = Math.min(h * 0.55, w * 0.9);
      S.branch = (() => {
        const c = mk(S.bw * S.dpr, S.bh * S.dpr), g = c.getContext("2d"), r2 = seeded(9), blooms = [];
        g.scale(S.dpr, S.dpr); g.lineCap = "round"; g.strokeStyle = dark ? "#1f0b10" : "#4d2c2b";
        const br = (x, y, a, len, wd, d) => {
          let cx = x, cy = y;
          for (let i = 0; i < 4; i++) { const na = a + (r2() - 0.5) * 0.35, nx = cx + (Math.cos(na) * len) / 4, ny = cy + (Math.sin(na) * len) / 4; g.lineWidth = wd * (1 - i * 0.08); g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny); g.stroke(); cx = nx; cy = ny; if (d <= 2 && r2() < 0.6) blooms.push([cx, cy]); }
          if (d > 0) { const n = d > 2 ? 2 : 3; for (let k = 0; k < n; k++) br(cx, cy, a + (r2() - 0.5) * 1.1 + (k - (n - 1) / 2) * 0.55, len * (0.55 + r2() * 0.17), wd * 0.62, d - 1); }
          else blooms.push([cx, cy]);
        };
        br(-8, 14, 0.32, Math.min(S.bw * 0.42, 210), 10, 4);
        for (const [x, y] of blooms) { if (x < 8 || y < 8 || x > S.bw - 12 || y > S.bh - 12) continue; const k = 1 + ((r2() * 3) | 0); for (let i = 0; i < k; i++) blossom(g, x + (r2() - 0.5) * 12, y + (r2() - 0.5) * 12, 4.5 + r2() * 4.5, r2() * TAU); if (r2() < 0.5) { g.fillStyle = "#ec4899"; g.beginPath(); g.arc(x + (r2() - 0.5) * 16, y + (r2() - 0.5) * 16, 2.2, 0, TAU); g.fill(); } }
        return c;
      })();
    },
    init(S) {
      S.bok = Array.from({ length: 12 }, () => ({ x: R(0, S.w), y: R(0, S.h), r: R(18, 60), sp: R(4, 12), ph: R(0, TAU), a: R(0.25, 0.5), c: pick(S.dark ? [[255, 120, 170], [255, 170, 200], [200, 90, 150]] : [[255, 255, 255], [255, 190, 214], [255, 220, 235]]) }));
      S.pet = Array.from({ length: Math.round(42 * S.q) }, () => this.petal(S, {}, true));
      S.ground = []; S.gust = 0; S.nextGust = R(4, 8);
    },
    petal(S, p, any) {
      const fromBranch = !any && Math.random() < 0.45, z = Math.random();
      return Object.assign(p, { tmp: 0, boost: 0, x: any ? R(0, S.w) : fromBranch ? R(10, Math.min(S.bw * 0.6, 260)) : R(-S.w * 0.4, S.w * 0.8), y: any ? R(0, S.h) : fromBranch ? R(10, S.bh * 0.6) : R(-40, -10), z, s: R(0.6, 1.15) * (0.55 + z * 0.6), rot: R(0, TAU), vr: R(-2, 2), flip: R(0, TAU), vf: R(1.5, 4), fs: R(0.8, 1.8), ph: R(0, TAU), v: Math.random() < 0.5 ? 1 : 0, vx: 10 });
    },
    frame(S, dt) {
      const { ctx: g, w, h, t } = S;
      g.drawImage(S.bg, 0, 0, w, h);
      g.globalCompositeOperation = S.dark ? "lighter" : "source-over";
      for (const b of S.bok) { b.y -= b.sp * dt; if (b.y < -b.r) { b.y = h + b.r; b.x = R(0, w); } g.globalAlpha = b.a * (0.7 + 0.3 * Math.sin(t * 0.6 + b.ph)) * (S.dark ? 0.5 : 1); g.drawImage(bokeh(b.c), b.x - b.r, b.y - b.r, b.r * 2, b.r * 2); }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      S.gust = Math.max(0, S.gust - dt * 0.42); if ((S.nextGust -= dt) <= 0) { S.nextGust = R(7, 13); S.gust = 1; }
      const G = Math.sin(S.gust * Math.PI), W = 16 + 20 * wave(t * 0.22, 1) + 110 * G, ps = [petalSpr(0), petalSpr(1)];
      for (let i = S.ground.length - 1; i >= 0; i--) {
        const p = S.ground[i]; p.life -= dt; if (p.life <= 0) { S.ground.splice(i, 1); continue; }
        g.globalAlpha = Math.min(1, p.life / 3) * 0.9; const c = Math.cos(p.rot) * p.s, s = Math.sin(p.rot) * p.s;
        S.tf(c, s, -s * 0.35, c * 0.35, p.x, p.y); g.drawImage(ps[p.v], -12, -12, 24, 24);
      }
      for (let i = S.pet.length - 1; i >= 0; i--) {
        const p = S.pet[i];
        p.vx += (W * (0.4 + p.z) - p.vx) * Math.min(1, dt * 1.5); p.boost *= Math.max(0, 1 - dt * 2);
        p.x += (p.vx + Math.sin(t * p.fs + p.ph) * 18 * p.z) * dt; p.y += (22 + p.z * 34 + Math.sin(t * p.fs * 0.7 + p.ph) * 8 + p.boost) * dt;
        p.rot += p.vr * dt * (1 + G); p.flip += p.vf * dt * (1 + G);
        const gy = S.groundY(clamp(p.x, 0, w));
        if (p.y > gy && p.z > 0.5 && p.x > 0 && p.x < w && Math.random() < 0.3 && S.ground.length < 45) { S.ground.push({ x: p.x, y: gy + R(-2, 8), rot: p.rot, s: p.s, v: p.v, life: R(14, 26) }); if (p.tmp) { S.pet.splice(i, 1); continue; } this.petal(S, p); continue; }
        if (p.y > h + 20 || p.x > w + 40) { if (p.tmp) { S.pet.splice(i, 1); continue; } this.petal(S, p); continue; }
        const cf = Math.cos(p.flip), sy = Math.abs(cf) * 0.82 + 0.18, c = Math.cos(p.rot) * p.s, s = Math.sin(p.rot) * p.s;
        g.globalAlpha = 0.55 + 0.45 * p.z; S.tf(c, s, -s * sy, c * sy, p.x, p.y); g.drawImage(ps[p.v], -15, -15, 30, 30);
      }
      S.reset(); g.globalAlpha = 1;
      g.save(); g.rotate(Math.sin(t * 0.6) * 0.012 + G * 0.025); g.drawImage(S.branch, 0, 0, S.bw, S.bh); g.restore();
      g.globalCompositeOperation = S.dark ? "lighter" : "source-over"; fxRun(S, dt); g.globalCompositeOperation = "source-over";
    },
    tap(S, x, y) {
      for (let i = 0; i < 10; i++) { const p = this.petal(S, {}, true); Object.assign(p, { tmp: 1, x, y, vx: R(-140, 140), boost: R(-160, -40), z: R(0.6, 1), s: R(0.7, 1.1) }); S.pet.push(p); }
      ring(S, x, y, S.dark ? [255, 150, 200] : [236, 72, 153], 40);
    },
    poke(S) { S.gust = 1; },
  };

  /* ---------- Love (hearts with depth, heartbeat glow, cupid's trail) ---------- */
  SCENES.hearts = {
    resize(S) {
      const { w, h } = S, dark = S.dark;
      S.bg = layer(S, (g) => {
        vgrad(g, w, dark ? [[0, "#2a0716"], [0.5, "#3e0b23"], [1, "#1a030c"]] : [[0, "#fff4f7"], [0.5, "#ffe1ea"], [1, "#ffc7d7"]], 0, h);
        g.fillStyle = tiledPattern(g, S, 56, (tg) => {
          tg.fillStyle = tg.strokeStyle = dark ? "rgba(255,130,170,.075)" : "rgba(225,29,72,.065)";
          heartPath(tg, 14, 14, 9); tg.fill(); tg.lineWidth = 1.1; heartPath(tg, 42, 42, 8); tg.stroke();
          tg.beginPath(); tg.arc(42, 14, 1.2, 0, TAU); tg.arc(14, 42, 1.2, 0, TAU); tg.fill();
        });
        g.fillRect(0, 0, w, h);
        const vg = g.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.2, w / 2, h * 0.45, Math.max(w, h) * 0.8);
        vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, dark ? "rgba(10,0,5,.55)" : "rgba(190,24,93,.13)"); g.fillStyle = vg; g.fillRect(0, 0, w, h);
      });
    },
    init(S) {
      const n = Math.round(26 * S.q);
      S.hearts = Array.from({ length: n }, (_, i) => this.heart(S, { z: (i + Math.random()) / n }, true));
      S.bok = Array.from({ length: 14 }, () => ({ x: R(0, S.w), y: R(0, S.h), r: R(20, 66), sp: R(5, 14), ph: R(0, TAU), a: R(0.18, 0.38), c: pick(S.dark ? [[255, 80, 130], [255, 140, 170], [200, 50, 110]] : [[255, 255, 255], [255, 178, 200], [255, 212, 175]]) }));
      S.spk = Array.from({ length: 22 }, () => ({ x: Math.random(), y: Math.random(), ph: R(0, TAU), sp: R(0.5, 1.4), s: R(8, 18) }));
      S.trace = null; S.nextTrace = R(4, 7);
    },
    heart(S, H, any) {
      const z = H.z;
      return Object.assign(H, { x0: R(0, S.w), y: any ? R(0, S.h) : S.h + 40, s: 12 + z * z * 34, sp: 16 + z * 46, sw: R(0.6, 1.3), amp: R(8, 26), ph: R(0, TAU), kind: pick(z < 0.3 ? ["pink", "rose", "red", "white"] : ["red", "red", "pink", "rose", "outline", "white"]), blur: z < 0.28, popAt: z > 0.55 && Math.random() < 0.45 ? R(0.08, 0.45) * S.h : -1e9 });
    },
    pop(S, x, y, kind) {
      burst(S, x, y, 8, [[255, 120, 160]], 60, 150, { kind: "heart", col: [kind === "outline" ? "red" : kind, "pink"], g: 90, drag: 2.2, up: -40, size: 3 });
      burst(S, x, y, 6, [[255, 200, 220], [255, 255, 255]], 30, 100, { g: 0 });
      ring(S, x, y, S.dark ? [255, 150, 190] : [244, 63, 120], 34);
    },
    frame(S, dt) {
      const { ctx: g, w, h, t, dark } = S;
      g.drawImage(S.bg, 0, 0, w, h);
      // heartbeat: lub-dub, then rest
      const ph = (t % 1.15) / 1.15, beat = Math.exp(-(((ph - 0.05) / 0.05) ** 2)) + 0.6 * Math.exp(-(((ph - 0.24) / 0.05) ** 2));
      S.beat = beat;
      const G = Math.max(w, h) * 1.15;
      g.globalCompositeOperation = dark ? "lighter" : "source-over";
      g.globalAlpha = dark ? 0.1 + 0.14 * beat : 0.1 + 0.12 * beat; g.drawImage(glow(dark ? [255, 60, 120] : [255, 110, 150], 0, 128), w / 2 - G / 2, h * 0.45 - G / 2, G, G);
      for (const b of S.bok) { b.y -= b.sp * dt; if (b.y < -b.r) { b.y = h + b.r; b.x = R(0, w); } g.globalAlpha = b.a * (0.75 + 0.25 * Math.sin(t * 0.7 + b.ph)); g.drawImage(bokeh(b.c), b.x - b.r, b.y - b.r, b.r * 2, b.r * 2); }
      const sc = dark ? [255, 200, 222] : [255, 140, 175];
      for (const s of S.spk) { const a = Math.max(0, Math.sin(t * s.sp + s.ph)) ** 6; if (a < 0.02) continue; s.y -= dt * 0.004; if (s.y < 0) s.y += 1; g.globalAlpha = a; g.drawImage(sparkle(sc), s.x * w - s.s / 2, s.y * h - s.s / 2, s.s, s.s); }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      for (const H of S.hearts) {
        H.y -= H.sp * dt;
        const sw = Math.sin(t * H.sw + H.ph), x = H.x0 + sw * H.amp, d = (H.s * (1 + 0.08 * beat * H.z)) / 0.6, rot = Math.cos(t * H.sw + H.ph) * 0.22;
        g.globalAlpha = (0.38 + 0.6 * H.z) * clamp((h + 40 - H.y) / 90, 0, 1);
        const c = Math.cos(rot), s = Math.sin(rot); S.tf(c, s, -s, c, x, H.y);
        g.drawImage(heartSprite(H.kind, H.blur ? 7 : 0), -d / 2, -d / 2, d, d);
        if (H.y < H.popAt) { S.reset(); g.globalAlpha = 1; this.pop(S, x, H.y, H.kind); this.heart(S, H); }
        else if (H.y < -H.s * 2) this.heart(S, H);
      }
      S.reset(); g.globalAlpha = 1;
      // cupid's trail: a glowing spark draws a heart, which then glows and fades
      if (!S.trace && (S.nextTrace -= dt) <= 0) { S.trace = { cx: R(0.3, 0.7) * w, cy: R(0.25, 0.5) * h, sc: Math.min(w, h) * R(0.011, 0.016), u: 0, glow: 0 }; S.nextTrace = R(10, 16); }
      const tc = dark ? [255, 130, 170] : [244, 63, 120];
      if (S.trace) {
        const T = S.trace;
        if (T.u < TAU) {
          for (let i = 0; i < 4; i++) { T.u = Math.min(TAU, T.u + (dt * 2.6) / 4); const [hx, hy] = heartXY(T.u); S.fx.push({ x: T.cx + hx * T.sc, y: T.cy + hy * T.sc, vx: R(-8, 8), vy: R(-8, 8), g: -6, drag: 1, life: 1.2, max: 1.2, size: R(1, 2), c: tc, rot: 0, vr: 0 }); }
          const [hx, hy] = heartXY(T.u); g.globalCompositeOperation = dark ? "lighter" : "source-over"; g.drawImage(glow(dark ? [255, 220, 235] : [255, 90, 140], 0.2, 32), T.cx + hx * T.sc - 11, T.cy + hy * T.sc - 11, 22, 22);
        } else {
          T.glow += dt; const a = Math.sin(clamp(T.glow / 1.6, 0, 1) * Math.PI); if (T.glow > 1.6) S.trace = null;
          g.beginPath(); for (let u = 0; u <= TAU + 0.01; u += 0.08) { const [hx, hy] = heartXY(u); u ? g.lineTo(T.cx + hx * T.sc, T.cy + hy * T.sc) : g.moveTo(T.cx + hx * T.sc, T.cy + hy * T.sc); }
          g.lineJoin = "round"; g.strokeStyle = rgba(tc, a * 0.16); g.lineWidth = 9; g.stroke(); g.strokeStyle = rgba(tc, a * 0.7); g.lineWidth = 2; g.stroke();
        }
      }
      g.globalCompositeOperation = dark ? "lighter" : "source-over";
      fxRun(S, dt, (p, k) => { if (p.kind !== "heart") return; const d = (p.size * 6 * (0.6 + 0.4 * k)) / 0.6, c = Math.cos(p.rot * 0.2), s = Math.sin(p.rot * 0.2); g.globalCompositeOperation = "source-over"; g.globalAlpha = Math.min(1, k * 1.5); S.tf(c, s, -s, c, p.x, p.y); g.drawImage(heartSprite(p.col), -d / 2, -d / 2, d, d); S.reset(); g.globalCompositeOperation = dark ? "lighter" : "source-over"; });
      g.globalCompositeOperation = "source-over";
    },
    tap(S, x, y) {
      burst(S, x, y, 14, [[255, 120, 160]], 90, 230, { kind: "heart", col: ["red", "pink", "rose", "white"], g: 120, drag: 2.4, up: -60, size: 3.2 });
      burst(S, x, y, 10, [[255, 210, 225], [255, 255, 255]], 40, 140, { g: 0 });
      ring(S, x, y, S.dark ? [255, 150, 190] : [244, 63, 120], 64);
    },
    poke(S) { burst(S, S.w / 2, S.h - 20, 12, [[255, 120, 160]], 40, 90, { kind: "heart", col: ["red", "pink", "rose"], g: -60, drag: 0.6, up: -170, size: 3, life: 2.2 }); },
  };

  /* ---------- Snowfall (winter night, cabin with a warm window) ---------- */
  const crystal = () => sprite("cry", 48, 48, (g, s) => {
    g.translate(s / 2, s / 2); g.strokeStyle = "rgba(255,255,255,.95)"; g.lineCap = "round"; g.lineWidth = 2;
    for (let i = 0; i < 6; i++) { g.rotate(TAU / 6); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -19); g.moveTo(0, -8); g.lineTo(-5, -13); g.moveTo(0, -8); g.lineTo(5, -13); g.moveTo(0, -14); g.lineTo(-3.5, -17); g.moveTo(0, -14); g.lineTo(3.5, -17); g.stroke(); }
    g.fillStyle = "#fff"; g.beginPath(); g.arc(0, 0, 2.5, 0, TAU); g.fill();
  });
  SCENES.snow = {
    resize(S) {
      const { w, h } = S, rnd = seeded(13);
      S.bg = layer(S, (g) => {
        vgrad(g, w, [[0, "#07142a"], [0.45, "#17335b"], [0.68, "#3a5f90"], [0.8, "#8a92ba"]], 0, h * 0.8);
        g.fillStyle = "#8a92ba"; g.fillRect(0, h * 0.8, w, h * 0.2);
        for (let i = 0; i < (w * h) / 2600; i++) { const s = 0.4 + rnd() * 0.9; g.fillStyle = `rgba(255,255,255,${0.1 + rnd() * 0.45})`; g.fillRect(rnd() * w, rnd() * h * 0.45, s, s); }
        moon(g, w * 0.78, h * 0.15, Math.min(w, h) * 0.05, [170, 200, 255], false);
        ridge(g, w, h, h * 0.75, h * 0.15, "#5a78a3", rnd, { rough: 1.5, rim: "rgba(255,255,255,.4)", rimW: 1.5 });
        vgrad(g, w, [[0, "rgba(150,170,210,0)"], [1, "rgba(160,178,215,.4)"]], h * 0.6, h * 0.77);
        const f1 = ridge(g, w, h, h * 0.81, h * 0.04, "#3d5a82", rnd, { rough: 0.8 });
        for (let x = rnd() * 8; x < w; x += 6 + rnd() * 9) pine(g, x, f1(x) + 3, 12 + rnd() * 16, "#2f4a70", "rgba(235,242,255,.7)");
        const sg = g.createLinearGradient(0, h * 0.86, 0, h); sg.addColorStop(0, "#f2f7fd"); sg.addColorStop(1, "#b9cce3");
        S.gy = ridge(g, w, h, h * 0.9, h * 0.05, sg, rnd, { rough: 0.6 });
        g.fillStyle = "rgba(110,140,185,.16)"; for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(rnd() * w, h * (0.93 + rnd() * 0.06), 30 + rnd() * 70, 3 + rnd() * 3, 0, 0, TAU); g.fill(); }
        for (let i = 0; i < 4; i++) { const x = rnd() * w * 0.24; pine(g, x, S.gy(x) + 6, 50 + rnd() * 45, "#1a2c48", "rgba(240,246,255,.85)"); }
        for (let i = 0; i < 3; i++) { const x = w * (0.86 + rnd() * 0.14); pine(g, x, S.gy(x) + 6, 55 + rnd() * 40, "#1a2c48", "rgba(240,246,255,.85)"); }
        // cabin
        const cx = w * 0.6, cy = S.gy(cx) + 4, s = Math.min(54, w * 0.13);
        g.fillStyle = "#4a3123"; g.fillRect(cx - s * 0.5, cy - s * 0.55, s, s * 0.55);
        g.strokeStyle = "rgba(0,0,0,.28)"; g.lineWidth = 1; for (let y = cy - s * 0.5; y < cy; y += s * 0.09) { g.beginPath(); g.moveTo(cx - s * 0.5, y); g.lineTo(cx + s * 0.5, y); g.stroke(); }
        g.fillStyle = "#3a2a22"; g.fillRect(cx + s * 0.24, cy - s * 0.98, s * 0.13, s * 0.34);
        g.fillStyle = "#2a1d18"; g.beginPath(); g.moveTo(cx - s * 0.66, cy - s * 0.52); g.lineTo(cx, cy - s); g.lineTo(cx + s * 0.66, cy - s * 0.52); g.closePath(); g.fill();
        g.strokeStyle = "#f4f8fd"; g.lineWidth = s * 0.09; g.lineCap = "round"; g.beginPath(); g.moveTo(cx - s * 0.68, cy - s * 0.5); g.lineTo(cx, cy - s * 1.03); g.lineTo(cx + s * 0.68, cy - s * 0.5); g.stroke();
        g.fillStyle = "#f4f8fd"; g.fillRect(cx + s * 0.22, cy - s * 1.02, s * 0.17, s * 0.06);
        for (let i = 0; i < 6; i++) { const ix = cx - s * 0.6 + i * s * 0.24; g.beginPath(); g.moveTo(ix - 1.5, cy - s * 0.5); g.lineTo(ix + 1.5, cy - s * 0.5); g.lineTo(ix, cy - s * 0.5 + 3 + (i % 3) * 2); g.closePath(); g.fill(); }
        g.fillStyle = "#ffcf70"; g.fillRect(cx - s * 0.34, cy - s * 0.42, s * 0.24, s * 0.2);
        g.fillStyle = "#4a3123"; g.fillRect(cx - s * 0.23, cy - s * 0.42, 1.5, s * 0.2); g.fillRect(cx - s * 0.34, cy - s * 0.33, s * 0.24, 1.5);
        g.fillStyle = "#2a1a12"; g.fillRect(cx + s * 0.06, cy - s * 0.36, s * 0.18, s * 0.36);
        g.fillStyle = "#eef4fb"; g.beginPath(); g.ellipse(cx, cy + 1, s * 0.75, 4, 0, 0, TAU); g.fill();
        S.chim = [cx + s * 0.305, cy - s * 1.02]; S.win = [cx - s * 0.22, cy - s * 0.32, s];
      });
      S.gl = Array.from({ length: 26 }, () => { const x = Math.random() * w; return { x, y: S.gy(x) + R(3, Math.max(4, h - S.gy(x) - 4)), ph: R(0, TAU), sp: R(0.6, 1.6) }; });
    },
    init(S) {
      S.flk = Array.from({ length: Math.round(118 * S.q) }, () => this.flake(S, true));
      S.smoke = []; S.smokeT = 0; S.gust = 0; S.nextGust = R(6, 12);
    },
    flake(S, any, f = {}) {
      const z = Math.random() ** 1.5;
      return Object.assign(f, { x: R(-0.1, 1.1) * S.w, y: any ? R(0, S.h) : R(-40, -6), z, r: z > 0.93 ? R(6, 11) : z > 0.55 ? R(1.6, 3) : R(0.6, 1.4), cry: z > 0.6 && z <= 0.93 && Math.random() < 0.35, ph: R(0, TAU), fs: R(0.6, 1.6), rot: R(0, TAU), vr: R(-1, 1) });
    },
    frame(S, dt) {
      const { ctx: g, w, h, t } = S;
      g.drawImage(S.bg, 0, 0, w, h);
      g.globalCompositeOperation = "lighter";
      const [wx, wy, ws] = S.win; g.globalAlpha = 0.5 + 0.12 * wave(t * 3, 2); g.drawImage(glow([255, 190, 90], 0.1, 64), wx - ws * 1.3, wy - ws * 1.3, ws * 2.6, ws * 2.6);
      for (const p of S.gl) { const a = Math.max(0, Math.sin(t * p.sp + p.ph)) ** 10; if (a > 0.03) { g.globalAlpha = a; g.drawImage(sparkle([200, 225, 255]), p.x - 6, p.y - 6, 12, 12); } }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      S.gust = Math.max(0, S.gust - dt * 0.4); if ((S.nextGust -= dt) <= 0) { S.nextGust = R(8, 14); S.gust = 1; }
      const W = 10 + 16 * wave(t * 0.2, 3) + 70 * Math.sin(S.gust * Math.PI);
      if ((S.smokeT -= dt) <= 0) { S.smokeT = 0.16; S.smoke.push({ x: S.chim[0], y: S.chim[1], r: 3, life: 4.5, max: 4.5, ph: R(0, TAU) }); }
      for (let i = S.smoke.length - 1; i >= 0; i--) { const p = S.smoke[i]; p.life -= dt; if (p.life <= 0) { S.smoke.splice(i, 1); continue; } const k = p.life / p.max; p.r += 5 * dt; p.y -= 13 * dt; p.x += (W * 0.35 + Math.sin(t + p.ph) * 4) * dt; g.globalAlpha = k * (1 - k) * 1.1; g.drawImage(glow([205, 212, 228], 0, 64), p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); }
      for (let i = 0; i < 2; i++) { const fx = ((t * (6 + i * 4) + i * w * 0.6) % (w * 1.8)) - w * 0.5; g.globalAlpha = 0.13; g.drawImage(glow([225, 232, 248], 0, 128), fx, h * (0.78 + i * 0.07), w * 1.1, h * 0.12); }
      g.globalAlpha = 1;
      const far = new Path2D(), mid = new Path2D(), cs = crystal();
      for (const f of S.flk) {
        const vy = 14 + f.z * f.z * 95; f.y += vy * dt; f.x += (W * (0.3 + f.z) + Math.sin(t * f.fs + f.ph) * 12 * (0.4 + f.z)) * dt; f.rot += f.vr * dt;
        if (f.y > h + 12 || f.x > w + 30) { this.flake(S, false, f); continue; }
        if (f.z > 0.93) { g.globalAlpha = 0.32; g.drawImage(glow([255, 255, 255], 0.35, 64), f.x - f.r * 2, f.y - f.r * 2, f.r * 4, f.r * 4); g.globalAlpha = 1; }
        else if (f.cry) { const d = f.r * 3.4, c = Math.cos(f.rot), s = Math.sin(f.rot); g.globalAlpha = 0.9; S.tf(c, s, -s, c, f.x, f.y); g.drawImage(cs, -d / 2, -d / 2, d, d); S.reset(); g.globalAlpha = 1; }
        else { const P = f.z > 0.55 ? mid : far; P.moveTo(f.x + f.r, f.y); P.arc(f.x, f.y, f.r, 0, TAU); }
      }
      g.fillStyle = "rgba(255,255,255,.6)"; g.fill(far); g.fillStyle = "rgba(255,255,255,.92)"; g.fill(mid);
      fxRun(S, dt);
    },
    tap(S, x, y) { burst(S, x, y, 18, [[255, 255, 255], [220, 235, 255]], 40, 150, { g: 60, size: 0.8 }); ring(S, x, y, [230, 240, 255], 40); },
    poke(S) { S.gust = 1; },
  };

  /* ---------- Fireflies (forest at night, synced flashes) ---------- */
  SCENES.fireflies = {
    resize(S) {
      const { w, h } = S, rnd = seeded(17);
      S.bg = layer(S, (g) => {
        vgrad(g, w, [[0, "#010806"], [0.5, "#03150c"], [0.72, "#0b2c19"], [1, "#020a05"]], 0, h);
        for (let i = 0; i < (w * h) / 3200; i++) { g.fillStyle = `rgba(220,255,230,${0.08 + rnd() * 0.3})`; g.fillRect(rnd() * w, rnd() * h * 0.45, 1, 1); }
        g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.3; g.drawImage(glow([170, 255, 190], 0, 128), w * 0.2 - 120, h * 0.12 - 120, 240, 240); g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
        g.fillStyle = "#e9f7dc"; g.beginPath(); g.arc(w * 0.2, h * 0.12, Math.min(w, h) * 0.035, 0, TAU); g.fill();
        const far = ridge(g, w, h, h * 0.66, h * 0.06, "#0c2b1a", rnd, { rough: 0.7 });
        g.fillStyle = "#0c2b1a"; for (let x = 0; x < w + 14; x += 9 + rnd() * 8) { g.beginPath(); g.arc(x, far(Math.min(x, w)) + 2, 9 + rnd() * 15, 0, TAU); g.fill(); }
        vgrad(g, w, [[0, "rgba(120,190,150,0)"], [0.5, "rgba(120,190,150,.13)"], [1, "rgba(120,190,150,0)"]], h * 0.6, h * 0.76);
        const mid = ridge(g, w, h, h * 0.77, h * 0.05, "#061a0f", rnd, { rough: 0.9 });
        for (let x = rnd() * 20; x < w; x += 22 + rnd() * 30) { if (rnd() < 0.5) pine(g, x, mid(x) + 4, 40 + rnd() * 60, "#061a0f"); else { g.fillStyle = "#061a0f"; g.fillRect(x - 2, mid(x) - 30, 4, 34); for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + (rnd() - 0.5) * 22, mid(x) - 34 - rnd() * 22, 12 + rnd() * 10, 0, TAU); g.fill(); } } }
        S.gy = ridge(g, w, h, h * 0.9, h * 0.03, "#030d07", rnd, { rough: 0.6 });
        S.mush = [];
        for (let i = 0; i < 4; i++) { const x = w * (0.08 + rnd() * 0.84), y = S.gy(x) + 6, s = 4 + rnd() * 4; g.fillStyle = "#cfe9df"; g.fillRect(x - s * 0.18, y - s * 1.1, s * 0.36, s * 1.1); g.fillStyle = "#3fbfb0"; g.beginPath(); g.ellipse(x, y - s * 1.1, s * 0.8, s * 0.5, 0, Math.PI, TAU); g.fill(); S.mush.push([x, y - s * 1.1, s]); }
      });
      S.grass = Array.from({ length: Math.round(95 * S.q) }, () => ({ x: R(0, w), hh: R(14, 52), ph: R(0, TAU), c: Math.random() < 0.5 }));
    },
    init(S) {
      S.ff = Array.from({ length: Math.round(34 * S.q) }, (_, i) => ({ x: R(0, S.w), y: R(0.2, 0.95) * S.h, vx: 0, vy: 0, seed: i * 7.3, z: R(0.35, 1), per: R(2.5, 5), off: R(0, 5), force: 0 }));
      S.mote = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), ph: R(0, TAU) }));
      S.wave = null; S.nextWave = R(9, 15); S.att = null;
    },
    frame(S, dt) {
      const { ctx: g, w, h, t } = S;
      g.drawImage(S.bg, 0, 0, w, h);
      g.globalCompositeOperation = "lighter";
      for (const [x, y, s] of S.mush) { g.globalAlpha = 0.25 + 0.15 * Math.sin(t * 1.3 + x); g.drawImage(glow([80, 230, 215], 0, 64), x - s * 3, y - s * 3, s * 6, s * 6); }
      g.globalAlpha = 0.3; g.fillStyle = "rgba(200,255,200,.5)";
      for (const m of S.mote) { m.y -= dt * 0.006; if (m.y < 0) m.y += 1; g.fillRect((m.x + 0.02 * Math.sin(t * 0.4 + m.ph)) * w, m.y * h, 1.2, 1.2); }
      g.globalAlpha = 1;
      if (!S.wave && (S.nextWave -= dt) <= 0) { S.wave = { x: -60 }; S.nextWave = R(14, 22); }
      if (S.wave && (S.wave.x += 260 * dt) > w + 60) S.wave = null;
      const att = S.att && t < S.att.until ? S.att : null;
      for (const f of S.ff) {
        let ax = wave(t * 0.4, f.seed) * 40, ay = wave(t * 0.33, f.seed + 5) * 30;
        if (att) { const dx = att.x - f.x, dy = att.y - f.y, d = Math.hypot(dx, dy); if (d < 230) { ax += dx * 1.6; ay += dy * 1.6; } }
        if (f.y < h * 0.15) ay += 40; if (f.y > h * 0.96) ay -= 40; if (f.x < 0) ax += 40; if (f.x > w) ax -= 40;
        f.vx = (f.vx + ax * dt) * (1 - 0.8 * dt); f.vy = (f.vy + ay * dt) * (1 - 0.8 * dt);
        const sp = Math.hypot(f.vx, f.vy), mx = att ? 90 : 38; if (sp > mx) { f.vx *= mx / sp; f.vy *= mx / sp; }
        f.x += f.vx * dt; f.y += f.vy * dt;
        if (S.wave && Math.abs(f.x - S.wave.x) < 16) f.force = 1;
        const p = ((t + f.off) % f.per) / f.per, b = Math.max(p < 0.18 ? Math.sin((p / 0.18) * Math.PI) : 0, f.force);
        f.force = Math.max(0, f.force - dt * 1.3);
        if (b < 0.02) continue;
        const s = (18 + 30 * f.z) * (0.6 + 0.4 * b);
        g.globalAlpha = b * (0.45 + 0.55 * f.z); g.drawImage(glow([190, 255, 80], 0.08, 64), f.x - s / 2, f.y - s / 2, s, s);
        g.globalAlpha = b; g.drawImage(glow([255, 255, 210], 0.3, 32), f.x - 3 * f.z - 1, f.y - 3 * f.z - 1, 6 * f.z + 2, 6 * f.z + 2);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      const a = new Path2D(), b2 = new Path2D();
      for (const gr of S.grass) { const by = S.gy(gr.x) + 5, bend = Math.sin(t * 1.1 + gr.x * 0.02 + gr.ph) * 6 + 4, P = gr.c ? a : b2; P.moveTo(gr.x, by); P.quadraticCurveTo(gr.x + bend * 0.4, by - gr.hh * 0.6, gr.x + bend, by - gr.hh); }
      g.lineCap = "round"; g.lineWidth = 1.7; g.strokeStyle = "#0b2a17"; g.stroke(a); g.strokeStyle = "#103b20"; g.stroke(b2);
      g.globalCompositeOperation = "lighter"; fxRun(S, dt); g.globalCompositeOperation = "source-over";
    },
    tap(S, x, y) { S.att = { x, y, until: S.t + 2.4 }; for (const f of S.ff) if (Math.hypot(f.x - x, f.y - y) < 230) f.force = 0.9; ring(S, x, y, [190, 255, 90], 50); },
    poke(S) { S.wave = { x: -60 }; },
  };

  /* ---------- Lava lamp (real metaballs) ---------- */
  const LAVA_LUT = (() => {
    const lut = new Uint32Array(256), st = [[0, [110, 8, 8], 0], [0.3, [160, 18, 14], 0], [0.42, [200, 35, 20], 0.35], [0.5, [226, 62, 20], 0.88], [0.53, [242, 92, 26], 1], [0.62, [250, 120, 38], 1], [0.8, [255, 150, 52], 1], [1, [255, 196, 96], 1]];
    for (let i = 0; i < 256; i++) {
      const v = i / 255; let k = 0; while (k < st.length - 2 && v > st[k + 1][0]) k++;
      const [a0, c0, l0] = st[k], [a1, c1, l1] = st[k + 1], f = clamp((v - a0) / (a1 - a0), 0, 1);
      const r = c0[0] + (c1[0] - c0[0]) * f, gg = c0[1] + (c1[1] - c0[1]) * f, b = c0[2] + (c1[2] - c0[2]) * f, al = Math.round((l0 + (l1 - l0) * f) * 255);
      lut[i] = ((al << 24) | (Math.round(b) << 16) | (Math.round(gg) << 8) | Math.round(r)) >>> 0;
    }
    return lut;
  })();
  SCENES.lava = {
    resize(S) {
      const { w, h } = S;
      S.bg = layer(S, (g) => {
        vgrad(g, w, [[0, "#120303"], [0.55, "#240707"], [1, "#3b0c05"]], 0, h);
        const rg = g.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, w * 0.95); rg.addColorStop(0, "rgba(255,95,25,.38)"); rg.addColorStop(1, "rgba(255,95,25,0)"); g.fillStyle = rg; g.fillRect(0, 0, w, h);
      });
      S.glass = layer(S, (g) => {
        for (const [x, ww, a] of [[0.1, 0.06, 0.07], [0.9, 0.035, 0.05], [0.16, 0.012, 0.08]]) { const lg = g.createLinearGradient(x * w - ww * w, 0, x * w + ww * w, 0); lg.addColorStop(0, "rgba(255,240,230,0)"); lg.addColorStop(0.5, `rgba(255,240,230,${a})`); lg.addColorStop(1, "rgba(255,240,230,0)"); g.fillStyle = lg; g.fillRect(x * w - ww * w, 0, ww * w * 2, h); }
        vgrad(g, w, [[0, "rgba(0,0,0,.45)"], [1, "rgba(0,0,0,0)"]], 0, h * 0.12);
      });
      S.cell = S.q < 0.8 ? 6 : 5; S.gw = Math.ceil(w / S.cell) + 1; S.gh = Math.ceil(h / S.cell) + 1;
      S.fc = mk(S.gw, S.gh); S.fctx = S.fc.getContext("2d"); S.img = S.fctx.createImageData(S.gw, S.gh); S.u32 = new Uint32Array(S.img.data.buffer);
      if (S.blobs) { const pool = S.blobs.filter((b) => b.fixed); pool[0].x = w / 2; pool[0].y = h + w * 0.22; pool[0].r0 = w * 0.42; pool[1].x = w * 0.55; pool[1].y = -w * 0.12; pool[1].r0 = w * 0.2; }
    },
    init(S) {
      const { w, h } = S, m = Math.min(w, h * 0.7);
      S.blobs = [{ fixed: 1, x: w / 2, y: h + w * 0.22, r0: w * 0.42, ph: 0 }, { fixed: 1, x: w * 0.55, y: -w * 0.12, r0: w * 0.2, ph: 2 }];
      for (let i = 0; i < 7; i++) S.blobs.push({ x: R(0.15, 0.85) * w, y: R(0.1, 0.9) * h, r0: R(0.08, 0.15) * m, vx: R(-10, 10), vy: R(-20, 20), temp: Math.random(), ph: R(0, TAU) });
      S.emb = Array.from({ length: Math.round(26 * S.q) }, () => ({ x: R(0, w), y: R(0, h), vy: R(14, 40), ph: R(0, TAU), s: R(1, 2.4) }));
      S.bx = new Float32Array(16); S.by = new Float32Array(16); S.br = new Float32Array(16);
    },
    frame(S, dt) {
      const { ctx: g, w, h, t } = S, B = S.blobs;
      for (let i = B.length - 1; i >= 0; i--) {
        const b = B[i]; if (b.fixed) continue;
        if (b.tmp) { b.tmp -= dt; if (b.tmp <= 0) { B.splice(i, 1); continue; } }
        const yf = b.y / h;
        if (yf > 0.82) b.temp = Math.min(1, b.temp + dt * 0.13); else if (yf < 0.2) b.temp = Math.max(0, b.temp - dt * 0.13);
        b.vy += (b.temp - 0.5) * -40 * dt; b.vx += wave(t * 0.3, b.ph) * 6 * dt; b.vx *= 1 - 0.4 * dt; b.vy *= 1 - 0.25 * dt; b.vy = clamp(b.vy, -46, 46);
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < b.r0 * 0.4) b.vx += 24 * dt; if (b.x > w - b.r0 * 0.4) b.vx -= 24 * dt;
        if (b.y > h + b.r0 * 0.2) { b.y = h + b.r0 * 0.2; b.vy *= -0.3; } if (b.y < -b.r0 * 0.2) { b.y = -b.r0 * 0.2; b.vy *= -0.3; }
      }
      const cell = S.cell, n = Math.min(16, B.length), { bx, by, br, u32, gw, gh } = S;
      for (let k = 0; k < n; k++) { const b = B[k], r = b.r0 * (1 + 0.07 * Math.sin(t * 1.3 + b.ph)) * (b.tmp ? Math.min(1, b.tmp / 2) : 1); bx[k] = b.x / cell; by[k] = b.y / cell; br[k] = (r * r) / (cell * cell); }
      let i = 0;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let v = 0; for (let k = 0; k < n; k++) { const dx = x - bx[k], dy = (y - by[k]) * 0.9; const q = br[k] / (dx * dx + dy * dy + 0.5); v += q * q; } const sv = Math.sqrt(v); u32[i++] = LAVA_LUT[sv >= 2 ? 255 : (sv * 127.5) | 0]; }
      S.fctx.putImageData(S.img, 0, 0);
      g.drawImage(S.bg, 0, 0, w, h);
      g.imageSmoothingEnabled = true; g.drawImage(S.fc, 0, 0, gw, gh, 0, 0, gw * cell, gh * cell);
      g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.2; g.drawImage(S.fc, 0, 0, gw, gh, -cell * 3, -cell * 3, gw * cell + cell * 6, gh * cell + cell * 6);
      for (const b of B) { if (b.fixed) continue; const r = b.r0; g.globalAlpha = 0.16; g.drawImage(glow([255, 235, 180], 0, 64), b.x - r * 0.75, b.y - r * 0.8, r * 0.8, r * 0.8); }
      for (const e of S.emb) { e.y -= e.vy * dt; e.x += Math.sin(t * 2 + e.ph) * 6 * dt; if (e.y < -10) { e.y = h + 5; e.x = R(0, w); } g.globalAlpha = 0.35 + 0.35 * Math.sin(t * 6 + e.ph); g.drawImage(glow([255, 160, 60], 0.2, 32), e.x - e.s * 3, e.y - e.s * 3, e.s * 6, e.s * 6); }
      fxRun(S, dt);
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.drawImage(S.glass, 0, 0, w, h);
    },
    tap(S, x, y) {
      for (const b of S.blobs) { if (b.fixed) continue; const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy) || 1; if (d < 200) { b.vx += (dx / d) * 60; b.vy += (dy / d) * 60; } }
      if (S.blobs.length < 12) S.blobs.push({ x, y, r0: R(22, 34), vx: 0, vy: 0, temp: 0.85, ph: R(0, TAU), tmp: 12 });
      burst(S, x, y, 12, [[255, 170, 70], [255, 120, 40]], 40, 140, { g: -30 }); ring(S, x, y, [255, 150, 60], 46);
    },
    poke(S) { for (const b of S.blobs) if (!b.fixed && b.y > S.h * 0.6) b.temp = Math.min(1, b.temp + 0.35); },
  };

  /* ---------- Rainy city night (window drops, lightning) ---------- */
  const dropSpr = () => sprite("drop", 48, 48, (g, s) => {
    const c = s / 2; g.beginPath(); g.arc(c, c, c - 2, 0, TAU);
    const gr = g.createRadialGradient(c, c * 1.25, 1, c, c, c - 2); gr.addColorStop(0, "rgba(220,235,255,.38)"); gr.addColorStop(0.7, "rgba(40,60,90,.22)"); gr.addColorStop(0.92, "rgba(8,14,26,.55)"); gr.addColorStop(1, "rgba(200,220,255,.32)");
    g.fillStyle = gr; g.fill(); g.fillStyle = "rgba(255,255,255,.78)"; g.beginPath(); g.ellipse(c * 0.72, c * 0.62, c * 0.18, c * 0.11, -0.6, 0, TAU); g.fill();
  });
  SCENES.rain = {
    resize(S) {
      const { w, h } = S, rnd = seeded(23);
      S.sky = layer(S, (g) => { vgrad(g, w, [[0, "#070d18"], [0.6, "#132136"], [1, "#1d3049"]], 0, h); });
      S.wins = []; S.beacons = [];
      S.city = layer(S, (g) => {
        let x = -5;
        while (x < w) { const bw = 14 + rnd() * 30, bh = h * (0.12 + rnd() * 0.2); g.fillStyle = "#17253a"; g.fillRect(x, h * 0.84 - bh, bw, bh + h); if (rnd() < 0.25) g.fillRect(x + bw * 0.45, h * 0.84 - bh - 14, 1.5, 14); for (let wy = h * 0.84 - bh + 5; wy < h; wy += 7) for (let wx = x + 3; wx < x + bw - 3; wx += 5) if (rnd() < 0.12) { g.fillStyle = `rgba(255,210,150,${0.2 + rnd() * 0.3})`; g.fillRect(wx, wy, 1.5, 2); } g.fillStyle = "#17253a"; x += bw + rnd() * 3; }
        x = -10;
        while (x < w) {
          const bw = 30 + rnd() * 46, bh = h * (0.18 + rnd() * 0.27), top = h * 0.9 - bh, gr = g.createLinearGradient(0, top, 0, h);
          gr.addColorStop(0, "#101b2c"); gr.addColorStop(1, "#070d17"); g.fillStyle = gr; g.fillRect(x, top, bw, h);
          if (rnd() < 0.4) g.fillRect(x + bw * 0.2, top - 6, bw * 0.25, 6);
          if (rnd() < 0.35) { g.fillRect(x + bw * 0.7, top - 18, 1.5, 18); S.beacons.push([x + bw * 0.7 + 0.75, top - 18, rnd() * TAU]); }
          for (let wy = top + 8; wy < h * 0.98; wy += 9) for (let wx = x + 5; wx < x + bw - 5; wx += 7) if (rnd() < 0.3) { const warm = rnd() < 0.7; g.fillStyle = warm ? `rgba(255,${(190 + rnd() * 40) | 0},120,${0.45 + rnd() * 0.45})` : `rgba(150,205,255,${0.35 + rnd() * 0.4})`; g.fillRect(wx, wy, 3, 4); if (rnd() < 0.05 && S.wins.length < 14) S.wins.push([wx, wy, warm, 0.3 + rnd() * 1.2, rnd() * TAU]); }
          x += bw + 2 + rnd() * 5;
        }
        for (let i = 0; i < 14; i++) { const c = [[255, 170, 80], [255, 120, 90], [120, 200, 255], [255, 220, 150]][i % 4], r = 16 + rnd() * 28; g.globalAlpha = 0.18 + rnd() * 0.17; g.drawImage(bokeh(c), rnd() * w - r, h * (0.86 + rnd() * 0.13) - r, r * 2, r * 2); }
        g.globalAlpha = 1; vgrad(g, w, [[0, "rgba(90,120,160,0)"], [1, "rgba(90,120,160,.28)"]], h * 0.7, h);
      });
    },
    init(S) {
      const L = (n, len, sp, a, lw) => ({ a, lw, p: Array.from({ length: Math.round(n * S.q) }, () => ({ x: R(-0.2, 1) * S.w, y: R(0, S.h), len: R(len[0], len[1]), sp: R(sp[0], sp[1]) })) });
      S.rl = [L(70, [10, 16], [650, 800], 0.16, 1), L(45, [18, 28], [900, 1100], 0.26, 1.2), L(12, [40, 70], [1300, 1600], 0.32, 1.6)];
      S.gd = Array.from({ length: Math.round(26 * S.q) }, () => this.drop(S, true));
      S.flashT = 9; S.bolt = null; S.nextBolt = R(6, 12); S.splT = 0;
    },
    drop(S, any) { return { x: R(0, S.w), y: R(0, S.h), r: Math.random() ** 2 * 6 + 1.4, vy: 0, slide: false, grow: any ? 1 : 0, trail: 0, life: 0 }; },
    bolt(S) {
      const pts = [], br = []; let x = R(0.2, 0.8) * S.w, y = -5; const end = S.h * R(0.45, 0.62);
      while (y < end) { pts.push([x, y]); y += R(12, 26); x += R(-18, 18); if (Math.random() < 0.12 && br.length < 3) { const b = [[x, y]]; let bx = x, by = y, d = Math.random() < 0.5 ? -1 : 1; for (let k = 0; k < 5; k++) { bx += d * R(6, 18); by += R(10, 20); b.push([bx, by]); } br.push(b); } }
      return [pts, ...br];
    },
    frame(S, dt) {
      const { ctx: g, w, h, t } = S;
      g.drawImage(S.sky, 0, 0, w, h);
      if ((S.nextBolt -= dt) <= 0) { S.nextBolt = R(12, 26); S.flashT = 0; S.bolt = this.bolt(S); }
      S.flashT += dt; const ft = S.flashT, fl = ft < 0.08 ? 0.9 : ft < 0.16 ? 0.2 : ft < 0.26 ? 0.7 : Math.exp(-(ft - 0.26) * 6) * 0.7;
      if (fl > 0.01) {
        g.globalCompositeOperation = "lighter"; g.fillStyle = `rgba(170,190,255,${fl * 0.28})`; g.fillRect(0, 0, w, h);
        if (S.bolt && ft < 0.45) for (const [lw, c] of [[7, "rgba(160,190,255,.25)"], [2, "rgba(255,255,255,.95)"]]) { g.lineWidth = lw; g.strokeStyle = c; g.lineJoin = "round"; for (const line of S.bolt) { g.beginPath(); line.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); } }
        g.globalCompositeOperation = "source-over";
      }
      g.drawImage(S.city, 0, 0, w, h);
      for (const [x, y, warm, f, ph] of S.wins) { const on = Math.sin(t * f + ph) > -0.5; g.fillStyle = on ? (warm ? "rgba(255,215,140,.95)" : "rgba(170,215,255,.9)") : "#0b1422"; g.fillRect(x, y, 3, 4); }
      g.globalCompositeOperation = "lighter";
      for (const [x, y, ph] of S.beacons) { const a = Math.max(0, Math.sin(t * 2.5 + ph)) ** 4; if (a > 0.02) { g.globalAlpha = a; g.drawImage(glow([255, 60, 60], 0.15, 32), x - 7, y - 7, 14, 14); } }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      const ang = 0.16 + 0.05 * wave(t * 0.2), dx = Math.sin(ang), dy = Math.cos(ang); g.lineCap = "round";
      for (const L of S.rl) {
        g.strokeStyle = `rgba(190,215,240,${L.a})`; g.lineWidth = L.lw; g.beginPath();
        for (const p of L.p) { p.y += p.sp * dt; p.x += ((p.sp * dx) / dy) * dt; if (p.y > h) { p.y = R(-60, -10); p.x = R(-0.2, 1) * w; } g.moveTo(p.x, p.y); g.lineTo(p.x - dx * p.len, p.y - dy * p.len); }
        g.stroke();
      }
      S.splT += dt * 28;
      while (S.splT > 1) { S.splT--; const x = R(0, w), y = h * R(0.94, 1); for (let k = 0; k < 2; k++) S.fx.push({ x, y, vx: R(-40, 40), vy: R(-120, -60), g: 600, drag: 0.5, life: 0.35, max: 0.35, size: 0.5, c: [190, 215, 240], rot: 0, vr: 0 }); if (Math.random() < 0.4) ring(S, x, y, [170, 200, 235], 8, 0.3); }
      g.globalCompositeOperation = "lighter"; fxRun(S, dt); g.globalCompositeOperation = "source-over";
      // drops sitting on the glass; big ones slide and leave a trail
      const ds = dropSpr();
      if (S.gd.length < 34 * S.q && Math.random() < dt * 2.5) S.gd.push(this.drop(S, false));
      for (let i = S.gd.length - 1; i >= 0; i--) {
        const d = S.gd[i];
        if (d.life) { d.life -= dt; if (d.life <= 0) { S.gd.splice(i, 1); continue; } }
        d.grow = Math.min(1, d.grow + dt * 2.5);
        if (!d.slide && !d.life && d.r > 4.6 && Math.random() < dt * 0.05) d.slide = true;
        if (d.slide) { d.vy = Math.min(d.vy + 90 * dt, 80 + d.r * 12); d.y += d.vy * dt; d.x += Math.sin(t * 6 + d.y * 0.05) * 0.3; d.trail += d.vy * dt; if (d.trail > 12) { d.trail = 0; S.gd.push({ x: d.x + R(-1, 1), y: d.y - d.r, r: R(0.8, 1.7), vy: 0, slide: false, grow: 1, trail: 0, life: R(4, 7) }); } if (d.y > h + 10) { Object.assign(d, this.drop(S, false)); } }
        const r = d.r * d.grow; g.globalAlpha = d.life ? Math.min(1, d.life / 2) : 1; g.drawImage(ds, d.x - r, d.y - r * (d.slide ? 1.3 : 1.05), r * 2, r * (d.slide ? 2.6 : 2.1));
      }
      g.globalAlpha = 1;
    },
    tap(S, x, y) { S.gd.push({ x, y, r: R(6, 8), vy: 0, slide: true, grow: 0.3, trail: 0, life: 0 }); ring(S, x, y, [180, 210, 245], 40); },
    poke(S) { S.nextBolt = 0; },
  };

  /* ---------- Party (stage lights, bunting, fairy lights, balloons, confetti cannons) ---------- */
  const CONF = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#facc15", "#22d3ee"];
  const CONF_BACK = CONF.map((c) => rgba(hex(c).map((v) => v * 0.62), 1));
  const balloonSpr = (c) => sprite(`bl${c}`, 80, 110, (g) => {
    const col = hex(c), cx = 40, cy = 44;
    g.beginPath(); g.ellipse(cx, cy, 30, 37, 0, 0, TAU);
    const gr = g.createRadialGradient(cx - 10, cy - 14, 3, cx, cy, 42); gr.addColorStop(0, rgba(col.map((v) => Math.min(255, v + 95)), 1)); gr.addColorStop(0.45, c); gr.addColorStop(1, rgba(col.map((v) => v * 0.55), 1));
    g.fillStyle = gr; g.fill();
    g.fillStyle = rgba(col.map((v) => v * 0.7), 1); g.beginPath(); g.moveTo(cx - 4.5, cy + 41); g.lineTo(cx + 4.5, cy + 41); g.lineTo(cx, cy + 35); g.closePath(); g.fill();
    g.fillStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.ellipse(cx - 11, cy - 16, 6, 10, -0.5, 0, TAU); g.fill();
    g.fillStyle = "rgba(255,255,255,.3)"; g.beginPath(); g.ellipse(cx + 14, cy + 18, 3, 5, -0.5, 0, TAU); g.fill();
  });
  SCENES.confetti = {
    resize(S) {
      const { w, h } = S, dark = S.dark;
      S.bg = layer(S, (g) => {
        vgrad(g, w, dark ? [[0, "#130b25"], [0.6, "#220f3f"], [1, "#2c0f3d"]] : [[0, "#fff8ec"], [0.6, "#fdf0ff"], [1, "#f3e8ff"]], 0, h);
        g.fillStyle = tiledPattern(g, S, 34, (tg) => { tg.fillStyle = dark ? "rgba(255,255,255,.06)" : "rgba(168,85,247,.08)"; tg.beginPath(); tg.arc(8, 8, 2.2, 0, TAU); tg.fill(); tg.fillStyle = dark ? "rgba(255,180,220,.06)" : "rgba(236,72,153,.08)"; tg.beginPath(); tg.arc(25, 25, 1.6, 0, TAU); tg.fill(); });
        g.fillRect(0, 0, w, h);
      });
    },
    init(S) {
      S.pc = Array.from({ length: Math.round(64 * S.q) }, () => this.piece(S, {}, true));
      S.bal = Array.from({ length: 4 }, (_, i) => ({ x0: ((i + R(0.2, 0.8)) / 4) * S.w, y: R(0.3, 1.1) * S.h, c: CONF[(i * 3) % CONF.length], sp: R(12, 22), ph: R(0, TAU), z: R(0.7, 1) }));
      S.nextCannon = R(2.5, 5);
    },
    piece(S, p, any, o) {
      const ci = (Math.random() * CONF.length) | 0, r = Math.random();
      return Object.assign(p, { x: R(0, S.w), y: any ? R(0, S.h) : R(-40, -10), vx: R(-20, 20), vy: R(20, 60), rot: R(0, TAU), vr: R(-5, 5), flip: R(0, TAU), vf: R(4, 10), w: R(6, 10), h: R(9, 15), ci, shape: r < 0.6 ? 0 : r < 0.75 ? 1 : r < 0.9 ? 2 : 3, fs: R(1, 3), ph: R(0, TAU), dr: R(2.4, 3.5), tmp: 0, age: 0 }, o);
    },
    cannon(S, side) {
      const x = side ? S.w + 5 : -5, y = S.h * 0.98;
      for (let i = 0; i < 30; i++) { const a = -Math.PI / 2 + (side ? -1 : 1) * R(0.18, 0.62), sp = R(520, 900); S.pc.push(this.piece(S, {}, false, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, tmp: 1 })); }
      burst(S, side ? S.w - 10 : 10, y - 10, 12, [[255, 220, 120], [255, 160, 200]], 60, 220, { g: 80 });
    },
    frame(S, dt) {
      const { ctx: g, w, h, t, dark } = S;
      g.drawImage(S.bg, 0, 0, w, h);
      // sweeping stage lights
      g.globalCompositeOperation = dark ? "lighter" : "source-over";
      const lights = [[0.12, [255, 110, 190]], [0.5, [90, 210, 255]], [0.88, [255, 205, 90]]];
      lights.forEach(([fx, c], i) => {
        const ax = fx * w, ay = -12, a = (fx - 0.5) * -0.9 + 0.38 * Math.sin(t * 0.5 + i * 2.1), L = h * 1.25, sp = 0.17;
        const gr = g.createRadialGradient(ax, ay, 0, ax, ay, L); gr.addColorStop(0, rgba(c, dark ? 0.26 : 0.2)); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + Math.sin(a - sp) * L, ay + Math.cos(a - sp) * L); g.lineTo(ax + Math.sin(a + sp) * L, ay + Math.cos(a + sp) * L); g.closePath(); g.fill();
      });
      g.globalCompositeOperation = "source-over";
      // balloons
      for (const b of S.bal) {
        b.y -= b.sp * dt; if (b.y < -120) { b.y = h + 60; b.x0 = R(0.1, 0.9) * w; }
        const x = b.x0 + Math.sin(t * 0.7 + b.ph) * 14, bw = 46 * b.z, bh = 63 * b.z, ky = b.y + bh * 0.42;
        g.strokeStyle = dark ? "rgba(255,255,255,.35)" : "rgba(90,60,110,.4)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x, ky); g.bezierCurveTo(x + Math.sin(t * 1.4 + b.ph) * 8, ky + 22, x - Math.sin(t * 1.1 + b.ph) * 8, ky + 44, x + Math.sin(t + b.ph) * 4, ky + 66); g.stroke();
        g.globalAlpha = dark ? 0.88 : 0.95; g.drawImage(balloonSpr(b.c), x - bw / 2, b.y - bh / 2, bw, bh); g.globalAlpha = 1;
      }
      // confetti physics: gravity, air drag, flutter, 3D flip (darker back side)
      if ((S.nextCannon -= dt) <= 0) { S.nextCannon = R(9, 15); this.cannon(S, 0); this.cannon(S, 1); }
      for (let i = S.pc.length - 1; i >= 0; i--) {
        const p = S.pc[i]; p.age += dt;
        const dr = p.dr * (p.tmp && p.age < 0.8 ? 0.33 : 1), d = Math.max(0, 1 - dr * dt);
        p.vx = (p.vx + Math.sin(t * p.fs + p.ph) * 40 * dt) * d; p.vy = (p.vy + 230 * dt) * d; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.flip += p.vf * dt;
        if (p.y > h + 30 || p.x < -60 || p.x > w + 60) { if (p.tmp) { S.pc.splice(i, 1); continue; } this.piece(S, p); continue; }
        const cf = Math.cos(p.flip), c = Math.cos(p.rot), s = Math.sin(p.rot);
        S.tf(c * cf, s * cf, -s, c, p.x, p.y);
        g.fillStyle = cf > 0 ? CONF[p.ci] : CONF_BACK[p.ci];
        if (p.shape === 0) g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        else if (p.shape === 1) { g.beginPath(); g.arc(0, 0, p.w * 0.5, 0, TAU); g.fill(); }
        else if (p.shape === 2) { g.strokeStyle = g.fillStyle; g.lineWidth = 2.2; g.beginPath(); for (let k = 0; k <= 7; k++) { const y = -10 + k * 3, x = Math.sin(k * 1.3 + t * 6) * 2.6; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
        else { g.beginPath(); g.moveTo(0, -p.w * 0.7); g.lineTo(p.w * 0.6, p.w * 0.5); g.lineTo(-p.w * 0.6, p.w * 0.5); g.closePath(); g.fill(); }
      }
      S.reset();
      // bunting + fairy lights across the top
      const sag = (x, y0, s) => y0 + s * (1 - ((x - w / 2) / (w / 2 + 10)) ** 2);
      const bs = 26 * (1 + 0.06 * Math.sin(t * 0.9));
      g.strokeStyle = dark ? "rgba(255,255,255,.4)" : "rgba(110,70,130,.45)"; g.lineWidth = 1;
      g.beginPath(); for (let x = -10; x <= w + 10; x += 8) x > -10 ? g.lineTo(x, sag(x, 4, bs)) : g.moveTo(x, sag(x, 4, bs)); g.stroke();
      let k = 0;
      for (let x = 6; x < w; x += 30, k++) {
        const y = sag(x, 4, bs), sw = Math.sin(t * 2 + k) * 0.1, c = Math.cos(sw), s = Math.sin(sw);
        S.tf(c, s, -s, c, x, y); g.fillStyle = CONF[k % CONF.length]; g.beginPath(); g.moveTo(-10, 0); g.lineTo(10, 0); g.lineTo(0, 20); g.closePath(); g.fill();
        g.fillStyle = "rgba(255,255,255,.22)"; g.beginPath(); g.moveTo(-10, 0); g.lineTo(0, 0); g.lineTo(0, 20); g.closePath(); g.fill();
      }
      S.reset();
      const ls = 22 * (1 + 0.05 * Math.sin(t * 0.8 + 1));
      g.beginPath(); for (let x = -10; x <= w + 10; x += 8) x > -10 ? g.lineTo(x, sag(x, 46, ls)) : g.moveTo(x, sag(x, 46, ls)); g.strokeStyle = dark ? "rgba(255,255,255,.25)" : "rgba(60,40,70,.35)"; g.stroke();
      const BULB = [[253, 224, 71], [244, 114, 182], [96, 165, 250], [74, 222, 128]];
      k = 0;
      for (let x = 12; x < w; x += 24, k++) {
        const y = sag(x, 46, ls) + 4, b = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 4 - k * 0.7)), c = BULB[k % 4];
        g.globalCompositeOperation = dark ? "lighter" : "source-over"; g.globalAlpha = b * (dark ? 0.9 : 0.55); g.drawImage(glow(c, 0.15, 32), x - 11, y - 11, 22, 22);
        g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.fillStyle = rgba(c.map((v) => Math.min(255, v + 40 * b)), 1); g.beginPath(); g.ellipse(x, y, 2.6, 3.4, 0, 0, TAU); g.fill();
      }
      g.globalCompositeOperation = dark ? "lighter" : "source-over"; fxRun(S, dt); g.globalCompositeOperation = "source-over";
    },
    tap(S, x, y) { for (let i = 0; i < 26; i++) { const a = R(0, TAU), sp = R(150, 420); S.pc.push(this.piece(S, {}, false, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, tmp: 1 })); } ring(S, x, y, [236, 72, 153], 50); },
    poke(S) { this.cannon(S, 0); this.cannon(S, 1); },
  };

  /* ---------- Beach sunset (new) ---------- */
  const cloudSpr = (i) => sprite(`cl${i}`, 240, 90, (g, w, h) => {
    const rnd = seeded(40 + i);
    g.beginPath(); for (let k = 0; k < 14; k++) { const x = 30 + rnd() * 180, y = 40 + rnd() * 28 - Math.sin(((x - 30) / 180) * Math.PI) * 20, r = 12 + rnd() * 20; g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
    const gr = g.createLinearGradient(0, 10, 0, h); gr.addColorStop(0, "rgba(255,190,170,.9)"); gr.addColorStop(0.6, "rgba(200,100,140,.85)"); gr.addColorStop(1, "rgba(120,50,120,.8)"); g.fillStyle = gr; g.fill();
  });
  SCENES.beach = {
    resize(S) {
      const { w, h } = S, rnd = seeded(31); S.hz = h * 0.68; S.sandY = h * 0.86;
      S.sun = [w * 0.5, S.hz, Math.min(w, h) * 0.11];
      S.bg = layer(S, (g) => {
        vgrad(g, w, [[0, "#1b1042"], [0.35, "#5b2a86"], [0.65, "#c2477a"], [0.85, "#f47c5c"], [1, "#ffc27a"]], 0, S.hz);
        const [sx, sy, sr] = S.sun;
        g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.6; g.drawImage(glow([255, 160, 90], 0, 128), sx - sr * 5, sy - sr * 5, sr * 10, sr * 10); g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
        const sg = g.createLinearGradient(0, sy - sr, 0, sy); sg.addColorStop(0, "#fff6d5"); sg.addColorStop(1, "#ffa74f"); g.fillStyle = sg; g.beginPath(); g.arc(sx, sy, sr, Math.PI, TAU); g.fill();
        g.fillStyle = "rgba(193,71,122,.5)"; for (let k = 1; k < 4; k++) g.fillRect(sx - sr, sy - sr * 0.12 * k * k * 0.5 - 2, sr * 2, 1.5 + k * 0.5);
        vgrad(g, w, [[0, "#f39a6b"], [0.06, "#a24a78"], [0.5, "#4b2670"], [1, "#2a1650"]], S.hz, S.sandY + 2);
        g.fillStyle = "#3a1a4f"; g.beginPath(); g.moveTo(w * 0.02, S.hz); g.quadraticCurveTo(w * 0.1, S.hz - h * 0.035, w * 0.2, S.hz - h * 0.01); g.lineTo(w * 0.26, S.hz); g.closePath(); g.fill();
        const sand = g.createLinearGradient(0, S.sandY, 0, h); sand.addColorStop(0, "#e6a07a"); sand.addColorStop(1, "#a85e58");
        S.shore = ridge(g, w, h, S.sandY + 4, h * 0.02, sand, rnd, { rough: 0.5 });
        g.fillStyle = "rgba(90,30,60,.18)"; g.fillRect(0, S.sandY + 2, w, h * 0.05);
        for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(120,50,60,${0.15 + rnd() * 0.2})`; g.fillRect(rnd() * w, S.sandY + h * 0.06 + rnd() * h * 0.08, 1.5, 1.5); }
      });
      S.palm = layer(S, (g) => {
        const bx = w * 0.06, by = h + 4, tx = w * 0.2, ty = h * 0.5;
        g.strokeStyle = "#1c0f2a"; g.lineCap = "round";
        for (let i = 0; i < 16; i++) { const f = i / 16, f2 = (i + 1) / 16, x1 = bx + (tx - bx) * f + Math.sin(f * 3) * 18, y1 = by + (ty - by) * f, x2 = bx + (tx - bx) * f2 + Math.sin(f2 * 3) * 18, y2 = by + (ty - by) * f2; g.lineWidth = 14 - f * 7; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.lineWidth = 1; g.strokeStyle = "rgba(60,30,60,.7)"; g.beginPath(); g.moveTo(x1 - 6 + f * 3, y1); g.lineTo(x1 + 6 - f * 3, y1 - 2); g.stroke(); g.strokeStyle = "#1c0f2a"; }
        const fx = tx + Math.sin(3) * 18;
        for (const a of [-2.9, -2.4, -1.9, -1.2, -0.6, -0.1, 0.4]) {
          const L = 70 + Math.abs(a + 1.4) * 14, ex = fx + Math.cos(a) * L, ey = ty + Math.sin(a) * L * 0.5 + L * 0.35, mx = fx + Math.cos(a) * L * 0.5, my = ty + Math.sin(a) * L * 0.5 - 12;
          g.lineWidth = 3; g.beginPath(); g.moveTo(fx, ty); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
          g.lineWidth = 2; for (let k = 1; k < 12; k++) { const u = k / 12, px = (1 - u) * (1 - u) * fx + 2 * (1 - u) * u * mx + u * u * ex, py = (1 - u) * (1 - u) * ty + 2 * (1 - u) * u * my + u * u * ey, ll = 16 * (1 - u * 0.6); g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a + 1.2) * ll * 0.5, py + ll); g.moveTo(px, py); g.lineTo(px + Math.cos(a - 1.2) * ll * 0.5, py + ll * 0.8); g.stroke(); }
        }
        g.fillStyle = "#1c0f2a"; for (const [dx, dy] of [[-4, 6], [5, 8], [0, 12]]) { g.beginPath(); g.arc(fx + dx, ty + dy, 5, 0, TAU); g.fill(); }
      });
    },
    init(S) {
      S.clouds = Array.from({ length: 4 }, (_, i) => ({ i, x: R(-0.2, 1) * S.w, y: R(0.08, 0.45) * S.hz, s: R(0.6, 1.2), sp: R(3, 7) }));
      S.birds = Array.from({ length: 4 }, () => ({ x: R(0, S.w), y: R(0.15, 0.5) * S.hz, s: R(5, 9), sp: R(14, 26), ph: R(0, TAU) }));
      S.glit = Array.from({ length: 12 }, () => ({ u: Math.random(), v: Math.random(), ph: R(0, TAU), sp: R(1, 2.5) }));
    },
    frame(S, dt) {
      const { ctx: g, w, h, t } = S, [sx, , sr] = S.sun;
      g.drawImage(S.bg, 0, 0, w, h);
      for (const c of S.clouds) { c.x += c.sp * dt; if (c.x > w + 40) c.x = -240 * c.s - 20; g.globalAlpha = 0.7; g.drawImage(cloudSpr(c.i), c.x, c.y, 240 * c.s, 90 * c.s); }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "lighter";
      const seaH = S.sandY - S.hz;
      for (let i = 0; i < 40; i++) { const f = i / 40, y = S.hz + 2 + f ** 1.3 * seaH, mw = sr * 1.4 * (1 + f * 1.6), ww = mw * (0.25 + 0.75 * Math.abs(Math.sin(t * 2.2 + i * 1.7))); g.fillStyle = `rgba(255,205,140,${0.5 * (1 - f * 0.8)})`; g.fillRect(sx - ww / 2 + Math.sin(t + i) * 6, y, ww, 1.6); }
      for (const p of S.glit) { const a = Math.max(0, Math.sin(t * p.sp + p.ph)) ** 8; if (a < 0.03) continue; const y = S.hz + 4 + p.v * seaH * 0.7, x = sx + (p.u - 0.5) * sr * 3 * (1 + p.v); g.globalAlpha = a; g.drawImage(sparkle([255, 220, 160]), x - 7, y - 7, 14, 14); }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      g.lineWidth = 1;
      for (let k = 0; k < 10; k++) { const f = (k + 1) / 11, y = S.hz + f ** 1.6 * seaH; g.strokeStyle = `rgba(255,190,170,${0.07 + f * 0.07})`; g.beginPath(); for (let x = 0; x <= w + 10; x += 10) { const yy = y + Math.sin(x * 0.03 * (1.4 - f) + t * (0.6 + f) + k) * (0.6 + f * 2); x ? g.lineTo(x, yy) : g.moveTo(x, yy); } g.stroke(); }
      // the wave washes up the sand and slides back
      const reach = 0.5 + 0.5 * Math.sin(t * 0.55), ey = (x) => S.shore(x) + 2 + h * 0.055 * reach + Math.sin(x * 0.04 + t * 0.8) * 3 + Math.sin(x * 0.11 - t) * 1.5;
      g.beginPath(); g.moveTo(0, S.sandY - 2); for (let x = 0; x <= w + 8; x += 8) g.lineTo(x, ey(x)); g.lineTo(w, S.sandY - 2); g.closePath(); g.fillStyle = "rgba(150,80,140,.5)"; g.fill();
      g.beginPath(); for (let x = 0; x <= w + 8; x += 8) x ? g.lineTo(x, ey(x)) : g.moveTo(x, ey(x)); g.strokeStyle = `rgba(255,240,235,${0.45 + 0.3 * reach})`; g.lineWidth = 2.2; g.stroke();
      g.fillStyle = "rgba(255,240,235,.5)"; for (let x = 4; x < w; x += 13) { const y = ey(x) - 2 - ((x * 7) % 5); g.fillRect(x + Math.sin(t + x) * 2, y, 1.6, 1.6); }
      g.strokeStyle = "#2a1236"; g.lineWidth = 1.6; g.lineCap = "round";
      for (const b of S.birds) { b.x += b.sp * dt; if (b.x > w + 30) { b.x = -30; b.y = R(0.15, 0.5) * S.hz; } const y = b.y + Math.sin(t * 0.8 + b.ph) * 4, f = Math.sin(t * 7 + b.ph); g.beginPath(); g.moveTo(b.x - b.s, y - f * b.s * 0.55); g.quadraticCurveTo(b.x - b.s * 0.45, y - b.s * 0.25, b.x, y); g.quadraticCurveTo(b.x + b.s * 0.45, y - b.s * 0.25, b.x + b.s, y - f * b.s * 0.55); g.stroke(); }
      g.save(); g.translate(w * 0.06, h); g.rotate(Math.sin(t * 0.8) * 0.012); g.translate(-w * 0.06, -h); g.drawImage(S.palm, 0, 0, w, h); g.restore();
      g.globalCompositeOperation = "lighter"; fxRun(S, dt); g.globalCompositeOperation = "source-over";
    },
    tap(S, x, y) { burst(S, x, y, 16, [[255, 220, 150], [255, 170, 120]], 40, 150, { g: 30 }); ring(S, x, y, [255, 210, 160], 44); },
    poke(S) { for (let i = 0; i < 3; i++) S.birds.push({ x: -30 - i * 18, y: R(0.2, 0.45) * S.hz, s: R(5, 8), sp: R(30, 40), ph: R(0, TAU) }); if (S.birds.length > 10) S.birds.splice(0, S.birds.length - 10); },
  };

  /* ---------- Hyperspace (new) ---------- */
  SCENES.warp = {
    resize(S) {
      const { w, h } = S;
      S.bg = layer(S, (g) => {
        g.fillStyle = "#03020a"; g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = "lighter";
        for (const [x, y, c, r] of [[0.5, 0.42, [110, 60, 220], 0.7], [0.3, 0.2, [40, 120, 220], 0.5], [0.75, 0.7, [200, 50, 160], 0.45]]) { const rr = Math.max(w, h) * r, gr = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, rr); gr.addColorStop(0, rgba(c, 0.22)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
      });
    },
    init(S) {
      S.pts = Array.from({ length: Math.round(220 * S.q) }, () => this.pt({}, true));
      S.boost = 0; S.nextJump = R(5, 9);
    },
    pt(p, any) { return Object.assign(p, { x: R(-1, 1), y: R(-1, 1), z: any ? R(0.05, 1) : 1, c: Math.random() < 0.7 ? 0 : Math.random() < 0.5 ? 1 : 2 }); },
    frame(S, dt) {
      const { ctx: g, w, h, t } = S;
      g.drawImage(S.bg, 0, 0, w, h);
      if ((S.nextJump -= dt) <= 0) { S.nextJump = R(9, 15); S.boost = 1; }
      S.boost = Math.max(0, S.boost - dt * 0.32);
      const sp = 0.1 + 1.2 * S.boost * S.boost, cx = w / 2 + Math.sin(t * 0.2) * w * 0.05, cy = h * 0.42 + Math.cos(t * 0.17) * h * 0.04, f = Math.min(w, h) * 0.5;
      g.globalCompositeOperation = "lighter";
      const G = Math.min(w, h) * (0.5 + S.boost * 0.6); g.globalAlpha = 0.25 + S.boost * 0.45; g.drawImage(glow([150, 110, 255], 0, 128), cx - G, cy - G, G * 2, G * 2); g.globalAlpha = 1;
      const COLS = ["rgba(235,240,255,", "rgba(150,190,255,", "rgba(220,150,255,"], paths = Array.from({ length: 9 }, () => new Path2D());
      for (const p of S.pts) {
        p.z -= sp * dt * 0.6 + dt * 0.04;
        const x = cx + (p.x / p.z) * f, y = cy + (p.y / p.z) * f;
        if (p.z < 0.03 || x < -50 || x > w + 50 || y < -50 || y > h + 50) { this.pt(p); continue; }
        const tz = p.z + 0.01 + sp * 0.06, tx = cx + (p.x / tz) * f, ty = cy + (p.y / tz) * f, bucket = p.c * 3 + Math.min(2, ((1 - p.z) * 3) | 0);
        paths[bucket].moveTo(tx, ty); paths[bucket].lineTo(x, y);
      }
      g.lineCap = "round";
      paths.forEach((P, i) => { const lvl = i % 3; g.strokeStyle = COLS[(i / 3) | 0] + (0.25 + lvl * 0.35) + ")"; g.lineWidth = 0.7 + lvl * 0.8; g.stroke(P); });
      if (S.boost > 0.9) { g.fillStyle = `rgba(200,190,255,${(S.boost - 0.9) * 2.5})`; g.fillRect(0, 0, w, h); }
      fxRun(S, dt); g.globalCompositeOperation = "source-over";
    },
    tap(S, x, y) { S.boost = 1; ring(S, x, y, [170, 150, 255], 60); },
    poke(S) { S.boost = Math.max(S.boost, 0.7); },
  };

  /* ---------------- engine ---------------- */
  const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LOW = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 3;
  const SKIP = ".bubble, button, a, input, textarea, select, img, video, audio, label, [contenteditable], .reactions-row, .poll-card, .link-card, .composer, .chat-composer, .msg-actions";

  function mount(wrap, theme) {
    const sc = SCENES[theme]; if (!sc) return null;
    const el = document.createElement("div");
    el.className = `chat-motion cm-${theme} cm-canvas`; el.dataset.kind = theme; el.setAttribute("aria-hidden", "true");
    const cv = document.createElement("canvas"); el.appendChild(cv);
    const ctx = cv.getContext("2d", { alpha: false });
    const S = { ctx, cv, w: 0, h: 0, dpr: 1, t: 0, q: LOW ? 0.7 : 1, fx: [], dark: false, half: false };
    S.tf = (a, b, c, d, e, f) => ctx.setTransform(a * S.dpr, b * S.dpr, c * S.dpr, d * S.dpr, e * S.dpr, f * S.dpr);
    S.reset = () => ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    let raf = 0, last = 0, frames = 0, slow = 0, alive = true, ready = false, seen = false, rt = 0;

    const size = (force) => {
      const r = el.getBoundingClientRect(), w = Math.round(r.width), h = Math.round(r.height);
      if (!w || !h) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, S.q < 0.8 ? 1.25 : 1.75), dark = document.documentElement.dataset.theme === "dark";
      if (!force && ready && w === S.w && h === S.h && dpr === S.dpr && dark === S.dark) return true;
      const darkChanged = ready && dark !== S.dark;
      Object.assign(S, { w, h, dpr, dark });
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); S.reset();
      try { sc.resize?.(S); if (!ready || force === "init" || darkChanged) sc.init?.(S); } catch (e) { console.warn("livebg", e); }
      ready = true; return true;
    };
    const draw = (dt) => { ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; S.reset(); try { sc.frame(S, dt); } catch (e) { console.warn("livebg", e); alive = false; } };
    const loop = (now) => {
      if (!alive) return;
      if (!el.isConnected) { if (seen) return destroy(); raf = requestAnimationFrame(loop); return; }
      seen = true;
      if (!ready && !size()) { raf = requestAnimationFrame(loop); return; }
      if (REDUCE) { S.t = 6; draw(1 / 60); return; }
      raf = requestAnimationFrame(loop);
      if (document.hidden || document.documentElement.hasAttribute("data-tp-still") || document.documentElement.hasAttribute("data-cp-wp")) { last = 0; return; }
      let dt = last ? (now - last) / 1000 : 1 / 60;
      if (S.half && dt < 1 / 40) return;
      last = now; dt = Math.min(dt, 0.05); S.t += dt;
      draw(dt);
      if (!S.half && ++frames >= 90) { if (slow > 50) { if (S.q > 0.55) { S.q = Math.max(0.5, S.q - 0.2); size("init"); } else S.half = true; } frames = slow = 0; }
      if (dt > 0.028) slow++;
    };
    const kick = () => { clearTimeout(rt); rt = setTimeout(() => { if (alive && el.isConnected && size()) { if (REDUCE) draw(1 / 60); } }, 120); };
    const ro = "ResizeObserver" in window ? new ResizeObserver(kick) : null; ro?.observe(el);
    const mo = new MutationObserver(kick); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const onClick = (e) => { if (!ready || REDUCE || !sc.tap || e.target.closest?.(SKIP)) return; const r = el.getBoundingClientRect(); sc.tap(S, e.clientX - r.left, e.clientY - r.top); };
    const onSent = () => { if (ready && !REDUCE) sc.poke?.(S); };
    wrap.addEventListener("click", onClick); addEventListener("tea:sent", onSent);
    function destroy() { alive = false; cancelAnimationFrame(raf); ro?.disconnect(); mo.disconnect(); wrap.removeEventListener("click", onClick); removeEventListener("tea:sent", onSent); }
    raf = requestAnimationFrame(loop);
    // paint the first frame as soon as the layer is in the page, so it never flashes empty
    setTimeout(() => { if (alive && el.isConnected && !ready && size()) { seen = true; draw(0); } }, 0);
    return el;
  }

  window.LiveBG = { mount, has: (k) => !!SCENES[k], list: Object.keys(SCENES) };
})();
