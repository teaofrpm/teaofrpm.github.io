/* teaofrpm photo editor — crop, rotate, filters, adjust, text, draw, stickers.
   Usage: const file = await MediaEditor.edit(pickedFile, { aspects: ["original","1:1","4:5"], title: "New post" });
   Resolves with an edited JPEG File, or null if the person cancelled. Videos/GIFs come back untouched. */
(function () {
  const PRESETS = {
    Normal: {},
    Clarendon: { contrast: 20, saturation: 25, warmth: -8 },
    Juno: { warmth: 18, saturation: 15, contrast: 8 },
    Lark: { brightness: 10, saturation: -10, contrast: -5, warmth: -5 },
    Vivid: { saturation: 45, contrast: 15 },
    Golden: { warmth: 30, brightness: 6, saturation: 10, vignette: 20 },
    Cool: { warmth: -25, saturation: 5, brightness: 3 },
    Fade: { fade: 45, contrast: -10, saturation: -15 },
    Vintage: { warmth: 22, fade: 35, saturation: -25, vignette: 35 },
    Moon: { gray: 1, contrast: 15, brightness: 5 },
    Noir: { gray: 1, contrast: 40, vignette: 40 },
  };
  const ADJ = [["brightness", "Brightness", -100, 100], ["contrast", "Contrast", -100, 100], ["saturation", "Saturation", -100, 100],
    ["warmth", "Warmth", -100, 100], ["fade", "Fade", 0, 100], ["vignette", "Vignette", 0, 100]];
  const COLORS = ["#ffffff", "#111111", "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#0a84ff", "#5e5ce6", "#ff2d55", "#a2845e"];
  const FONTS = { sans: "700 1em Inter, 'Segoe UI', sans-serif", serif: "700 1em 'Cormorant Garamond', Georgia, serif", mono: "700 1em ui-monospace, Consolas, monospace", hand: "700 1em 'Comic Sans MS', 'Segoe Print', cursive" };
  const STICKERS = "😂 😍 🥹 😎 🔥 ✨ 💯 ❤️ 💀 🙏 🎉 🥳 😭 🤡 👀 💅 🫶 ⭐ 🌈 ☕ 📚 🏆 🎂 📸 🌸 🍕 ⚽ 🏏 🎧 💤".split(" ");
  const ASPECTS = { original: null, "1:1": 1, "4:5": 4 / 5, "16:9": 16 / 9, "9:16": 9 / 16, "3:4": 3 / 4 };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => res({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("This photo's format isn't supported by your browser.")); };
      img.src = url;
    });
  }

  // all colour work is plain pixel maths, so preview and export match on every browser
  function processPixels(ctx, x, y, w, h, a) {
    if (!w || !h) return;
    const any = a.brightness || a.contrast || a.saturation || a.warmth || a.fade || a.vignette || a.gray;
    if (!any) return;
    const id = ctx.getImageData(x, y, w, h), d = id.data;
    const c = (a.contrast || 0) * 1.28, cf = (259 * (c + 255)) / (255 * (259 - c));
    const br = (a.brightness || 0) * 1.1, sat = 1 + (a.saturation || 0) / 100, wm = (a.warmth || 0) * 0.55;
    const fade = (a.fade || 0) / 100, vig = (a.vignette || 0) / 100, gray = !!a.gray;
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let v = cf * (i + br - 128) + 128;
      v = v * (1 - fade * 0.35) + fade * 45;
      lut[i] = v;
    }
    const cx = w / 2, cy = h / 2, maxD = cx * cx + cy * cy;
    for (let py = 0, p = 0; py < h; py++) {
      const dy = py - cy;
      for (let px = 0; px < w; px++, p += 4) {
        let r = d[p], g = d[p + 1], b = d[p + 2];
        if (gray || sat !== 1) {
          const l = 0.299 * r + 0.587 * g + 0.114 * b;
          if (gray) r = g = b = l;
          else { r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
        }
        if (wm) { r += wm; b -= wm; }
        r = lut[r < 0 ? 0 : r > 255 ? 255 : r | 0]; g = lut[g < 0 ? 0 : g > 255 ? 255 : g | 0]; b = lut[b < 0 ? 0 : b > 255 ? 255 : b | 0];
        if (vig) {
          const dx = px - cx, f = 1 - vig * 0.85 * ((dx * dx + dy * dy) / maxD);
          r *= f; g *= f; b *= f;
        }
        d[p] = r; d[p + 1] = g; d[p + 2] = b;
      }
    }
    ctx.putImageData(id, x, y);
  }

  function drawOverlays(ctx, F, s) {
    for (const st of s.strokes) {
      if (st.points.length < 1) continue;
      ctx.save();
      ctx.strokeStyle = st.color; ctx.lineWidth = st.width * F.w; ctx.lineCap = "round"; ctx.lineJoin = "round";
      if (st.glow) { ctx.shadowColor = st.color; ctx.shadowBlur = st.width * F.w * 1.4; }
      ctx.beginPath();
      st.points.forEach(([x, y], i) => (i ? ctx.lineTo(F.x + x * F.w, F.y + y * F.h) : ctx.moveTo(F.x + x * F.w, F.y + y * F.h)));
      if (st.points.length === 1) ctx.lineTo(F.x + st.points[0][0] * F.w + 0.1, F.y + st.points[0][1] * F.h);
      ctx.stroke();
      ctx.restore();
    }
    for (const t of s.texts) drawText(ctx, F, t, t === s.sel && s.showSel);
  }

  function textBox(ctx, F, t) {
    const size = t.size * F.w;
    ctx.font = (t.emoji ? `${size}px sans-serif` : FONTS[t.font] || FONTS.sans).replace("1em", `${size}px`);
    const lines = String(t.text || " ").split("\n");
    const lh = size * 1.18;
    const w = Math.max(...lines.map((l) => ctx.measureText(l || " ").width));
    const h = lines.length * lh;
    const cx = F.x + t.x * F.w, cy = F.y + t.y * F.h;
    return { size, lines, lh, w, h, cx, cy, x: cx - w / 2, y: cy - h / 2 };
  }

  function drawText(ctx, F, t, selected) {
    ctx.save();
    const b = textBox(ctx, F, t);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const pad = b.size * 0.28;
    if (t.style === "bg" && !t.emoji) {
      ctx.fillStyle = t.color;
      const r = b.size * 0.3;
      roundRect(ctx, b.x - pad, b.y - pad * 0.6, b.w + pad * 2, b.h + pad * 1.2, r);
      ctx.fill();
    }
    b.lines.forEach((line, i) => {
      const ly = b.y + b.lh * (i + 0.5);
      if (t.style === "outline" && !t.emoji) {
        ctx.lineWidth = Math.max(2, b.size * 0.12); ctx.strokeStyle = t.color === "#111111" ? "#fff" : "#000"; ctx.lineJoin = "round";
        ctx.strokeText(line, b.cx, ly);
      }
      if (t.style === "neon" && !t.emoji) { ctx.shadowColor = t.color; ctx.shadowBlur = b.size * 0.5; }
      else if (!t.emoji && t.style !== "bg") { ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = b.size * 0.12; }
      ctx.fillStyle = t.style === "bg" && !t.emoji ? (isLight(t.color) ? "#111" : "#fff") : (t.style === "neon" ? "#fff" : t.color);
      ctx.fillText(line, b.cx, ly);
    });
    if (selected) {
      ctx.shadowBlur = 0;
      ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.strokeRect(b.x - pad - 3, b.y - pad - 3, b.w + pad * 2 + 6, b.h + pad * 2 + 6);
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  const isLight = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 160; };

  function edit(file, opts = {}) {
    if (!file) return Promise.resolve(null);
    if (!/^image\//.test(file.type || "image/") || /gif/i.test(file.type)) return Promise.resolve(file);
    return loadImage(file).then(({ img, url }) => new Promise((resolve) => open(img, url, file, opts, resolve)))
      .catch((e) => { if (typeof toast === "function") toast(e.message); return null; });
  }

  function open(img, url, file, opts, resolve) {
    const aspects = (opts.aspects || ["original", "1:1", "4:5", "16:9", "9:16"]).filter((k) => k in ASPECTS);
    const s = {
      rot: 0, flip: false, aspectKey: opts.aspect || aspects[0], zoom: 1, panX: 0, panY: 0,
      preset: "Normal", adj: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0 }, adjKey: "brightness",
      texts: [], strokes: [], sel: null, showSel: true, tool: "crop",
      pen: { color: "#ffffff", width: 0.012, glow: false },
    };

    const root = document.createElement("div");
    root.className = "pe-root";
    root.innerHTML = `
      <div class="pe-top">
        <button type="button" class="pe-x" data-act="cancel">Cancel</button>
        <b>${opts.title || "Edit photo"}</b>
        <button type="button" class="pe-done" data-act="done">${opts.doneLabel || "Done"}</button>
      </div>
      <div class="pe-stage"><canvas></canvas></div>
      <div class="pe-panel"></div>
      <div class="pe-tabs">
        ${[["crop", "crop", "Crop"], ["filters", "sparkles", "Filters"], ["adjust", "sliders", "Adjust"], ["text", "type", "Text"], ["draw", "pen", "Draw"], ["sticker", "smilePlus", "Stickers"]]
          .map(([k, ic, l]) => `<button type="button" data-tool="${k}" class="${k === "crop" ? "on" : ""}">${typeof svgIcon === "function" ? svgIcon(ic, 20) : ""}<span>${l}</span></button>`).join("")}
      </div>`;
    document.body.appendChild(root);
    if (window.AppNav?.hide) AppNav.hide();
    document.documentElement.classList.add("pe-open");
    const canvas = root.querySelector("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    const stage = root.querySelector(".pe-stage"), panel = root.querySelector(".pe-panel");
    let F = { x: 0, y: 0, w: 1, h: 1 }, dpr = 1, raf = 0;

    const rotDims = () => (s.rot % 2 ? [img.naturalHeight, img.naturalWidth] : [img.naturalWidth, img.naturalHeight]);
    const aspectNow = () => ASPECTS[s.aspectKey] || (rotDims()[0] / rotDims()[1]);
    const baseScale = () => { const [rw, rh] = rotDims(); return Math.max(F.w / rw, F.h / rh); };
    const effAdj = () => {
      const p = PRESETS[s.preset] || {}, out = { gray: p.gray || 0 };
      for (const [k] of ADJ) out[k] = (p[k] || 0) + (s.adj[k] || 0);
      return out;
    };

    function layout() {
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const r = stage.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = r.width + "px"; canvas.style.height = r.height + "px";
      const pad = 16 * dpr, aw = canvas.width - pad * 2, ah = canvas.height - pad * 2, a = aspectNow();
      let w = aw, h = aw / a;
      if (h > ah) { h = ah; w = ah * a; }
      F = { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
      clampPan();
      draw();
    }

    function clampPan() {
      s.zoom = clamp(s.zoom, 1, 6);
      const [rw, rh] = rotDims(), sc = baseScale() * s.zoom;
      const mx = Math.max(0, (rw * sc - F.w) / 2) / F.w, my = Math.max(0, (rh * sc - F.h) / 2) / F.h;
      s.panX = clamp(s.panX, -mx, mx); s.panY = clamp(s.panY, -my, my);
    }

    function paintImage(c, frame, scale) {
      c.save();
      c.translate(frame.x + frame.w / 2 + s.panX * frame.w, frame.y + frame.h / 2 + s.panY * frame.h);
      c.rotate(s.rot * Math.PI / 2);
      if (s.flip) c.scale(-1, 1);
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      c.drawImage(img, -w / 2, -h / 2, w, h);
      c.restore();
    }

    function draw() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const sc = baseScale() * s.zoom;
        if (s.tool === "crop") { ctx.globalAlpha = 0.28; paintImage(ctx, F, sc); ctx.globalAlpha = 1; }
        ctx.save();
        ctx.beginPath(); ctx.rect(F.x, F.y, F.w, F.h); ctx.clip();
        paintImage(ctx, F, sc);
        ctx.restore();
        processPixels(ctx, Math.round(F.x), Math.round(F.y), Math.round(F.w), Math.round(F.h), effAdj());
        ctx.save(); ctx.beginPath(); ctx.rect(F.x, F.y, F.w, F.h); ctx.clip();
        drawOverlays(ctx, F, s);
        ctx.restore();
        if (s.tool === "crop") {
          ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 2; ctx.strokeRect(F.x, F.y, F.w, F.h);
          ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1;
          for (let i = 1; i < 3; i++) {
            ctx.beginPath(); ctx.moveTo(F.x + F.w * i / 3, F.y); ctx.lineTo(F.x + F.w * i / 3, F.y + F.h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(F.x, F.y + F.h * i / 3); ctx.lineTo(F.x + F.w, F.y + F.h * i / 3); ctx.stroke();
          }
          if (opts.circle) {
            ctx.save(); ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.beginPath(); ctx.rect(F.x, F.y, F.w, F.h);
            ctx.arc(F.x + F.w / 2, F.y + F.h / 2, Math.min(F.w, F.h) / 2, 0, Math.PI * 2, true); ctx.fill("evenodd"); ctx.restore();
          }
        }
      });
    }

    /* ---------- panels ---------- */
    function chip(label, on, data) { return `<button type="button" class="pe-chip${on ? " on" : ""}" ${data}>${label}</button>`; }
    function colorsRow(cur, attr) { return `<div class="pe-colors">${COLORS.map((c) => `<button type="button" ${attr}="${c}" class="${c === cur ? "on" : ""}" style="background:${c}"></button>`).join("")}</div>`; }

    function renderPanel() {
      root.querySelectorAll(".pe-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tool === s.tool));
      s.showSel = s.tool === "text" || s.tool === "sticker";
      if (s.tool === "crop") {
        panel.innerHTML = `<div class="pe-row">${aspects.map((k) => chip(k === "original" ? "Original" : k, k === s.aspectKey, `data-aspect="${k}"`)).join("")}</div>
          <div class="pe-row"><button type="button" class="pe-chip" data-act="rotate">↻ Rotate</button><button type="button" class="pe-chip" data-act="flip">⇋ Flip</button>
          <label class="pe-slider">Zoom<input type="range" min="1" max="4" step="0.01" value="${s.zoom}" data-zoom></label>
          <button type="button" class="pe-chip" data-act="reset">Reset</button></div>
          <p class="pe-hint">Drag to move · pinch or slide to zoom</p>`;
      } else if (s.tool === "filters") {
        panel.innerHTML = `<div class="pe-filters">${Object.keys(PRESETS).map((k) => `<button type="button" data-preset="${k}" class="${k === s.preset ? "on" : ""}"><canvas width="64" height="64"></canvas><span>${k}</span></button>`).join("")}</div>`;
        paintThumbs();
      } else if (s.tool === "adjust") {
        const [k, , min, max] = ADJ.find((a) => a[0] === s.adjKey);
        panel.innerHTML = `<div class="pe-row">${ADJ.map(([key, l]) => chip(l + (s.adj[key] ? " •" : ""), key === s.adjKey, `data-adj="${key}"`)).join("")}</div>
          <label class="pe-slider wide"><input type="range" min="${min}" max="${max}" value="${s.adj[k]}" data-adjval><output>${s.adj[k]}</output></label>`;
      } else if (s.tool === "text") {
        const t = s.sel && !s.sel.emoji ? s.sel : null;
        panel.innerHTML = `<div class="pe-row"><button type="button" class="pe-chip on" data-act="addtext">＋ Add text</button>
          ${t ? `<button type="button" class="pe-chip" data-act="deltext">🗑 Delete</button>` : `<span class="pe-hint">Tap text on the photo to edit it</span>`}</div>
          ${t ? `<textarea class="pe-input" rows="2" maxlength="200" placeholder="Type something…">${escapeText(t.text)}</textarea>
          ${colorsRow(t.color, "data-tcolor")}
          <div class="pe-row">${["plain", "bg", "outline", "neon"].map((st) => chip({ plain: "Aa", bg: "Box", outline: "Outline", neon: "Neon" }[st], t.style === st, `data-tstyle="${st}"`)).join("")}
          ${Object.keys(FONTS).map((f) => chip({ sans: "Modern", serif: "Classic", mono: "Typewriter", hand: "Hand" }[f], t.font === f, `data-tfont="${f}"`)).join("")}</div>
          <label class="pe-slider wide">Size<input type="range" min="0.03" max="0.25" step="0.005" value="${t.size}" data-tsize></label>` : ""}`;
        const ta = panel.querySelector(".pe-input");
        if (ta) ta.addEventListener("input", () => { t.text = ta.value; draw(); });
      } else if (s.tool === "draw") {
        panel.innerHTML = `${colorsRow(s.pen.color, "data-pcolor")}
          <div class="pe-row"><label class="pe-slider">Size<input type="range" min="0.003" max="0.05" step="0.001" value="${s.pen.width}" data-psize></label>
          ${chip("✨ Glow", s.pen.glow, 'data-act="glow"')}<button type="button" class="pe-chip" data-act="undo">↶ Undo</button><button type="button" class="pe-chip" data-act="clear">Clear</button></div>
          <p class="pe-hint">Draw with your finger on the photo</p>`;
      } else if (s.tool === "sticker") {
        panel.innerHTML = `<div class="pe-stickers">${STICKERS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}</div>
          ${s.sel?.emoji ? `<div class="pe-row"><label class="pe-slider wide">Size<input type="range" min="0.06" max="0.45" step="0.005" value="${s.sel.size}" data-tsize></label><button type="button" class="pe-chip" data-act="deltext">🗑</button></div>` : `<p class="pe-hint">Tap a sticker, then drag it where you want</p>`}`;
      }
      draw();
    }
    const escapeText = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;");

    function paintThumbs() {
      const sz = 64, tmp = document.createElement("canvas"); tmp.width = sz; tmp.height = sz;
      const tc = tmp.getContext("2d", { willReadFrequently: true });
      const fr = { x: 0, y: 0, w: sz, h: sz }, [rw, rh] = rotDims(), sc = Math.max(sz / rw, sz / rh);
      tc.save(); tc.translate(sz / 2, sz / 2); tc.rotate(s.rot * Math.PI / 2); if (s.flip) tc.scale(-1, 1);
      tc.drawImage(img, -img.naturalWidth * sc / 2, -img.naturalHeight * sc / 2, img.naturalWidth * sc, img.naturalHeight * sc); tc.restore();
      const base = tc.getImageData(0, 0, sz, sz);
      panel.querySelectorAll("[data-preset]").forEach((b) => {
        const c = b.querySelector("canvas").getContext("2d", { willReadFrequently: true });
        c.putImageData(base, 0, 0);
        const p = PRESETS[b.dataset.preset];
        processPixels(c, 0, 0, sz, sz, { gray: p.gray || 0, brightness: p.brightness || 0, contrast: p.contrast || 0, saturation: p.saturation || 0, warmth: p.warmth || 0, fade: p.fade || 0, vignette: p.vignette || 0 });
        void fr;
      });
    }

    panel.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const d = b.dataset;
      if (d.aspect) { s.aspectKey = d.aspect; s.zoom = 1; s.panX = s.panY = 0; layout(); renderPanel(); }
      else if (d.preset) { s.preset = d.preset; panel.querySelectorAll("[data-preset]").forEach((x) => x.classList.toggle("on", x === b)); draw(); }
      else if (d.adj) { s.adjKey = d.adj; renderPanel(); }
      else if (d.tcolor && s.sel) { s.sel.color = d.tcolor; renderPanel(); }
      else if (d.tstyle && s.sel) { s.sel.style = d.tstyle; renderPanel(); }
      else if (d.tfont && s.sel) { s.sel.font = d.tfont; renderPanel(); }
      else if (d.pcolor) { s.pen.color = d.pcolor; renderPanel(); }
      else if (d.emoji) { const t = { text: d.emoji, emoji: true, x: 0.5, y: 0.5, size: 0.18, color: "#fff", style: "plain", font: "sans" }; s.texts.push(t); s.sel = t; renderPanel(); }
      else if (d.act === "rotate") { s.rot = (s.rot + 1) % 4; s.zoom = 1; s.panX = s.panY = 0; layout(); }
      else if (d.act === "flip") { s.flip = !s.flip; draw(); }
      else if (d.act === "reset") { s.rot = 0; s.flip = false; s.zoom = 1; s.panX = s.panY = 0; layout(); renderPanel(); }
      else if (d.act === "addtext") {
        const t = { text: "", x: 0.5, y: 0.45 + Math.random() * 0.1, size: 0.08, color: "#ffffff", style: "plain", font: "sans" };
        s.texts.push(t); s.sel = t; renderPanel(); panel.querySelector(".pe-input")?.focus();
      }
      else if (d.act === "deltext" && s.sel) { s.texts.splice(s.texts.indexOf(s.sel), 1); s.sel = null; renderPanel(); }
      else if (d.act === "glow") { s.pen.glow = !s.pen.glow; renderPanel(); }
      else if (d.act === "undo") { s.strokes.pop(); draw(); }
      else if (d.act === "clear") { s.strokes = []; draw(); }
    });
    panel.addEventListener("input", (e) => {
      const el = e.target, d = el.dataset;
      if ("zoom" in d) { s.zoom = +el.value; clampPan(); draw(); }
      else if ("adjval" in d) { s.adj[s.adjKey] = +el.value; el.nextElementSibling.textContent = el.value; draw(); }
      else if ("tsize" in d && s.sel) { s.sel.size = +el.value; draw(); }
      else if ("psize" in d) { s.pen.width = +el.value; }
    });
    root.querySelector(".pe-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tool]"); if (!b) return;
      s.tool = b.dataset.tool;
      if (s.tool !== "text" && s.tool !== "sticker") s.sel = null;
      s.texts = s.texts.filter((t) => t.emoji || (t.text || "").trim());
      renderPanel();
    });

    /* ---------- gestures on the photo ---------- */
    const pts = new Map(); let gesture = null;
    const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
    const hitText = (x, y) => {
      for (let i = s.texts.length - 1; i >= 0; i--) {
        const b = textBox(ctx, F, s.texts[i]), pad = b.size * 0.4;
        if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return s.texts[i];
      }
      return null;
    };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = toCanvas(e);
      pts.set(e.pointerId, [x, y]);
      if (pts.size === 2 && s.tool === "crop") {
        const [a, b] = [...pts.values()];
        gesture = { type: "pinch", d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: s.zoom };
        return;
      }
      if (s.tool === "draw") {
        const st = { color: s.pen.color, width: s.pen.width, glow: s.pen.glow, points: [[(x - F.x) / F.w, (y - F.y) / F.h]] };
        s.strokes.push(st); gesture = { type: "draw", st }; draw(); return;
      }
      if (s.tool !== "crop") {
        const t = hitText(x, y);
        if (t) {
          if (s.tool !== "sticker" && s.tool !== "text") s.tool = t.emoji ? "sticker" : "text";
          s.sel = t; gesture = { type: "text", t, ox: x, oy: y, tx: t.x, ty: t.y }; renderPanel(); return;
        }
        if (s.sel) { s.sel = null; renderPanel(); }
        return;
      }
      gesture = { type: "pan", ox: x, oy: y, px: s.panX, py: s.panY };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      const [x, y] = toCanvas(e);
      pts.set(e.pointerId, [x, y]);
      if (!gesture) return;
      if (gesture.type === "pinch" && pts.size === 2) {
        const [a, b] = [...pts.values()];
        s.zoom = gesture.zoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / gesture.d; clampPan(); draw();
        const z = panel.querySelector("[data-zoom]"); if (z) z.value = s.zoom;
      } else if (gesture.type === "pan") {
        s.panX = gesture.px + (x - gesture.ox) / F.w; s.panY = gesture.py + (y - gesture.oy) / F.h; clampPan(); draw();
      } else if (gesture.type === "draw") {
        gesture.st.points.push([(x - F.x) / F.w, (y - F.y) / F.h]); draw();
      } else if (gesture.type === "text") {
        gesture.t.x = clamp(gesture.tx + (x - gesture.ox) / F.w, 0, 1); gesture.t.y = clamp(gesture.ty + (y - gesture.oy) / F.h, 0, 1); draw();
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2 && gesture?.type === "pinch") gesture = null; if (!pts.size) gesture = null; };
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", (e) => { if (s.tool !== "crop") return; e.preventDefault(); s.zoom *= e.deltaY < 0 ? 1.08 : 0.93; clampPan(); draw(); }, { passive: false });

    /* ---------- finish ---------- */
    function exportFile() {
      const [rw, rh] = rotDims(); void rw; void rh;
      const sc = baseScale() * s.zoom;
      let ow = F.w / sc, oh = F.h / sc;
      const max = opts.maxSize || 2048, k = Math.min(1, max / Math.max(ow, oh));
      ow = Math.max(1, Math.round(ow * k)); oh = Math.max(1, Math.round(oh * k));
      const out = document.createElement("canvas"); out.width = ow; out.height = oh;
      const oc = out.getContext("2d", { willReadFrequently: true });
      oc.fillStyle = "#fff"; oc.fillRect(0, 0, ow, oh);
      const frame = { x: 0, y: 0, w: ow, h: oh };
      paintImage(oc, frame, sc * (ow / F.w));
      processPixels(oc, 0, 0, ow, oh, effAdj());
      const keepSel = s.sel; s.sel = null;
      drawOverlays(oc, frame, s);
      s.sel = keepSel;
      return new Promise((res) => out.toBlob((b) => res(b ? new File([b], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : null), "image/jpeg", 0.9));
    }

    function close(result) {
      window.removeEventListener("resize", layout);
      document.removeEventListener("keydown", onKey);
      URL.revokeObjectURL(url);
      root.remove();
      document.documentElement.classList.remove("pe-open");
      if (window.AppNav?.show) AppNav.show();
      resolve(result);
    }
    const onKey = (e) => { if (e.key === "Escape" && !/TEXTAREA|INPUT/.test(document.activeElement?.tagName)) close(null); };
    document.addEventListener("keydown", onKey);
    root.querySelector(".pe-top").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      if (b.dataset.act === "cancel") close(null);
      else { b.disabled = true; b.textContent = "…"; s.texts = s.texts.filter((t) => t.emoji || (t.text || "").trim()); close(await exportFile()); }
    });
    window.addEventListener("resize", layout);
    renderPanel();
    layout();
    requestAnimationFrame(layout);   // re-measure once the sheet has its final size
  }

  window.MediaEditor = { edit };
})();
