// Illustrated backgrounds for the still (non-animated) chat themes.
// Each scene is drawn as one inline SVG (400x800 canvas, sliced to fit the screen): busy at the
// top and bottom edges, calm in the middle where the messages are. Light themes get a night version.
const ThemeArt = (() => {
  const W = 400, H = 800;
  let uid = 0;

  function rng(seed) {
    let h = 2166136261;
    for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  }
  const f = (n) => Math.round(n * 10) / 10;
  const range = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join("");

  /* ---------- shared pieces ---------- */
  function stars(r, n, color, y0 = 0, y1 = H, big = 0.08) {
    return range(n, () => {
      const x = f(r() * W), y = f(y0 + r() * (y1 - y0)), s = r();
      if (s < big) { const k = f(2 + r() * 3); return `<path d="M${x} ${f(y - k)}Q${x} ${y} ${f(x + k)} ${y}Q${x} ${y} ${x} ${f(y + k)}Q${x} ${y} ${f(x - k)} ${y}Q${x} ${y} ${x} ${f(y - k)}Z" fill="${color}" opacity="${f(0.6 + r() * 0.4)}"/>`; }
      return `<circle cx="${x}" cy="${y}" r="${f(0.4 + s * 1.2)}" fill="${color}" opacity="${f(0.25 + r() * 0.7)}"/>`;
    });
  }
  function ridge(r, y, amp, seg, fill, jag = 0.5) {
    let d = `M0 ${H} L0 ${y}`;
    const n = seg;
    for (let i = 1; i <= n; i++) {
      const x = (W / n) * i, yy = y - amp * (0.3 + r() * 0.7) * (i % 2 ? 1 : jag);
      d += ` L${f(x - W / n / 2)} ${f(yy)} L${f(x)} ${f(y - r() * amp * 0.25)}`;
    }
    return `<path d="${d} L${W} ${H} Z" fill="${fill}"/>`;
  }
  function hills(r, y, amp, fill, waves = 3) {
    let d = `M0 ${H} L0 ${y}`;
    const n = waves * 2;
    for (let i = 0; i < n; i++) {
      const x1 = (W / n) * (i + 0.5), x2 = (W / n) * (i + 1);
      d += ` Q${f(x1)} ${f(y - (i % 2 ? -amp * 0.4 : amp) * (0.6 + r() * 0.4))} ${f(x2)} ${f(y + (r() - 0.5) * amp * 0.3)}`;
    }
    return `<path d="${d} L${W} ${H} Z" fill="${fill}"/>`;
  }
  function pine(x, y, h, fill) {
    const w = h * 0.42;
    let d = `M${f(x)} ${f(y - h)}`;
    for (let k = 0; k < 4; k++) {
      const yy = y - h + (h * 0.85) * ((k + 1) / 4), ww = w * (0.35 + 0.65 * ((k + 1) / 4));
      d += ` L${f(x + ww / 2)} ${f(yy)} L${f(x + ww / 5)} ${f(yy - h * 0.06)}`;
    }
    d += ` L${f(x + w * 0.06)} ${f(y - h * 0.1)} L${f(x + w * 0.06)} ${f(y)} L${f(x - w * 0.06)} ${f(y)} L${f(x - w * 0.06)} ${f(y - h * 0.1)}`;
    for (let k = 3; k >= 0; k--) {
      const yy = y - h + (h * 0.85) * ((k + 1) / 4), ww = w * (0.35 + 0.65 * ((k + 1) / 4));
      d += ` L${f(x - ww / 5)} ${f(yy - h * 0.06)} L${f(x - ww / 2)} ${f(yy)}`;
    }
    return `<path d="${d}Z" fill="${fill}"/>`;
  }
  const bird = (x, y, s, c) => `<path d="M${f(x - s)} ${f(y - s * 0.3)}Q${f(x - s * 0.45)} ${f(y - s * 0.55)} ${x} ${y}Q${f(x + s * 0.45)} ${f(y - s * 0.55)} ${f(x + s)} ${f(y - s * 0.3)}" fill="none" stroke="${c}" stroke-width="${f(Math.max(0.8, s * 0.14))}" stroke-linecap="round"/>`;
  const cloud = (x, y, s, c, o = 1) => `<g fill="${c}" opacity="${o}"><ellipse cx="${x}" cy="${y}" rx="${f(s * 1.6)}" ry="${f(s * 0.45)}"/><circle cx="${f(x - s * 0.55)}" cy="${f(y - s * 0.25)}" r="${f(s * 0.5)}"/><circle cx="${f(x + s * 0.25)}" cy="${f(y - s * 0.42)}" r="${f(s * 0.68)}"/><circle cx="${f(x + s * 0.95)}" cy="${f(y - s * 0.12)}" r="${f(s * 0.4)}"/></g>`;

  /* ---------- scenes ---------- */
  const SCENES = {
    midnight(r, id) {
      const sky = `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1026"/><stop offset=".55" stop-color="#1e1b4b"/><stop offset="1" stop-color="#312e81"/></linearGradient>
        <radialGradient id="${id}m" cx=".5" cy=".5" r=".5"><stop offset=".45" stop-color="#fef9c3" stop-opacity=".45"/><stop offset="1" stop-color="#fef9c3" stop-opacity="0"/></radialGradient>`;
      let city = "";
      const layer = (base, hmin, hmax, col, win, dens) => {
        let x = -10, out = "";
        while (x < W + 10) {
          const w = 18 + r() * 34, h = hmin + r() * (hmax - hmin);
          out += `<rect x="${f(x)}" y="${f(base - h)}" width="${f(w)}" height="${f(h + 40)}" fill="${col}"/>`;
          if (r() < 0.35) out += `<rect x="${f(x + w / 2 - 1)}" y="${f(base - h - 14)}" width="2" height="14" fill="${col}"/><circle cx="${f(x + w / 2)}" cy="${f(base - h - 15)}" r="1.6" fill="#f87171"/>`;
          if (win) for (let yy = base - h + 6; yy < base - 6; yy += 9) for (let xx = x + 4; xx < x + w - 5; xx += 7) if (r() < dens) out += `<rect x="${f(xx)}" y="${f(yy)}" width="3" height="4" fill="${r() < 0.85 ? "#fde68a" : "#93c5fd"}" opacity="${f(0.45 + r() * 0.5)}"/>`;
          x += w + 1 + r() * 5;
        }
        return out;
      };
      city += layer(H - 70, 60, 150, "#1b1846", false, 0);
      city += layer(H - 30, 40, 120, "#121036", true, 0.32);
      city += layer(H + 6, 20, 70, "#0a0920", true, 0.22);
      return `<defs>${sky}</defs><rect width="${W}" height="${H}" fill="url(#${id}s)"/>
        ${stars(r, 150, "#e0e7ff", 0, H - 160, 0.07)}
        <circle cx="300" cy="120" r="90" fill="url(#${id}m)"/>
        <circle cx="300" cy="120" r="38" fill="#fef3c7"/><circle cx="316" cy="108" r="34" fill="#1a1a48"/>
        <circle cx="282" cy="132" r="4" fill="#fde68a" opacity=".6"/><circle cx="290" cy="146" r="2.5" fill="#fde68a" opacity=".5"/><circle cx="276" cy="116" r="2" fill="#fde68a" opacity=".5"/>
        ${cloud(90, 200, 30, "#c7d2fe", 0.08)}${cloud(330, 260, 22, "#c7d2fe", 0.06)}
        <path d="M30 70l150 60" stroke="#fff" stroke-width="1" opacity=".35" stroke-linecap="round"/>
        ${city}`;
    },

    ocean(r, id, dark) {
      const c = dark ? { s1: "#020c1b", s2: "#082f49", sun: "#e0f2fe", w: ["#0c4a6e", "#075985", "#0369a1", "#0e7490", "#155e75"], sand: "#1e293b", fish: "#38bdf8" }
                     : { s1: "#e0f2fe", s2: "#bae6fd", sun: "#fef08a", w: ["#7dd3fc", "#38bdf8", "#0ea5e9", "#0284c7", "#0369a1"], sand: "#fde68a", fish: "#0369a1" };
      const wave = (y, amp, col, o) => {
        let d = `M0 ${y}`;
        for (let x = 0; x <= W; x += 50) d += ` q12.5 ${-amp} 25 0 t25 0`;
        return `<path d="${d} V${H} H0Z" fill="${col}" opacity="${o}"/>`;
      };
      const rays = range(9, (i) => `<path d="M330 70 L${f(330 + Math.cos((i / 8) * Math.PI) * 400)} ${f(70 + Math.sin((i / 8) * Math.PI) * 400)}" stroke="${c.sun}" stroke-width="${f(10 + r() * 16)}" opacity="${dark ? 0.025 : 0.08}"/>`);
      const bubbles = range(26, () => { const x = f(r() * W), y = f(440 + r() * 300), rr = f(1.5 + r() * 5); return `<circle cx="${x}" cy="${y}" r="${rr}" fill="none" stroke="#fff" stroke-width=".9" opacity="${f(0.25 + r() * 0.4)}"/><circle cx="${f(x - rr / 3)}" cy="${f(y - rr / 3)}" r="${f(rr / 4)}" fill="#fff" opacity=".5"/>`; });
      const fish = range(7, () => { const x = r() * W, y = 470 + r() * 220, s = 6 + r() * 9, dir = r() < 0.5 ? 1 : -1; return `<g transform="translate(${f(x)} ${f(y)}) scale(${dir} 1)" fill="${c.fish}" opacity=".55"><ellipse rx="${f(s)}" ry="${f(s * 0.45)}"/><path d="M${f(-s * 0.9)} 0 l${f(-s * 0.7)} ${f(-s * 0.5)} v${f(s)}z"/><circle cx="${f(s * 0.5)}" cy="${f(-s * 0.1)}" r="${f(s * 0.1)}" fill="#fff"/></g>`; });
      const weed = range(14, () => { const x = r() * W, h = 40 + r() * 90; let d = `M${f(x)} ${H}`; for (let k = 1; k <= 5; k++) d += ` Q${f(x + (k % 2 ? 12 : -12))} ${f(H - (h * (k - 0.5)) / 5)} ${f(x + (r() - 0.5) * 6)} ${f(H - (h * k) / 5)}`; return `<path d="${d}" fill="none" stroke="${dark ? "#065f46" : "#059669"}" stroke-width="${f(2 + r() * 2.5)}" stroke-linecap="round" opacity=".55"/>`; });
      const shells = range(8, () => { const x = f(r() * W), y = f(H - 8 - r() * 14); return `<path d="M${x} ${y} a7 7 0 0 1 14 0 z" fill="${dark ? "#475569" : "#fda4af"}" opacity=".7"/>`; });
      return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.s1}"/><stop offset=".5" stop-color="${c.s2}"/><stop offset="1" stop-color="${c.w[4]}"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#${id}s)"/>${rays}
        <circle cx="330" cy="70" r="34" fill="${c.sun}" opacity="${dark ? 0.85 : 1}"/>${dark ? stars(r, 60, "#e0f2fe", 0, 200) : ""}
        ${bird(80, 90, 10, dark ? "#94a3b8" : "#0c4a6e")}${bird(110, 110, 7, dark ? "#94a3b8" : "#0c4a6e")}${bird(150, 80, 5, dark ? "#94a3b8" : "#0c4a6e")}
        ${cloud(110, 160, 26, "#fff", dark ? 0.06 : 0.7)}${cloud(260, 210, 18, "#fff", dark ? 0.05 : 0.6)}
        ${wave(330, 8, c.w[0], 0.5)}${wave(360, 10, c.w[1], 0.45)}${wave(400, 9, c.w[2], 0.4)}${wave(440, 12, c.w[3], 0.45)}
        ${fish}${bubbles}<path d="M0 ${H - 22} Q100 ${H - 36} 200 ${H - 24} T${W} ${H - 26} V${H} H0Z" fill="${c.sand}" opacity=".8"/>${weed}${shells}`;
    },

    sunset(r, id, dark) {
      const c = dark ? { a: "#1a0b2e", b: "#4c0519", sun1: "#f97316", sun2: "#be123c", m: ["#3b0a2a", "#2a0820", "#1c0516", "#10030c"] }
                     : { a: "#fde68a", b: "#fb7185", sun1: "#fde047", sun2: "#f97316", m: ["#f9a8d4", "#f472b6", "#be185d", "#831843"] };
      const stripes = range(7, (i) => `<rect x="120" y="${f(250 + i * 14 + i * i * 0.8)}" width="160" height="${f(2 + i * 1.1)}" fill="${dark ? c.a : "#fff7ed"}"/>`);
      return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset=".55" stop-color="${c.b}"/><stop offset="1" stop-color="${c.m[3]}"/></linearGradient>
          <linearGradient id="${id}u" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.sun1}"/><stop offset="1" stop-color="${c.sun2}"/></linearGradient>
          <clipPath id="${id}c"><circle cx="200" cy="300" r="80"/></clipPath></defs>
        <rect width="${W}" height="${H}" fill="url(#${id}s)"/>${dark ? stars(r, 80, "#fecdd3", 0, 260) : ""}
        <circle cx="200" cy="300" r="120" fill="${c.sun1}" opacity=".18"/><g clip-path="url(#${id}c)"><rect x="100" y="200" width="200" height="200" fill="url(#${id}u)"/>${stripes}</g>
        ${cloud(70, 150, 22, "#fff", dark ? 0.05 : 0.45)}${cloud(320, 120, 30, "#fff", dark ? 0.05 : 0.4)}${cloud(300, 380, 16, "#fff", dark ? 0.04 : 0.3)}
        ${range(6, (i) => bird(60 + i * 22 + r() * 10, 210 + (i % 3) * 9 + r() * 6, 5 + r() * 4, dark ? "#fda4af" : "#831843"))}
        ${ridge(r, 470, 110, 6, c.m[0], 0.6)}${ridge(r, 540, 90, 7, c.m[1], 0.5)}${ridge(r, 620, 70, 9, c.m[2], 0.4)}
        <rect y="680" width="${W}" height="120" fill="${c.m[3]}"/>
        ${range(14, (i) => `<rect x="${f(130 + r() * 140 - i * 2)}" y="${f(690 + i * 7)}" width="${f(40 + r() * 70 - i * 2)}" height="2" rx="1" fill="${c.sun1}" opacity="${f(0.5 - i * 0.03)}"/>`)}`;
    },

    lavender(r, id, dark) {
      const c = dark ? { a: "#140b26", b: "#2e1065", h: ["#3b1f6e", "#2e1659", "#211044"], fl: "#a78bfa", st: "#4c1d95" }
                     : { a: "#faf5ff", b: "#ede9fe", h: ["#ddd6fe", "#c4b5fd", "#a78bfa"], fl: "#7c3aed", st: "#65a30d" };
      let rows = "";
      for (let i = 0; i < 16; i++) {
        const t = i / 15, x0 = -150 + t * 700;
        rows += `<path d="M200 540 L${f(x0)} ${H}" stroke="${c.fl}" stroke-width="${f(2 + t * 0 + 7 * Math.abs(t - 0.5))}" stroke-dasharray="2 ${f(3 + r() * 2)}" stroke-linecap="round" opacity=".55"/>`;
      }
      const flowers = range(90, () => { const y = 560 + Math.pow(r(), 0.7) * 240, x = r() * W, s = 1 + (y - 540) / 90; return `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x)}" y2="${f(y + s * 5)}" stroke="${c.st}" stroke-width="${f(s * 0.5)}" opacity=".6"/>${range(3, (k) => `<ellipse cx="${f(x)}" cy="${f(y - k * s * 1.6)}" rx="${f(s * 0.9)}" ry="${f(s * 0.7)}" fill="${c.fl}" opacity=".75"/>`)}`; });
      const butter = (x, y, s, col) => `<g transform="translate(${x} ${y}) rotate(${f(r() * 40 - 20)})" fill="${col}" opacity=".7"><ellipse cx="${-s}" cy="0" rx="${s}" ry="${s * 0.7}"/><ellipse cx="${s}" cy="0" rx="${s}" ry="${s * 0.7}"/><ellipse cx="${-s * 0.7}" cy="${s * 0.9}" rx="${s * 0.6}" ry="${s * 0.45}"/><ellipse cx="${s * 0.7}" cy="${s * 0.9}" rx="${s * 0.6}" ry="${s * 0.45}"/><rect x="-.6" y="${-s * 0.6}" width="1.2" height="${s * 1.8}" fill="#3b0764"/></g>`;
      const tree = `<g opacity=".8"><path d="M318 548 q-3 -30 2 -52" stroke="${dark ? "#1e1035" : "#57534e"}" stroke-width="5" fill="none"/>${range(9, () => `<circle cx="${f(320 + (r() - 0.5) * 50)}" cy="${f(486 + (r() - 0.5) * 36)}" r="${f(12 + r() * 10)}" fill="${dark ? "#2a1655" : "#a3e635"}" opacity=".8"/>`)}</g>`;
      return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#${id}s)"/>${dark ? stars(r, 70, "#ede9fe", 0, 420) + `<circle cx="80" cy="110" r="26" fill="#f5f3ff" opacity=".85"/>` : `<circle cx="80" cy="110" r="46" fill="#fde68a" opacity=".35"/><circle cx="80" cy="110" r="26" fill="#fef3c7"/>`}
        ${cloud(260, 120, 24, "#fff", dark ? 0.04 : 0.7)}${cloud(120, 220, 16, "#fff", dark ? 0.04 : 0.55)}
        ${hills(r, 470, 40, c.h[0], 2)}${hills(r, 520, 30, c.h[1], 3)}${tree}${hills(r, 560, 18, c.h[2], 4)}
        <rect y="548" width="${W}" height="252" fill="${c.h[2]}" opacity=".4"/>${rows}${flowers}
        ${butter(110, 400, 5, dark ? "#c4b5fd" : "#f472b6")}${butter(290, 360, 4, dark ? "#a5b4fc" : "#fbbf24")}${butter(60, 300, 3.5, dark ? "#f0abfc" : "#a855f7")}`;
    },

    mint(r, id, dark) {
      const c = dark ? { a: "#011a14", b: "#053b2c", l: ["#065f46", "#047857", "#064e3b"], v: "#34d399" } : { a: "#f0fdf4", b: "#d1fae5", l: ["#6ee7b7", "#34d399", "#10b981"], v: "#ecfdf5" };
      const monstera = (x, y, s, rot, col) => {
        let holes = "";
        for (let k = 0; k < 5; k++) holes += `<ellipse cx="${f(-s * 0.55 + k * s * 0.05)}" cy="${f(-s * 0.55 + k * s * 0.28)}" rx="${f(s * 0.16)}" ry="${f(s * 0.06)}" transform="rotate(-30 ${f(-s * 0.55)} ${f(-s * 0.55 + k * s * 0.28)})" fill="${c.a}"/><ellipse cx="${f(s * 0.55 - k * s * 0.05)}" cy="${f(-s * 0.55 + k * s * 0.28)}" rx="${f(s * 0.16)}" ry="${f(s * 0.06)}" transform="rotate(30 ${f(s * 0.55)} ${f(-s * 0.55 + k * s * 0.28)})" fill="${c.a}"/>`;
        return `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="M0 ${f(s * 0.9)} C${f(-s * 1.1)} ${f(s * 0.6)} ${f(-s * 1.1)} ${f(-s * 0.9)} 0 ${f(-s)} C${f(s * 1.1)} ${f(-s * 0.9)} ${f(s * 1.1)} ${f(s * 0.6)} 0 ${f(s * 0.9)}Z" fill="${col}"/>${holes}<path d="M0 ${f(s * 0.9)} V${f(-s * 0.95)}" stroke="${c.v}" stroke-width="${f(s * 0.03)}" opacity=".7"/>${range(6, (k) => `<path d="M0 ${f(-s * 0.7 + k * s * 0.27)} q${f(-s * 0.4)} ${f(-s * 0.08)} ${f(-s * 0.75)} ${f(-s * 0.2)} M0 ${f(-s * 0.7 + k * s * 0.27)} q${f(s * 0.4)} ${f(-s * 0.08)} ${f(s * 0.75)} ${f(-s * 0.2)}" stroke="${c.v}" stroke-width="${f(s * 0.015)}" fill="none" opacity=".55"/>`)}<path d="M0 ${f(s * 0.9)} q${f(s * 0.1)} ${f(s * 0.5)} ${f(s * 0.05)} ${f(s * 1.2)}" stroke="${col}" stroke-width="${f(s * 0.06)}" fill="none"/></g>`;
      };
      const fern = (x, y, len, rot, col) => `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="M0 0 Q${f(len * 0.1)} ${f(-len * 0.5)} 0 ${-len}" stroke="${col}" stroke-width="2" fill="none"/>${range(14, (k) => { const t = (k + 1) / 15, yy = -len * t, w = len * 0.28 * (1 - t * 0.8); return `<path d="M${f(len * 0.05 * Math.sin(t * 3))} ${f(yy)} q${f(-w / 2)} ${f(-w * 0.2)} ${f(-w)} ${f(-w * 0.55)} q${f(w * 0.6)} ${f(w * 0.05)} ${f(w)} ${f(w * 0.55)}Z M${f(len * 0.05 * Math.sin(t * 3))} ${f(yy)} q${f(w / 2)} ${f(-w * 0.2)} ${f(w)} ${f(-w * 0.55)} q${f(-w * 0.6)} ${f(w * 0.05)} ${f(-w)} ${f(w * 0.55)}Z" fill="${col}"/>`; })}</g>`;
      const dots = range(40, () => `<circle cx="${f(r() * W)}" cy="${f(r() * H)}" r="${f(0.8 + r() * 1.6)}" fill="${c.l[1]}" opacity="${f(0.2 + r() * 0.3)}"/>`);
      return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#${id}s)"/>${dots}
        <g opacity="${dark ? 0.8 : 0.72}">${fern(-10, 300, 260, 55, c.l[0])}${monstera(40, 70, 130, 140, c.l[1])}${monstera(190, -30, 80, 175, c.l[2])}${fern(260, -20, 170, 160, c.l[0])}${monstera(-20, 200, 70, 100, c.l[2])}
        ${fern(420, 560, 260, -65, c.l[0])}${monstera(360, 730, 140, -30, c.l[1])}${monstera(200, 850, 90, -5, c.l[2])}${fern(130, 830, 190, 15, c.l[0])}${monstera(430, 600, 70, -80, c.l[2])}</g>`;
    },

    rose(r, id, dark) {
      const c = dark ? { a: "#2a0414", b: "#4c0519", p: ["#9f1239", "#be123c", "#e11d48"], lf: "#14532d", ln: "#fda4af" } : { a: "#fff1f2", b: "#fce7f3", p: ["#fda4af", "#fb7185", "#f43f5e"], lf: "#86efac", ln: "#be123c" };
      const rose = (x, y, s, rot) => {
        let petals = "";
        for (let k = 5; k >= 1; k--) {
          const rr = s * (k / 5);
          petals += range(5, (j) => { const a = (j / 5) * Math.PI * 2 + k * 0.7; return `<ellipse cx="${f(Math.cos(a) * rr * 0.35)}" cy="${f(Math.sin(a) * rr * 0.35)}" rx="${f(rr * 0.62)}" ry="${f(rr * 0.42)}" transform="rotate(${f((a * 180) / Math.PI)} ${f(Math.cos(a) * rr * 0.35)} ${f(Math.sin(a) * rr * 0.35)})" fill="${c.p[k % 3]}" stroke="${c.ln}" stroke-width=".6" stroke-opacity=".35"/>`; });
        }
        const spiral = `<path d="M0 0 ${range(14, (k) => { const a = k * 0.9, rr = s * 0.04 * k; return `L${f(Math.cos(a) * rr)} ${f(Math.sin(a) * rr)}`; })}" fill="none" stroke="${c.ln}" stroke-width=".8" opacity=".55"/>`;
        const leaves = range(3, (j) => { const a = rot + 110 + j * 55; return `<g transform="rotate(${a})"><path d="M${f(s * 0.8)} 0 q${f(s * 0.5)} ${f(-s * 0.35)} ${f(s * 1.15)} 0 q${f(-s * 0.5)} ${f(s * 0.35)} ${f(-s * 1.15)} 0z" fill="${c.lf}"/><path d="M${f(s * 0.8)} 0 h${f(s * 1.1)}" stroke="${dark ? "#166534" : "#4ade80"}" stroke-width=".8"/></g>`; });
        return `<g transform="translate(${x} ${y}) rotate(${rot})" opacity=".85">${leaves}${petals}${spiral}</g>`;
      };
      const petalsFall = range(22, () => { const x = f(r() * W), y = f(r() * H), s = 3 + r() * 5; return `<path d="M${x} ${y} q${f(s)} ${f(-s)} ${f(s * 2)} 0 q${f(-s)} ${f(s * 1.3)} ${f(-s * 2)} 0z" fill="${c.p[Math.floor(r() * 3)]}" opacity="${f(0.25 + r() * 0.35)}" transform="rotate(${f(r() * 360)} ${x} ${y})"/>`; });
      const vine = `<path d="M-10 160 C60 120 40 60 120 30 S220 -10 260 -20" stroke="${c.lf}" stroke-width="3" fill="none" opacity=".7"/><path d="M410 640 C340 680 360 740 290 770 S180 810 140 830" stroke="${c.lf}" stroke-width="3" fill="none" opacity=".7"/>`;
      return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#${id}s)"/>${petalsFall}${vine}
        ${rose(50, 60, 70, 10)}${rose(170, 18, 44, 70)}${rose(8, 190, 40, -20)}${rose(250, -10, 30, 30)}${rose(110, 150, 22, 50)}${rose(350, 740, 76, 200)}${rose(220, 790, 46, 120)}${rose(400, 610, 42, 40)}${rose(300, 650, 24, 90)}${rose(130, 805, 28, 10)}`;
    },

    aurora(r, id) {
      const band = (y, col1, col2, amp, o) => {
        let d = `M-20 ${y}`;
        for (let x = 0; x <= W + 40; x += 40) d += ` Q${f(x + 20)} ${f(y - amp * (0.4 + r()))} ${x + 40} ${f(y + (r() - 0.5) * amp)}`;
        return `<path d="${d}" stroke="url(#${id}${col1})" stroke-width="${f(60 + r() * 50)}" fill="none" opacity="${o}" filter="url(#${id}b)" stroke-linecap="round"/>`;
      };
      const trees = range(34, (i) => pine(i * 12.5 - 6 + r() * 6, H - 40 + r() * 10, 50 + r() * 70, "#020617"));
      const trees2 = range(22, (i) => pine(i * 19 + r() * 8, H - 90 + r() * 10, 30 + r() * 40, "#0b1730"));
      return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020617"/><stop offset=".6" stop-color="#0c1e3a"/><stop offset="1" stop-color="#0f2a3f"/></linearGradient>
          <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22d3ee"/><stop offset=".5" stop-color="#34d399"/><stop offset="1" stop-color="#a3e635"/></linearGradient>
          <linearGradient id="${id}p" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a855f7"/><stop offset=".6" stop-color="#ec4899"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
          <filter id="${id}b" filterUnits="userSpaceOnUse" x="-100" y="-100" width="600" height="600"><feGaussianBlur stdDeviation="16"/></filter></defs>
        <rect width="${W}" height="${H}" fill="url(#${id}s)"/>${stars(r, 160, "#e0f2fe", 0, H - 160, 0.05)}
        ${band(170, "g", "", 70, 0.55)}${band(250, "p", "", 60, 0.35)}${band(120, "g", "", 40, 0.3)}
        ${range(30, () => { const x = f(r() * W); return `<line x1="${x}" y1="${f(90 + r() * 60)}" x2="${x}" y2="${f(230 + r() * 80)}" stroke="#6ee7b7" stroke-width="${f(1 + r() * 2)}" opacity="${f(0.05 + r() * 0.12)}"/>`; })}
        ${ridge(r, 620, 120, 5, "#1e293b", 0.55)}
        ${ridge(r, 680, 70, 8, "#111c33", 0.5)}${trees2}${trees}<rect y="${H - 34}" width="${W}" height="34" fill="#020617"/>`;
    },

    neon(r, id) {
      let grid = "";
      for (let i = 0; i <= 22; i++) { const x = -400 + i * 54.5; grid += `<line x1="200" y1="560" x2="${f(x)}" y2="${H}" stroke="#d946ef" stroke-width="1.2" opacity=".55"/>`; }
      for (let i = 0; i < 12; i++) { const y = 560 + Math.pow(i / 11, 2.2) * 240; grid += `<line x1="0" y1="${f(y)}" x2="${W}" y2="${f(y)}" stroke="#d946ef" stroke-width="${f(0.6 + i * 0.12)}" opacity="${f(0.25 + i * 0.05)}"/>`; }
      const palm = (x, y, s, flip) => `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})" fill="none" stroke="#22d3ee" stroke-width="1.6" stroke-linecap="round" opacity=".8" filter="url(#${id}g)"><path d="M0 0 C4 -40 2 -80 10 -120"/>${range(6, (k) => { const a = -150 + k * 28; return `<path d="M10 -120 q${f(Math.cos((a * Math.PI) / 180) * 30)} ${f(Math.sin((a * Math.PI) / 180) * 30 - 12)} ${f(Math.cos((a * Math.PI) / 180) * 60)} ${f(Math.sin((a * Math.PI) / 180) * 60 + 18)}"/>`; })}</g>`;
      const mtn = `<path d="M0 560 L60 480 L100 520 L160 430 L200 500 L250 450 L300 520 L350 470 L400 540 L400 560Z" fill="#0b0b12" stroke="#a855f7" stroke-width="1.4" opacity=".9" filter="url(#${id}g)"/>${range(9, (i) => `<path d="M${40 + i * 40} 560 L${f(60 + i * 40 + r() * 10)} ${f(500 + r() * 30)}" stroke="#a855f7" stroke-width=".6" opacity=".35"/>`)}`;
      const sunStripes = range(8, (i) => `<rect x="110" y="${f(430 + i * 13 + i * i * 0.6)}" width="180" height="${f(1.5 + i * 0.9)}" fill="#09090b"/>`);
      return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#09090b"/><stop offset=".55" stop-color="#1e0b2e"/><stop offset=".7" stop-color="#2a0a3a"/><stop offset="1" stop-color="#09090b"/></linearGradient>
          <linearGradient id="${id}u" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde047"/><stop offset=".5" stop-color="#f472b6"/><stop offset="1" stop-color="#a21caf"/></linearGradient>
          <filter id="${id}g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <clipPath id="${id}c"><circle cx="200" cy="470" r="92"/></clipPath></defs>
        <rect width="${W}" height="${H}" fill="url(#${id}s)"/>${stars(r, 110, "#f5d0fe", 0, 420, 0.06)}
        <circle cx="200" cy="470" r="130" fill="#f472b6" opacity=".12"/><g clip-path="url(#${id}c)"><rect x="100" y="370" width="200" height="200" fill="url(#${id}u)"/>${sunStripes}</g>
        ${mtn}<rect y="560" width="${W}" height="240" fill="#0b0414"/>${grid}
        <line x1="0" y1="560" x2="${W}" y2="560" stroke="#f0abfc" stroke-width="1.6" filter="url(#${id}g)"/>
        ${palm(30, 640, 1.1, false)}${palm(375, 620, 0.9, true)}
        <text x="200" y="90" text-anchor="middle" font-family="Bricolage Grotesque, Inter, sans-serif" font-size="26" font-weight="800" letter-spacing="8" fill="none" stroke="#22d3ee" stroke-width="1" opacity=".55" filter="url(#${id}g)">TEAOFRPM</text>`;
    },

    forest(r, id) {
      const layer = (yBase, hmin, hmax, n, col) => range(n, (i) => pine((i / (n - 1)) * (W + 30) - 15 + (r() - 0.5) * 12, yBase + r() * 12, hmin + r() * (hmax - hmin), col));
      const fog = (y, o) => `<rect y="${y}" width="${W}" height="90" fill="url(#${id}f)" opacity="${o}"/>`;
      const glow = range(40, () => `<circle cx="${f(r() * W)}" cy="${f(560 + r() * 230)}" r="${f(0.8 + r() * 1.4)}" fill="#d9f99d" opacity="${f(0.4 + r() * 0.5)}"/>`);
      return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f2a1d"/><stop offset=".5" stop-color="#1f4a32"/><stop offset="1" stop-color="#052e16"/></linearGradient>
          <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d1fae5" stop-opacity="0"/><stop offset=".5" stop-color="#d1fae5" stop-opacity=".22"/><stop offset="1" stop-color="#d1fae5" stop-opacity="0"/></linearGradient>
          <radialGradient id="${id}m"><stop offset=".3" stop-color="#ecfccb" stop-opacity=".5"/><stop offset="1" stop-color="#ecfccb" stop-opacity="0"/></radialGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#${id}s)"/>${stars(r, 70, "#ecfccb", 0, 300, 0.04)}
        <circle cx="290" cy="130" r="80" fill="url(#${id}m)"/><circle cx="290" cy="130" r="30" fill="#f7fee7" opacity=".9"/>
        ${range(4, (i) => bird(80 + i * 26, 190 + (i % 2) * 10, 6, "#052e16"))}
        ${layer(500, 90, 150, 16, "#2d5a3d")}${fog(440, 0.9)}${layer(580, 100, 170, 13, "#1f4630")}${fog(520, 0.8)}
        ${layer(670, 120, 190, 11, "#143322")}${fog(610, 0.6)}${layer(780, 150, 230, 8, "#08200f")}${glow}`;
    },

    candy(r, id, dark) {
      const pal = dark ? ["#f472b6", "#60a5fa", "#34d399", "#fbbf24", "#c084fc"] : ["#f472b6", "#60a5fa", "#4ade80", "#fbbf24", "#c084fc"];
      const pick = () => pal[Math.floor(r() * pal.length)];
      const items = [];
      const lolli = (x, y, s) => { const c1 = pick(); return `<g transform="translate(${x} ${y}) rotate(${f(r() * 60 - 30)})"><rect x="-1.2" y="0" width="2.4" height="${f(s * 2.2)}" rx="1" fill="${dark ? "#e2e8f0" : "#fff"}" stroke="#0001"/><circle r="${s}" fill="${c1}"/><path d="M0 0 ${range(18, (k) => { const a = k * 0.75, rr = (s * k) / 18; return `L${f(Math.cos(a) * rr)} ${f(Math.sin(a) * rr)}`; })}" stroke="#fff" stroke-width="${f(s * 0.18)}" fill="none" opacity=".8"/></g>`; };
      const wrap = (x, y, s) => { const c1 = pick(); return `<g transform="translate(${x} ${y}) rotate(${f(r() * 360)})"><path d="M${-s * 1.7} ${-s * 0.6} L${-s} 0 L${-s * 1.7} ${s * 0.6}Z M${s * 1.7} ${-s * 0.6} L${s} 0 L${s * 1.7} ${s * 0.6}Z" fill="${c1}" opacity=".8"/><ellipse rx="${s * 1.05}" ry="${s * 0.75}" fill="${c1}"/><path d="M${-s * 0.5} ${-s * 0.7} l${s * 0.3} ${s * 1.4} M0 ${-s * 0.75} l${s * 0.3} ${s * 1.5} M${s * 0.5} ${-s * 0.7} l${s * 0.25} ${s * 1.35}" stroke="#fff" stroke-width="${f(s * 0.16)}" opacity=".7"/></g>`; };
      const donut = (x, y, s) => `<g transform="translate(${x} ${y})"><circle r="${s}" fill="${dark ? "#b45309" : "#fcd34d"}"/><path d="M${-s} 0 a${s} ${s} 0 0 1 ${s * 2} 0 q${-s * 0.2} ${s * 0.4} ${-s * 0.5} ${s * 0.2} q${-s * 0.3} ${s * 0.5} ${-s * 0.6} ${s * 0.1} q${-s * 0.4} ${s * 0.3} ${-s * 0.9} ${-s * 0.3}z" fill="${pick()}" transform="rotate(${f(r() * 360)})"/><circle r="${s * 0.35}" fill="${dark ? "#1e1b4b" : "#fdf2f8"}"/>${range(7, () => { const a = r() * Math.PI * 2, rr = s * (0.5 + r() * 0.35); return `<rect x="${f(Math.cos(a) * rr)}" y="${f(Math.sin(a) * rr)}" width="${f(s * 0.22)}" height="${f(s * 0.07)}" rx="1" fill="${pick()}" transform="rotate(${f(r() * 180)} ${f(Math.cos(a) * rr)} ${f(Math.sin(a) * rr)})"/>`; })}</g>`;
      for (let i = 0; i < 34; i++) {
        let y = r() * H; if (y > 250 && y < 560) y = r() < 0.5 ? y * 0.4 : 560 + r() * 240;   // keep the middle calm
        const x = r() * W, s = 9 + r() * 11, k = r();
        items.push(k < 0.33 ? lolli(f(x), f(y), s) : k < 0.66 ? wrap(f(x), f(y), s * 0.8) : donut(f(x), f(y), s));
      }
      const sprinkles = range(110, () => { const x = f(r() * W), y = f(r() * H); return `<rect x="${x}" y="${y}" width="5" height="1.6" rx=".8" fill="${pick()}" opacity="${f(0.4 + r() * 0.4)}" transform="rotate(${f(r() * 180)} ${x} ${y})"/>`; });
      return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${dark ? "#2a0a24" : "#fdf2f8"}"/><stop offset=".5" stop-color="${dark ? "#0f1a3b" : "#eff6ff"}"/><stop offset="1" stop-color="${dark ? "#05261a" : "#f0fdf4"}"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#${id}s)"/>${sprinkles}<g opacity="${dark ? 0.85 : 1}">${items.join("")}</g>`;
    },

    coffee(r, id, dark) {
      const c = dark ? { a: "#140d0a", b: "#2b1d16", bean: "#5b3a29", line: "#2b1d16", cup: "#e7d5c5", saucer: "#d6c2b0", latte: "#c08552", foam: "#f5ebe0" }
                     : { a: "#faf3eb", b: "#ecdcca", bean: "#8b5e3c", line: "#5c3b22", cup: "#fffaf5", saucer: "#f1e4d8", latte: "#a0693f", foam: "#fdf6ec" };
      const bean = (x, y, s, rot) => `<g transform="translate(${x} ${y}) rotate(${rot})"><ellipse rx="${s}" ry="${f(s * 0.68)}" fill="${c.bean}"/><path d="M${-s * 0.85} 0 C${-s * 0.3} ${-s * 0.35} ${s * 0.3} ${s * 0.35} ${s * 0.85} 0" stroke="${c.line}" stroke-width="${f(s * 0.16)}" fill="none"/><ellipse rx="${f(s * 0.7)}" ry="${f(s * 0.35)}" cx="${f(-s * 0.1)}" cy="${f(-s * 0.25)}" fill="#fff" opacity=".12"/></g>`;
      const beans = range(46, () => { let y = r() * H; if (y > 230 && y < 520) y = r() < 0.5 ? y * 0.45 : 540 + r() * 60; return bean(f(r() * W), f(y), f(5 + r() * 6), f(r() * 360)); });
      const cup = `<g transform="translate(270 690)">
          <ellipse cx="0" cy="70" rx="120" ry="24" fill="#000" opacity=".08"/><ellipse cx="0" cy="58" rx="112" ry="26" fill="${c.saucer}" stroke="${c.line}" stroke-opacity=".25"/><ellipse cx="0" cy="54" rx="70" ry="14" fill="#000" opacity=".06"/>
          <path d="M-72 -20 Q-70 50 0 58 Q70 50 72 -20Z" fill="${c.cup}" stroke="${c.line}" stroke-opacity=".3"/>
          <path d="M70 -6 q38 -4 36 22 q-2 26 -42 26" fill="none" stroke="${c.cup}" stroke-width="10"/><path d="M70 -6 q38 -4 36 22 q-2 26 -42 26" fill="none" stroke="${c.line}" stroke-opacity=".25" stroke-width="1"/>
          <ellipse cx="0" cy="-20" rx="72" ry="16" fill="${c.latte}"/><ellipse cx="0" cy="-20" rx="64" ry="12" fill="#6f4426" opacity=".35"/>
          <path d="M0 -28 c-10 -10 -26 -2 -16 8 l16 12 l16 -12 c10 -10 -6 -18 -16 -8z" fill="${c.foam}"/><path d="M-30 -18 q30 10 60 0" stroke="${c.foam}" stroke-width="2" fill="none" opacity=".8"/><path d="M-22 -12 q22 7 44 0" stroke="${c.foam}" stroke-width="1.5" fill="none" opacity=".7"/>
          ${range(3, (k) => `<path d="M${-22 + k * 22} -50 c-12 -18 12 -26 0 -44 s12 -26 0 -44" stroke="${dark ? "#f5ebe0" : "#a0693f"}" stroke-width="2.4" fill="none" opacity="${f(0.22 + k * 0.05)}" stroke-linecap="round"/>`)}</g>`;
      const crois = `<g transform="translate(70 90) rotate(-18)" opacity=".85">${range(5, (k) => `<ellipse cx="${-40 + k * 20}" cy="${Math.abs(k - 2) * 6}" rx="${16 - Math.abs(k - 2) * 3}" ry="${14 - Math.abs(k - 2) * 2}" fill="${dark ? "#a16207" : "#e7b36a"}" stroke="${c.line}" stroke-opacity=".3"/>`)}</g>`;
      return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient>
          <pattern id="${id}p" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".8" fill="${c.line}" opacity=".12"/></pattern></defs>
        <rect width="${W}" height="${H}" fill="url(#${id}s)"/><rect width="${W}" height="${H}" fill="url(#${id}p)"/>${beans}${cup}`;
    },

    mono(r, id, dark) {
      const ink = dark ? "#fafafa" : "#18181b", bg1 = dark ? "#09090b" : "#fafafa", bg2 = dark ? "#18181b" : "#e4e4e7";
      const mid = dark ? "#3f3f46" : "#a1a1aa";
      const dots = range(14, (i) => range(4, (j) => `<circle cx="${30 + i * 26}" cy="${30 + j * 16}" r="1.3" fill="${ink}" opacity=".35"/>`));
      const lines = range(18, (i) => `<line x1="0" y1="${f(640 + i * 9)}" x2="${f(140 + i * 10)}" y2="${f(640 + i * 9)}" stroke="${ink}" stroke-width=".8" opacity="${f(0.1 + (i % 3) * 0.08)}"/>`);
      const rings = range(7, (i) => `<circle cx="330" cy="150" r="${20 + i * 14}" fill="none" stroke="${ink}" stroke-width="${i === 3 ? 2 : 0.7}" opacity="${i === 3 ? 0.5 : 0.18}"/>`);
      return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
          <pattern id="${id}h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${ink}" stroke-width="1" opacity=".35"/></pattern></defs>
        <rect width="${W}" height="${H}" fill="url(#${id}s)"/>${dots}${rings}
        <circle cx="330" cy="150" r="34" fill="${ink}" opacity=".85"/>
        <path d="M40 130 A60 60 0 0 1 160 130Z" fill="url(#${id}h)" opacity=".9"/><rect x="40" y="130" width="120" height="3" fill="${ink}"/>
        <rect x="180" y="40" width="60" height="60" fill="none" stroke="${ink}" stroke-width="1.2" opacity=".4" transform="rotate(12 210 70)"/>
        <line x1="20" y1="230" x2="380" y2="200" stroke="${ink}" stroke-width=".8" opacity=".25"/>
        ${lines}<rect x="250" y="640" width="120" height="120" fill="url(#${id}h)" opacity=".7"/><circle cx="250" cy="640" r="46" fill="${mid}" opacity=".55"/>
        <path d="M300 520 L380 600 L300 600Z" fill="${ink}" opacity=".85"/><circle cx="90" cy="560" r="8" fill="none" stroke="${ink}" stroke-width="1.5" opacity=".5"/>
        <text x="20" y="${H - 18}" font-family="Inter, sans-serif" font-size="9" font-weight="700" letter-spacing="3" fill="${ink}" opacity=".4">NO. 13 — MONO</text>`;
    },

    // Comic-panel collage: an original neon-crime-caper scene (no real game art), with its own layout for wide screens
    // "GTA 6 Vibes": a live comic-panel collage of an original neon beach city.
    // Crisp flat-shaded vector art, every panel animates (SMIL, so it also plays when loaded as an image).
    heist(r, id, dark, wide) {
      const VW = wide ? 1280 : 400, VH = wide ? 720 : 800;
      const lg = (k, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}${k}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient>`;
      const rg = (k, stops, cx = 0.5, cy = 0.5, rr = 0.5) => `<radialGradient id="${id}${k}" cx="${cx}" cy="${cy}" r="${rr}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</radialGradient>`;
      const U = (k) => `url(#${id}${k})`;
      const defs = [
        lg("dusk", [[0, "#1b0a3c"], [0.38, "#5b1a73"], [0.66, "#c2307a"], [0.86, "#ff7a59"], [1, "#ffc46b"]]),
        lg("dusk2", [[0, "#2a0c5c"], [0.5, "#9b2c8f"], [0.8, "#ff6f7d"], [1, "#ffb26b"]]),
        lg("night", [[0, "#07031a"], [0.55, "#1a0b45"], [1, "#3b1466"]]),
        lg("sea", [[0, "#ff8f8f"], [0.12, "#b6407e"], [0.5, "#3a2273"], [1, "#120a33"]]),
        lg("seaDay", [[0, "#5ee7df"], [0.5, "#2a9df4"], [1, "#1a3a8f"]]),
        lg("chrome", [[0, "#fff7d1"], [0.35, "#ffd166"], [0.55, "#f29e1f"], [0.62, "#8a4b00"], [0.8, "#ffcf5c"], [1, "#b86a00"]]),
        lg("glass", [[0, "#bff4ff"], [0.5, "#5aa9e6"], [1, "#1d3b7a"]], 1, 1),
        lg("hull", [[0, "#ffffff"], [0.7, "#e8e9f7"], [1, "#b9bce0"]]),
        lg("pinkG", [[0, "#ffd1e3"], [0.5, "#ff7eb6"], [1, "#e0457b"]]),
        lg("road", [[0, "#170a33"], [1, "#05020f"]]),
        lg("cone", [[0, "#fff8d6", 0.55], [1, "#fff8d6", 0]]),
        lg("trailR", [[0, "#ff2d55", 0], [1, "#ff2d55", 0.9]], 1, 0),
        lg("trailW", [[0, "#fff6c9", 0.9], [1, "#fff6c9", 0]], 1, 0),
        lg("skinA", [[0, "#9a5a32"], [1, "#6e3b1c"]]),
        lg("skinB", [[0, "#d39062"], [1, "#a86a3f"]]),
        lg("shades", [[0, "#ffcf5c"], [0.45, "#ff5e87"], [1, "#2a0c5c"]]),
        rg("sun", [[0, "#fff6c2"], [0.55, "#ffd36e"], [1, "#ff7a59"]]),
        rg("glowS", [[0, "#ffd36e", 0.75], [1, "#ff7a59", 0]]),
        rg("neonP", [[0, "#ff4fa3", 0.9], [1, "#ff4fa3", 0]]),
        rg("neonC", [[0, "#3ff3ff", 0.9], [1, "#3ff3ff", 0]]),
        rg("red", [[0, "#ff2d55", 0.95], [1, "#ff2d55", 0]]),
        rg("blue", [[0, "#2d7bff", 0.95], [1, "#2d7bff", 0]]),
      ].join("") + `<filter id="${id}bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
        <filter id="${id}neon" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

      // --- tiny animation helpers (SMIL) ---
      const spin = (cx, cy, dur) => `<animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="${dur}s" repeatCount="indefinite"/>`;
      const sway = (cx, cy, a, dur, b = 0) => `<animateTransform attributeName="transform" type="rotate" values="${-a} ${cx} ${cy};${a} ${cx} ${cy};${-a} ${cx} ${cy}" dur="${dur}s" begin="${b}s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>`;
      const bob = (dx, dy, dur, b = 0) => `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;${dx} ${dy};0 0" dur="${dur}s" begin="${b}s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>`;
      const blink = (vals, dur, b = 0) => `<animate attributeName="opacity" values="${vals}" dur="${dur}s" begin="${b}s" repeatCount="indefinite"/>`;
      const slide = (from, to, dur, b = 0) => `<animateTransform attributeName="transform" type="translate" from="${from}" to="${to}" dur="${dur}s" begin="${b}s" repeatCount="indefinite"/>`;

      const palm = (x, y, s, col, swayA = 3, d = 5) => {
        let trunk = `<path d="M-3 0 C2 -40 6 -80 18 -118 L23 -116 C12 -78 7 -40 4 0Z" fill="${col}"/>`;
        for (let k = 1; k < 9; k++) trunk += `<path d="M${f(-2 + k * 2)} ${f(-k * 13)} l6 -2" stroke="#000" stroke-opacity=".25" stroke-width="1.2"/>`;
        let fr = "";
        [[-78, -30], [-52, -62], [-12, -78], [30, -70], [62, -44], [80, -10], [-70, 2]].forEach(([dx, dy]) => {
          const ex = 20 + dx, ey = -118 + dy * 0.55 + 20;
          fr += `<path d="M20 -118 Q${f(20 + dx * 0.45)} ${f(-118 + dy * 0.55 - 14)} ${f(ex)} ${f(ey)}" stroke="${col}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
          for (let q = 1; q < 9; q++) { const t = q / 9, px = 20 + dx * t, py = -118 + (dy * 0.55 - 14) * (2 * t * (1 - t)) * 1.2 + (ey + 118) * t * t; fr += `<path d="M${f(px)} ${f(py)} l${f(dy > -40 ? 3 : -4)} ${f(9 - t * 4)}" stroke="${col}" stroke-width="2.2" stroke-linecap="round"/><path d="M${f(px)} ${f(py)} l${f(dy > -40 ? -5 : 4)} ${f(7 - t * 3)}" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`; }
        });
        return `<g transform="translate(${x} ${y}) scale(${s})">${trunk}<g>${sway(20, -118, swayA, d, r() * 2)}${fr}<circle cx="20" cy="-116" r="5" fill="${col}"/></g></g>`;
      };
      const city = (base, col, hmin, hmax, win, seed = 0) => {
        let o = "", x = -4;
        while (x < 304) {
          const w = 12 + r() * 22, h = hmin + r() * (hmax - hmin), deco = r() < 0.3;
          o += deco ? `<path d="M${f(x)} ${base} V${f(base - h + 6)} Q${f(x)} ${f(base - h)} ${f(x + 6)} ${f(base - h)} H${f(x + w - 6)} Q${f(x + w)} ${f(base - h)} ${f(x + w)} ${f(base - h + 6)} V${base}Z" fill="${col}"/>`
                     : `<rect x="${f(x)}" y="${f(base - h)}" width="${f(w)}" height="${f(h)}" fill="${col}"/>`;
          if (r() < 0.25) o += `<rect x="${f(x + w / 2 - 0.7)}" y="${f(base - h - 12)}" width="1.4" height="12" fill="${col}"/><circle cx="${f(x + w / 2)}" cy="${f(base - h - 12)}" r="1.5" fill="#ff3b5c">${blink("1;.15;1", 1.6, r() * 1.6)}</circle>`;
          if (win) for (let yy = base - h + 5; yy < base - 4; yy += 6) for (let xx = x + 2.5; xx < x + w - 3; xx += 4.5) if (r() < 0.32) {
            const c = r() < 0.75 ? "#ffd98a" : r() < 0.5 ? "#9fe8ff" : "#ff9ed1";
            o += `<rect x="${f(xx)}" y="${f(yy)}" width="2.2" height="2.8" fill="${c}"${r() < 0.06 ? `>${blink("1;.2;1", 3 + r() * 4, r() * 3)}</rect>` : "/>"}`;
          }
          x += w + 1.5 + r() * 3;
        }
        return o;
      };
      const S = {
        heli: () => {
          const beam = `<g opacity=".9"><path d="M150 96 L104 200 H196Z" fill="${U("cone")}">${sway(150, 96, 9, 6)}</path></g>`;
          return `<rect width="300" height="200" fill="${U("dusk")}"/><circle cx="236" cy="150" r="70" fill="${U("glowS")}"/><circle cx="236" cy="150" r="30" fill="${U("sun")}"/>
          <g opacity=".55">${city(200, "#6b2a7d", 40, 90, false)}</g><g opacity=".85">${city(200, "#3a1258", 30, 110, true)}</g>${city(200, "#1c0836", 20, 60, true)}${beam}
          <g>${bob(0, -5, 4)}<g transform="translate(150 84)">
            <ellipse cx="0" cy="-23" rx="74" ry="3.2" fill="#fff" opacity=".22">${blink(".12;.32;.12", 0.18)}</ellipse>
            <path d="M-2 -23 V-14" stroke="#14072b" stroke-width="3"/>
            <path d="M-30 -12 Q-36 10 -10 14 H20 Q36 12 34 -2 Q30 -16 6 -16Z" fill="#2563eb" stroke="#14072b" stroke-width="1.6"/>
            <path d="M-30 -12 Q-33 -2 -26 4 H24" fill="none" stroke="#7fb4ff" stroke-width="1.4" opacity=".8"/>
            <path d="M8 -14 Q30 -11 32 2 H10Z" fill="${U("glass")}" stroke="#14072b" stroke-width="1.4"/><path d="M14 -11 L20 -2" stroke="#fff" stroke-width="1.6" opacity=".8"/>
            <path d="M-28 -2 L-78 -8 L-78 0 L-28 6Z" fill="#1d4ed8" stroke="#14072b" stroke-width="1.4"/><path d="M-80 -16 L-72 -16 L-70 2 L-80 2Z" fill="#ff3b6b" stroke="#14072b" stroke-width="1.2"/>
            <g>${spin(-76, -5, 0.35)}<path d="M-76 -15 V5" stroke="#fff" stroke-width="1.6" opacity=".55"/></g>
            <path d="M-14 14 V22 M18 14 V22 M-24 22 H32" stroke="#14072b" stroke-width="2.2" fill="none" stroke-linecap="round"/>
            <circle cx="-2" cy="16" r="2.4" fill="#fff8d6"/><circle cx="-80" cy="-16" r="1.8" fill="#ff2d55">${blink("1;0;1", 1)}</circle></g></g>
          ${[0, 1, 2].map((i) => `<g>${slide("0 0", "60 -6", 14 + i * 3, -i * 4)}<path d="M${30 + i * 18} ${50 + i * 8} q4 -4 8 0 q4 -4 8 0" stroke="#2a0c5c" stroke-width="1.4" fill="none"/></g>`).join("")}`;
        },
        sunset: () => `<rect width="300" height="200" fill="${U("dusk")}"/><circle cx="150" cy="128" r="90" fill="${U("glowS")}"/>
          <g><circle cx="150" cy="128" r="54" fill="${U("sun")}"/>${[0, 1, 2, 3, 4].map((i) => `<rect x="90" y="${f(132 + i * 9 + i * i * 0.6)}" width="120" height="${f(1.6 + i * 1.3)}" fill="#e2558a"/>`).join("")}</g>
          ${[[40, 58, 26], [230, 46, 32], [120, 34, 18]].map(([a, b, c]) => `<g>${slide("0 0", "18 0", 30, 0)}${cloud(a, b, c, "#ffb3c7", 0.55)}<ellipse cx="${a}" cy="${b + c * 0.35}" rx="${c * 1.5}" ry="${c * 0.12}" fill="#ffd36e" opacity=".6"/></g>`).join("")}
          <rect y="150" width="300" height="50" fill="${U("sea")}"/>
          ${range(10, (i) => `<rect x="${f(150 - (30 + i * 9) / 2 + (r() - 0.5) * 8)}" y="${f(154 + i * 4.4)}" width="${f(30 + i * 9)}" height="1.6" rx=".8" fill="#ffd98a" opacity="${f(0.85 - i * 0.06)}">${blink("1;.35;1", 1.4 + r(), r())}</rect>`)}
          <path d="M0 188 Q60 180 120 190 T300 186 V200 H0Z" fill="#2a0f3d"/>
          ${palm(34, 196, 1.05, "#16052b", 3, 5)}${palm(270, 194, 0.85, "#16052b", 4, 6)}${palm(232, 198, 0.55, "#2a0c45", 5, 4.5)}`,
        duo: () => {
          const bokeh = range(14, () => `<circle cx="${f(r() * 300)}" cy="${f(r() * 140)}" r="${f(3 + r() * 9)}" fill="${r() < 0.5 ? "#ffd36e" : "#ff7eb6"}" opacity="${f(0.15 + r() * 0.25)}">${blink(`${f(0.1 + r() * 0.2)};${f(0.3 + r() * 0.3)};${f(0.1 + r() * 0.2)}`, 3 + r() * 3, r() * 2)}</circle>`);
          const hib = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-5" rx="3.6" ry="5.4" fill="#ff4f7a" transform="rotate(${a})"/>`).join("")}<circle r="1.6" fill="#ffd36e"/></g>`;
          return `<rect width="300" height="200" fill="${U("dusk2")}"/><circle cx="150" cy="96" r="96" fill="${U("glowS")}"/><circle cx="150" cy="104" r="62" fill="${U("sun")}" opacity=".95"/>${bokeh}
          ${palm(16, 214, 0.95, "#1f0a3d", 3, 6)}${palm(290, 214, 0.9, "#1f0a3d", 3, 5.5)}
          <g>${bob(0, -1.5, 3.2)}
          <g stroke="#14072b" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
            <path d="M58 200 Q62 150 102 140 L138 136 Q152 152 146 200Z" fill="#ffd166"/>${hib(80, 166, 1)}${hib(112, 182, 0.9)}${hib(128, 152, 0.8)}${hib(92, 194, 0.8)}
            <path d="M58 200 Q62 150 102 140" fill="none" stroke="#ff7eb6" stroke-width="2.5" opacity=".7"/>
            <path d="M104 140 Q110 152 122 150 L120 134" fill="${U("skinA")}"/>
            <path d="M98 146 Q116 168 134 146" fill="none" stroke="#ffcf5c" stroke-width="3.2"/><path d="M98 146 Q116 168 134 146" fill="none" stroke="#8a4b00" stroke-width="1" stroke-dasharray="1.5 2.5"/>
            <ellipse cx="114" cy="104" rx="22" ry="27" fill="${U("skinA")}"/><path d="M96 112 Q102 126 114 128" fill="none" stroke="#4a240f" stroke-width="1" opacity=".6"/>
            <path d="M136 98 Q138 112 132 120" fill="none" stroke="#ff9ec7" stroke-width="2" opacity=".55"/>
            <path d="M86 94 Q88 68 114 68 Q142 68 142 94 L152 98 Q114 88 78 98Z" fill="#06d6a0"/><path d="M90 86 Q114 78 140 86" stroke="#04a37a" stroke-width="1.2" fill="none"/>
            <path d="M93 103 H135 L132 112 Q125 117 118 111 Q114 117 104 115 Q96 112 93 103Z" fill="${U("shades")}"/><path d="M100 106 l5 -2 M121 106 l5 -2" stroke="#fff" stroke-width="1.3" opacity=".85"/>
            <path d="M104 122 Q112 128 121 122" fill="none"/>
            <path d="M242 200 Q238 150 198 140 L164 138 Q150 152 154 200Z" fill="#7b2ff7"/><path d="M198 140 L206 162 L192 200" fill="none" stroke="#c4b5fd" stroke-width="1.4"/><path d="M242 200 Q238 150 198 140" fill="none" stroke="#3ff3ff" stroke-width="2.5" opacity=".55"/>
            <path d="M176 140 Q184 152 192 148 L190 134" fill="${U("skinB")}"/>
            ${[[166, 74, 16], [186, 64, 18], [207, 75, 16], [158, 96, 14], [214, 98, 14], [186, 50, 12], [172, 56, 10], [202, 56, 10]].map(([a, b, c]) => `<circle cx="${a}" cy="${b}" r="${c}" fill="#2b1a12"/><circle cx="${a - c * 0.3}" cy="${b - c * 0.35}" r="${c * 0.35}" fill="#5a3a26" stroke="none"/>`).join("")}
            <ellipse cx="186" cy="106" rx="21" ry="26" fill="${U("skinB")}"/><path d="M170 96 Q168 112 174 122" fill="none" stroke="#ffb3d1" stroke-width="2" opacity=".55"/>
            <circle cx="166" cy="117" r="6.5" fill="none" stroke="#ffcf5c" stroke-width="2.2"/>
            <path d="M167 100 H205 L202 109 Q195 113 188 108 Q184 113 176 111 Q169 108 167 100Z" fill="${U("shades")}"/><path d="M174 103 l5 -2 M193 103 l5 -2" stroke="#fff" stroke-width="1.3" opacity=".85"/>
            <path d="M180 122 Q188 127 197 121" fill="#e0457b"/>
            <g transform="rotate(-12 221 162)"><rect x="214" y="150" width="14" height="25" rx="3" fill="#14072b"/><rect x="216" y="153" width="10" height="17" rx="1.5" fill="#3ff3ff">${blink("1;.6;1", 2.4)}</rect></g>
          </g></g>`;
        },
        flamingo: () => `<rect width="300" height="200" fill="${U("dusk2")}"/><circle cx="60" cy="70" r="40" fill="${U("glowS")}"/><circle cx="60" cy="70" r="16" fill="${U("sun")}"/>
          <rect y="130" width="300" height="70" fill="${U("sea")}"/>
          ${[0, 1, 2, 3].map((i) => `<ellipse cx="150" cy="186" rx="20" ry="3" fill="none" stroke="#ffd1e3" stroke-width="1.2"><animate attributeName="rx" values="16;90" dur="4s" begin="${i}s" repeatCount="indefinite"/><animate attributeName="ry" values="2.5;10" dur="4s" begin="${i}s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="4s" begin="${i}s" repeatCount="indefinite"/></ellipse>`).join("")}
          <g>${bob(0, -2, 3.6)}<g stroke="#5a0f2e" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
            <path d="M150 186 V128" stroke="#e0457b" stroke-width="2.6"/><path d="M150 152 L140 142 L150 138" fill="none" stroke="#e0457b" stroke-width="2.4"/>
            <path d="M116 112 Q114 86 150 86 Q194 88 190 112 Q172 130 140 128 Q120 126 116 112Z" fill="${U("pinkG")}"/>
            <path d="M126 104 Q150 92 182 104 Q160 116 128 112Z" fill="#ff5f95" opacity=".9"/><path d="M134 106 Q152 100 172 106" fill="none" stroke="#fff" stroke-opacity=".6"/>
            <path d="M118 112 L104 118 L118 116Z" fill="#e0457b"/>
            <path d="M182 96 Q206 70 182 48 Q164 32 178 20" fill="none" stroke="${U("pinkG")}" stroke-width="7.5"/>
            <circle cx="182" cy="18" r="8.5" fill="#ff9ab8"/><circle cx="185" cy="15" r="1.4" fill="#14072b" stroke="none"/><path d="M188 16 L203 22 Q198 30 190 26Z" fill="#14072b"/><path d="M188 16 L196 19" stroke="#ffd1e3"/></g></g>
          <g opacity=".35" transform="translate(0 372) scale(1 -1)"><path d="M116 112 Q114 86 150 86 Q194 88 190 112 Q172 130 140 128 Q120 126 116 112Z" fill="#ff7eb6"/></g>`,
        bank: () => `<rect width="300" height="200" fill="${U("night")}"/>${stars(r, 30, "#fff", 0, 70)}
          <path d="M70 40 L60 200 H240 L230 40Z" fill="#ffe6a8" opacity=".06"/>
          <g stroke="#14072b" stroke-width="1.6"><path d="M36 74 L150 30 L264 74Z" fill="#efe4ff"/><path d="M60 70 L150 38 L240 70Z" fill="#d9c7ff"/>
          <rect x="44" y="74" width="212" height="12" fill="#e3d0ff"/>
          ${[0, 1, 2, 3, 4].map((i) => `<rect x="${58 + i * 40}" y="86" width="18" height="78" fill="url(#${id}hull)"/><rect x="${58 + i * 40}" y="86" width="5" height="78" fill="#fff" stroke="none" opacity=".7"/>`).join("")}
          <rect x="36" y="164" width="228" height="10" fill="#d9c7ff"/><rect x="28" y="174" width="244" height="10" fill="#c3adf5"/></g>
          <text x="150" y="66" text-anchor="middle" font-family="Georgia, serif" font-size="12" font-weight="700" fill="#3a1466" letter-spacing="4">BANK</text>
          <circle cx="150" cy="52" r="26" fill="${U("red")}" opacity=".5">${blink(".7;.05;.7", 0.8)}</circle>
          ${range(9, (i) => { const x = 20 + r() * 260, y = 30 + r() * 150, a = r() * 60 - 30; return `<g>${slide("0 0", `${f((r() - 0.5) * 30)} -50`, 5 + r() * 4, -r() * 6)}<animate attributeName="opacity" values="0;1;1;0" dur="${f(5 + r() * 3)}s" repeatCount="indefinite"/><g transform="translate(${f(x)} ${f(y)}) rotate(${f(a)})"><rect x="-14" y="-7" width="28" height="14" rx="2" fill="#86e39a" stroke="#14532d" stroke-width="1.2"/><rect x="-11" y="-4.5" width="22" height="9" rx="1" fill="none" stroke="#1a5c2a" stroke-width=".7"/><circle r="3.2" fill="#c8f7d2" stroke="#1a5c2a" stroke-width=".7"/></g></g>`; })}`,
        // the big street panel that replaces the old wordmark: night boulevard, neon, wet road
        drive: () => {
          const sign = (x, y, w, h, txt, col, d) => `<g filter="url(#${id}neon)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="none" stroke="${col}" stroke-width="1.6"/><text x="${x + w / 2}" y="${y + h * 0.72}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-weight="800" font-size="${h * 0.55}" fill="${col}" letter-spacing="1">${txt}</text>${blink(`1;1;.25;1;.4;1`, d, r() * 2)}</g>`;
          const deco = (x, w, h, body, trim) => `<path d="M${x} 150 V${150 - h + 10} Q${x} ${150 - h} ${x + 10} ${150 - h} H${x + w - 10} Q${x + w} ${150 - h} ${x + w} ${150 - h + 10} V150Z" fill="${body}"/>${[0, 1, 2].map((k) => `<path d="M${x + 4} ${150 - h + 18 + k * 5} H${x + w - 4}" stroke="${trim}" stroke-width="1.2" filter="url(#${id}neon)"/>`).join("")}
            ${range(Math.floor((h - 40) / 12), (k) => range(Math.floor((w - 8) / 10), (q) => `<rect x="${x + 6 + q * 10}" y="${150 - h + 36 + k * 12}" width="5" height="6" rx="1" fill="${r() < 0.55 ? "#ffd98a" : "#2a1450"}"/>`))}`;
          return `<rect width="300" height="200" fill="${U("night")}"/>${stars(r, 40, "#fff", 0, 70)}
            <circle cx="250" cy="34" r="12" fill="#fff1c9"/><circle cx="250" cy="34" r="26" fill="#fff1c9" opacity=".12"/>
            ${deco(4, 70, 110, "#3b1a6b", "#3ff3ff")}${deco(80, 62, 86, "#5a1f7a", "#ff4fa3")}${deco(148, 80, 120, "#2c1460", "#ffd36e")}${deco(234, 66, 96, "#4a1a72", "#3ff3ff")}
            ${sign(14, 104, 50, 13, "HOTEL", "#ff4fa3", 5)}${sign(88, 112, 46, 12, "OPEN", "#3ff3ff", 3.5)}${sign(160, 100, 56, 13, "24 / 7", "#ffd36e", 6)}${sign(242, 108, 50, 12, "DINER", "#ff4fa3", 4.2)}
            ${palm(76, 154, 0.4, "#0b041c", 4, 5)}${palm(232, 154, 0.42, "#0b041c", 4, 5.5)}
            <rect y="150" width="300" height="50" fill="${U("road")}"/>
            <rect y="150" width="300" height="50" fill="#ff4fa3" opacity=".08"/>
            ${[[30, "#ff4fa3"], [110, "#3ff3ff"], [190, "#ffd36e"], [266, "#ff4fa3"]].map(([x, c]) => `<rect x="${x - 10}" y="156" width="20" height="40" fill="${c}" opacity=".22" filter="url(#${id}bl)"/>`).join("")}
            <path d="M0 176 H300" stroke="#ffd36e" stroke-width="2" stroke-dasharray="16 12"><animate attributeName="stroke-dashoffset" from="0" to="-56" dur="1s" repeatCount="indefinite"/></path>
            <g>${slide("-120 0", "420 0", 3.2)}<rect x="0" y="164" width="90" height="3" rx="1.5" fill="${U("trailR")}"/><rect x="0" y="169" width="70" height="2" rx="1" fill="${U("trailR")}"/></g>
            <g>${slide("420 0", "-160 0", 2.6, -1)}<rect x="0" y="182" width="110" height="3" rx="1.5" fill="${U("trailW")}"/><rect x="0" y="187" width="80" height="2" rx="1" fill="${U("trailW")}"/></g>`;
        },
        chase: () => `<rect width="300" height="200" fill="${U("night")}"/><g opacity=".9">${city(128, "#2a0f55", 30, 80, true)}</g>
          <rect y="128" width="300" height="72" fill="${U("road")}"/>
          <path d="M0 166 H300" stroke="#ffd36e" stroke-width="2.2" stroke-dasharray="18 12"><animate attributeName="stroke-dashoffset" from="0" to="60" dur=".45s" repeatCount="indefinite"/></path>
          <path d="M150 0 L92 200 H226Z" fill="${U("cone")}" opacity=".6">${sway(150, 0, 7, 3.5)}</path>
          ${range(7, (i) => `<rect x="0" y="${136 + i * 9}" width="${f(40 + r() * 50)}" height="1.6" rx=".8" fill="#fff" opacity=".35">${slide("300 0", "-120 0", 0.6 + r() * 0.5, -r())}</rect>`)}
          <ellipse cx="216" cy="182" rx="56" ry="6" fill="#ff4fa3" opacity=".55" filter="url(#${id}bl)"/>
          <g>${bob(0, -1.2, 0.3)}<g stroke="#0b041c" stroke-width="1.6" stroke-linejoin="round">
            <path d="M166 176 Q168 160 188 156 L206 144 Q224 140 242 146 L264 158 Q278 162 276 176Z" fill="#2b1055"/><path d="M166 176 Q168 160 188 156" fill="none" stroke="#ff4fa3" stroke-width="1.4"/>
            <path d="M208 148 L240 148 L252 158 L200 158Z" fill="${U("glass")}" opacity=".75"/><rect x="270" y="164" width="6" height="4" rx="1" fill="#ff2d55"/>
            <circle cx="188" cy="178" r="10" fill="#0b041c"/><circle cx="188" cy="178" r="4" fill="#9aa0c8"/><circle cx="256" cy="178" r="10" fill="#0b041c"/><circle cx="256" cy="178" r="4" fill="#9aa0c8"/></g></g>
          <g>${bob(0, -1.2, 0.32, 0.1)}<g stroke="#0b041c" stroke-width="1.6" stroke-linejoin="round">
            <path d="M34 178 Q36 162 56 158 L74 146 Q94 142 110 148 L132 160 Q144 164 142 178Z" fill="url(#${id}hull)"/><path d="M52 167 H140" stroke="#1d4ed8" stroke-width="5"/>
            <path d="M76 150 L108 150 L118 160 L68 160Z" fill="${U("glass")}"/><rect x="34" y="166" width="6" height="4" rx="1" fill="#fff6c9"/>
            <circle cx="56" cy="180" r="10" fill="#0b041c"/><circle cx="56" cy="180" r="4" fill="#c9cde6"/><circle cx="122" cy="180" r="10" fill="#0b041c"/><circle cx="122" cy="180" r="4" fill="#c9cde6"/>
            <rect x="80" y="138" width="12" height="7" rx="2" fill="#ff2d55"/><rect x="92" y="138" width="12" height="7" rx="2" fill="#2d7bff"/></g></g>
          <circle cx="86" cy="141" r="26" fill="${U("red")}">${blink("1;0;0;1", 0.5)}</circle><circle cx="98" cy="141" r="26" fill="${U("blue")}">${blink("0;1;1;0", 0.5)}</circle>
          <path d="M34 168 L0 160 L0 176Z" fill="#fff6c9" opacity=".35"/>`,
        bike: () => `<rect width="300" height="200" fill="${U("dusk")}"/><circle cx="230" cy="120" r="50" fill="${U("glowS")}"/><g opacity=".7">${city(150, "#4a1a6b", 30, 80, true)}</g>
          <rect y="150" width="300" height="50" fill="${U("road")}"/><path d="M0 174 H300" stroke="#ffd36e" stroke-width="2.5" stroke-dasharray="20 14"><animate attributeName="stroke-dashoffset" from="0" to="68" dur=".5s" repeatCount="indefinite"/></path>
          ${range(6, (i) => `<rect x="0" y="${92 + i * 10}" width="${f(40 + r() * 40)}" height="1.8" rx=".9" fill="#fff" opacity=".5">${slide("80 0", "-90 0", 0.5 + r() * 0.3, -r())}</rect>`)}
          <g>${bob(0, -3, 0.9)}<g transform="translate(168 150) rotate(-20)" stroke="#0b041c" stroke-width="1.8" stroke-linejoin="round">
            <g><circle cx="-48" cy="0" r="21" fill="#14072b"/><circle cx="-48" cy="0" r="14" fill="#2a1450" stroke="#ff4fa3"/><g>${spin(-48, 0, 0.25)}${[0, 60, 120].map((a) => `<path d="M-48 0 l${f(Math.cos(a * Math.PI / 180) * 13)} ${f(Math.sin(a * Math.PI / 180) * 13)} M-48 0 l${f(-Math.cos(a * Math.PI / 180) * 13)} ${f(-Math.sin(a * Math.PI / 180) * 13)}" stroke="#ff9ed1" stroke-width="1.6"/>`).join("")}</g></g>
            <g><circle cx="48" cy="0" r="21" fill="#14072b"/><circle cx="48" cy="0" r="14" fill="#2a1450" stroke="#ff4fa3"/><g>${spin(48, 0, 0.25)}${[0, 60, 120].map((a) => `<path d="M48 0 l${f(Math.cos(a * Math.PI / 180) * 13)} ${f(Math.sin(a * Math.PI / 180) * 13)} M48 0 l${f(-Math.cos(a * Math.PI / 180) * 13)} ${f(-Math.sin(a * Math.PI / 180) * 13)}" stroke="#ff9ed1" stroke-width="1.6"/>`).join("")}</g></g>
            <path d="M-48 0 L-10 -8 L30 -26 L48 0 M-10 -8 L14 -4" fill="none" stroke-width="3"/>
            <path d="M-26 -26 Q0 -44 34 -32 L28 -14 L-14 -12Z" fill="${U("pinkG")}"/><path d="M-20 -26 Q2 -38 26 -31" fill="none" stroke="#fff" stroke-width="1.4" opacity=".75"/>
            <path d="M30 -32 L44 -42 L48 -38" fill="none" stroke-width="2.4"/><circle cx="44" cy="-30" r="3" fill="#fff6c9"/></g></g>`,
        car: () => `<rect width="300" height="200" fill="${U("dusk")}"/><circle cx="150" cy="140" r="80" fill="${U("glowS")}"/><circle cx="150" cy="140" r="36" fill="${U("sun")}"/>
          ${palm(26, 152, 0.8, "#1f0a3d", 3, 5)}${palm(282, 152, 0.75, "#1f0a3d", 4, 6)}<rect y="150" width="300" height="50" fill="${U("road")}"/>
          <ellipse cx="152" cy="170" rx="118" ry="9" fill="#ff4fa3" filter="url(#${id}bl)"><animate attributeName="opacity" values=".45;.85;.45" dur="2.2s" repeatCount="indefinite"/></ellipse>
          <g stroke="#14072b" stroke-width="1.6" stroke-linejoin="round">
            <path d="M40 154 Q42 132 80 126 L124 108 Q150 100 188 106 L236 122 Q266 128 266 150 L262 160 H44Z" fill="${U("chrome")}"/>
            <path d="M60 132 Q120 118 250 132" fill="none" stroke="#fff7d1" stroke-width="2.4" opacity=".9"/><path d="M48 150 H262" stroke="#8a4b00" stroke-width="1.2" opacity=".6"/>
            <path d="M128 110 L170 104 L188 122 L120 125Z" fill="${U("glass")}"/><path d="M136 110 L146 122" stroke="#fff" stroke-width="1.6" opacity=".7"/>
            <g>${sway(152, 108, 3, 4)}<path d="M152 108 L178 50 L204 58 L184 110Z" fill="${U("chrome")}"/><path d="M162 100 L180 60 L196 64 L178 104Z" fill="${U("glass")}" opacity=".85"/></g>
            <path d="M246 132 L264 136 L262 144 L244 140Z" fill="#fff6c9"/><path d="M42 140 L52 138 L52 146 L42 148Z" fill="#ff2d55"/>
            ${[86, 222].map((cx) => `<circle cx="${cx}" cy="160" r="18" fill="#14072b"/><circle cx="${cx}" cy="160" r="11" fill="#d6d9ee"/><g>${spin(cx, 160, 1.2)}${[0, 72, 144, 216, 288].map((a) => `<path d="M${cx} 160 l${f(Math.cos(a * Math.PI / 180) * 10)} ${f(Math.sin(a * Math.PI / 180) * 10)}" stroke="#7a7fa8" stroke-width="2"/>`).join("")}</g><circle cx="${cx}" cy="160" r="3" fill="#14072b"/>`).join("")}
          </g>`,
        boat: () => `<rect width="300" height="200" fill="${U("seaDay")}"/><rect width="300" height="74" fill="${U("dusk2")}"/><circle cx="250" cy="58" r="34" fill="${U("glowS")}"/><circle cx="250" cy="58" r="18" fill="${U("sun")}"/>
          ${range(16, () => `<path d="M${f(r() * 300)} ${f(84 + r() * 110)} q6 -3 12 0" stroke="#fff" stroke-width="1.2" fill="none" opacity=".55">${slide("0 0", "-30 0", 3 + r() * 3, -r() * 3)}</path>`)}
          <g>${bob(0, -3, 1.8)}
            <path d="M84 150 L-30 210 M92 152 L10 214 M100 154 L60 214" stroke="#fff" stroke-width="6" stroke-opacity=".75" stroke-linecap="round"><animate attributeName="stroke-opacity" values=".75;.45;.75" dur="1.2s" repeatCount="indefinite"/></path>
            ${range(16, () => `<circle cx="${f(60 + r() * 50)}" cy="${f(136 + r() * 26)}" r="${f(1 + r() * 2.6)}" fill="#fff"><animate attributeName="cy" values="${f(150 + r() * 10)};${f(128 + r() * 10)};${f(150 + r() * 10)}" dur="${f(0.8 + r() * 0.6)}s" repeatCount="indefinite"/></circle>`)}
            <g stroke="#14072b" stroke-width="1.6" stroke-linejoin="round">
              <path d="M70 142 L232 114 Q262 110 266 124 L250 144 Q164 160 84 154Z" fill="${U("hull")}"/>
              <path d="M84 154 Q164 160 250 144 L246 151 Q164 166 88 160Z" fill="#ff3b6b"/><path d="M96 146 L240 124" stroke="#2a9df4" stroke-width="2.4"/>
              <path d="M150 124 L180 104 L210 110 L198 120Z" fill="${U("glass")}"/><path d="M164 116 L178 108" stroke="#fff" stroke-width="1.4" opacity=".8"/>
            </g></g>`,
      };
      const P = wide
        ? [["heli", 8, 8, 280, 230], ["duo", 296, 8, 300, 458], ["sunset", 604, 8, 320, 230], ["boat", 932, 8, 340, 230], ["flamingo", 8, 246, 280, 220], ["drive", 604, 246, 668, 220], ["car", 8, 474, 400, 238], ["chase", 416, 474, 460, 238], ["bike", 884, 474, 180, 238], ["bank", 1072, 474, 200, 238]]
        : [["heli", 6, 6, 190, 170], ["sunset", 202, 6, 192, 170], ["duo", 6, 182, 232, 200], ["flamingo", 244, 182, 150, 97], ["bank", 244, 285, 150, 97], ["drive", 6, 388, 388, 110], ["chase", 6, 504, 250, 140], ["bike", 262, 504, 132, 140], ["car", 6, 650, 190, 144], ["boat", 202, 650, 192, 144]];
      const VB = { drive: "0 70 300 130" }, ALIGN = { chase: "xMidYMax", car: "xMidYMax", bike: "xMidYMax" };
      const panels = P.map(([k, x, y, w, h]) => `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${VB[k] || "0 0 300 200"}" preserveAspectRatio="${ALIGN[k] || "xMidYMid"} slice">${S[k]()}</svg>
        <rect x="${x + 0.75}" y="${y + 0.75}" width="${w - 1.5}" height="${h - 1.5}" rx="3" fill="none" stroke="#fff" stroke-width="1.5"/><rect x="${x + 2.5}" y="${y + 2.5}" width="${w - 5}" height="${h - 5}" rx="2" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="1"/>`).join("");
      return { vw: VW, vh: VH, body: `<defs>${defs}</defs><rect width="${VW}" height="${VH}" fill="#0b041c"/>${panels}` };
    },

    galaxy(r, id) {
      let arms = "";
      for (let a = 0; a < 2; a++) for (let i = 0; i < 260; i++) {
        const t = i / 260, ang = t * 4.4 + a * Math.PI, rad = 6 + t * 150, sp = (1 - t) * 6 + 4;
        const x = 210 + Math.cos(ang) * rad + (r() - 0.5) * sp * 3, y = 330 + Math.sin(ang) * rad * 0.45 + (r() - 0.5) * sp;
        arms += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.4 + r() * (1.6 - t))}" fill="${r() < 0.2 ? "#fbcfe8" : r() < 0.5 ? "#c4b5fd" : "#fff"}" opacity="${f(0.3 + (1 - t) * 0.6 * r())}"/>`;
      }
      const planet = (x, y, rr, c1, c2, ring) => `<g><circle cx="${x}" cy="${y}" r="${rr}" fill="url(#${id}${c1})"/>${ring ? `<ellipse cx="${x}" cy="${y}" rx="${rr * 1.9}" ry="${rr * 0.45}" fill="none" stroke="${c2}" stroke-width="${f(rr * 0.12)}" opacity=".7" transform="rotate(-18 ${x} ${y})"/><path d="M${f(x - rr)} ${y} a${rr} ${rr} 0 0 0 ${rr * 2} 0" fill="url(#${id}${c1})" transform="rotate(-18 ${x} ${y})"/>` : ""}</g>`;
      return `<defs><radialGradient id="${id}s" cx=".5" cy=".42" r=".8"><stop offset="0" stop-color="#3b1d7a"/><stop offset=".5" stop-color="#160c38"/><stop offset="1" stop-color="#05030f"/></radialGradient>
          <radialGradient id="${id}c"><stop offset="0" stop-color="#fff"/><stop offset=".2" stop-color="#fde68a" stop-opacity=".9"/><stop offset=".6" stop-color="#c084fc" stop-opacity=".25"/><stop offset="1" stop-color="#c084fc" stop-opacity="0"/></radialGradient>
          <radialGradient id="${id}n1"><stop offset="0" stop-color="#ec4899" stop-opacity=".45"/><stop offset="1" stop-color="#ec4899" stop-opacity="0"/></radialGradient>
          <radialGradient id="${id}n2"><stop offset="0" stop-color="#22d3ee" stop-opacity=".35"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>
          <radialGradient id="${id}a" cx=".35" cy=".35"><stop offset="0" stop-color="#fdba74"/><stop offset="1" stop-color="#9a3412"/></radialGradient>
          <radialGradient id="${id}b" cx=".35" cy=".35"><stop offset="0" stop-color="#a5f3fc"/><stop offset="1" stop-color="#1e3a8a"/></radialGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#${id}s)"/>
        <ellipse cx="90" cy="620" rx="160" ry="110" fill="url(#${id}n1)"/><ellipse cx="330" cy="560" rx="140" ry="120" fill="url(#${id}n2)"/><ellipse cx="300" cy="120" rx="120" ry="80" fill="url(#${id}n1)" opacity=".6"/>
        ${stars(r, 220, "#fff", 0, H, 0.05)}${arms}<ellipse cx="210" cy="330" rx="60" ry="30" fill="url(#${id}c)"/>
        ${planet(70, 120, 26, "a", "#fed7aa", true)}${planet(340, 700, 18, "b", "#bae6fd", false)}<circle cx="360" cy="680" r="3" fill="#e0f2fe"/>`;
    },
  };

  const WIDE = new Set(["heist"]);          // scenes with their own landscape layout for desktops
  function svgFor(theme, dark, wide = false) {
    const fn = SCENES[theme];
    if (!fn) return "";
    const id = `ta${++uid}`;
    const out = fn(rng(theme + (dark ? "-d" : "")), id, dark, wide && WIDE.has(theme));
    const vw = out.vw || W, vh = out.vh || H, body = out.body ?? out;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${body}</svg>`;
  }

  let observer = null;
  function apply(wrap, theme) {
    const cur = wrap.querySelector(".ct-art");
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    if (!SCENES[theme]) { cur?.remove(); document.documentElement.removeAttribute("data-ct-art"); return; }
    const wide = WIDE.has(theme) && wrap.clientWidth > wrap.clientHeight * 1.05;
    const key = `${theme}|${dark}|${wide}`;
    if (cur?.dataset.key === key) return;
    cur?.remove();
    const el = document.createElement("div");
    el.className = "ct-art";
    el.dataset.key = key;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = svgFor(theme, dark, wide);
    wrap.prepend(el);
    document.documentElement.setAttribute("data-ct-art", theme);
    // repaint when the app flips between light and dark
    observer ||= new MutationObserver(() => { const t = document.documentElement.getAttribute("data-ct-art"); if (t) apply(wrap, t); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  // a phone turned sideways or a resized desktop window swaps to the other layout
  let rz = 0;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { const t = document.documentElement.getAttribute("data-ct-art"), w = document.querySelector(".messages-wrap"); if (t && w && WIDE.has(t)) apply(w, t); }, 200); });
  // a theme whose artwork lives in Supabase Storage (chat_themes.art_url). Drawn as a background
  // image, so an uploaded SVG can never run script; if it fails to load, the built-in scene is used.
  function applyUrl(wrap, t) {
    const wide = !!t.art_wide_url && wrap.clientWidth > wrap.clientHeight * 1.05;
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const url = (wide && t.art_wide_url) || (dark && t.art_dark_url) || t.art_url;
    const key = `db|${t.key}|${url}|${t.version || 1}`;
    const cur = wrap.querySelector(".ct-art");
    if (cur?.dataset.key === key) return;
    const img = new Image();
    img.onload = () => {
      if (document.documentElement.getAttribute("data-chat-theme") !== t.key) return;
      wrap.querySelector(".ct-art")?.remove();
      const el = document.createElement("div");
      el.className = "ct-art ct-art-img"; el.dataset.key = key; el.setAttribute("aria-hidden", "true");
      el.style.backgroundImage = `url("${encodeURI(img.src)}")`;
      wrap.prepend(el);
      document.documentElement.setAttribute("data-ct-art", t.key);
    };
    img.onerror = () => { if (SCENES[t.key]) apply(wrap, t.key); };
    img.src = `${url}${url.includes("?") ? "&" : "?"}v=${t.version || 1}`;
    dbCur = { wrap, t };
  }
  let dbCur = null;
  addEventListener("resize", () => { if (dbCur && document.documentElement.getAttribute("data-chat-theme") === dbCur.t.key) applyUrl(dbCur.wrap, dbCur.t); });
  return { has: (t) => !!SCENES[t], apply, applyUrl, svgFor };
})();
window.ThemeArt = ThemeArt;
