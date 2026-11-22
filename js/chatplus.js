/* chatplus.js — extra chat features for room.html. Hooks: room.js calls
   ChatPlus.onLive / beforeSend / focusActions / openFun / renderInfo. */
(() => {
  const P = window.Plus; if (!P) return;
  const C = (window.ChatPlus = {});
  const { get, set } = P;
  const esc = escapeHTML;
  const I = P.I;
  const root = document.documentElement;
  const CID = new URLSearchParams(location.search).get("c") || "";
  const input = () => document.getElementById("msgInput");
  const me = () => App.me || {};
  const insertAt = (txt) => { const i = input(); const a = i.selectionStart ?? i.value.length, b = i.selectionEnd ?? a; i.value = i.value.slice(0, a) + txt + i.value.slice(b); i.selectionStart = i.selectionEnd = a + txt.length; i.dispatchEvent(new Event("input", { bubbles: true })); i.focus(); };
  const sendText = (txt) => { const i = input(); i.value = txt; i.dispatchEvent(new Event("input", { bubbles: true })); try { refreshSendState(); } catch {} setTimeout(() => sendMessage(), 30); };
  const look = () => get("look", {});

  /* ================= chat lock (per chat PIN) ================= */
  (async () => {
    const h = get("chatlocks", {})[CID]; if (!h) return;
    root.setAttribute("data-cp-locked", "");
    const ok = await P.askPin("This chat is locked", async (pin) => (await P.hash(pin)) === h);
    if (ok) root.removeAttribute("data-cp-locked");
  })();
  async function toggleLock() {
    const l = get("chatlocks", {});
    if (l[CID]) { delete l[CID]; set("chatlocks", l); toast("Chat unlocked"); return; }
    const a = await P.askPin("PIN for this chat"); if (!a) return;
    const b = await P.askPin("Type it again"); if (!b) return;
    if (a !== b) return toast("PINs didn't match");
    l[CID] = await P.hash(a); set("chatlocks", l); toast("Chat locked on this device");
  }

  /* ================= look: wallpaper, bubbles, size, compact, blur ================= */
  function applyLook() {
    const L = look();
    root.setAttribute("data-cp-bubble", L.bubble || "default");
    root.style.setProperty("--cp-size", `${L.size || 15}px`);
    root.toggleAttribute("data-cp-compact", !!L.compact);
    root.toggleAttribute("data-cp-blur", !!(get("blur", {})[CID]));
    root.toggleAttribute("data-cp-times", !!L.times);
    const wrap = document.querySelector(".messages-wrap");
    const wp = get("wp_" + CID, null) || get("wp_all", null);
    if (wrap) { wrap.style.backgroundImage = wp ? `linear-gradient(rgba(0,0,0,${L.dim ?? 0.25}),rgba(0,0,0,${L.dim ?? 0.25})), url(${wp})` : ""; wrap.classList.toggle("cp-wp", !!wp); }
  }
  function compress(file, max = 1000) {
    return new Promise((res, rej) => {
      const img = new Image(); img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); res(c.toDataURL("image/jpeg", 0.72));
      }; img.onerror = rej; img.src = URL.createObjectURL(file);
    });
  }
  function lookSheet() {
    const L = look();
    const s = P.sheet("🎨 Chat look", `
      <div class="settings-group-title">Wallpaper (this device)</div>
      <div class="tp-row2"><button type="button" class="btn btn-small" data-wp="this">Photo for this chat</button><button type="button" class="btn btn-small btn-ghost" data-wp="all">For all chats</button><button type="button" class="btn btn-small btn-ghost" data-wp="none">Remove</button></div>
      <label class="tp-tg"><span><b>Dim wallpaper</b></span><input type="range" min="0" max="0.7" step="0.05" value="${L.dim ?? 0.25}" data-l="dim"></label>
      <div class="settings-group-title">Bubbles</div>
      <div class="tp-chips">${[["default", "Default"], ["round", "Extra round"], ["sharp", "Sharp"], ["tail", "With tail"], ["outline", "Outline"]].map(([k, n]) => `<button type="button" data-b="${k}" class="${(L.bubble || "default") === k ? "on" : ""}">${n}</button>`).join("")}</div>
      <label class="tp-tg"><span><b>Text size</b><small class="cp-sz">${L.size || 15}px</small></span><input type="range" min="12" max="22" value="${L.size || 15}" data-l="size"></label>
      <label class="tp-tg"><span><b>Compact mode</b><small>Fit more messages</small></span><input type="checkbox" data-c="compact" ${L.compact ? "checked" : ""}><i></i></label>
      <label class="tp-tg"><span><b>Always show times</b></span><input type="checkbox" data-c="times" ${L.times ? "checked" : ""}><i></i></label>
      <label class="tp-tg"><span><b>Privacy blur</b><small>Blur this chat until you tap a message</small></span><input type="checkbox" data-blur ${get("blur", {})[CID] ? "checked" : ""}><i></i></label>
      <input type="file" accept="image/*" hidden>`);
    let target = "this";
    const fi = s.body.querySelector("input[type=file]");
    fi.onchange = async () => { const f = fi.files[0]; if (!f) return; try { const d = await compress(f); set(target === "all" ? "wp_all" : "wp_" + CID, d); applyLook(); toast("Wallpaper set ✨"); } catch { toast("Could not use that photo"); } };
    s.body.addEventListener("click", (e) => {
      const w = e.target.closest("[data-wp]"); if (w) { if (w.dataset.wp === "none") { store.remove("tp_wp_" + CID); store.remove("tp_wp_all"); applyLook(); } else { target = w.dataset.wp; fi.click(); } }
      const b = e.target.closest("[data-b]"); if (b) { set("look", { ...look(), bubble: b.dataset.b }); s.body.querySelectorAll("[data-b]").forEach((x) => x.classList.toggle("on", x === b)); applyLook(); }
    });
    s.body.addEventListener("input", (e) => { const k = e.target.dataset.l; if (!k) return; set("look", { ...look(), [k]: Number(e.target.value) }); if (k === "size") s.body.querySelector(".cp-sz").textContent = e.target.value + "px"; applyLook(); });
    s.body.addEventListener("change", (e) => {
      const k = e.target.dataset.c; if (k) { set("look", { ...look(), [k]: e.target.checked }); applyLook(); }
      if (e.target.hasAttribute("data-blur")) { const b = get("blur", {}); if (e.target.checked) b[CID] = 1; else delete b[CID]; set("blur", b); applyLook(); }
    });
  }
  // privacy blur: first tap on a blurred bubble just reveals it
  document.addEventListener("click", (e) => {
    if (!root.hasAttribute("data-cp-blur")) return;
    const r = e.target.closest("#messages .msg-row"); if (!r || r.classList.contains("cp-peek")) return;
    e.preventDefault(); e.stopPropagation(); r.classList.add("cp-peek"); setTimeout(() => r.classList.remove("cp-peek"), 5000);
  }, true);

  /* ================= nicknames + keyword alerts ================= */
  const nicks = () => get("nicks", {});
  function nickSheet() {
    const others = (typeof members !== "undefined" ? members : []).map((m) => profileCache.get(m.user_id)).filter((p) => p && p.id !== me().id).slice(0, 60);
    const n = nicks();
    const s = P.sheet("🏷️ Nicknames", `<p class="x3-hint">Sirf tumhe dikhenge, is device pe.</p><div class="tp-list">${others.map((p) => `<label class="tp-mrow"><span class="cp-nk-name">${esc(p.display_name)}</span><input data-u="${p.id}" value="${esc(n[p.id] || "")}" placeholder="Nickname" maxlength="30"></label>`).join("") || `<div class="settings-empty">No one here yet</div>`}</div><button type="button" class="btn" data-save style="width:100%;margin-top:10px">Save</button>`);
    s.body.querySelector("[data-save]").onclick = () => { const all = nicks(); s.body.querySelectorAll("[data-u]").forEach((i) => { if (i.value.trim()) all[i.dataset.u] = i.value.trim(); else delete all[i.dataset.u]; }); set("nicks", all); s.close(); document.querySelectorAll("#messages .msg-row").forEach(decorateRow); paintHeader(); toast("Saved"); };
  }
  function paintHeader() {
    const t = document.getElementById("roomTitle"); if (!t || typeof convo === "undefined" || !convo || convo.kind !== "dm") return;
    const other = (members || []).find((m) => m.user_id !== me().id); const nk = other && nicks()[other.user_id];
    if (nk && !t.dataset.cpNick) { t.dataset.cpNick = t.textContent; t.textContent = nk; } else if (!nk && t.dataset.cpNick) { t.textContent = t.dataset.cpNick; delete t.dataset.cpNick; }
  }
  const kws = () => get("kw", []);
  function kwSheet() {
    const s = P.sheet("🔔 Keyword alerts", `<p class="x3-hint">In words wale messages highlight honge aur phone vibrate karega — jaise apna naam, "exam", "test".</p><div class="tp-add"><input type="text" placeholder="Add a word" maxlength="30"><button type="button" class="btn btn-small">Add</button></div><div class="tp-chips cp-kws"></div>`);
    const paint = () => (s.body.querySelector(".cp-kws").innerHTML = kws().map((k) => `<button type="button" data-k="${esc(k)}">${esc(k)} ✕</button>`).join("") || `<small class="x3-hint">No words yet</small>`);
    const inp = s.body.querySelector("input");
    const add = () => { const v = inp.value.trim().toLowerCase(); if (!v) return; set("kw", [...new Set([...kws(), v])].slice(0, 30)); inp.value = ""; paint(); };
    s.body.querySelector(".tp-add button").onclick = add; inp.onkeydown = (e) => e.key === "Enter" && add();
    s.body.querySelector(".cp-kws").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) { set("kw", kws().filter((k) => k !== b.dataset.k)); paint(); } };
    paint();
  }
  const hasKw = (t) => { const l = kws(); if (!l.length || !t) return false; const x = t.toLowerCase(); return l.some((k) => x.includes(k)); };

  /* ================= live hooks ================= */
  C.onLive = (list) => {
    const incoming = list.filter((m) => m.user_id && m.user_id !== me().id && !m.is_system);
    if (!incoming.length) return;
    if (incoming.some((m) => hasKw(m.content))) { P.buzz([60, 40, 60]); P.sound("done"); }
    else if (!document.hidden) P.sound("recv");
  };

  /* ================= slash commands + text shortcuts ================= */
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const EIGHT = ["Haan bilkul ✅", "Nahi bhai ❌", "Shayad 🤔", "100% 💯", "Bilkul nahi 🙅", "Baad mein poochna 😴", "Signs point to yes 👍", "Mat karna 😬"];
  const CMDS = {
    shrug: ["¯\\_(ツ)_/¯", (a) => `${a} ¯\\_(ツ)_/¯`.trim()],
    tableflip: ["(╯°□°)╯︵ ┻━┻", (a) => `${a} (╯°□°)╯︵ ┻━┻`.trim()],
    unflip: ["┬─┬ ノ( ゜-゜ノ)", (a) => `${a} ┬─┬ ノ( ゜-゜ノ)`.trim()],
    lenny: ["( ͡° ͜ʖ ͡°)", (a) => `${a} ( ͡° ͜ʖ ͡°)`.trim()],
    me: ["/me dances → _Name dances_", (a) => a ? `_${me().display_name || "Someone"} ${a}_` : null],
    roll: ["/roll 20 → dice roll", (a) => { const n = Math.min(1000, Math.max(2, parseInt(a) || 6)); return `🎲 rolled ${1 + Math.floor(Math.random() * n)} (1–${n})`; }],
    flip: ["Coin flip", () => `🪙 ${Math.random() < 0.5 ? "Heads 👑" : "Tails 🦅"}`],
    "8ball": ["/8ball question", (a) => `🎱 ${a ? `"${a}" → ` : ""}${pick(EIGHT)}`],
    rps: ["Rock paper scissors", () => `✊✋✌️ I throw… ${pick(["✊ Rock", "✋ Paper", "✌️ Scissors"])}!`],
    pick: ["/pick pizza, burger, momos", (a) => { const l = a.split(/[,|]/).map((x) => x.trim()).filter(Boolean); return l.length > 1 ? `🎯 Picked: *${pick(l)}* (from ${l.join(", ")})` : null; }],
    love: ["/love A B → love meter", (a) => { const [x, y] = a.split(/\s+/); if (!x || !y) return null; let h = 0; for (const ch of (x + y).toLowerCase().split("").sort().join("")) h = (h * 31 + ch.charCodeAt(0)) % 101; return `💘 ${x} + ${y} = ${h}% ${h > 80 ? "🔥" : h > 50 ? "😊" : "😬"}`; }],
    calc: ["/calc 12*(3+4)", (a) => { if (!/^[\d\s+\-*/().%^]+$/.test(a)) return null; try { const v = Function(`"use strict";return (${a.replace(/\^/g, "**")})`)(); return Number.isFinite(v) ? `🧮 ${a} = *${+v.toFixed(6)}*` : null; } catch { return null; } }],
    time: ["Current time", () => `🕒 ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`],
    date: ["Today's date", () => `📅 ${new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`],
    clap: ["/clap text → text 👏 like 👏 this", (a) => a ? a.split(/\s+/).join(" 👏 ") + " 👏" : null],
    mock: ["/mock text → tExT", (a) => a ? [...a].map((c, i) => i % 2 ? c.toUpperCase() : c.toLowerCase()).join("") + " 🤪" : null],
    reverse: ["/reverse text", (a) => a ? [...a].reverse().join("") : null],
    spoiler: ["/spoiler secret → hidden text", (a) => a ? `||${a}||` : null],
    countdown: ["/countdown 10 → 10…1 🚀", (a) => { const n = Math.min(10, Math.max(3, parseInt(a) || 5)); return [...Array(n)].map((_, i) => n - i).join("… ") + "… 🚀"; }],
    hug: ["Send a hug", (a) => `🤗 ${me().display_name || ""} hugs ${a || "everyone"}`],
    gm: ["Good morning card", () => `☀️ *Good morning!* ${pick(["Aaj ka din mast jaaye ✨", "Chai pi lo pehle ☕", "Uth jao, school hai 🏫"])}`],
    gn: ["Good night card", () => `🌙 *Good night!* ${pick(["Sweet dreams 💤", "Kal milte hain 👋", "Phone rakh do ab 😴"])}`],
  };
  const SC = { fire: "🔥", heart: "❤️", lol: "😂", joy: "😂", cry: "😭", sob: "😭", skull: "💀", eyes: "👀", clap: "👏", ok: "👌", pray: "🙏", thumbsup: "👍", "+1": "👍", party: "🥳", tada: "🎉", star: "⭐", sparkles: "✨", 100: "💯", cool: "😎", think: "🤔", sad: "😢", angry: "😡", love: "😍", kiss: "😘", wink: "😉", smile: "😊", sleep: "😴", poop: "💩", rocket: "🚀", tea: "🍵", chai: "☕", book: "📚", pizza: "🍕", cake: "🎂", gift: "🎁", muscle: "💪", wave: "👋", shrug: "🤷", facepalm: "🤦", ghost: "👻", crown: "👑", money: "💸", nerd: "🤓", sus: "🤨", cap: "🧢", goat: "🐐", moai: "🗿", salute: "🫡", melt: "🫠" };
  const ASCII = { ":)": "🙂", ":-)": "🙂", ":D": "😄", ":(": "🙁", ";)": "😉", ":P": "😛", ":p": "😛", "<3": "❤️", ":O": "😮", ":o": "😮", "B)": "😎", ":'(": "😢", "xD": "😆", "XD": "😆" };
  const DEF_SHORT = { brb: "be right back", gn: "good night 🌙", gm: "good morning ☀️", omw: "on my way 🏃", ty: "thank you 🙏", hbd: "Happy birthday! 🎂🎉", idk: "I don't know 🤷", np: "no problem 👍", wyd: "what are you doing? 👀" };
  const shorts = () => ({ ...DEF_SHORT, ...get("shorts", {}) });

  C.beforeSend = (inp) => {
    let v = inp.value;
    const m = v.trim().match(/^\/([a-z0-9]+)\b\s*([\s\S]*)$/i);
    if (m) {
      const k = m[1].toLowerCase();
      if (k === "help" || k === "commands") { inp.value = ""; cmdHelp(); return false; }
      const c = CMDS[k];
      if (c) { const out = c[1](m[2].trim()); if (out == null) { toast(`Usage: ${c[0]}`); return false; } v = out; }
    }
    if (look().ascii !== false) v = v.replace(/(^|\s)(:-?\)|:D|:\(|;\)|:[Pp]|<3|:[Oo]|B\)|:'\(|xD|XD)(?=\s|$)/g, (x, a, e) => a + ASCII[e]);
    inp.value = v;
    if (v.trim()) P.sound("send");
    return true;
  };
  function cmdHelp() {
    const s = P.sheet("⚡ Slash commands", `<div class="tp-keys">${Object.entries(CMDS).map(([k, [d]]) => `<button type="button" data-k="${k}"><kbd>/${k}</kbd><span>${esc(d)}</span></button>`).join("")}</div><div class="settings-group-title">Text shortcuts — type ;word + space</div><div class="tp-keys">${Object.entries(shorts()).map(([k, v]) => `<div><kbd>;${esc(k)}</kbd><span>${esc(v)}</span></div>`).join("")}</div><button type="button" class="tp-link" data-edit>Edit my shortcuts</button><div class="settings-group-title">Emoji codes</div><p class="x3-hint">${Object.keys(SC).slice(0, 30).map((k) => `:${k}: ${SC[k]}`).join(" · ")}</p>`);
    s.body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]"); if (b) { s.close(); const i = input(); i.value = `/${b.dataset.k} `; i.focus(); i.dispatchEvent(new Event("input", { bubbles: true })); }
      if (e.target.closest("[data-edit]")) { s.close(); P.after(shortSheet); }
    });
  }
  function shortSheet() {
    const s = P.sheet("✍️ Text shortcuts", `<p class="x3-hint">Ek line mein: <b>word = full text</b>. Chat mein <b>;word</b> + space likho.</p><textarea class="tp-note-ed" rows="9">${esc(Object.entries(shorts()).map(([k, v]) => `${k} = ${v}`).join("\n"))}</textarea><button type="button" class="btn" style="width:100%;margin-top:8px">Save</button>`);
    s.body.querySelector("button").onclick = () => { const o = {}; s.body.querySelector("textarea").value.split("\n").forEach((l) => { const [k, ...v] = l.split("="); if (k.trim() && v.join("=").trim()) o[k.trim().toLowerCase().replace(/\s+/g, "")] = v.join("=").trim(); }); Object.keys(DEF_SHORT).forEach((k) => { if (!(k in o)) o[k] = ""; }); set("shorts", o); s.close(); toast("Saved"); };
  }
  // live: ;short + space, :code:, slash suggestions, counter
  let pop = null;
  function slashPop(inp) {
    const v = inp.value, m = v.match(/^\/([a-z0-9]*)$/i);
    if (!m) { pop?.remove(); pop = null; return; }
    const list = Object.entries(CMDS).filter(([k]) => k.startsWith(m[1].toLowerCase())).slice(0, 8);
    if (!list.length) { pop?.remove(); pop = null; return; }
    if (!pop) { pop = document.createElement("div"); pop.className = "cp-pop"; (inp.closest(".composer, form, .chat-composer") || inp.parentNode).appendChild(pop);
      pop.addEventListener("mousedown", (e) => e.preventDefault());
      pop.addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (!b) return; inp.value = `/${b.dataset.k} `; inp.focus(); pop.remove(); pop = null; inp.dispatchEvent(new Event("input", { bubbles: true })); }); }
    pop.innerHTML = list.map(([k, [d]]) => `<button type="button" data-k="${k}"><b>/${k}</b><span>${esc(d)}</span></button>`).join("") + `<button type="button" data-k="help"><b>/help</b><span>All commands</span></button>`;
  }
  function onType(e) {
    const inp = e.target; if (inp.id !== "msgInput") return;
    const pos = inp.selectionStart, before = inp.value.slice(0, pos);
    let m = before.match(/(^|\s);([a-z0-9]+)\s$/i);
    if (m && shorts()[m[2].toLowerCase()]) { const rep = shorts()[m[2].toLowerCase()] + " "; const st = pos - m[2].length - 2; inp.value = inp.value.slice(0, st) + rep + inp.value.slice(pos); inp.selectionStart = inp.selectionEnd = st + rep.length; }
    m = before.match(/:([a-z0-9+_]{2,12}):$/i);
    if (m && SC[m[1].toLowerCase()]) { const st = pos - m[0].length; inp.value = inp.value.slice(0, st) + SC[m[1].toLowerCase()] + inp.value.slice(pos); inp.selectionStart = inp.selectionEnd = st + SC[m[1].toLowerCase()].length; }
    slashPop(inp);
    let cnt = document.getElementById("cpCount");
    const n = inp.value.length;
    if (n > 200) { if (!cnt) { cnt = document.createElement("div"); cnt.id = "cpCount"; (inp.closest(".composer, form, .chat-composer") || inp.parentNode).appendChild(cnt); } cnt.textContent = `${inp.value.trim().split(/\s+/).length} words · ${n}`; cnt.classList.toggle("bad", n > 3500); }
    else cnt?.remove();
  }
  document.addEventListener("input", onType, true);

  /* ================= formatting: keyboard + selection bar ================= */
  const wrapSel = (l, r = l) => { const i = input(); const a = i.selectionStart, b = i.selectionEnd; if (a === b) return insertAt(l + r); const t = i.value.slice(a, b); i.value = i.value.slice(0, a) + l + t + r + i.value.slice(b); i.selectionStart = a; i.selectionEnd = b + l.length + r.length; i.dispatchEvent(new Event("input", { bubbles: true })); i.focus(); };
  document.addEventListener("keydown", (e) => {
    if (e.target.id !== "msgInput") return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); wrapSel("*"); } else if (k === "i") { e.preventDefault(); wrapSel("_"); }
      else if (k === "e") { e.preventDefault(); wrapSel("`"); } else if (e.shiftKey && k === "x") { e.preventDefault(); wrapSel("~"); }
    }
    if (e.key === "Escape") { pop?.remove(); pop = null; document.getElementById("cancelReply")?.click(); }
    if (e.key === "Tab" && pop) { e.preventDefault(); pop.querySelector("[data-k]")?.click(); }
  });
  let fbar = null;
  document.addEventListener("selectionchange", () => {
    const i = input(); if (!i || document.activeElement !== i) { fbar?.classList.remove("show"); return; }
    const has = i.selectionEnd - i.selectionStart > 0;
    if (has && !fbar) {
      fbar = document.createElement("div"); fbar.className = "cp-fbar";
      fbar.innerHTML = `<button type="button" data-w="*"><b>B</b></button><button type="button" data-w="_"><i>I</i></button><button type="button" data-w="~"><s>S</s></button><button type="button" data-w="\`"><code>{ }</code></button><button type="button" data-w="||" aria-label="Spoiler">${I("tp-eyeoff", 16)}</button>`;
      fbar.addEventListener("mousedown", (e) => e.preventDefault());
      fbar.addEventListener("pointerdown", (e) => e.preventDefault());
      fbar.addEventListener("click", (e) => { const b = e.target.closest("[data-w]"); if (b) wrapSel(b.dataset.w); });
      (i.closest(".composer, form, .chat-composer") || i.parentNode).appendChild(fbar);
    }
    fbar?.classList.toggle("show", has);
  });

  /* ================= rendering extras (spoilers, code, jumbo emoji, links, nicknames) ================= */
  const seg = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter() : null;
  const EMO_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣|\s)+$/u;
  function decorateRow(row) {
    if (!row.classList?.contains("msg-row")) return;
    const id = row.dataset.msgId, m = typeof messageCache !== "undefined" ? messageCache.get(id) : null;
    const nk = nicks()[row.dataset.uid], nm = row.querySelector(".msg-name");
    if (nm) { if (nk) { if (nm.textContent !== nk) { nm.dataset.real = nm.dataset.real || nm.textContent; nm.textContent = nk; } } else if (nm.dataset.real && nm.textContent !== nm.dataset.real) { nm.textContent = nm.dataset.real; delete nm.dataset.real; } }
    const tx = row.querySelector(".bubble > .msg-text");
    if (!tx || tx.dataset.cp === (m?.content || "") + (m?.edited_at || "") || tx.classList.contains("x3-has-card")) return;
    tx.dataset.cp = (m?.content || "") + (m?.edited_at || "");
    const raw = (m?.content || "").trim();
    if (raw && EMO_ONLY.test(raw)) { const n = seg ? [...seg.segment(raw.replace(/\s/g, ""))].length : raw.length / 2; if (n <= 3) { tx.classList.add("cp-jumbo", "cp-j" + n); row.querySelector(".bubble").classList.add("cp-jumbo-b"); } }
    let h = tx.innerHTML, ch = false;
    if (h.includes("```")) { h = h.replace(/```\n?([\s\S]+?)```/g, (x, c) => `<pre class="cp-code"><button type="button" class="cp-copy">Copy</button><code>${c.replace(/<\/?code>/g, "`")}</code></pre>`); ch = true; }
    if (h.includes("||")) { h = h.replace(/\|\|([^|<>][^|]*?)\|\|/g, '<span class="cp-spoiler" title="Tap to reveal">$1</span>'); ch = true; }
    if (ch) tx.innerHTML = h;
    // phone numbers + emails become links (outside existing links/code)
    const w = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentNode.closest("a, code, pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    const RE = /([\w.+-]+@[\w-]+\.[\w.]{2,})|((?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5})\b/g;
    nodes.forEach((n) => {
      if (!RE.test(n.nodeValue)) return; RE.lastIndex = 0;
      const f = document.createDocumentFragment(); let last = 0, mm;
      while ((mm = RE.exec(n.nodeValue))) { f.append(n.nodeValue.slice(last, mm.index)); const a = document.createElement("a"); a.className = "cp-auto"; a.textContent = mm[0]; a.href = mm[1] ? `mailto:${mm[1]}` : `tel:${mm[2].replace(/[\s-]/g, "")}`; f.append(a); last = mm.index + mm[0].length; }
      f.append(n.nodeValue.slice(last)); n.replaceWith(f);
    });
    if (m && m.user_id !== me().id && hasKw(m.content)) row.classList.add("cp-kw");
  }
  C.decorate = decorateRow;
  document.addEventListener("click", (e) => {
    const sp = e.target.closest(".cp-spoiler"); if (sp && !sp.classList.contains("open")) { e.stopPropagation(); sp.classList.add("open"); P.buzz(8); return; }
    const cp = e.target.closest(".cp-copy"); if (cp) { e.stopPropagation(); navigator.clipboard?.writeText(cp.nextElementSibling.textContent).then(() => { cp.textContent = "Copied ✓"; setTimeout(() => (cp.textContent = "Copy"), 1200); }); }
  }, true);

  /* ================= message actions (long-press menu) ================= */
  async function translate(m, row) {
    const text = (m.content || "").slice(0, 480); if (!text) return;
    const hi = /[ऀ-ॿ]/.test(text), pair = hi ? "hi|en" : "en|hi";
    let box_ = row.querySelector(".cp-tr"); if (!box_) { box_ = document.createElement("div"); box_.className = "cp-tr"; row.querySelector(".bubble").appendChild(box_); }
    box_.textContent = "Translating…";
    try {
      const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`);
      const d = await r.json(); const out = d?.responseData?.translatedText;
      box_.innerHTML = `<small>${hi ? "English" : "हिंदी"}</small>${esc(out || "Could not translate")}`;
    } catch { box_.textContent = "Could not translate (offline?)"; }
  }
  function remind(m) {
    const at = (h, min = 0, addDay = 0) => { const d = new Date(); d.setDate(d.getDate() + addDay); d.setHours(h, min, 0, 0); return d.getTime(); };
    const who = profileCache.get(m.user_id)?.display_name || "Message";
    const txt = `${who}: ${m.content || (m.image_url ? "📷 Photo" : m.video_url ? "🎥 Video" : "message")}`;
    const go = (t, label) => { P.addReminder(t, txt, location.pathname.split("/").pop() + location.search); toast(`⏰ Reminder set — ${label}`); };
    const tonight = at(21) > Date.now() ? at(21) : at(21, 0, 1);
    actionSheet("Remind me", [
      { icon: "clock", label: "In 20 minutes", onClick: () => go(Date.now() + 20 * 60000, "20 min") },
      { icon: "clock", label: "In 1 hour", onClick: () => go(Date.now() + 3600e3, "1 hour") },
      { icon: "clock", label: "In 3 hours", onClick: () => go(Date.now() + 3 * 3600e3, "3 hours") },
      { icon: "clock", label: "Tonight 9 PM", onClick: () => go(tonight, "tonight") },
      { icon: "clock", label: "Tomorrow 7 AM", onClick: () => go(at(7, 0, 1), "tomorrow morning") },
    ]);
  }
  C.focusActions = (m, own, row) => {
    const out = [];
    if (m.content) out.push(["globe", "Translate", () => translate(m, row)]);
    out.push(["clock", "Remind me", () => remind(m)]);
    if (m.content) out.push(["copy", "Copy as quote", () => { const n = profileCache.get(m.user_id)?.display_name || ""; navigator.clipboard?.writeText(`> ${n}: ${m.content}`).then(() => toast("Quote copied")); }]);
    if (m.content || m.image_url) out.push(["share", "Share outside", () => P.share("teaofrpm", m.content || "Photo", m.image_url || undefined)]);
    return out;
  };

  /* ================= fun menu (+ → More fun) ================= */
  const FONTS = (() => {
    const map = (A, a, d) => (s) => [...s].map((c) => { const u = c.codePointAt(0); if (u >= 65 && u <= 90 && A) return String.fromCodePoint(A + u - 65); if (u >= 97 && u <= 122 && a) return String.fromCodePoint(a + u - 97); if (u >= 48 && u <= 57 && d) return String.fromCodePoint(d + u - 48); return c; }).join("");
    const DS = { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" };
    const script = (s) => map(0x1d4d0, 0x1d4ea)(s);
    const UP = "ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz";
    const SM = "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ";
    return [
      ["𝐁𝐨𝐥𝐝", map(0x1d400, 0x1d41a, 0x1d7ce)], ["𝘐𝘵𝘢𝘭𝘪𝘤", map(0x1d608, 0x1d622)], ["𝙱𝚘𝚕𝚍 𝚒𝚝𝚊𝚕𝚒𝚌", map(0x1d63c, 0x1d656)], ["𝓢𝓬𝓻𝓲𝓹𝓽", script],
      ["𝔊𝔬𝔱𝔥𝔦𝔠", map(0x1d56c, 0x1d586)], ["𝕆𝕦𝕥𝕝𝕚𝕟𝕖", (s) => [...s].map((c) => DS[c] || map(0x1d538, 0x1d552, 0x1d7d8)(c)).join("")], ["𝚃𝚢𝚙𝚎𝚠𝚛𝚒𝚝𝚎𝚛", map(0x1d670, 0x1d68a, 0x1d7f6)], ["𝖲𝖺𝗇𝗌", map(0x1d5a0, 0x1d5ba, 0x1d7e2)],
      ["Ⓑⓤⓑⓑⓛⓔ", map(0x24b6, 0x24d0)], ["🅱🅻🅾🅲🅺", (s) => map(0x1f170, 0x1f170)(s.toUpperCase()).replace(/[a-z]/g, "")], ["ꜱᴍᴀʟʟ ᴄᴀᴘꜱ", (s) => [...s.toLowerCase()].map((c) => (c >= "a" && c <= "z" ? SM[c.charCodeAt(0) - 97] : c)).join("")],
      ["ǝpᴉsdn", (s) => [...s.toLowerCase()].reverse().map((c) => (c >= "a" && c <= "z" ? UP[c.charCodeAt(0) - 97] : c)).join("")], ["Ｗｉｄｅ", (s) => [...s].map((c) => { const u = c.codePointAt(0); return u > 32 && u < 127 ? String.fromCodePoint(u + 0xfee0) : c === " " ? "　" : c; }).join("")],
      ["S̶t̶r̶i̶k̶e̶", (s) => [...s].map((c) => c + "̶").join("")], ["U̲n̲d̲e̲r̲", (s) => [...s].map((c) => c + "̲").join("")], ["s p a c e d", (s) => [...s].join(" ")],
      ["✨ Sparkle ✨", (s) => `✨ ${s} ✨`], ["꧁ Royal ꧂", (s) => `꧁༺ ${s} ༻꧂`],
    ];
  })();
  function fontsSheet() {
    const s = P.sheet("Aa Fancy fonts", `<input type="text" class="tp-pal-in" placeholder="Type text…" value="${esc(input().value || "teaofrpm")}"><div class="cp-fonts"></div><p class="x3-hint">Tap a style to put it in the message box</p>`);
    const inp = s.body.querySelector("input");
    const paint = () => (s.body.querySelector(".cp-fonts").innerHTML = FONTS.map(([n, f], i) => `<button type="button" data-i="${i}"><small>${n}</small><span>${esc(f(inp.value || "Hello"))}</span></button>`).join(""));
    inp.oninput = paint;
    s.body.querySelector(".cp-fonts").onclick = (e) => { const b = e.target.closest("[data-i]"); if (!b) return; const i = input(); i.value = FONTS[b.dataset.i][1](inp.value); i.dispatchEvent(new Event("input", { bubbles: true })); s.close(); setTimeout(() => i.focus(), 300); };
    paint();
  }
  const KAO = { Happy: ["(◕‿◕)", "(＾▽＾)", "ヽ(•‿•)ノ", "(✿◠‿◠)", "＼(^o^)／", "(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧", "( ˘ ³˘)♥", "(｡♥‿♥｡)"], Sad: ["(╥﹏╥)", "(ಥ﹏ಥ)", "(︶︹︺)", "( ´•︵•` )", "(._.)"], Angry: ["(╬ Ò﹏Ó)", "ಠ_ಠ", "(ノಠ益ಠ)ノ彡┻━┻", "(¬_¬)", "(⩺_⩹)"], Cute: ["ʕ•ᴥ•ʔ", "(=^･ω･^=)", "U・ᴥ・U", "(っ◔◡◔)っ ♥", "(づ｡◕‿‿◕｡)づ", "₍ᐢ•ﻌ•ᐢ₎"], Cool: ["(⌐■_■)", "( •_•)>⌐■-■", "¯\\_(ツ)_/¯", "( ͡° ͜ʖ ͡°)", "ᕦ(ò_óˇ)ᕤ", "(☞ﾟヮﾟ)☞"], Misc: ["(°ロ°) !", "(⊙_⊙)", "(-_-) zzZ", "♪~ ᕕ(ᐛ)ᕗ", "(•_•)?", "┬┴┬┴┤(･_├┬┴┬┴"] };
  function kaoSheet() {
    const s = P.sheet("(◕‿◕) Kaomoji", Object.entries(KAO).map(([k, l]) => `<div class="settings-group-title">${k}</div><div class="cp-kao">${l.map((x) => `<button type="button">${esc(x)}</button>`).join("")}</div>`).join(""));
    s.body.onclick = (e) => { const b = e.target.closest(".cp-kao button"); if (b) { s.close(); setTimeout(() => insertAt(b.textContent + " "), 300); } };
  }
  function doodle() {
    const s = P.sheet("✏️ Doodle", `<canvas class="cp-doodle" width="900" height="900"></canvas><div class="cp-dtools"><div class="cp-colors">${["#111111", "#ffffff", "#e63946", "#f4a261", "#ffd60a", "#2a9d8f", "#4361ee", "#9b5de5", "#ff70a6"].map((c, i) => `<button type="button" data-c="${c}" style="background:${c}" class="${i ? "" : "on"}"></button>`).join("")}</div>
      <input type="range" min="3" max="40" value="10" data-w><button type="button" class="btn btn-small btn-ghost" data-u>↶</button><button type="button" class="btn btn-small btn-ghost" data-bg>BG</button><button type="button" class="btn btn-small btn-ghost" data-x>Clear</button></div><button type="button" class="btn" data-send style="width:100%;margin-top:8px">Send doodle</button>`);
    const c = s.body.querySelector("canvas"), ctx = c.getContext("2d"); let col = "#111111", w = 10, bg = "#ffffff", hist = [], drawing = false, last = null;
    const fill = () => { ctx.fillStyle = bg; ctx.fillRect(0, 0, 900, 900); }; fill();
    const pt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (900 / r.width), (e.clientY - r.top) * (900 / r.height)]; };
    c.addEventListener("pointerdown", (e) => { c.setPointerCapture(e.pointerId); hist.push(ctx.getImageData(0, 0, 900, 900)); if (hist.length > 20) hist.shift(); drawing = true; last = pt(e); ctx.beginPath(); ctx.arc(last[0], last[1], w / 2 * 1.5, 0, 7); ctx.fillStyle = col; ctx.fill(); });
    c.addEventListener("pointermove", (e) => { if (!drawing) return; const p = pt(e); ctx.strokeStyle = col; ctx.lineWidth = w * 1.5; ctx.lineCap = ctx.lineJoin = "round"; ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; });
    c.addEventListener("pointerup", () => (drawing = false)); c.style.touchAction = "none";
    s.body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-c]"); if (b) { col = b.dataset.c; s.body.querySelectorAll("[data-c]").forEach((x) => x.classList.toggle("on", x === b)); }
      if (e.target.closest("[data-u]") && hist.length) ctx.putImageData(hist.pop(), 0, 0);
      if (e.target.closest("[data-x]")) { hist.push(ctx.getImageData(0, 0, 900, 900)); fill(); }
      if (e.target.closest("[data-bg]")) { bg = col; hist.push(ctx.getImageData(0, 0, 900, 900)); fill(); }
      if (e.target.closest("[data-send]")) c.toBlob((blob) => { s.close(); setTimeout(() => handlePickedImage(new File([blob], "doodle.png", { type: "image/png" }), "Doodle"), 300); }, "image/png");
    });
    s.body.querySelector("[data-w]").oninput = (e) => (w = Number(e.target.value));
  }
  function shareLocation() {
    if (!navigator.geolocation) return toast("Location not supported");
    toast("📍 Getting location…");
    navigator.geolocation.getCurrentPosition((p) => {
      const { latitude: a, longitude: b, accuracy } = p.coords;
      if (!confirm(`Send your current location (±${Math.round(accuracy)} m) to this chat?`)) return;
      sendText(`📍 My location: https://maps.google.com/?q=${a.toFixed(5)},${b.toFixed(5)}`);
    }, () => toast("Location permission denied"), { enableHighAccuracy: true, timeout: 12000 });
  }
  async function shareContact() {
    const s = P.sheet("👤 Share a contact", `<input type="search" class="tp-pal-in" placeholder="Search people…"><div class="tp-pal-list"></div>`);
    let people = []; try { people = await loadAllPeople(); } catch {}
    const inp = s.body.querySelector("input");
    const paint = () => { const q = inp.value.trim().toLowerCase(); s.body.querySelector(".tp-pal-list").innerHTML = people.filter((p) => !q || (p.display_name || "").toLowerCase().includes(q) || (p.username || "").includes(q)).slice(0, 30).map((p) => `<button type="button" class="tp-pal-row" data-u="${esc(p.username)}" data-n="${esc(p.display_name)}"><b>👤</b><span>${esc(p.display_name)} <small>@${esc(p.username)}</small></span></button>`).join(""); };
    inp.oninput = paint; paint();
    s.body.querySelector(".tp-pal-list").onclick = (e) => { const b = e.target.closest("[data-u]"); if (!b) return; s.close(); sendText(`👤 ${b.dataset.n} — @${b.dataset.u}`); };
  }
  async function insights() {
    const s = P.sheet("📊 Chat insights", `<div class="tp-center"><small>Counting…</small></div>`);
    const cid = convo.id;
    const head = (q) => q.select("id", { count: "exact", head: true }).eq("conversation_id", cid).eq("deleted", false);
    const ppl = (members || []).slice(0, 10);
    const [tot, ph, vi, vo, first, ...per] = await Promise.all([
      head(sb.from("messages")), head(sb.from("messages")).not("image_url", "is", null), head(sb.from("messages")).not("video_url", "is", null), head(sb.from("messages")).not("audio_url", "is", null),
      sb.from("messages").select("created_at").eq("conversation_id", cid).order("created_at", { ascending: true }).limit(1),
      ...ppl.map((m) => head(sb.from("messages")).eq("user_id", m.user_id)),
    ]);
    const loaded = [...messageCache.values()].filter((m) => m.content);
    const emo = {}; const hours = Array(24).fill(0); const words = {};
    loaded.forEach((m) => {
      hours[new Date(m.created_at).getHours()]++;
      (m.content.match(/\p{Extended_Pictographic}/gu) || []).forEach((e) => (emo[e] = (emo[e] || 0) + 1));
      m.content.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 && !/^(https?|that|this|with|have|hai|kya|nahi|bhai|haan)$/.test(w)).forEach((w) => (words[w] = (words[w] || 0) + 1));
    });
    const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
    const peak = hours.indexOf(Math.max(...hours));
    const since = first.data?.[0]?.created_at;
    const days = since ? Math.max(1, Math.round((Date.now() - new Date(since)) / 864e5)) : 1;
    const ranks = ppl.map((m, i) => [profileCache.get(m.user_id)?.display_name || "?", per[i].count || 0]).sort((a, b) => b[1] - a[1]);
    const mx = Math.max(1, ...ranks.map((r) => r[1]));
    s.body.innerHTML = `<div class="cp-ins"><div class="cp-ins-grid"><div><b>${(tot.count || 0).toLocaleString()}</b><small>messages</small></div><div><b>${ph.count || 0}</b><small>photos</small></div><div><b>${vi.count || 0}</b><small>videos</small></div><div><b>${vo.count || 0}</b><small>voice notes</small></div><div><b>${Math.round((tot.count || 0) / days)}</b><small>per day</small></div><div><b>${since ? new Date(since).toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit" }) : "—"}</b><small>first message</small></div></div>
      <div class="settings-group-title">Who talks most</div>${ranks.map(([n, c]) => `<div class="cp-bar"><span>${esc(n)}</span><i style="width:${(c / mx) * 100}%"></i><b>${c}</b></div>`).join("")}
      <div class="settings-group-title">Most used emoji</div><div class="cp-emo">${top(emo, 8).map(([e, c]) => `<span>${e}<small>${c}</small></span>`).join("") || "—"}</div>
      <div class="settings-group-title">Busiest hour</div><div class="cp-hours">${hours.map((h, i) => `<i style="height:${4 + (h / Math.max(1, hours[peak])) * 50}px" title="${i}:00" class="${i === peak ? "pk" : ""}"></i>`).join("")}</div><p class="x3-hint">Sabse zyada baat ${peak % 12 || 12} ${peak < 12 ? "AM" : "PM"} ke aas-paas hoti hai</p>
      <div class="settings-group-title">Top words</div><div class="tp-chips">${top(words, 12).map(([w, c]) => `<span class="cp-word">${esc(w)} <small>${c}</small></span>`).join("") || "—"}</div>
      <p class="x3-hint">Emoji, hours and words use the messages loaded on screen.</p></div>`;
  }
  async function exportChat() {
    toast("Exporting chat…");
    const rows = []; let from = 0;
    while (from < 10000) {
      const { data, error } = await sb.from("messages").select("user_id,content,image_url,video_url,audio_url,created_at,is_system").eq("conversation_id", convo.id).eq("deleted", false).order("created_at", { ascending: true }).range(from, from + 999);
      if (error || !data?.length) break; rows.push(...data); if (data.length < 1000) break; from += 1000;
    }
    const need = [...new Set(rows.map((r) => r.user_id).filter((u) => u && !profileCache.get(u)))];
    if (need.length) { const { data } = await sb.from("profiles").select("id,display_name,username").in("id", need.slice(0, 500)); (data || []).forEach((p) => profileCache.set(p.id, { ...(profileCache.get(p.id) || {}), ...p })); }
    const name = (u) => profileCache.get(u)?.display_name || "Unknown";
    const title = document.getElementById("roomTitle")?.textContent || "chat";
    const txt = `Chat: ${title}\nExported ${new Date().toLocaleString()} · ${rows.length} messages\n\n` + rows.map((r) => `[${new Date(r.created_at).toLocaleString([], { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}] ${r.is_system ? "•" : name(r.user_id) + ":"} ${r.content || (r.image_url ? "<photo> " + r.image_url : r.video_url ? "<video> " + r.video_url : r.audio_url ? "<voice note>" : "")}`).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain;charset=utf-8" })); a.download = `${title.replace(/[^\w\s-]/g, "").trim() || "chat"}-${P.dkey()}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const FUN = [
    ["tp-type", "Fancy fonts", fontsSheet], ["smile", "Kaomoji", kaoSheet], ["tp-doodle", "Doodle", doodle], ["tp-pin", "Location", shareLocation],
    ["tp-user", "Contact", shareContact], ["tp-slash", "/commands", cmdHelp], ["tp-dice", "Roll dice", () => sendText(CMDS.roll[1](""))], ["tp-coin", "Flip coin", () => sendText(CMDS.flip[1]())],
    ["tp-8ball", "Magic 8-ball", () => { const q = prompt("Ask the 8-ball:"); if (q) sendText(CMDS["8ball"][1](q)); }], ["tp-hand2", "Rock paper…", () => sendText(CMDS.rps[1]())],
    ["tp-eyeoff", "Spoiler", () => { const t = prompt("Secret text (tap to reveal):"); if (t) sendText(`||${t}||`); }], ["palette", "Chat look", lookSheet],
    ["tp-chart", "Insights", insights], ["download", "Export chat", exportChat], ["tp-grid", "Tools & games", () => (location.href = "tools.html")],
  ];  C.openFun = () => {
    const s = P.sheet("✨ More fun", `<div class="cp-fun">${FUN.map(([e, n], i) => `<button type="button" data-i="${i}"><b>${I(e, 22)}</b><span>${n}</span></button>`).join("")}</div>`);
    s.body.onclick = (e) => { const b = e.target.closest("[data-i]"); if (!b) return; s.close(); P.after(FUN[b.dataset.i][2]); };
  };

  /* ================= chat details section ================= */
  C.renderInfo = (body) => {
    if (!body) return;
    body.querySelector(".cp-info")?.remove();
    const d = document.createElement("div"); d.className = "cp-info";
    const locked = !!get("chatlocks", {})[CID];
    d.innerHTML = `<div class="cp-info-title">Chat extras</div><div class="cp-info-grid">
      <button type="button" data-x="look">${I("tp-wall", 20)}<span>Wallpaper & look</span></button><button type="button" data-x="ins">${I("tp-chart", 20)}<span>Insights</span></button>
      <button type="button" data-x="nick">${I("tp-tag", 20)}<span>Nicknames</span></button><button type="button" data-x="kw">${I("bell", 20)}<span>Keyword alerts</span></button>
      <button type="button" data-x="lock">${I(locked ? "tp-unlock" : "lock", 20)}<span>${locked ? "Unlock chat" : "Lock chat"}</span></button><button type="button" data-x="exp">${I("download", 20)}<span>Export chat</span></button>
      <button type="button" data-x="cmd">${I("tp-slash", 20)}<span>Commands</span></button><button type="button" data-x="short">${I("pen", 20)}<span>Text shortcuts</span></button></div>`;
    const anchor = body.querySelector(":scope > .settings-group-title");
    body.insertBefore(d, anchor);
    d.onclick = (e) => { const x = e.target.closest("[data-x]")?.dataset.x; if (!x) return; const fn = { look: lookSheet, ins: insights, nick: nickSheet, kw: kwSheet, lock: toggleLock, exp: exportChat, cmd: cmdHelp, short: shortSheet }[x]; if (x === "exp" || x === "lock") fn().then?.(() => C.renderInfo(body)); else fn(); };
  };

  /* ================= boot ================= */
  const mo = new MutationObserver((muts) => {
    for (const mu of muts) {
      mu.addedNodes.forEach((n) => { if (n.nodeType !== 1) return; if (n.classList.contains("msg-row")) decorateRow(n); else n.closest?.(".msg-row") && decorateRow(n.closest(".msg-row")); });
      if (mu.target.nodeType === 1 && mu.target.closest?.(".msg-row") && mu.type === "childList") decorateRow(mu.target.closest(".msg-row"));
    }
  });
  const start = () => {
    const box_ = document.getElementById("messages"); if (!box_) return;
    mo.observe(box_, { childList: true, subtree: true });
    box_.querySelectorAll(".msg-row").forEach(decorateRow);
    applyLook();
    setTimeout(paintHeader, 1500);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
