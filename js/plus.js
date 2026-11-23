/* plus.js — app-wide extras (v34). Local-first: settings live on this device.
   Tools live in plus-tools.js, games in plus-games.js, chat extras in chatplus.js. */
(() => {
  const P = (window.Plus = window.Plus || {});
  const VER = "34";
  const K = (k) => "tp_" + k;
  const get = (k, d) => store.get(K(k), d);
  const set = (k, v) => store.set(K(k), v);
  const esc = escapeHTML;
  const pad = (n) => String(n).padStart(2, "0");
  const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const root = document.documentElement;

  /* ---------- SVG icon set for every Plus feature (no emoji icons) ---------- */
  Object.assign(ICON_PATHS, {
    "tp-todo": '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 12.5l2.8 2.8L16.5 9"/>',
    "tp-hand": '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7"/><path d="M16 11l2 2 4-4"/>',
    "tp-exam": '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
    "tp-timer": '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6M12 2v3"/>',
    "tp-cards": '<rect x="2" y="7" width="14" height="14" rx="3"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>',
    "tp-calc": '<rect x="4" y="2" width="16" height="20" rx="3"/><path d="M8 6.5h8"/><path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18.5h.01M12 18.5h4"/>',
    "tp-note": '<path d="M5 3h14a1 1 0 0 1 1 1v11l-6 6H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 21v-6h6"/><path d="M8 8h8M8 12h5"/>',
    "tp-stopwatch": '<circle cx="12" cy="14" r="7.5"/><path d="M12 14v-4"/><path d="M10 2h4M19.5 6.5l1.5-1.5"/>',
    "tp-alarm": '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.2 2.2"/><path d="M5 3L2 6M19 3l3 3"/>',
    "tp-sprout": '<path d="M12 21v-9"/><path d="M12 12C12 7 8.5 4.5 4 4.5c0 5 3.5 7.5 8 7.5z"/><path d="M12 15c0-4 3-6.5 8-6.5 0 4-3 6.5-8 6.5z"/>',
    "tp-cake": '<path d="M4 21v-8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8"/><path d="M2 21h20"/><path d="M4 16c2 1.5 4 1.5 6 0s4-1.5 6 0 3 1 4 .5"/><path d="M12 11V7.5"/><path d="M12 5c.9-.9 1-1.8 0-3-1 1.2-.9 2.1 0 3z"/>',
    "tp-receipt": '<path d="M5 2v20l2.5-1.7L10 22l2-1.7 2 1.7 2.5-1.7L19 22V2l-2.5 1.7L14 2l-2 1.7L10 2 7.5 3.7z"/><path d="M9 9h6M9 13h6"/>',
    "tp-target": '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    "tp-coin": '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><path d="M12 9.5v5"/>',
    "tp-dice": '<rect x="3" y="3" width="18" height="18" rx="4.5"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01" stroke-width="3"/>',
    "tp-hash": '<path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
    "tp-c4": '<rect x="2" y="4" width="20" height="16" rx="3.5"/><circle cx="7" cy="10" r="1.6"/><circle cx="12" cy="10" r="1.6"/><circle cx="17" cy="10" r="1.6"/><circle cx="7" cy="15" r="1.6"/><circle cx="12" cy="15" r="1.6"/><circle cx="17" cy="15" r="1.6"/>',
    "tp-snake": '<path d="M20 5h-7a3.5 3.5 0 0 0 0 7h-2a3.5 3.5 0 0 0 0 7H4"/><path d="M20 5h.01" stroke-width="3.2"/>',
    "tp-brain": '<path d="M9.5 4A3 3 0 0 0 6.5 7 3 3 0 0 0 4.5 12a3 3 0 0 0 2 5 3 3 0 0 0 5.5 1.5V5.5A2 2 0 0 0 9.5 4z"/><path d="M14.5 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-5.5 1.5"/>',
    "tp-keyboard": '<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    "tp-sigma": '<path d="M18 5H6l6 7-6 7h12"/>',
    "tp-party": '<path d="M4 20l5-14 9 9z"/><path d="M14 4.5l1-2.5M19.5 9.5l2.5-1M17 6l2.5-2.5"/>',
    "tp-qr": '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM21 14v.01M14 21h.01M17.5 21H21v-3.5"/>',
    "tp-mail": '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
    "tp-bulb": '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
    "tp-unlock": '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>',
    "tp-eyeoff": '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 22 12a17 17 0 0 1-2.4 3.3M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    "tp-chart": '<path d="M3 3v18h18"/><path d="M8 17v-6M13 17V7M18 17v-4"/>',
    "tp-tag": '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    "tp-pin": '<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
    "tp-user": '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-7 8-7s8 3 8 7"/>',
    "tp-type": '<path d="M3 19l5-13 5 13"/><path d="M5 14.5h6"/><circle cx="17.5" cy="15.5" r="3"/><path d="M20.5 12.5V19"/>',
    "tp-sun": '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    "tp-moon": '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    "tp-sunset": '<path d="M12 10V3M5.5 11.5l1.4 1.4M18.5 11.5l-1.4 1.4M2 18h20M7 18a5 5 0 0 1 10 0M5 22h14"/>',
    "tp-cloudsun": '<path d="M12 2v2M4.9 4.9l1.4 1.4M2 12h2M15.9 6.1A4 4 0 0 0 8 8.5"/><path d="M17 20H8a4 4 0 1 1 .8-7.9A5 5 0 0 1 18 13a3.5 3.5 0 0 1-1 7z"/>',
    "tp-flame": '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 5-2 8 0 4 3 7 7 7z"/>',
    "tp-book": '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    "tp-phone": '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
    "tp-undo": '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    "tp-trophy": '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    "tp-coffee": '<path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M7 2v2M11 2v2M15 2v2"/>',
    "tp-checkc": '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16 9.5"/>',
    "tp-xc": '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
    "tp-8ball": '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10.5" r="3.5"/><path d="M12 9.2v2.6"/>',
    "tp-hand2": '<path d="M7 11V7a2 2 0 0 1 4 0v4M11 10V5.5a2 2 0 0 1 4 0V11M15 10a2 2 0 0 1 4 0v3a8 8 0 0 1-8 8H9.5A5.5 5.5 0 0 1 4 15.5V13a2 2 0 0 1 3-1.7"/>',
    "tp-slash": '<rect x="3" y="3" width="18" height="18" rx="4.5"/><path d="M14.5 7l-5 10"/>',
    "tp-shake": '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M3.5 8L2 12l1.5 4M20.5 8l1.5 4-1.5 4"/>',
    "tp-contrast": '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>',
    "tp-battery": '<rect x="2" y="7" width="17" height="10" rx="2.5"/><path d="M22 11v2M6 10.5v3"/>',
    "tp-drop": '<path d="M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z"/>',
    "tp-wave": '<path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/>',
    "tp-text": '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
    "tp-grid": '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    "tp-wall": '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5-9 11"/>',
    "tp-doodle": '<path d="M3 17c3-6 5 2 8-3s4-7 6-4-2 7 1 8 3-2 3-2"/>',
    "tp-rocket": '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3a15 15 0 0 1 12-9 15 15 0 0 1-9 12z"/><circle cx="14.5" cy="9.5" r="1.5"/>',
  });
  const I = (n, s = 18) => svgIcon(n, s);
  P.I = I;
  // sheet titles start with an emoji in code; show a matching SVG instead
  const TITLE_ICON = { "✅": "tp-todo", "📅": "calendar", "📝": "tp-exam", "🍅": "tp-timer", "⏱️": "tp-stopwatch", "🧮": "tp-calc", "🙋": "tp-hand", "🗒️": "tp-note", "🃏": "tp-cards", "🎯": "tp-target", "🪙": "tp-coin", "🌱": "tp-sprout", "🎂": "tp-cake", "⏰": "tp-alarm", "💸": "tp-receipt", "⭕": "tp-hash", "🐍": "tp-snake", "🧠": "tp-brain", "⚡": "bolt", "⌨️": "tp-keyboard", "➗": "tp-sigma", "🔴": "tp-c4", "🎉": "tp-party", "✨": "sparkle", "🎨": "palette", "🏷️": "tp-tag", "🔔": "bell", "👤": "tp-user", "📊": "tp-chart", "✏️": "tp-doodle", "📲": "tp-phone", "🔳": "tp-qr", "🐞": "bug", "🚀": "tp-rocket", "⬇️": "download", "🧰": "tp-grid", "✍️": "pen", "(◕‿◕) ": "smile", "Aa": "tp-type", "(◕‿◕)": "smile" };
  const EMO_LEAD = /^((?:\p{Extended_Pictographic}|\ufe0f|\u200d)+|Aa|\(◕‿◕\))\s*/u;
  P.get = get; P.set = set; P.dkey = dkey; P.pad = pad;

  // one helper for every sheet: auto-removes itself, runs cleanup
  P.sheet = (title, html, cls = "") => {
    const lead = (title || "").match(EMO_LEAD);
    const icon = lead && TITLE_ICON[lead[1]];
    const clean = lead ? title.slice(lead[0].length) : title;
    const s = makeSheet({ title: clean, html, className: "tp-sheet " + cls });
    if (icon && s.titleEl) s.titleEl.innerHTML = `<span class="tp-tic">${I(icon, 17)}</span>${escapeHTML(clean)}`;
    s.el.classList.add("tp-anim"); setTimeout(() => s.el.classList.remove("tp-anim"), 900);
    s.onClose = () => { try { s.cleanup && s.cleanup(); } catch {} setTimeout(() => s.el.remove(), 300); };
    s.open();
    return s;
  };
  P.after = (fn) => setTimeout(fn, 80);   // open a sheet after closing another

  /* ---------- prefs ---------- */
  const DEF = { haptics: true, sounds: true, batt: true, shake: true, privacy: false, gray: false, warm: false, still: false, contrast: false, readable: false, autoDark: false, breakMin: 0, bedtime: "" };
  P.prefs = () => ({ ...DEF, ...get("prefs", {}) });
  P.setPref = (k, v) => { set("prefs", { ...get("prefs", {}), [k]: v }); applyPrefs(); };

  const realVibrate = navigator.vibrate ? navigator.vibrate.bind(navigator) : null;
  function applyPrefs() {
    const p = P.prefs();
    root.style.filter = [p.gray && "grayscale(1)", p.contrast && "contrast(1.15)"].filter(Boolean).join(" ");
    root.toggleAttribute("data-tp-still", !!(p.still || P._battLow));
    root.toggleAttribute("data-tp-readable", !!p.readable);
    let warm = document.getElementById("tpWarm");
    if (p.warm && !warm) { warm = document.createElement("div"); warm.id = "tpWarm"; document.body.appendChild(warm); }
    if (!p.warm && warm) warm.remove();
    if (realVibrate) navigator.vibrate = p.haptics ? realVibrate : () => false;
    if (p.autoDark && (store.raw("teaofrpm_theme") || "light") !== "dark") {
      const h = new Date().getHours();
      if (h >= 19 || h < 7) root.setAttribute("data-theme", "dark"); else root.removeAttribute("data-theme");
    }
  }
  P.applyPrefs = applyPrefs;

  /* ---------- sounds (tiny synth, no files) ---------- */
  let ac = null;
  P.sound = (kind = "tick") => {
    if (!P.prefs().sounds) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const notes = { send: [660, 990], recv: [880, 660], done: [523, 659, 784, 1047], tick: [1200], win: [523, 784, 1047, 1319], lose: [330, 247] }[kind] || [800];
      notes.forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.09;
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.18);
      });
    } catch {}
  };
  P.buzz = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  /* ---------- notifications ---------- */
  P.notify = async (title, body, url) => {
    try {
      if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) return reg.showNotification(title, { body, icon: "images/icon-192.png", data: { url } });
        return new Notification(title, { body, icon: "images/icon-192.png" });
      }
    } catch {}
    toast(`${title}${body ? " — " + body : ""}`, 5000);
  };
  P.askNotify = () => { try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {} };

  /* ---------- app lock (PIN) ---------- */
  const hash = async (pin) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("tp:" + pin)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const beat = () => store.setRaw(K("seen"), String(Date.now()));

  /* fingerprint / face unlock (WebAuthn platform authenticator, stays on this device) */
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  P.bioAvailable = async () => { try { return !!window.PublicKeyCredential && window.isSecureContext && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; } };
  P.bioEnrolled = () => !!store.raw(K("bio"));
  P.bioEnroll = async () => {
    if (P.bioEnrolled()) return true;
    if (!(await P.bioAvailable())) return false;
    try {
      const u = App.me || {};
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "teaofrpm" },
        user: { id: new TextEncoder().encode(String(u.id || "me")).slice(0, 64), name: u.username || "me", displayName: u.display_name || "me" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
        timeout: 60000, attestation: "none",
      } });
      if (!cred) return false;
      store.setRaw(K("bio"), b64(cred.rawId));
      return true;
    } catch { return false; }
  };
  P.bioCheck = async () => {
    const id = store.raw(K("bio")); if (!id) return false;
    try {
      const a = await navigator.credentials.get({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: "public-key", id: unb64(id), transports: ["internal", "hybrid"] }],
        userVerification: "required", timeout: 60000,
      } });
      return !!a;
    } catch { return false; }
  };
  P.bioOffer = async () => {
    if (P.bioEnrolled() || !(await P.bioAvailable())) return;
    if (await P.bioEnroll()) toast("Fingerprint / Face unlock on ✓");
  };

  P.askPin = (title, check) => new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "tp-lock";
    const bio = !!check && P.bioEnrolled();
    ov.innerHTML = `<div class="tp-lock-box"><img src="images/icon.svg" alt="" class="tp-lock-logo"><b>${esc(title)}</b><div class="tp-dots">${"<i></i>".repeat(4)}</div><small class="tp-lock-msg"></small>
      <div class="tp-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((k) => k === "" ? (bio ? `<button type="button" class="tp-bio" data-bio aria-label="Use fingerprint or face"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 11c0 3-1 6-3 8"/><path d="M8 5.5A7 7 0 0 1 19 11c0 2-.3 4-1 6"/><path d="M5 9a7 7 0 0 1 1.5-2.5"/><path d="M5 13c0 1.5-.3 3-1 4"/><path d="M9 11a3 3 0 0 1 6 0c0 3.5-.8 6.5-2.5 9"/><path d="M15.5 15.5c-.2 1.5-.6 3-1.2 4.5"/></svg></button>` : "<span></span>") : `<button type="button" data-k="${k}">${k}</button>`).join("")}</div>
      ${check ? `<button type="button" class="tp-lock-forgot">Forgot PIN? Log out</button>` : `<button type="button" class="tp-lock-forgot" data-cancel>Cancel</button>`}</div>`;
    document.body.appendChild(ov);
    const tryBio = async () => { if (!ov.isConnected) return; if (await P.bioCheck()) { P.buzz(12); done(true); } };
    if (bio) setTimeout(tryBio, 250);   // most phones allow it straight away; otherwise the button does it
    ov.addEventListener("click", (e) => { if (e.target.closest("[data-bio]")) tryBio(); });
    let pin = "", fails = 0, waitTill = 0;
    const dots = ov.querySelectorAll(".tp-dots i"), msg = ov.querySelector(".tp-lock-msg");
    const paint = () => dots.forEach((d, i) => d.classList.toggle("on", i < pin.length));
    const done = (v) => { ov.classList.add("out"); setTimeout(() => ov.remove(), 220); resolve(v); };
    const press = async (k) => {
      if (Date.now() < waitTill) return;
      if (k === "⌫") pin = pin.slice(0, -1); else if (pin.length < 4) pin += k;
      paint(); P.buzz(8);
      if (pin.length < 4) return;
      if (!check) return done(pin);
      if (await check(pin)) return done(true);
      fails++; pin = ""; paint();
      ov.querySelector(".tp-dots").classList.add("shake"); setTimeout(() => ov.querySelector(".tp-dots")?.classList.remove("shake"), 400);
      if (fails >= 5) { waitTill = Date.now() + 30000; msg.textContent = "Too many tries — wait 30s"; setTimeout(() => (msg.textContent = ""), 30000); fails = 0; }
      else msg.textContent = "Wrong PIN";
    };
    ov.addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]"); if (b) return press(b.dataset.k);
      if (e.target.closest("[data-cancel]")) return done(null);
      if (e.target.closest(".tp-lock-forgot")) { set("pin", null); try { logoutUser(false).finally(() => location.replace("index.html")); } catch { location.replace("index.html"); } }
    });
    const kd = (e) => { if (!ov.isConnected) return removeEventListener("keydown", kd); if (/^\d$/.test(e.key)) press(e.key); else if (e.key === "Backspace") press("⌫"); };
    addEventListener("keydown", kd);
  });
  let locking = false;
  async function maybeLock() {
    const h = get("pin"); if (!h || locking) return;
    const seen = Number(store.raw(K("seen")) || 0);
    if (Date.now() - seen < 60000) return;
    locking = true;
    await P.askPin("Enter PIN", async (pin) => (await hash(pin)) === h);
    locking = false; beat();
  }
  P.setupPin = async () => {
    if (get("pin")) { set("pin", null); toast("App lock off"); return true; }
    const a = await P.askPin("Choose a 4-digit PIN"); if (!a) return false;
    const b = await P.askPin("Type it again"); if (!b) return false;
    if (a !== b) { toast("PINs didn't match"); return false; }
    set("pin", await hash(a)); beat(); toast("🔒 App lock on — asks after 1 min away");
    setTimeout(() => P.bioOffer(), 600);
    return true;
  };
  P.hash = hash;

  /* ---------- privacy screen + heartbeat + screen time ---------- */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { beat(); if (P.prefs().privacy) root.setAttribute("data-tp-hide", ""); }
    else { root.removeAttribute("data-tp-hide"); maybeLock(); beat(); applyPrefs(); }
  });
  addEventListener("pagehide", beat);
  setInterval(() => {
    if (document.hidden) return;
    beat();
    const st = get("st", {}); const k = dkey();
    st[k] = (st[k] || 0) + 15;
    const keys = Object.keys(st).sort(); while (keys.length > 21) delete st[keys.shift()];
    set("st", st);
    // break reminder
    const p = P.prefs();
    P._session = (P._session || 0) + 15;
    if (p.breakMin && P._session >= p.breakMin * 60) { P._session = 0; P.buzz([60, 60, 60]); P.notify("Break time 🧘", "Rest your eyes — take a 2 min break"); }
  }, 15000);
  P.streak = () => {
    const days = new Set(Object.keys(get("st", {}))); let n = 0; const d = new Date();
    while (days.has(dkey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  };
  P.fmtDur = (s) => s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.max(0, Math.round(s / 60))}m`;

  /* ---------- reminders (from chat) + birthdays + bedtime ---------- */
  P.addReminder = (at, text, url) => { const l = get("rem", []); l.push({ id: Date.now().toString(36), at, text, url }); set("rem", l); P.askNotify(); };
  function tickReminders() {
    const l = get("rem", []); if (!l.length) return;
    const now = Date.now(), due = l.filter((r) => r.at <= now);
    if (!due.length) return;
    set("rem", l.filter((r) => r.at > now));
    due.forEach((r) => { P.sound("done"); P.buzz([80, 60, 80]); P.notify("⏰ Reminder", r.text.slice(0, 120), r.url); if (r.url && !document.hidden) setTimeout(() => { if (confirm(`⏰ ${r.text.slice(0, 120)}\n\nOpen the chat?`)) location.href = r.url; }, 300); });
  }
  setInterval(tickReminders, 20000);
  function checkDaily() {
    const t = dkey();
    const md = t.slice(5);
    const bdays = get("bdays", []).filter((b) => b.date && b.date.slice(5) === md);
    if (bdays.length && get("bday_shown") !== t) {
      set("bday_shown", t);
      setTimeout(() => { P.sheet("🎂 Birthday today!", `<div class="tp-center"><div class="tp-big tp-bigic">${I("tp-cake", 44)}</div><p>It's <b>${bdays.map((b) => esc(b.name)).join(", ")}</b>'s birthday today! Don't forget to wish them.</p><a class="btn" href="messages.html" style="margin-top:10px">Send a wish</a></div>`); P.sound("win"); }, 1200);
    }
    const bt = P.prefs().bedtime;
    if (bt) {
      const [h, m] = bt.split(":").map(Number), now = new Date(), b = new Date(); b.setHours(h, m, 0, 0);
      let diff = now - b; if (diff < -12 * 3600e3) diff += 24 * 3600e3;
      if (diff >= 0 && diff < 3 * 3600e3 && get("bed_shown") !== t) { set("bed_shown", t); P.notify("😴 Bedtime", "Time to sleep — school tomorrow. Put the phone away."); }
    }
  }
  setInterval(checkDaily, 60000);

  /* ---------- offline banner ---------- */
  const net = (on) => {
    let b = document.getElementById("tpNet");
    if (!b) { b = document.createElement("div"); b.id = "tpNet"; document.body.appendChild(b); }
    b.innerHTML = on ? `${I("tp-checkc", 15)}<span>Back online</span>` : `${I("tp-wave", 15)}<span>You're offline — messages will send when you're back</span>`;
    b.className = on ? "on show" : "show";
    clearTimeout(b._t); if (on) b._t = setTimeout(() => (b.className = "on"), 2200);
  };
  addEventListener("offline", () => net(false));
  addEventListener("online", () => net(true));

  /* ---------- install app ---------- */
  let deferredInstall = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; document.querySelectorAll("[data-tp-install]").forEach((x) => (x.hidden = false)); });
  P.canInstall = () => !matchMedia("(display-mode: standalone)").matches && !navigator.standalone;
  P.install = async () => {
    if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; return; }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    P.sheet("📲 Install the app", `<div class="tp-steps">${ios
      ? `<p>1. In Safari, tap <b>Share</b> ⬆️ at the bottom</p><p>2. Choose <b>Add to Home Screen</b></p><p>3. Tap <b>Add</b> — done!</p>`
      : `<p>1. Open the browser menu <b>⋮</b></p><p>2. Tap <b>Install app</b> / <b>Add to Home screen</b></p><p>3. The app icon appears on your home screen</p>`}</div>`);
  };

  /* ---------- update ready ---------- */
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      const b = document.createElement("button");
      b.className = "tp-update"; b.type = "button"; b.innerHTML = `${I("sparkle", 15)}<span>New version ready — tap to refresh</span>`;
      b.onclick = () => location.reload(); document.body.appendChild(b);
    });
  }

  /* ---------- back to top (any long scroller) ---------- */
  // removed on request: the floating ↑ button got in the way (home, messages, reels)
  let topBtn = null, topScroller = null;
  if (false) addEventListener("scroll", (e) => {
    if (PAGE === "room.html") return;
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!el || el.scrollHeight < 2600 || el.closest?.(".app-sheet, .tp-sheet")) return;
    topScroller = el;
    if (!topBtn) {
      topBtn = document.createElement("button"); topBtn.type = "button"; topBtn.className = "tp-top"; topBtn.setAttribute("aria-label", "Back to top"); topBtn.textContent = "↑";
      topBtn.onclick = () => { topScroller.scrollTo({ top: 0, behavior: "smooth" }); P.buzz(8); };
      document.body.appendChild(topBtn);
    }
    topBtn.classList.toggle("show", el.scrollTop > 1400);
  }, true);

  /* ---------- pull to refresh ---------- */
  if (["home.html", "messages.html", "discover.html", "profile.html", "tools.html"].includes(PAGE) && matchMedia("(pointer: coarse)").matches) {
    let y0 = null, x0 = 0, dy = 0, sc = null, ind = null;
    addEventListener("touchstart", (e) => {
      if (document.querySelector(".app-sheet-backdrop.show, .story-viewer.show, .tp-lock")) return;
      sc = e.target.closest?.("[id$='Scroll'], .home-body, .profile-scroll") || document.scrollingElement;
      if ((sc.scrollTop || 0) > 0 || document.scrollingElement.scrollTop > 0) { y0 = null; return; }
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0;
    }, { passive: true });
    addEventListener("touchmove", (e) => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (Math.abs(e.touches[0].clientX - x0) > Math.abs(dy) || dy < 12) { if (ind) ind.style.transform = "translate(-50%,-60px)"; return; }
      if (!ind) { ind = document.createElement("div"); ind.className = "tp-ptr"; ind.textContent = "↻"; document.body.appendChild(ind); }
      const d = Math.min(dy, 140);
      ind.style.transform = `translate(-50%, ${d * 0.6 - 40}px) rotate(${d * 3}deg)`;
      ind.classList.toggle("ready", dy > 90);
    }, { passive: true });
    addEventListener("touchend", () => {
      if (y0 == null) return;
      if (ind) { if (dy > 90) { ind.classList.add("spin"); P.buzz(15); setTimeout(() => location.reload(), 250); } else ind.style.transform = "translate(-50%,-60px)"; }
      y0 = null;
    });
  }

  /* ---------- battery saver ---------- */
  navigator.getBattery?.().then((b) => {
    const chk = () => {
      const low = P.prefs().batt && b.level <= 0.2 && !b.charging;
      if (low && !P._battLow && get("batt_toast") !== dkey()) { set("batt_toast", dkey()); toast("🔋 Battery low — animations paused to save power"); }
      P._battLow = low; applyPrefs();
    };
    chk(); b.addEventListener("levelchange", chk); b.addEventListener("chargingchange", chk);
  }).catch(() => {});

  /* ---------- shake to report a problem ---------- */
  let shakes = [];
  addEventListener("devicemotion", (e) => {
    const a = e.accelerationIncludingGravity; if (!a || !P.prefs().shake) return;
    const g = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
    if (g < 28) return;
    const now = Date.now(); shakes = shakes.filter((t) => now - t < 1200); shakes.push(now);
    if (shakes.length >= 3 && !document.querySelector(".tp-fb")) { shakes = []; P.feedback(true); }
  });
  P.feedback = (fromShake) => {
    let kind = "bug";
    const s = P.sheet(fromShake ? "Shake detected — report a problem?" : "Report a problem or idea", `
      <div class="fb-kinds"><button type="button" data-k="bug" class="on">${I("bug", 16)} Bug</button><button type="button" data-k="idea">${I("tp-bulb", 16)} Idea</button><button type="button" data-k="other">${I("tp-mail", 16)} Other</button></div>
      <textarea class="fb-text" maxlength="2000" rows="4" placeholder="Kya hua? Kaunsa page, kya dabaya…"></textarea>
      <button type="button" class="btn tp-fbsend" style="width:100%;margin-top:10px">Send to the team</button>
      ${fromShake ? `<p class="x3-hint" style="margin-top:8px">You can turn off shake-to-report in Plus settings.</p>` : ""}`, "tp-fb");
    s.body.querySelector(".fb-kinds").onclick = (e) => { const b = e.target.closest("[data-k]"); if (!b) return; kind = b.dataset.k; s.body.querySelectorAll(".fb-kinds button").forEach((x) => x.classList.toggle("on", x === b)); };
    s.body.querySelector(".tp-fbsend").onclick = async (e) => {
      const body = s.body.querySelector(".fb-text").value.trim(); if (body.length < 3) return toast("Add a little more detail");
      e.target.disabled = true;
      const { error } = await sb.from("feedback").insert({ user_id: App.me.id, kind, body, page: `${PAGE} · ${innerWidth}px` });
      if (error) { e.target.disabled = false; return toast(friendlyError(error, "Could not send.")); }
      s.close(); toast("Sent — thank you! 🙏");
    };
  };

  /* ---------- share / QR / export / storage ---------- */
  const base = () => location.href.replace(/[^/]*([?#].*)?$/, "");
  P.myLink = () => `${base()}profile.html?u=${encodeURIComponent(App.me?.username || "")}`;
  P.share = async (title, text, url) => {
    try { if (navigator.share) { await navigator.share({ title, text, url }); return; } } catch (e) { if (e?.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url ? `${text} ${url}` : text); toast("Copied ✅"); } catch { prompt("Copy this:", url || text); }
  };
  P.invite = () => P.share("teaofrpm", "Join me on teaofrpm — our school's own chat app ☕", base() + "index.html");
  let qrLib = null;
  P.qr = async () => {
    const s = P.sheet("🔳 My QR code", `<div class="tp-center"><div class="tp-qr"></div><p class="x3-hint">Scan to open my profile</p>
      <div class="tp-row2"><button type="button" class="btn btn-small" data-s>Share link</button><button type="button" class="btn btn-small btn-ghost" data-d>Save image</button></div></div>`);
    qrLib = qrLib || new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
    try { await qrLib; new QRCode(s.body.querySelector(".tp-qr"), { text: P.myLink(), width: 220, height: 220, colorDark: "#2b0a3d", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M }); }
    catch { s.body.querySelector(".tp-qr").textContent = "Could not load QR (offline?)"; }
    s.body.querySelector("[data-s]").onclick = () => P.share("My profile", `@${App.me.username} on teaofrpm`, P.myLink());
    s.body.querySelector("[data-d]").onclick = () => { const c = s.body.querySelector(".tp-qr canvas"); if (!c) return; const a = document.createElement("a"); a.download = `teaofrpm-${App.me.username}.png`; a.href = c.toDataURL("image/png"); a.click(); };
  };
  P.exportData = async () => {
    toast("Preparing your data…");
    const id = App.me.id;
    const [pr, po, ms] = await Promise.all([
      sb.from("profiles").select("*").eq("id", id).maybeSingle(),
      sb.from("posts").select("*").eq("user_id", id).limit(2000),
      sb.from("messages").select("id,conversation_id,content,image_url,video_url,audio_url,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(5000),
    ]);
    const local = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("tp_") && k !== "tp_pin") local[k] = localStorage.getItem(k); }
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), profile: pr.data, posts: po.data || [], my_messages: ms.data || [], device_tools: local }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `teaofrpm-my-data-${dkey()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  P.storage = async () => {
    const est = await navigator.storage?.estimate?.().catch(() => null);
    return est ? `${(est.usage / 1048576).toFixed(1)} MB used` : "—";
  };
  P.clearCache = async () => {
    if (!confirm("Clear the app cache? Your login and settings stay.")) return;
    try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
    try { sessionStorage.clear(); } catch {}
    toast("Cache cleared — reloading…"); setTimeout(() => location.reload(), 700);
  };

  /* ---------- shortcuts + command palette ---------- */
  const PAGES = [["Home", "home.html", "home"], ["Messages", "messages.html", "chat"], ["Discover", "discover.html", "search"], ["Reels", "reels.html", "play"], ["Profile", "profile.html", "users"], ["Settings", "settings.html", "palette"], ["Tools & games", "tools.html", "tp-grid"]];
  P.palette = async () => {
    if (document.querySelector(".tp-pal")) return;
    const s = P.sheet("", `<input type="search" class="tp-pal-in" placeholder="Search pages, tools, people…" autocomplete="off"><div class="tp-pal-list"></div>`, "tp-pal");
    const inp = s.body.querySelector("input"), list = s.body.querySelector(".tp-pal-list");
    let people = [], pq = "";
    const findPeople = debounce(async (q) => {
      try { const l = await peopleFor(q); if (inp.value.trim().toLowerCase() === q) { people = l; pq = q; paint(); } } catch {}
    }, 180);
    const tools = (P.toolList || []).map((t) => [t.name, () => P.openTool(t.key), t.icon]);
    const acts = [["Plus settings", () => P.openSettings(), "sparkle"], ["My QR code", () => P.qr(), "tp-qr"], ["Invite friends", () => P.invite(), "tp-mail"], ["Report a problem", () => P.feedback(), "bug"], ["Keyboard shortcuts", () => P.help(), "tp-keyboard"]];
    const run = (fn) => { s.close(); P.after(fn); };
    const paint = () => {
      const q = inp.value.trim().toLowerCase();
      const m = (t) => !q || t.toLowerCase().includes(q);
      const rows = [
        ...PAGES.filter(([n]) => m(n)).map(([n, h, ic]) => `<a href="${h}" class="tp-pal-row"><b>${svgIcon(ic, 16)}</b><span>${n}</span><em>Page</em></a>`),
        ...tools.filter(([n]) => m(n)).map(([n, , e], i) => `<button type="button" class="tp-pal-row" data-t="${esc(n)}"><b>${I(e, 16)}</b><span>${esc(n)}</span><em>Tool</em></button>`),
        ...acts.filter(([n]) => m(n)).map(([n, , e]) => `<button type="button" class="tp-pal-row" data-a="${esc(n)}"><b>${I(e, 16)}</b><span>${esc(n)}</span><em>Action</em></button>`),
        ...(q.length >= 2 && pq === q ? people.slice(0, 8)
          .map((p) => `<a href="profile.html?u=${encodeURIComponent(p.username)}" class="tp-pal-row"><b>${I("tp-user", 16)}</b><span>${esc(p.display_name)} <small>@${esc(p.username)}</small></span><em>Person</em></a>`) : []),
      ];
      list.innerHTML = rows.join("") || `<div class="settings-empty">Nothing found</div>`;
    };
    paint();
    inp.addEventListener("input", () => { paint(); const q = inp.value.trim().toLowerCase(); if (q.length >= 2 && q !== pq) findPeople(q); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") list.querySelector(".tp-pal-row")?.click(); });
    list.addEventListener("click", (e) => {
      const t = e.target.closest("[data-t]"); if (t) return run(tools.find(([n]) => n === t.dataset.t)[1]);
      const a = e.target.closest("[data-a]"); if (a) return run(acts.find(([n]) => n === a.dataset.a)[1]);
    });
    setTimeout(() => inp.focus(), 200);
  };
  P.help = () => P.sheet("⌨️ Keyboard shortcuts", `<div class="tp-keys">${[["Ctrl K", "Search everything"], ["g h", "Home"], ["g m", "Messages"], ["g d", "Discover"], ["g r", "Reels"], ["g p", "Profile"], ["g s", "Settings"], ["g t", "Tools & games"], ["?", "This help"], ["Esc", "Close"], ["Ctrl B / I", "Bold / italic in chat"]].map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join("")}</div>`);
  let gAt = 0;
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); P.palette(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".tp-lock")) return;
    if (e.key === "?") { P.help(); return; }
    if (e.key === "g") { gAt = Date.now(); return; }
    if (Date.now() - gAt < 1200) {
      const to = { h: "home.html", m: "messages.html", d: "discover.html", r: "reels.html", p: "profile.html", s: "settings.html", t: "tools.html" }[e.key];
      gAt = 0; if (to) location.href = to;
    }
  });

  /* ---------- what's new ---------- */
  function whatsNew() {
    if (get("seen_ver") === VER || PAGE === "room.html") return;
    set("seen_ver", VER);
    if (!get("seen_ver_any")) { set("seen_ver_any", 1); }
    P.sheet("✨ What's new", `<div class="tp-new">
      <p>${I("tp-grid", 16)} <b>Tools & games</b> — homework, timetable, attendance (75% calculator!), exams, focus timer, flashcards, notes + 6 games</p>
      <p>${I("chat", 16)} <b>Chat</b> — double-tap heart, fancy fonts, /commands, spoilers ||like this||, translate, remind me, doodle, location, wallpaper, chat lock</p>
      <p>${I("sparkle", 16)} <b>Plus settings</b> — app lock PIN, grayscale, night light, data saver, break & bedtime reminders, screen time</p>
      <p>${I("tp-keyboard", 16)} <b>Ctrl K</b> search everything · pull down to refresh · shake to report a bug</p>
      <a class="btn" href="tools.html" style="width:100%;margin-top:8px">Open Tools & games</a></div>`);
  }

  /* ---------- home greeting card ---------- */
  const QUOTES = ["Study first, party later 📚➡️🎉", "Small steps every day = big results.", "Do today's work today — don't push it to tomorrow.", "Discipline > motivation.", "Mistakes are proof you're trying.", "A little every day adds up to a lot.", "Be the friend you want to have.", "Focus on progress, not perfection.", "Dreams are the ones that don't let you sleep.", "Hard work beats talent when talent doesn't work hard.", "Kindness is free — use it a lot.", "One hour without the phone = one chapter done ✅"];
  P.quote = () => QUOTES[Math.floor(Date.now() / 864e5) % QUOTES.length];
  function greet() {
    const feed = document.getElementById("feed"); if (!feed || get("greet_hide") === dkey() || document.querySelector(".tp-greet")) return;
    const h = new Date().getHours(), name = (App.me?.display_name || "").split(" ")[0];
    const hi = h < 5 ? "Still awake" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 21 ? "Good evening" : "Good night";
    const ic = I(h < 5 ? "tp-moon" : h < 12 ? "tp-sun" : h < 17 ? "tp-cloudsun" : h < 21 ? "tp-sunset" : "tp-moon", 22);
    const bits = [];
    const nc = P.nextClass?.(); if (nc) bits.push(`${I("tp-book", 14)} Next: <b>${esc(nc.sub)}</b> at ${esc(nc.time)}`);
    const ex = P.nextExam?.(); if (ex) bits.push(`${I("tp-exam", 14)} <b>${esc(ex.name)}</b> in ${ex.days === 0 ? "<b>today!</b>" : `${ex.days} day${ex.days > 1 ? "s" : ""}`}`);
    const hw = P.hwDue?.(); if (hw) bits.push(`${I("tp-todo", 14)} ${hw} homework pending`);
    const c = document.createElement("div");
    c.className = "tp-greet";
    c.innerHTML = `<button type="button" class="tp-greet-x" aria-label="Hide for today">${svgIcon("close", 13)}</button>
      <div class="tp-greet-hi">${ic}<span>${hi}${name ? `, ${esc(name)}` : ""}</span></div>
      ${bits.length ? `<div class="tp-greet-bits">${bits.map((b) => `<span>${b}</span>`).join("")}</div>` : ""}
      <div class="tp-greet-q">“${esc(P.quote())}”</div>
      <a class="tp-greet-btn" href="tools.html">${I("tp-grid", 15)} Tools & games</a>`;
    c.querySelector(".tp-greet-x").onclick = () => { set("greet_hide", dkey()); c.remove(); };
    feed.prepend(c);
  }

  /* ---------- focus mode (pomodoro running) chip on every page ---------- */
  function focusChip() {
    const st = get("pomo"); let chip = document.getElementById("tpFocus");
    if (!st || !st.endAt) { chip?.remove(); return; }
    if (!chip) { chip = document.createElement("a"); chip.id = "tpFocus"; chip.href = "tools.html#focus"; document.body.appendChild(chip); }
    const left = Math.max(0, Math.round((st.endAt - Date.now()) / 1000));
    chip.innerHTML = `${I(st.phase === "break" ? "tp-coffee" : "tp-timer", 15)}<span>${pad(Math.floor(left / 60))}:${pad(left % 60)}</span>`;
    if (left === 0) P.pomoNext?.();
    if (st.phase === "focus" && st.block && PAGE === "home.html" && !document.querySelector(".tp-block")) {
      const b = document.createElement("div"); b.className = "tp-block";
      b.innerHTML = `<div><div class="tp-big tp-bigic">${I("tp-timer", 44)}</div><b>Focus mode on</b><p>Feed hidden till the timer ends. Stay focused.</p><a class="btn" href="tools.html#focus">Open timer</a> <a class="btn btn-ghost" href="messages.html">Messages</a></div>`;
      document.body.appendChild(b);
    }
    if ((st.phase !== "focus" || !st.block) && document.querySelector(".tp-block")) document.querySelector(".tp-block").remove();
  }
  setInterval(focusChip, 1000);

  /* ---------- Plus settings sheet ---------- */
  P.openSettings = async () => {
    const p = P.prefs();
    const st = get("st", {}); const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return [d.toLocaleDateString([], { weekday: "narrow" }), st[dkey(d)] || 0]; });
    const max = Math.max(60, ...days.map((d) => d[1]));
    const tg = (k, label, sub) => `<label class="tp-tg"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}</span><input type="checkbox" data-p="${k}" ${p[k] ? "checked" : ""}><i></i></label>`;
    const s = P.sheet("✨ Plus settings", `
      <div class="tp-st"><div class="tp-st-top"><div><small>Today</small><b>${P.fmtDur(st[dkey()] || 0)}</b></div><div><small>Streak</small><b>${I("tp-flame", 17)} ${P.streak()} days</b></div></div>
        <div class="tp-bars">${days.map(([l, v]) => `<div><i style="height:${Math.max(4, (v / max) * 60)}px"></i><small>${l}</small></div>`).join("")}</div></div>
      <div class="settings-group-title">Privacy</div>
      <label class="tp-tg"><span><b>App lock (PIN)</b><small>Asks for a PIN after 1 minute away</small></span><input type="checkbox" data-pin ${get("pin") ? "checked" : ""}><i></i></label>
      ${tg("privacy", "Hide app in switcher", "Blurs the screen when you leave the app")}
      <div class="settings-group-title">Comfort</div>
      ${tg("gray", "Grayscale", "Less colourful = less addictive")}
      ${tg("warm", "Night light", "Warm screen for late nights")}
      ${tg("autoDark", "Dark after 7 PM", "Switches to dark mode at night automatically")}
      ${tg("still", "Reduce motion", "Turns off animations")}
      ${tg("contrast", "High contrast", "")}
      ${tg("readable", "Easier reading", "More space between letters and lines")}
      ${tg("haptics", "Vibration", "")}
      ${tg("sounds", "Sound effects", "Send, receive, timers and games")}
      ${tg("batt", "Battery saver", "Pause animations below 20% battery")}
      ${tg("shake", "Shake to report a problem", "")}
      <div class="settings-group-title">Wellbeing</div>
      <label class="tp-tg"><span><b>Break reminder</b><small>Nudge after using the app for a while</small></span><select data-v="breakMin">${[0, 20, 30, 45, 60, 90].map((m) => `<option value="${m}" ${p.breakMin === m ? "selected" : ""}>${m ? m + " min" : "Off"}</option>`).join("")}</select></label>
      <label class="tp-tg"><span><b>Bedtime reminder</b><small>A nudge to sleep</small></span><input type="time" data-v="bedtime" value="${esc(p.bedtime)}"></label>
      <div class="settings-group-title">App</div>
      <div class="tp-btns">
        ${P.canInstall() ? `<button type="button" data-x="install">${I("tp-phone", 17)}<span>Install app</span></button>` : ""}
        <button type="button" data-x="qr">${I("tp-qr", 17)}<span>My QR code</span></button><button type="button" data-x="invite">${I("tp-mail", 17)}<span>Invite friends</span></button>
        <button type="button" data-x="export">${I("download", 17)}<span>Download my data</span></button><button type="button" data-x="cache">${I("trash", 17)}<span>Clear cache <small class="tp-mb"></small></span></button>
        <button type="button" data-x="keys">${I("tp-keyboard", 17)}<span>Shortcuts</span></button><button type="button" data-x="fb">${I("bug", 17)}<span>Report a problem</span></button>
      </div>`);
    P.storage().then((t) => { const el = s.body.querySelector(".tp-mb"); if (el) el.textContent = `(${t})`; });
    s.body.addEventListener("change", async (e) => {
      const c = e.target;
      if (c.dataset.p) P.setPref(c.dataset.p, c.checked);
      if (c.dataset.v) P.setPref(c.dataset.v, c.dataset.v === "breakMin" ? Number(c.value) : c.value);
      if (c.hasAttribute("data-pin")) { const ok = await P.setupPin(); c.checked = !!get("pin"); if (!ok) c.checked = !!get("pin"); }
      if (c.dataset.v === "bedtime" || c.dataset.v === "breakMin") P.askNotify();
    });
    s.body.addEventListener("click", (e) => {
      const x = e.target.closest("[data-x]")?.dataset.x; if (!x) return;
      const fn = { install: P.install, qr: P.qr, invite: P.invite, export: P.exportData, cache: P.clearCache, keys: P.help, fb: () => P.feedback() }[x];
      if (["export", "cache", "invite", "install"].includes(x)) fn(); else { s.close(); P.after(fn); }
    });
  };

  /* ---------- settings page rows ---------- */
  function settingsRows() {
    const anchor = document.getElementById("feedbackRow"); if (!anchor || document.getElementById("tpRows")) return;
    const wrap = document.createElement("div"); wrap.id = "tpRows";
    wrap.innerHTML = `
      <a class="settings-row" href="tools.html"><span class="settings-row-icon">${I("tp-grid", 18)}</span><span class="settings-row-text"><b>Tools & games</b><span>Homework, timetable, attendance, focus timer, games</span></span><span class="settings-row-chevron">${svgIcon("chevron", 16)}</span></a>
      <button class="settings-row" type="button" data-tp="plus"><span class="settings-row-icon">${I("sparkle", 18)}</span><span class="settings-row-text"><b>Plus settings</b><span>App lock, screen time, night light, reminders</span></span><span class="settings-row-chevron">${svgIcon("chevron", 16)}</span></button>
      <button class="settings-row" type="button" data-tp="qr"><span class="settings-row-icon">${I("tp-qr", 18)}</span><span class="settings-row-text"><b>My QR code</b><span>Share your profile in one scan</span></span><span class="settings-row-chevron">${svgIcon("chevron", 16)}</span></button>
      <button class="settings-row" type="button" data-tp="install" data-tp-install ${P.canInstall() ? "" : "hidden"}><span class="settings-row-icon">${I("tp-phone", 18)}</span><span class="settings-row-text"><b>Install app</b><span>Works like a real app from your home screen</span></span><span class="settings-row-chevron">${svgIcon("chevron", 16)}</span></button>`;
    anchor.parentNode.insertBefore(wrap, anchor);
    wrap.addEventListener("click", (e) => { const t = e.target.closest("[data-tp]")?.dataset.tp; if (t) ({ plus: P.openSettings, qr: P.qr, install: P.install })[t](); });
  }


  /* ---------- feel: ripples, image fade-in, switch haptics ---------- */
  const RIP = ".tp-tile, .tp-pal-row, .cp-fun button, .cp-info-grid button, .tp-btns button, .settings-row, .thread-row, .x3-tile, .tp-item, .tp-note";
  document.addEventListener("pointerdown", (e) => {
    if (P.prefs().still || root.hasAttribute("data-tp-still")) return;
    const el = e.target.closest(RIP); if (!el) return;
    const r = el.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.classList.add("tp-ripple-host");
    const s = document.createElement("span"); s.className = "tp-rip";
    s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    el.appendChild(s); setTimeout(() => s.remove(), 700);
  }, { passive: true });
  document.addEventListener("load", (e) => {
    const im = e.target;
    // only feed/post photos fade in; chat, avatars, reels and stickers must never flash
    if (im.tagName !== "IMG" || im.closest(".tp-qr, #messages, .messages, .avatar, .reel, .story-ring, .sticker, .mf-row, .app-sheet-handle") || (im.naturalWidth < 80 && im.naturalHeight < 80)) return;
    if (im.dataset.tpSeen) return;   // a re-load of the same <img> (src swap) shouldn't fade again
    im.dataset.tpSeen = "1";
    im.classList.remove("tp-in"); void im.offsetWidth; im.classList.add("tp-in");
  }, true);
  document.addEventListener("change", (e) => { if (e.target.matches?.('input[type="checkbox"], input[type="radio"]')) P.buzz(8); }, true);
  /* ---------- boot ---------- */
  applyPrefs();
  maybeLock();
  const onMe = () => {
    settingsRows();
    if (PAGE === "home.html") setTimeout(greet, 300);
    setTimeout(whatsNew, 1500);
    checkDaily(); tickReminders(); focusChip();
  };
  if (App.me) onMe(); else addEventListener("app:me", onMe, { once: true });
})();
