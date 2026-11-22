/* plus-games.js — quick games with local high scores. Needs plus.js + plus-tools.js. */
(() => {
  const P = window.Plus; if (!P || !P.toolList) return;
  const { get, set } = P;
  const I = P.I;
  const best = (k) => get("best", {})[k];
  const saveBest = (k, v, lowerWins) => {
    const b = get("best", {}); const old = b[k];
    const better = old == null || (lowerWins ? v < old : v > old);
    if (better) { b[k] = v; set("best", b); }
    return better;
  };
  const shareScore = (txt) => P.share("teaofrpm games", `${txt} — beat me if you can 😎`);
  const endCard = (el, emoji, title, line, isBest, shareTxt, again) => {
    el.innerHTML = `<div class="tp-center tp-end"><div class="tp-big tp-bigic">${I(emoji, 44)}</div><b>${title}</b><p>${line}</p>${isBest ? `<p class="tp-best">${I("tp-trophy", 16)} New best!</p>` : ""}<div class="tp-row2"><button type="button" class="btn" data-again>Play again</button><button type="button" class="btn btn-ghost" data-share>Share</button></div></div>`;
    el.querySelector("[data-again]").onclick = again;
    el.querySelector("[data-share]").onclick = () => shareScore(shareTxt);
    P.sound(isBest ? "win" : "done");
  };

  /* ===== Tic-tac-toe vs bot (minimax) ===== */
  function ttt() {
    const s = P.sheet("⭕ Tic-tac-toe", `<div class="tp-center"><div class="tp-chips"><button type="button" data-lv="easy">Easy</button><button type="button" data-lv="hard" class="on">Unbeatable</button></div><div class="tp-ttt"></div><b class="tp-msg">Your turn (X)</b><small class="tp-score"></small><button type="button" class="btn btn-ghost" data-new>New game</button></div>`);
    let b, over, lv = "hard";
    const L = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    const win = (x) => { for (const l of L) if (x[l[0]] && x[l[0]] === x[l[1]] && x[l[1]] === x[l[2]]) return x[l[0]]; return x.every(Boolean) ? "draw" : null; };
    const mm = (x, me) => { const w = win(x); if (w === "O") return [10]; if (w === "X") return [-10]; if (w) return [0];
      let bestM = null, bestS = me ? -99 : 99;
      x.forEach((v, i) => { if (v) return; x[i] = me ? "O" : "X"; const sc = mm(x, !me)[0] * 0.9; x[i] = null; if (me ? sc > bestS : sc < bestS) { bestS = sc; bestM = i; } });
      return [bestS, bestM]; };
    const sc = () => { const r = get("ttt", { w: 0, l: 0, d: 0 }); s.body.querySelector(".tp-score").textContent = `You ${r.w} · Bot ${r.l} · Draw ${r.d}`; };
    const finish = (w) => { over = true; const r = get("ttt", { w: 0, l: 0, d: 0 }); r[w === "X" ? "w" : w === "O" ? "l" : "d"]++; set("ttt", r); sc();
      s.body.querySelector(".tp-msg").textContent = w === "X" ? "You win!" : w === "O" ? "Bot wins" : "Draw"; P.sound(w === "X" ? "win" : w === "O" ? "lose" : "done"); };
    const paint = () => { s.body.querySelector(".tp-ttt").innerHTML = b.map((v, i) => `<button type="button" data-i="${i}" class="${v ? "v" + v : ""}">${v || ""}</button>`).join(""); };
    const reset = () => { b = Array(9).fill(null); over = false; s.body.querySelector(".tp-msg").textContent = "Your turn (X)"; paint(); sc(); };
    s.body.querySelector(".tp-ttt").onclick = (e) => {
      const c = e.target.closest("[data-i]"); if (!c || over || b[c.dataset.i]) return;
      b[c.dataset.i] = "X"; P.buzz(8); paint(); let w = win(b); if (w) return finish(w);
      s.body.querySelector(".tp-msg").textContent = "Bot thinking…";
      setTimeout(() => {
        const free = b.map((v, i) => v ? null : i).filter((i) => i != null);
        const m = lv === "easy" && Math.random() < 0.55 ? free[Math.floor(Math.random() * free.length)] : mm(b.slice(), true)[1];
        b[m] = "O"; paint(); w = win(b); if (w) finish(w); else s.body.querySelector(".tp-msg").textContent = "Your turn (X)";
      }, 350);
    };
    s.body.querySelector(".tp-chips").onclick = (e) => { const x = e.target.closest("[data-lv]"); if (!x) return; lv = x.dataset.lv; s.body.querySelectorAll("[data-lv]").forEach((y) => y.classList.toggle("on", y === x)); reset(); };
    s.body.querySelector("[data-new]").onclick = reset;
    reset();
  }

  /* ===== Snake ===== */
  function snake() {
    const s = P.sheet("🐍 Snake", `<div class="tp-center"><b class="tp-msg">Score 0 · Best ${best("snake") || 0}</b><canvas class="tp-canvas" width="360" height="360"></canvas><div class="tp-dpad"><button data-d="u">▲</button><button data-d="l">◀</button><button data-d="r">▶</button><button data-d="d">▼</button></div><small class="x3-hint">Swipe on the board or use arrow keys</small></div>`);
    const c = s.body.querySelector("canvas"), ctx = c.getContext("2d"), N = 18, Z = 20;
    let sn, dir, nd, food, score, timer, dead;
    const css = getComputedStyle(document.documentElement);
    const col = css.getPropertyValue("--deep-royal").trim() || "#4A148C";
    const place = () => { do { food = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]; } while (sn.some(([x, y]) => x === food[0] && y === food[1])); };
    const draw = () => {
      ctx.fillStyle = "#111"; ctx.fillRect(0, 0, 360, 360);
      ctx.fillStyle = "#ff4d6d"; ctx.beginPath(); ctx.arc(food[0] * Z + 10, food[1] * Z + 10, 8, 0, 7); ctx.fill();
      sn.forEach(([x, y], i) => { ctx.fillStyle = i === 0 ? "#80ed99" : col.startsWith("#") ? "#57cc99" : col; ctx.fillRect(x * Z + 1, y * Z + 1, Z - 2, Z - 2); });
    };
    const step = () => {
      dir = nd; const h = [sn[0][0] + dir[0], sn[0][1] + dir[1]];
      if (h[0] < 0 || h[1] < 0 || h[0] >= N || h[1] >= N || sn.some(([x, y]) => x === h[0] && y === h[1])) return die();
      sn.unshift(h);
      if (h[0] === food[0] && h[1] === food[1]) { score++; P.sound("tick"); P.buzz(10); place(); clearInterval(timer); timer = setInterval(step, Math.max(60, 150 - score * 4)); } else sn.pop();
      s.body.querySelector(".tp-msg").textContent = `Score ${score} · Best ${Math.max(score, best("snake") || 0)}`;
      draw();
    };
    const die = () => { clearInterval(timer); dead = true; P.buzz([80, 40, 80]); const nb = saveBest("snake", score); const host = s.body.querySelector(".tp-center"); endCard(host, "tp-snake", `Score ${score}`, `Best ${best("snake")}`, nb && score > 0, `I scored ${score} in Snake 🐍 on teaofrpm`, () => { s.close(); P.after(snake); }); };
    const start = () => { sn = [[8, 9], [7, 9], [6, 9]]; dir = nd = [1, 0]; score = 0; dead = false; place(); draw(); clearInterval(timer); timer = setInterval(step, 150); };
    const turn = (k) => { const m = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] }[k]; if (m && (m[0] !== -dir[0] || m[1] !== -dir[1])) nd = m; };
    s.body.querySelector(".tp-dpad").onclick = (e) => { const b = e.target.closest("[data-d]"); if (b) turn(b.dataset.d); };
    const kd = (e) => { const k = { ArrowUp: "u", ArrowDown: "d", ArrowLeft: "l", ArrowRight: "r", w: "u", s: "d", a: "l", d: "r" }[e.key]; if (k && !dead) { e.preventDefault(); turn(k); } };
    addEventListener("keydown", kd);
    let tx = 0, ty = 0;
    c.addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
    c.addEventListener("touchmove", (e) => { e.preventDefault(); }, { passive: false });
    c.addEventListener("touchend", (e) => { const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return; turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : (dy > 0 ? "d" : "u")); });
    s.cleanup = () => { clearInterval(timer); removeEventListener("keydown", kd); };
    start();
  }

  /* ===== Memory match ===== */
  function memory() {
    const s = P.sheet("🧠 Memory match", `<div class="tp-center"><b class="tp-msg">Moves 0</b><div class="tp-mem"></div><small class="x3-hint">Best: ${best("memory") ? best("memory") + " moves" : "—"}</small></div>`);
    const E = ["🍕", "🚀", "🐶", "⚽", "🎧", "🌈", "🍩", "🦄", "🎮", "🍉", "🐱", "🌻"].sort(() => Math.random() - 0.5).slice(0, 8);
    const deck = [...E, ...E].sort(() => Math.random() - 0.5);
    let open = [], moves = 0, found = 0, lock = false;
    s.body.querySelector(".tp-mem").innerHTML = deck.map((e, i) => `<button type="button" data-i="${i}"><span>${e}</span></button>`).join("");
    s.body.querySelector(".tp-mem").onclick = (ev) => {
      const b = ev.target.closest("[data-i]"); if (!b || lock || b.classList.contains("up")) return;
      b.classList.add("up"); open.push(b); P.buzz(6);
      if (open.length < 2) return;
      moves++; s.body.querySelector(".tp-msg").textContent = `Moves ${moves}`;
      const [a, c] = open; open = [];
      if (deck[a.dataset.i] === deck[c.dataset.i]) { a.classList.add("ok"); c.classList.add("ok"); found++; P.sound("tick");
        if (found === 8) setTimeout(() => { const nb = saveBest("memory", moves, true); endCard(s.body.querySelector(".tp-center"), "tp-brain", `Done in ${moves} moves`, `Best ${best("memory")} moves`, nb, `I finished Memory match in ${moves} moves 🧠`, () => { s.close(); P.after(memory); }); }, 400); }
      else { lock = true; setTimeout(() => { a.classList.remove("up"); c.classList.remove("up"); lock = false; }, 700); }
    };
  }

  /* ===== Reaction time ===== */
  function reaction() {
    const s = P.sheet("⚡ Reaction test", `<button type="button" class="tp-react wait"><b>Tap to start</b><small>Best: ${best("react") ? best("react") + " ms" : "—"}</small></button>`);
    const el = s.body.querySelector(".tp-react"); let state = "idle", t0 = 0, to = null, tries = [];
    const set_ = (cls, b, sm) => { el.className = "tp-react " + cls; el.innerHTML = `<b>${b}</b><small>${sm || ""}</small>`; };
    el.onclick = () => {
      if (state === "idle" || state === "done") { state = "wait"; set_("wait", "Wait for green…", "Jaldi mat karna"); to = setTimeout(() => { state = "go"; t0 = performance.now(); set_("go", "TAP NOW!"); P.buzz(10); }, 1200 + Math.random() * 2800); }
      else if (state === "wait") { clearTimeout(to); state = "done"; set_("bad", "Too soon!", "Tap to try again"); P.sound("lose"); }
      else if (state === "go") {
        const ms = Math.round(performance.now() - t0); tries.push(ms); state = "done";
        const nb = saveBest("react", ms, true);
        set_("res", `${ms} ms`, `${nb ? "New best! · " : ""}avg ${Math.round(tries.reduce((a, b) => a + b, 0) / tries.length)} ms · tap to go again`);
        P.sound(nb ? "win" : "tick");
      }
    };
    s.cleanup = () => clearTimeout(to);
  }

  /* ===== Typing speed ===== */
  const LINES = ["the quick brown fox jumps over the lazy dog", "practice makes a person perfect so keep going", "chai and samosa make every evening better", "never stop learning because life never stops teaching", "my homework is done and now i can finally relax", "friends who study together pass together", "small steps every day lead to big results", "a good book is the best friend you can have"];
  function typing() {
    const s = P.sheet("⌨️ Typing speed", `<div class="tp-type"><p class="tp-target"></p><textarea rows="3" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="Start typing to begin the timer…"></textarea><b class="tp-msg">Best: ${best("wpm") ? best("wpm") + " WPM" : "—"}</b></div>`);
    const line = LINES[Math.floor(Math.random() * LINES.length)], ta = s.body.querySelector("textarea"), tg = s.body.querySelector(".tp-target");
    let t0 = 0;
    const paint = () => { const v = ta.value; tg.innerHTML = [...line].map((ch, i) => `<span class="${i < v.length ? (v[i] === ch ? "ok" : "bad") : i === v.length ? "cur" : ""}">${ch === " " ? "&nbsp;" : ch}</span>`).join(""); };
    ta.addEventListener("input", () => {
      if (!t0) t0 = performance.now(); paint();
      if (ta.value.length >= line.length) {
        const min = (performance.now() - t0) / 60000, ok = [...line].filter((c, i) => ta.value[i] === c).length;
        const wpm = Math.round((ok / 5) / min), acc = Math.round((ok / line.length) * 100);
        const nb = saveBest("wpm", wpm);
        endCard(s.body.querySelector(".tp-type"), "tp-keyboard", `${wpm} WPM`, `${acc}% accuracy`, nb, `I type at ${wpm} WPM ⌨️`, () => { s.close(); P.after(typing); });
      }
    });
    paint(); setTimeout(() => ta.focus(), 250);
  }

  /* ===== Math sprint ===== */
  function mathSprint() {
    const s = P.sheet("➗ Math sprint", `<div class="tp-center tp-ms"><b class="tp-msg">60s · Score 0</b><div class="tp-q">Ready?</div><input type="number" inputmode="numeric" class="tp-ans" placeholder="Answer" disabled><button type="button" class="btn" data-go>Start</button><small class="x3-hint">Best: ${best("math") ?? "—"}</small></div>`);
    let score = 0, ans = 0, left = 60, iv = null;
    const q = () => { const ops = ["+", "−", "×"], o = ops[Math.floor(Math.random() * (score > 5 ? 3 : 2))]; let a = 2 + Math.floor(Math.random() * (10 + score * 2)), b = 2 + Math.floor(Math.random() * (10 + score)); if (o === "×") { a = 2 + Math.floor(Math.random() * 12); b = 2 + Math.floor(Math.random() * 12); } if (o === "−" && b > a) [a, b] = [b, a]; ans = o === "+" ? a + b : o === "−" ? a - b : a * b; s.body.querySelector(".tp-q").textContent = `${a} ${o} ${b} = ?`; };
    const inp = s.body.querySelector(".tp-ans");
    s.body.querySelector("[data-go]").onclick = (e) => {
      e.target.remove(); inp.disabled = false; inp.focus(); q();
      iv = setInterval(() => { left--; s.body.querySelector(".tp-msg").textContent = `${left}s · Score ${score}`; if (left <= 0) { clearInterval(iv); const nb = saveBest("math", score); endCard(s.body.querySelector(".tp-ms"), "tp-sigma", `Score ${score}`, `Best ${best("math")}`, nb && score > 0, `I solved ${score} sums in 60s ➗`, () => { s.close(); P.after(mathSprint); }); } }, 1000);
    };
    inp.addEventListener("input", () => { if (Number(inp.value) === ans && inp.value !== "") { score++; P.sound("tick"); P.buzz(6); inp.value = ""; s.body.querySelector(".tp-msg").textContent = `${left}s · Score ${score}`; q(); } });
    s.cleanup = () => clearInterval(iv);
  }

  /* ===== 4-in-a-row vs bot ===== */
  function connect4() {
    const R = 6, C = 7;
    const s = P.sheet("🔴 4 in a row", `<div class="tp-center"><b class="tp-msg">Your turn (red)</b><div class="tp-c4"></div><button type="button" class="btn btn-ghost" data-new>New game</button></div>`);
    let g, over;
    const drop = (b, c, v) => { for (let r = R - 1; r >= 0; r--) if (!b[r][c]) { b[r][c] = v; return r; } return -1; };
    const won = (b, v) => { const d = [[0, 1], [1, 0], [1, 1], [1, -1]]; for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) for (const [dr, dc] of d) { let k = 0; while (k < 4 && b[r + dr * k]?.[c + dc * k] === v) k++; if (k === 4) return true; } return false; };
    const paint = () => { s.body.querySelector(".tp-c4").innerHTML = g.map((row) => row.map((v, c) => `<button type="button" data-c="${c}" class="${v || ""}"></button>`).join("")).join(""); };
    const botMove = () => {
      const cols = [...Array(C).keys()].filter((c) => !g[0][c]);
      for (const v of ["y", "r"]) for (const c of cols) { const b = g.map((r) => r.slice()); drop(b, c, v); if (won(b, v)) return c; }
      const pref = [3, 2, 4, 1, 5, 0, 6].filter((c) => cols.includes(c));
      const safe = pref.filter((c) => { const b = g.map((r) => r.slice()); drop(b, c, "y"); return !cols.some((c2) => { const b2 = b.map((r) => r.slice()); if (drop(b2, c2, "r") < 0) return false; return won(b2, "r"); }); });
      return (safe.length ? safe : pref)[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * (safe.length || pref.length))];
    };
    const end = (m, snd) => { over = true; s.body.querySelector(".tp-msg").textContent = m; P.sound(snd); };
    s.body.querySelector(".tp-c4").onclick = (e) => {
      const b = e.target.closest("[data-c]"); if (!b || over) return;
      if (drop(g, Number(b.dataset.c), "r") < 0) return; P.buzz(8); paint();
      if (won(g, "r")) return end("You win!", "win");
      if (g[0].every(Boolean)) return end("Draw", "done");
      over = true; s.body.querySelector(".tp-msg").textContent = "Bot thinking…";
      setTimeout(() => { over = false; drop(g, botMove(), "y"); paint(); if (won(g, "y")) end("Bot wins", "lose"); else if (g[0].every(Boolean)) end("Draw", "done"); else s.body.querySelector(".tp-msg").textContent = "Your turn (red)"; }, 400);
    };
    const reset = () => { g = [...Array(R)].map(() => Array(C).fill(null)); over = false; s.body.querySelector(".tp-msg").textContent = "Your turn (red)"; paint(); };
    s.body.querySelector("[data-new]").onclick = reset; reset();
  }

  /* ===== Would you rather / truth or dare (party prompts) ===== */
  const WYR = ["Exam se ek din pehle syllabus milna ya ek hafta pehle sirf aadha?", "Hamesha 10 min late ya hamesha 30 min early?", "Bina phone ke ek hafta ya bina dost ke ek din?", "Flying power ya invisible hone ki power?", "Teacher ka favourite banna ya class ka favourite?", "Sirf Maggi kha ke 1 mahina ya sirf khichdi?", "Har exam mein 90% ya ek baar topper?", "Apna future dekh lo ya apna past badal lo?", "Free wifi forever ya free food forever?", "Ek din principal bano ya ek din PM?"];
  const TRUTH = ["Last time kab jhooth bola? Kya tha?", "Class mein crush hai? 👀 (naam mat batao, sirf haan/na)", "Sabse embarrassing moment school mein?", "Phone mein sabse zyada kaunsi app chalate ho?", "Kabhi homework copy kiya hai? Kiska?", "Ek cheez jo kisi ko nahi pata tumhare baare mein?"];
  const DARE = ["Group mein apni sabse purani photo bhejo 😂", "Agle 3 messages sirf emoji mein likho", "Kisi dost ko 'tu best hai' bolo — abhi", "Apna last searched cheez share karo", "10 second ki voice note mein gaana gao 🎤", "Apni profile bio 1 ghante ke liye 'main aalu hoon 🥔' kar do"];
  function party() {
    const s = P.sheet("🎉 Party prompts", `<div class="tp-chips"><button type="button" data-m="w" class="on">Would you rather</button><button type="button" data-m="t">Truth</button><button type="button" data-m="d">Dare</button></div><div class="tp-prompt"></div><div class="tp-row2"><button type="button" class="btn" data-next>Next</button><button type="button" class="btn btn-ghost" data-send>Share to chat</button></div>`);
    let m = "w", cur = "";
    const next = () => { const l = { w: WYR, t: TRUTH, d: DARE }[m]; cur = l[Math.floor(Math.random() * l.length)]; const el = s.body.querySelector(".tp-prompt"); el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); el.textContent = cur; P.sound("tick"); };
    s.body.querySelector(".tp-chips").onclick = (e) => { const b = e.target.closest("[data-m]"); if (!b) return; m = b.dataset.m; s.body.querySelectorAll("[data-m]").forEach((x) => x.classList.toggle("on", x === b)); next(); };
    s.body.querySelector("[data-next]").onclick = next;
    s.body.querySelector("[data-send]").onclick = () => P.share("Party prompt", `${{ w: "🤔 Would you rather:", t: "🫣 Truth:", d: "😈 Dare:" }[m]} ${cur}`);
    next();
  }

  P.toolList.push(
    { key: "ttt", name: "Tic-tac-toe", icon: "tp-hash", sec: "Games", fn: ttt, badge: () => { const r = get("ttt"); return r ? `${r.w}W` : ""; } },
    { key: "c4", name: "4 in a row", icon: "tp-c4", sec: "Games", fn: connect4 },
    { key: "snake", name: "Snake", icon: "tp-snake", sec: "Games", fn: snake, badge: () => best("snake") ? `Best ${best("snake")}` : "" },
    { key: "memory", name: "Memory match", icon: "tp-brain", sec: "Games", fn: memory, badge: () => best("memory") ? `Best ${best("memory")}` : "" },
    { key: "react", name: "Reaction test", icon: "bolt", sec: "Games", fn: reaction, badge: () => best("react") ? `${best("react")}ms` : "" },
    { key: "typing", name: "Typing speed", icon: "tp-keyboard", sec: "Games", fn: typing, badge: () => best("wpm") ? `${best("wpm")}wpm` : "" },
    { key: "math", name: "Math sprint", icon: "tp-sigma", sec: "Games", fn: mathSprint, badge: () => best("math") != null ? `Best ${best("math")}` : "" },
    { key: "party", name: "Truth / dare / WYR", icon: "tp-party", sec: "Games", fn: party },
  );
})();
