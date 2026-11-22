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
  P.get = get; P.set = set; P.dkey = dkey; P.pad = pad;

  // one helper for every sheet: auto-removes itself, runs cleanup
  P.sheet = (title, html, cls = "") => {
    const s = makeSheet({ title, html, className: "tp-sheet " + cls });
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
  P.askPin = (title, check) => new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "tp-lock";
    ov.innerHTML = `<div class="tp-lock-box"><img src="images/icon.svg" alt="" class="tp-lock-logo"><b>${esc(title)}</b><div class="tp-dots">${"<i></i>".repeat(4)}</div><small class="tp-lock-msg"></small>
      <div class="tp-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((k) => k === "" ? "<span></span>" : `<button type="button" data-k="${k}">${k}</button>`).join("")}</div>
      ${check ? `<button type="button" class="tp-lock-forgot">Forgot PIN? Log out</button>` : `<button type="button" class="tp-lock-forgot" data-cancel>Cancel</button>`}</div>`;
    document.body.appendChild(ov);
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
    set("pin", await hash(a)); beat(); toast("🔒 App lock on — asks after 1 min away"); return true;
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
    if (p.breakMin && P._session >= p.breakMin * 60) { P._session = 0; P.buzz([60, 60, 60]); P.notify("Break time 🧘", "Aankhon ko aaram chahiye — 2 min break lo"); }
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
      setTimeout(() => { P.sheet("🎂 Birthday today!", `<div class="tp-center"><div class="tp-big">🎉</div><p>Aaj <b>${bdays.map((b) => esc(b.name)).join(", ")}</b> ka birthday hai! Wish karna mat bhoolna.</p><a class="btn" href="messages.html" style="margin-top:10px">Send a wish</a></div>`); P.sound("win"); }, 1200);
    }
    const bt = P.prefs().bedtime;
    if (bt) {
      const [h, m] = bt.split(":").map(Number), now = new Date(), b = new Date(); b.setHours(h, m, 0, 0);
      let diff = now - b; if (diff < -12 * 3600e3) diff += 24 * 3600e3;
      if (diff >= 0 && diff < 3 * 3600e3 && get("bed_shown") !== t) { set("bed_shown", t); P.notify("😴 Bedtime", "So jao bhai, kal school hai. Phone side mein rakho."); }
    }
  }
  setInterval(checkDaily, 60000);

  /* ---------- offline banner ---------- */
  const net = (on) => {
    let b = document.getElementById("tpNet");
    if (!b) { b = document.createElement("div"); b.id = "tpNet"; document.body.appendChild(b); }
    b.textContent = on ? "✅ Back online" : "📡 You're offline — messages will send when you're back";
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
    P.sheet("Install the app", `<div class="tp-steps">${ios
      ? `<p>1. Safari mein neeche <b>Share</b> ⬆️ dabao</p><p>2. <b>Add to Home Screen</b> chuno</p><p>3. <b>Add</b> — ho gaya! 🎉</p>`
      : `<p>1. Browser ka menu <b>⋮</b> kholo</p><p>2. <b>Install app</b> / <b>Add to Home screen</b> dabao</p><p>3. App icon home screen pe aa jayega 🎉</p>`}</div>`);
  };

  /* ---------- update ready ---------- */
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      const b = document.createElement("button");
      b.className = "tp-update"; b.type = "button"; b.textContent = "✨ New version ready — tap to refresh";
      b.onclick = () => location.reload(); document.body.appendChild(b);
    });
  }

  /* ---------- back to top (any long scroller) ---------- */
  let topBtn = null, topScroller = null;
  addEventListener("scroll", (e) => {
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
      <div class="fb-kinds"><button type="button" data-k="bug" class="on">🐞 Bug</button><button type="button" data-k="idea">💡 Idea</button><button type="button" data-k="other">✉️ Other</button></div>
      <textarea class="fb-text" maxlength="2000" rows="4" placeholder="Kya hua? Kaunsa page, kya dabaya…"></textarea>
      <button type="button" class="btn tp-fbsend" style="width:100%;margin-top:10px">Send to the team</button>
      ${fromShake ? `<p class="x3-hint" style="margin-top:8px">Shake band karna ho to Plus settings mein off karo.</p>` : ""}`, "tp-fb");
    s.body.querySelector(".fb-kinds").onclick = (e) => { const b = e.target.closest("[data-k]"); if (!b) return; kind = b.dataset.k; s.body.querySelectorAll(".fb-kinds button").forEach((x) => x.classList.toggle("on", x === b)); };
    s.body.querySelector(".tp-fbsend").onclick = async (e) => {
      const body = s.body.querySelector(".fb-text").value.trim(); if (body.length < 3) return toast("Thoda detail mein likho");
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
  P.invite = () => P.share("teaofrpm", "Aaja teaofrpm pe — school ka apna chat app ☕", base() + "index.html");
  let qrLib = null;
  P.qr = async () => {
    const s = P.sheet("My QR code", `<div class="tp-center"><div class="tp-qr"></div><p class="x3-hint">Scan karke seedha mera profile khulega</p>
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
  const PAGES = [["Home", "home.html", "home"], ["Messages", "messages.html", "chat"], ["Discover", "discover.html", "search"], ["Reels", "reels.html", "play"], ["Profile", "profile.html", "users"], ["Settings", "settings.html", "palette"], ["Tools & games", "tools.html", "grid"]];
  P.palette = async () => {
    if (document.querySelector(".tp-pal")) return;
    const s = P.sheet("", `<input type="search" class="tp-pal-in" placeholder="Search pages, tools, people…" autocomplete="off"><div class="tp-pal-list"></div>`, "tp-pal");
    const inp = s.body.querySelector("input"), list = s.body.querySelector(".tp-pal-list");
    let people = [];
    loadAllPeople().then((l) => { people = l || []; if (inp.value.trim().length >= 2) paint(); }).catch(() => {});
    const tools = (P.toolList || []).map((t) => [t.name, () => P.openTool(t.key), t.emoji]);
    const acts = [["Plus settings", () => P.openSettings(), "✨"], ["My QR code", () => P.qr(), "🔳"], ["Invite friends", () => P.invite(), "📨"], ["Report a problem", () => P.feedback(), "🐞"], ["Keyboard shortcuts", () => P.help(), "⌨️"]];
    const run = (fn) => { s.close(); P.after(fn); };
    const paint = () => {
      const q = inp.value.trim().toLowerCase();
      const m = (t) => !q || t.toLowerCase().includes(q);
      const rows = [
        ...PAGES.filter(([n]) => m(n)).map(([n, h, ic]) => `<a href="${h}" class="tp-pal-row">${svgIcon(ic, 16)}<span>${n}</span><em>Page</em></a>`),
        ...tools.filter(([n]) => m(n)).map(([n, , e], i) => `<button type="button" class="tp-pal-row" data-t="${esc(n)}"><b>${e}</b><span>${esc(n)}</span><em>Tool</em></button>`),
        ...acts.filter(([n]) => m(n)).map(([n, , e]) => `<button type="button" class="tp-pal-row" data-a="${esc(n)}"><b>${e}</b><span>${esc(n)}</span><em>Action</em></button>`),
        ...(q.length >= 2 ? people.filter((p) => (p.display_name || "").toLowerCase().includes(q) || (p.username || "").includes(q)).slice(0, 8)
          .map((p) => `<a href="profile.html?u=${encodeURIComponent(p.username)}" class="tp-pal-row"><b>👤</b><span>${esc(p.display_name)} <small>@${esc(p.username)}</small></span><em>Person</em></a>`) : []),
      ];
      list.innerHTML = rows.join("") || `<div class="settings-empty">Nothing found</div>`;
    };
    paint();
    inp.addEventListener("input", paint);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") list.querySelector(".tp-pal-row")?.click(); });
    list.addEventListener("click", (e) => {
      const t = e.target.closest("[data-t]"); if (t) return run(tools.find(([n]) => n === t.dataset.t)[1]);
      const a = e.target.closest("[data-a]"); if (a) return run(acts.find(([n]) => n === a.dataset.a)[1]);
    });
    setTimeout(() => inp.focus(), 200);
  };
  P.help = () => P.sheet("Keyboard shortcuts", `<div class="tp-keys">${[["Ctrl K", "Search everything"], ["g h", "Home"], ["g m", "Messages"], ["g d", "Discover"], ["g r", "Reels"], ["g p", "Profile"], ["g s", "Settings"], ["g t", "Tools & games"], ["?", "This help"], ["Esc", "Close"], ["Ctrl B / I", "Bold / italic in chat"]].map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join("")}</div>`);
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
      <p>🧰 <b>Tools & games</b> — homework, timetable, attendance (75% calculator!), exams, focus timer, flashcards, notes + 6 games</p>
      <p>💬 <b>Chat</b> — double-tap ❤️, fancy fonts, /commands, spoilers ||like this||, translate, remind me, doodle, location, wallpaper, chat lock</p>
      <p>✨ <b>Plus settings</b> — app lock PIN, grayscale, night light, data saver, break & bedtime reminders, screen time</p>
      <p>⌨️ <b>Ctrl K</b> search everything · pull down to refresh · shake to report a bug</p>
      <a class="btn" href="tools.html" style="width:100%;margin-top:8px">Open Tools & games</a></div>`);
  }

  /* ---------- home greeting card ---------- */
  const QUOTES = ["Padhai karo, phir party karo 📚➡️🎉", "Small steps every day = big results.", "Aaj ka kaam aaj — kal pe mat taalo.", "Discipline > motivation.", "Mistakes are proof you're trying.", "Thoda thoda roz, bahut ho jaata hai.", "Be the friend you want to have.", "Focus on progress, not perfection.", "Sapne woh nahi jo neend mein aate hain…", "Hard work beats talent when talent doesn't work hard.", "Kindness is free — use it a lot.", "Ek ghanta phone side, ek chapter done ✅"];
  P.quote = () => QUOTES[Math.floor(Date.now() / 864e5) % QUOTES.length];
  function greet() {
    const feed = document.getElementById("feed"); if (!feed || get("greet_hide") === dkey() || document.querySelector(".tp-greet")) return;
    const h = new Date().getHours(), name = (App.me?.display_name || "").split(" ")[0];
    const hi = h < 5 ? "Still awake" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 21 ? "Good evening" : "Good night";
    const ic = h < 5 ? "🌙" : h < 12 ? "☀️" : h < 17 ? "🌤️" : h < 21 ? "🌆" : "🌙";
    const bits = [];
    const nc = P.nextClass?.(); if (nc) bits.push(`📚 Next: <b>${esc(nc.sub)}</b> at ${esc(nc.time)}`);
    const ex = P.nextExam?.(); if (ex) bits.push(`📝 <b>${esc(ex.name)}</b> in ${ex.days === 0 ? "<b>today!</b>" : `${ex.days} day${ex.days > 1 ? "s" : ""}`}`);
    const hw = P.hwDue?.(); if (hw) bits.push(`✅ ${hw} homework pending`);
    const c = document.createElement("div");
    c.className = "tp-greet";
    c.innerHTML = `<button type="button" class="tp-greet-x" aria-label="Hide for today">${svgIcon("close", 13)}</button>
      <div class="tp-greet-hi">${ic} ${hi}${name ? `, ${esc(name)}` : ""}</div>
      ${bits.length ? `<div class="tp-greet-bits">${bits.map((b) => `<span>${b}</span>`).join("")}</div>` : ""}
      <div class="tp-greet-q">“${esc(P.quote())}”</div>
      <a class="tp-greet-btn" href="tools.html">🧰 Tools & games</a>`;
    c.querySelector(".tp-greet-x").onclick = () => { set("greet_hide", dkey()); c.remove(); };
    feed.prepend(c);
  }

  /* ---------- focus mode (pomodoro running) chip on every page ---------- */
  function focusChip() {
    const st = get("pomo"); let chip = document.getElementById("tpFocus");
    if (!st || !st.endAt) { chip?.remove(); return; }
    if (!chip) { chip = document.createElement("a"); chip.id = "tpFocus"; chip.href = "tools.html#focus"; document.body.appendChild(chip); }
    const left = Math.max(0, Math.round((st.endAt - Date.now()) / 1000));
    chip.textContent = `${st.phase === "break" ? "☕" : "🍅"} ${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
    if (left === 0) P.pomoNext?.();
    if (st.phase === "focus" && st.block && PAGE === "home.html" && !document.querySelector(".tp-block")) {
      const b = document.createElement("div"); b.className = "tp-block";
      b.innerHTML = `<div><div class="tp-big">🍅</div><b>Focus mode on</b><p>Feed hidden till the timer ends. Padhai pe dhyan do 💪</p><a class="btn" href="tools.html#focus">Open timer</a> <a class="btn btn-ghost" href="messages.html">Messages</a></div>`;
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
      <div class="tp-st"><div class="tp-st-top"><div><small>Today</small><b>${P.fmtDur(st[dkey()] || 0)}</b></div><div><small>Streak</small><b>🔥 ${P.streak()} days</b></div></div>
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
        ${P.canInstall() ? `<button type="button" data-x="install">📲 Install app</button>` : ""}
        <button type="button" data-x="qr">🔳 My QR code</button><button type="button" data-x="invite">📨 Invite friends</button>
        <button type="button" data-x="export">⬇️ Download my data</button><button type="button" data-x="cache">🧹 Clear cache <small class="tp-mb"></small></button>
        <button type="button" data-x="keys">⌨️ Shortcuts</button><button type="button" data-x="fb">🐞 Report a problem</button>
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
      <a class="settings-row" href="tools.html"><span class="settings-row-icon">🧰</span><span class="settings-row-text"><b>Tools & games</b><span>Homework, timetable, attendance, focus timer, games</span></span><span class="settings-row-chevron">${svgIcon("chevron", 16)}</span></a>
      <button class="settings-row" type="button" data-tp="plus"><span class="settings-row-icon">✨</span><span class="settings-row-text"><b>Plus settings</b><span>App lock, screen time, night light, reminders</span></span><span class="settings-row-chevron">${svgIcon("chevron", 16)}</span></button>
      <button class="settings-row" type="button" data-tp="qr"><span class="settings-row-icon">🔳</span><span class="settings-row-text"><b>My QR code</b><span>Share your profile in one scan</span></span><span class="settings-row-chevron">${svgIcon("chevron", 16)}</span></button>
      <button class="settings-row" type="button" data-tp="install" data-tp-install ${P.canInstall() ? "" : "hidden"}><span class="settings-row-icon">📲</span><span class="settings-row-text"><b>Install app</b><span>Home screen pe app jaisa chalega</span></span><span class="settings-row-chevron">${svgIcon("chevron", 16)}</span></button>`;
    anchor.parentNode.insertBefore(wrap, anchor);
    wrap.addEventListener("click", (e) => { const t = e.target.closest("[data-tp]")?.dataset.tp; if (t) ({ plus: P.openSettings, qr: P.qr, install: P.install })[t](); });
  }

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
