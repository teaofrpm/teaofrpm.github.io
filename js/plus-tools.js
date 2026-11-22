/* plus-tools.js — study + everyday tools (all saved on this device). Needs plus.js. */
(() => {
  const P = window.Plus; if (!P) return;
  const { get, set, pad, dkey } = P;
  const esc = escapeHTML;
  const I = P.I;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const daysTo = (iso) => { const a = new Date(dkey() + "T00:00"), b = new Date(iso + "T00:00"); return Math.round((b - a) / 864e5); };
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /* ===== Homework / to-do ===== */
  P.hwDue = () => get("todo", []).filter((t) => !t.done).length;
  function todo() {
    const s = P.sheet("✅ Homework & to-do", `<div class="tp-add"><input type="text" placeholder="e.g. Maths ex 5.2" maxlength="120"><input type="date"><button type="button" class="btn btn-small">Add</button></div>
      <div class="tp-chips"><button type="button" data-f="open" class="on">Pending</button><button type="button" data-f="done">Done</button><button type="button" data-f="all">All</button></div><div class="tp-list"></div>`);
    let f = "open";
    const [ti, di] = s.body.querySelectorAll(".tp-add input");
    const paint = () => {
      const l = get("todo", []).filter((t) => f === "all" || (f === "done" ? t.done : !t.done))
        .sort((a, b) => a.done - b.done || (a.due || "9") .localeCompare(b.due || "9"));
      s.body.querySelector(".tp-list").innerHTML = l.map((t) => {
        const d = t.due ? daysTo(t.due) : null;
        const tag = d == null ? "" : d < 0 ? `<em class="bad">${-d}d late</em>` : d === 0 ? `<em class="warn">Today</em>` : d === 1 ? `<em class="warn">Tomorrow</em>` : `<em>${d}d</em>`;
        return `<div class="tp-item ${t.done ? "done" : ""}"><button type="button" class="tp-check" data-c="${t.id}">${t.done ? I("check", 14) : ""}</button><span>${esc(t.t)}</span>${t.done ? "" : tag}<button type="button" class="tp-del" data-d="${t.id}">×</button></div>`;
      }).join("") || `<div class="settings-empty">${f === "done" ? "Nothing done yet" : `${I("tp-party", 16)} Sab khatam!`}</div>`;
    };
    const add = () => { const t = ti.value.trim(); if (!t) return; set("todo", [...get("todo", []), { id: uid(), t, due: di.value || null, done: false }]); ti.value = ""; paint(); P.buzz(); };
    s.body.querySelector(".tp-add button").onclick = add;
    ti.onkeydown = (e) => e.key === "Enter" && add();
    s.body.querySelector(".tp-chips").onclick = (e) => { const b = e.target.closest("[data-f]"); if (!b) return; f = b.dataset.f; s.body.querySelectorAll(".tp-chips button").forEach((x) => x.classList.toggle("on", x === b)); paint(); };
    s.body.querySelector(".tp-list").onclick = (e) => {
      const c = e.target.closest("[data-c]"), d = e.target.closest("[data-d]");
      const l = get("todo", []);
      if (c) { const t = l.find((x) => x.id === c.dataset.c); t.done = !t.done; if (t.done) { P.sound("done"); P.buzz(20); } }
      if (d) l.splice(l.findIndex((x) => x.id === d.dataset.d), 1);
      if (c || d) { set("todo", l); paint(); }
    };
    paint();
  }

  /* ===== Timetable ===== */
  P.nextClass = () => {
    const tt = get("tt", {}), now = new Date(), cur = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return (tt[now.getDay()] || []).slice().sort((a, b) => a.time.localeCompare(b.time)).find((p) => p.time > cur) || null;
  };
  function timetable() {
    let day = new Date().getDay() || 1;
    const s = P.sheet("📅 Timetable", `<div class="tp-chips tp-days">${DAYS.map((d, i) => i ? `<button type="button" data-day="${i}">${d}</button>` : "").join("")}</div>
      <div class="tp-list"></div><div class="tp-add"><input type="time" value="08:00"><input type="text" placeholder="Subject" maxlength="40"><button type="button" class="btn btn-small">Add</button></div>
      <button type="button" class="tp-link" data-copy>Copy this day to all weekdays</button>`);
    const [tm, sub] = s.body.querySelectorAll(".tp-add input");
    const paint = () => {
      s.body.querySelectorAll("[data-day]").forEach((b) => b.classList.toggle("on", Number(b.dataset.day) === day));
      const l = (get("tt", {})[day] || []).slice().sort((a, b) => a.time.localeCompare(b.time));
      const nc = day === new Date().getDay() ? P.nextClass() : null;
      s.body.querySelector(".tp-list").innerHTML = l.map((p, i) => `<div class="tp-item ${nc && nc.time === p.time ? "now" : ""}"><b class="tp-time">${esc(p.time)}</b><span>${esc(p.sub)}</span>${nc && nc.time === p.time ? "<em class='warn'>Next</em>" : ""}<button type="button" class="tp-del" data-d="${esc(p.time)}|${esc(p.sub)}">×</button></div>`).join("") || `<div class="settings-empty">No classes — add the first period below</div>`;
    };
    s.body.querySelector(".tp-days").onclick = (e) => { const b = e.target.closest("[data-day]"); if (b) { day = Number(b.dataset.day); paint(); } };
    const add = () => { if (!sub.value.trim()) return; const tt = get("tt", {}); tt[day] = [...(tt[day] || []), { time: tm.value || "08:00", sub: sub.value.trim() }]; set("tt", tt); sub.value = ""; const [h, m] = (tm.value || "08:00").split(":").map(Number); const n = new Date(0, 0, 0, h, m + 40); tm.value = `${pad(n.getHours())}:${pad(n.getMinutes())}`; paint(); };
    s.body.querySelector(".tp-add button").onclick = add; sub.onkeydown = (e) => e.key === "Enter" && add();
    s.body.querySelector(".tp-list").onclick = (e) => { const d = e.target.closest("[data-d]"); if (!d) return; const [t, n] = d.dataset.d.split("|"); const tt = get("tt", {}); tt[day] = (tt[day] || []).filter((p) => !(esc(p.time) === t && esc(p.sub) === n)); set("tt", tt); paint(); };
    s.body.querySelector("[data-copy]").onclick = () => { const tt = get("tt", {}); for (let i = 1; i <= 6; i++) if (i !== day) tt[i] = JSON.parse(JSON.stringify(tt[day] || [])); set("tt", tt); toast("Copied to Mon–Sat ✅"); };
    paint();
  }

  /* ===== Exams countdown ===== */
  P.nextExam = () => { const l = get("exams", []).filter((e) => daysTo(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)); return l[0] ? { ...l[0], days: daysTo(l[0].date) } : null; };
  function exams() {
    const s = P.sheet("📝 Exam countdown", `<div class="tp-add"><input type="text" placeholder="e.g. Physics unit test" maxlength="60"><input type="date"><button type="button" class="btn btn-small">Add</button></div><div class="tp-list"></div>`);
    const [n, d] = s.body.querySelectorAll(".tp-add input");
    const paint = () => {
      const l = get("exams", []).sort((a, b) => a.date.localeCompare(b.date));
      s.body.querySelector(".tp-list").innerHTML = l.map((e) => { const x = daysTo(e.date); return `<div class="tp-item ${x < 0 ? "done" : ""}"><b class="tp-count ${x <= 3 && x >= 0 ? "hot" : ""}">${x < 0 ? I("check", 16) : x === 0 ? "Today" : x}</b><span>${esc(e.name)}<small>${new Date(e.date + "T00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}${x > 0 ? ` · ${x} day${x > 1 ? "s" : ""} left` : ""}</small></span><button type="button" class="tp-del" data-d="${e.id}">×</button></div>`; }).join("") || `<div class="settings-empty">No exams added</div>`;
    };
    const add = () => { if (!n.value.trim() || !d.value) return toast("Name aur date dono daalo"); set("exams", [...get("exams", []), { id: uid(), name: n.value.trim(), date: d.value }]); n.value = ""; paint(); };
    s.body.querySelector(".tp-add button").onclick = add;
    s.body.querySelector(".tp-list").onclick = (e) => { const x = e.target.closest("[data-d]"); if (x) { set("exams", get("exams", []).filter((y) => y.id !== x.dataset.d)); paint(); } };
    paint();
  }

  /* ===== Focus timer (pomodoro) + study mode ===== */
  P.pomoNext = () => {
    const st = get("pomo"); if (!st) return;
    const cfg = get("pomo_cfg", { f: 25, b: 5 });
    if (st.phase === "focus") { const log = get("focus_log", {}); log[dkey()] = (log[dkey()] || 0) + cfg.f; set("focus_log", log); }
    const phase = st.phase === "focus" ? "break" : "focus";
    set("pomo", { ...st, phase, endAt: Date.now() + (phase === "focus" ? cfg.f : cfg.b) * 60000 });
    P.sound(phase === "break" ? "win" : "done"); P.buzz([100, 80, 100]);
    P.notify(phase === "break" ? "☕ Break time!" : "🍅 Back to focus", phase === "break" ? `${cfg.b} min break — paani piyo, stretch karo` : `${cfg.f} min focus shuru`);
  };
  function focus() {
    const s = P.sheet("🍅 Focus timer", `<div class="tp-center"><div class="tp-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" class="bg"/><circle cx="60" cy="60" r="54" class="fg"/></svg><div><b class="tp-clock">25:00</b><small class="tp-phase">Ready</small></div></div>
      <div class="tp-row2"><label>Focus <select data-f>${[15, 20, 25, 30, 45, 50, 60].map((m) => `<option>${m}</option>`).join("")}</select> min</label><label>Break <select data-b>${[3, 5, 10, 15].map((m) => `<option>${m}</option>`).join("")}</select> min</label></div>
      <label class="tp-tg tp-inline"><span><b>Hide the feed while focusing</b></span><input type="checkbox" data-block><i></i></label>
      <div class="tp-row2"><button type="button" class="btn" data-go>Start</button><button type="button" class="btn btn-ghost" data-stop>Reset</button></div>
      <p class="x3-hint tp-today"></p></div>`);
    const cfg = get("pomo_cfg", { f: 25, b: 5 });
    s.body.querySelector("[data-f]").value = cfg.f; s.body.querySelector("[data-b]").value = cfg.b;
    s.body.querySelector("[data-block]").checked = !!get("pomo", {})?.block || !!cfg.block;
    const fg = s.body.querySelector(".fg"), C = 2 * Math.PI * 54; fg.style.strokeDasharray = C;
    const paint = () => {
      const st = get("pomo"), c = get("pomo_cfg", { f: 25, b: 5 });
      const total = (st?.phase === "break" ? c.b : c.f) * 60;
      const left = st?.endAt ? Math.max(0, Math.round((st.endAt - Date.now()) / 1000)) : st?.paused ?? c.f * 60;
      s.body.querySelector(".tp-clock").textContent = `${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
      s.body.querySelector(".tp-phase").textContent = !st ? "Ready" : st.endAt ? (st.phase === "break" ? "Break" : "Focus") : "Paused";
      s.body.querySelector("[data-go]").textContent = st?.endAt ? "Pause" : st ? "Resume" : "Start";
      fg.style.strokeDashoffset = C * (1 - left / total);
      s.body.querySelector(".tp-today").textContent = `Aaj ka focus: ${get("focus_log", {})[dkey()] || 0} min`;
    };
    const saveCfg = () => set("pomo_cfg", { f: Number(s.body.querySelector("[data-f]").value), b: Number(s.body.querySelector("[data-b]").value), block: s.body.querySelector("[data-block]").checked });
    s.body.addEventListener("change", () => { saveCfg(); const st = get("pomo"); if (st) set("pomo", { ...st, block: s.body.querySelector("[data-block]").checked }); paint(); });
    s.body.querySelector("[data-go]").onclick = () => {
      saveCfg(); P.askNotify(); const st = get("pomo"), c = get("pomo_cfg");
      if (st?.endAt) set("pomo", { ...st, endAt: null, paused: Math.round((st.endAt - Date.now()) / 1000) });
      else if (st) set("pomo", { ...st, endAt: Date.now() + st.paused * 1000 });
      else set("pomo", { phase: "focus", endAt: Date.now() + c.f * 60000, block: c.block });
      P.buzz(); paint();
    };
    s.body.querySelector("[data-stop]").onclick = () => { set("pomo", null); paint(); };
    const iv = setInterval(paint, 500); s.cleanup = () => clearInterval(iv); paint();
  }

  /* ===== Stopwatch ===== */
  function stopwatch() {
    const s = P.sheet("⏱️ Stopwatch", `<div class="tp-center"><b class="tp-clock tp-sw">00:00.0</b><div class="tp-row2"><button type="button" class="btn" data-go>Start</button><button type="button" class="btn btn-ghost" data-lap>Lap</button></div><div class="tp-list tp-laps"></div></div>`);
    let t0 = 0, acc = 0, run = false, laps = [];
    const fmt = (ms) => `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${Math.floor(ms / 100) % 10}`;
    const now = () => acc + (run ? Date.now() - t0 : 0);
    const iv = setInterval(() => (s.body.querySelector(".tp-sw").textContent = fmt(now())), 50); s.cleanup = () => clearInterval(iv);
    s.body.querySelector("[data-go]").onclick = (e) => { if (run) { acc += Date.now() - t0; run = false; e.target.textContent = "Start"; s.body.querySelector("[data-lap]").textContent = "Reset"; } else { t0 = Date.now(); run = true; e.target.textContent = "Stop"; s.body.querySelector("[data-lap]").textContent = "Lap"; } P.buzz(); };
    s.body.querySelector("[data-lap]").onclick = () => { if (!run) { acc = 0; laps = []; } else laps.unshift(now()); s.body.querySelector(".tp-laps").innerHTML = laps.map((l, i) => `<div class="tp-item"><span>Lap ${laps.length - i}</span><b>${fmt(l)}</b></div>`).join(""); };
  }

  /* ===== Marks / percentage calculator ===== */
  const grade = (p) => p >= 91 ? "A1" : p >= 81 ? "A2" : p >= 71 ? "B1" : p >= 61 ? "B2" : p >= 51 ? "C1" : p >= 41 ? "C2" : p >= 33 ? "D" : "E";
  function marks() {
    const s = P.sheet("🧮 Marks calculator", `<div class="tp-list tp-marks"></div><button type="button" class="tp-link" data-add>+ Add subject</button><div class="tp-result"></div>`);
    const rows = get("marks", [{ s: "English", o: "", m: 100 }, { s: "Maths", o: "", m: 100 }, { s: "Science", o: "", m: 100 }]);
    const paint = () => {
      s.body.querySelector(".tp-marks").innerHTML = rows.map((r, i) => `<div class="tp-mrow"><input data-i="${i}" data-k="s" value="${esc(r.s)}" placeholder="Subject"><input data-i="${i}" data-k="o" type="number" inputmode="decimal" value="${esc(r.o)}" placeholder="Got"><span>/</span><input data-i="${i}" data-k="m" type="number" inputmode="decimal" value="${esc(r.m)}"><button type="button" class="tp-del" data-d="${i}">×</button></div>`).join("");
      calc();
    };
    const calc = () => {
      const v = rows.filter((r) => r.o !== "" && Number(r.m) > 0);
      const o = v.reduce((a, r) => a + Number(r.o), 0), m = v.reduce((a, r) => a + Number(r.m), 0), p = m ? (o / m) * 100 : 0;
      s.body.querySelector(".tp-result").innerHTML = m ? `<b>${p.toFixed(2)}%</b><span>${o} / ${m} · Grade ${grade(p)} · CGPA ≈ ${(p / 9.5).toFixed(1)}</span>${v.map((r) => `<small>${esc(r.s)}: ${((r.o / r.m) * 100).toFixed(0)}% (${grade((r.o / r.m) * 100)})</small>`).join("")}` : `<span>Marks daalo, result yahan dikhega</span>`;
      set("marks", rows);
    };
    s.body.addEventListener("input", (e) => { const i = e.target.dataset.i; if (i == null) return; rows[i][e.target.dataset.k] = e.target.value; calc(); });
    s.body.addEventListener("click", (e) => { if (e.target.closest("[data-add]")) { rows.push({ s: "", o: "", m: 100 }); paint(); } const d = e.target.closest("[data-d]"); if (d) { rows.splice(Number(d.dataset.d), 1); paint(); } });
    paint();
  }

  /* ===== Attendance (75% rule) ===== */
  function attendance() {
    const s = P.sheet("🙋 Attendance", `<div class="tp-add"><input type="text" placeholder="Subject (or 'Overall')" maxlength="30"><button type="button" class="btn btn-small">Add</button></div>
      <label class="tp-tg tp-inline"><span><b>Target</b></span><select data-target>${[60, 65, 70, 75, 80, 85, 90].map((x) => `<option value="${x}">${x}%</option>`).join("")}</select></label><div class="tp-list"></div>`);
    const tg = s.body.querySelector("[data-target]"); tg.value = get("att_target", 75);
    const paint = () => {
      const T = Number(tg.value) / 100;
      s.body.querySelector(".tp-list").innerHTML = get("att", []).map((a) => {
        const pc = a.t ? (a.p / a.t) * 100 : 0;
        const bunk = Math.floor(a.p / T - a.t), need = Math.ceil((T * a.t - a.p) / (1 - T));
        const note = !a.t ? "Start marking" : pc >= T * 100 ? (bunk > 0 ? `${I("tp-checkc", 13)} ${bunk} class${bunk > 1 ? "es" : ""} bunk kar sakte ho` : `${I("tp-alarm", 13)} Ab ek bhi miss mat karna`) : `${I("bolt", 13)} Lagatar ${need} class${need > 1 ? "es" : ""} attend karo`;
        return `<div class="tp-att ${a.t && pc < T * 100 ? "low" : ""}"><div><b>${esc(a.n)}</b><small>${a.p}/${a.t} · ${note}</small></div><strong>${a.t ? pc.toFixed(0) : "–"}%</strong>
          <div class="tp-att-btns"><button type="button" data-a="p" data-id="${a.id}">${I("check", 14)} Present</button><button type="button" data-a="a" data-id="${a.id}">${I("close", 14)} Absent</button><button type="button" data-a="u" data-id="${a.id}" aria-label="Undo">${I("tp-undo", 15)}</button><button type="button" data-a="x" data-id="${a.id}" aria-label="Delete">${I("trash", 15)}</button></div></div>`;
      }).join("") || `<div class="settings-empty">Subject add karo, roz Present / Absent dabao</div>`;
    };
    const inp = s.body.querySelector(".tp-add input");
    s.body.querySelector(".tp-add button").onclick = () => { if (!inp.value.trim()) return; set("att", [...get("att", []), { id: uid(), n: inp.value.trim(), p: 0, t: 0, h: [] }]); inp.value = ""; paint(); };
    tg.onchange = () => { set("att_target", Number(tg.value)); paint(); };
    s.body.querySelector(".tp-list").onclick = (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      const l = get("att", []), a = l.find((x) => x.id === b.dataset.id); if (!a) return;
      if (b.dataset.a === "p") { a.p++; a.t++; a.h.push(1); } else if (b.dataset.a === "a") { a.t++; a.h.push(0); }
      else if (b.dataset.a === "u") { const last = a.h.pop(); if (last != null) { a.t--; a.p -= last; } }
      else if (b.dataset.a === "x") { if (!confirm(`Delete ${a.n}?`)) return; l.splice(l.indexOf(a), 1); }
      a.h = a.h.slice(-200); set("att", l); P.buzz(); paint();
    };
    paint();
  }

  /* ===== Notes ===== */
  function notes() {
    const s = P.sheet("🗒️ Notes", `<div class="tp-add"><input type="search" placeholder="Search notes…"><button type="button" class="btn btn-small" data-new>+ New</button></div><div class="tp-list tp-notes"></div>`);
    const q = s.body.querySelector("input");
    const paint = () => {
      const t = q.value.trim().toLowerCase();
      s.body.querySelector(".tp-notes").innerHTML = get("notes", []).filter((n) => !t || n.x.toLowerCase().includes(t)).sort((a, b) => b.at - a.at)
        .map((n) => `<button type="button" class="tp-note" data-o="${n.id}"><b>${esc(n.x.split("\n")[0].slice(0, 60) || "Untitled")}</b><small>${esc(n.x.split("\n").slice(1).join(" ").slice(0, 90))}</small><em>${new Date(n.at).toLocaleDateString([], { day: "numeric", month: "short" })}</em></button>`).join("") || `<div class="settings-empty">Koi note nahi — "+ New" dabao</div>`;
    };
    const edit = (id) => {
      const l = get("notes", []); let n = l.find((x) => x.id === id);
      if (!n) { n = { id: uid(), x: "", at: Date.now() }; }
      const e = P.sheet("", `<textarea class="tp-note-ed" placeholder="Title on the first line…">${esc(n.x)}</textarea><div class="tp-row2"><button type="button" class="btn btn-small btn-ghost" data-share>Share</button><button type="button" class="btn btn-small btn-ghost" data-del>Delete</button></div>`);
      const ta = e.body.querySelector("textarea");
      const save = () => { const all = get("notes", []).filter((x) => x.id !== n.id); if (ta.value.trim()) all.push({ ...n, x: ta.value, at: Date.now() }); set("notes", all); paint(); };
      ta.addEventListener("input", save);
      e.body.querySelector("[data-del]").onclick = () => { ta.value = ""; save(); e.close(); };
      e.body.querySelector("[data-share]").onclick = () => P.share("Note", ta.value);
      setTimeout(() => ta.focus(), 250);
    };
    q.oninput = paint;
    s.body.querySelector("[data-new]").onclick = () => edit(null);
    s.body.querySelector(".tp-notes").onclick = (e) => { const b = e.target.closest("[data-o]"); if (b) edit(b.dataset.o); };
    paint();
  }

  /* ===== Flashcards ===== */
  function flash() {
    const s = P.sheet("🃏 Flashcards", `<div class="tp-add"><input type="text" placeholder="New deck name" maxlength="40"><button type="button" class="btn btn-small">Create</button></div><div class="tp-list"></div>`);
    const inp = s.body.querySelector("input");
    const paint = () => { s.body.querySelector(".tp-list").innerHTML = get("decks", []).map((d) => `<div class="tp-item"><span><b>${esc(d.n)}</b><small>${d.c.length} cards</small></span><button type="button" class="btn btn-small" data-study="${d.id}" ${d.c.length ? "" : "disabled"}>Study</button><button type="button" class="btn btn-small btn-ghost" data-edit="${d.id}">Edit</button></div>`).join("") || `<div class="settings-empty">Deck banao — e.g. "History dates"</div>`; };
    s.body.querySelector(".tp-add button").onclick = () => { if (!inp.value.trim()) return; set("decks", [...get("decks", []), { id: uid(), n: inp.value.trim(), c: [] }]); inp.value = ""; paint(); };
    s.body.querySelector(".tp-list").onclick = (e) => {
      const st = e.target.closest("[data-study]"), ed = e.target.closest("[data-edit]");
      const d = get("decks", []).find((x) => x.id === (st || ed)?.dataset[st ? "study" : "edit"]); if (!d) return;
      if (ed) {
        const x = P.sheet(`Edit: ${d.n}`, `<p class="x3-hint">Ek line mein ek card: <b>question | answer</b></p><textarea class="tp-note-ed" rows="10">${esc(d.c.map((c) => `${c.q} | ${c.a}`).join("\n"))}</textarea><div class="tp-row2"><button type="button" class="btn" data-save>Save</button><button type="button" class="btn btn-ghost" data-del>Delete deck</button></div>`);
        x.body.querySelector("[data-save]").onclick = () => { const c = x.body.querySelector("textarea").value.split("\n").map((l) => l.split("|")).filter((p) => p.length >= 2 && p[0].trim()).map(([q, ...a]) => ({ q: q.trim(), a: a.join("|").trim() })); set("decks", get("decks", []).map((y) => y.id === d.id ? { ...y, c } : y)); x.close(); paint(); toast(`${c.length} cards saved`); };
        x.body.querySelector("[data-del]").onclick = () => { if (!confirm("Delete this deck?")) return; set("decks", get("decks", []).filter((y) => y.id !== d.id)); x.close(); paint(); };
        return;
      }
      let deck = d.c.slice().sort(() => Math.random() - 0.5), i = 0, known = 0;
      const y = P.sheet(d.n, `<div class="tp-center"><small class="tp-fc-n"></small><button type="button" class="tp-card"><div class="tp-card-in"><div class="f"></div><div class="b"></div></div></button><p class="x3-hint">Tap the card to flip</p><div class="tp-row2"><button type="button" class="btn btn-ghost" data-again>${I("tp-undo", 16)} Again</button><button type="button" class="btn" data-got>${I("check", 16)} Got it</button></div></div>`);
      const card = y.body.querySelector(".tp-card");
      const show = () => {
        if (i >= deck.length) { y.body.querySelector(".tp-center").innerHTML = `<div class="tp-big tp-bigic">${I("tp-trophy", 44)}</div><b>Deck done!</b><p>${known} / ${d.c.length} first try</p>`; P.sound("win"); return; }
        card.classList.remove("flip"); y.body.querySelector(".f").textContent = deck[i].q; y.body.querySelector(".b").textContent = deck[i].a; y.body.querySelector(".tp-fc-n").textContent = `${i + 1} / ${deck.length}`;
      };
      card.onclick = () => { card.classList.toggle("flip"); P.buzz(6); };
      y.body.querySelector("[data-got]").onclick = () => { if (!deck[i]._again) known++; i++; show(); };
      y.body.querySelector("[data-again]").onclick = () => { deck.push({ ...deck[i], _again: 1 }); i++; show(); };
      show();
    };
    paint();
  }

  /* ===== Random picker / coin / dice ===== */
  function picker() {
    const s = P.sheet("🎯 Random picker", `<textarea class="tp-note-ed" rows="4" placeholder="Naam daalo — ek line mein ek, ya comma se">${esc(get("pick", ""))}</textarea><div class="tp-center"><b class="tp-pick">?</b><button type="button" class="btn" data-go>Pick one</button><p class="x3-hint">"Kaun dega treat?" — ab bahes khatam</p></div>`);
    s.body.querySelector("[data-go]").onclick = () => {
      const ta = s.body.querySelector("textarea"); set("pick", ta.value);
      const l = ta.value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean); if (l.length < 2) return toast("Kam se kam 2 naam daalo");
      const out = s.body.querySelector(".tp-pick"); let n = 0; const total = 18 + Math.floor(Math.random() * 8);
      const step = () => { out.textContent = l[n % l.length]; P.sound("tick"); n++; if (n < total) setTimeout(step, 40 + n * 9); else { out.innerHTML = `${I("tp-party", 24)} ${esc(l[Math.floor(Math.random() * l.length)])}`; out.classList.add("pop"); P.sound("win"); setTimeout(() => out.classList.remove("pop"), 600); } };
      step();
    };
  }
  function coin() {
    const s = P.sheet("🪙 Coin & dice", `<div class="tp-center"><div class="tp-coin">${I("tp-coin", 72)}</div><b class="tp-pick tp-cres">Tap to flip</b><div class="tp-row2"><button type="button" class="btn" data-c>Flip coin</button><button type="button" class="btn btn-ghost" data-d>${I("tp-dice", 16)} Roll dice</button><button type="button" class="btn btn-ghost" data-d2>2 dice</button></div></div>`);
    const out = s.body.querySelector(".tp-cres"), coinEl = s.body.querySelector(".tp-coin");
    const anim = (txt, face) => { coinEl.classList.remove("spin"); void coinEl.offsetWidth; coinEl.classList.add("spin"); coinEl.innerHTML = I(face, 72); out.textContent = "…"; P.buzz(20); setTimeout(() => { out.textContent = txt; P.sound("tick"); }, 650); };
    const D = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
    s.body.querySelector("[data-c]").onclick = () => anim(Math.random() < 0.5 ? "Heads" : "Tails", "tp-coin");
    s.body.querySelector("[data-d]").onclick = () => { const r = 1 + Math.floor(Math.random() * 6); anim(`${D[r - 1]}  ${r}`, "tp-dice"); };
    s.body.querySelector("[data-d2]").onclick = () => { const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6); anim(`${D[a - 1]} ${D[b - 1]}  = ${a + b}`, "tp-dice"); };
  }

  /* ===== Habits ===== */
  function habits() {
    const s = P.sheet("🌱 Habit tracker", `<div class="tp-add"><input type="text" placeholder="e.g. 8 glass paani, 30 min reading" maxlength="40"><button type="button" class="btn btn-small">Add</button></div><div class="tp-list"></div>`);
    const week = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
    const streak = (h) => { let n = 0; const d = new Date(); if (!h.d[dkey(d)]) d.setDate(d.getDate() - 1); while (h.d[dkey(d)]) { n++; d.setDate(d.getDate() - 1); } return n; };
    const paint = () => { s.body.querySelector(".tp-list").innerHTML = get("habits", []).map((h) => `<div class="tp-habit"><div><b>${esc(h.n)}</b><small>${I("tp-flame", 12)} ${streak(h)} day streak</small></div><div class="tp-week">${week.map((d) => `<button type="button" data-h="${h.id}" data-k="${dkey(d)}" class="${h.d[dkey(d)] ? "on" : ""}">${"SMTWTFS"[d.getDay()]}</button>`).join("")}</div><button type="button" class="tp-del" data-x="${h.id}">×</button></div>`).join("") || `<div class="settings-empty">Ek achhi aadat add karo</div>`; };
    const inp = s.body.querySelector("input");
    s.body.querySelector(".tp-add button").onclick = () => { if (!inp.value.trim()) return; set("habits", [...get("habits", []), { id: uid(), n: inp.value.trim(), d: {} }]); inp.value = ""; paint(); };
    s.body.querySelector(".tp-list").onclick = (e) => {
      const b = e.target.closest("[data-h]"), x = e.target.closest("[data-x]"); const l = get("habits", []);
      if (b) { const h = l.find((y) => y.id === b.dataset.h); h.d[b.dataset.k] = !h.d[b.dataset.k]; if (!h.d[b.dataset.k]) delete h.d[b.dataset.k]; else { P.sound("done"); P.buzz(15); } }
      if (x) l.splice(l.findIndex((y) => y.id === x.dataset.x), 1);
      if (b || x) { set("habits", l); paint(); }
    };
    paint();
  }

  /* ===== Birthdays ===== */
  function bdays() {
    const s = P.sheet("🎂 Birthdays", `<div class="tp-add"><input type="text" placeholder="Name" maxlength="40"><input type="date"><button type="button" class="btn btn-small">Add</button></div><div class="tp-list"></div><p class="x3-hint">Us din app khulte hi yaad dilayega</p>`);
    const [n, d] = s.body.querySelectorAll("input");
    const next = (iso) => { const t = new Date(dkey() + "T00:00"); const b = new Date(t.getFullYear() + iso.slice(4) + "T00:00"); if (b < t) b.setFullYear(t.getFullYear() + 1); return Math.round((b - t) / 864e5); };
    const paint = () => { s.body.querySelector(".tp-list").innerHTML = get("bdays", []).map((b) => ({ ...b, n: next(b.date) })).sort((a, b) => a.n - b.n).map((b) => `<div class="tp-item"><b class="tp-count ${b.n <= 7 ? "hot" : ""}">${b.n === 0 ? I("tp-cake", 18) : b.n}</b><span>${esc(b.name)}<small>${new Date(b.date + "T00:00").toLocaleDateString([], { day: "numeric", month: "long" })}${b.n ? ` · ${b.n} days` : " · TODAY"}</small></span><button type="button" class="tp-del" data-d="${b.id}">×</button></div>`).join("") || `<div class="settings-empty">Doston ke birthday add karo</div>`; };
    s.body.querySelector(".tp-add button").onclick = () => { if (!n.value.trim() || !d.value) return toast("Naam aur date daalo"); set("bdays", [...get("bdays", []), { id: uid(), name: n.value.trim(), date: d.value }]); n.value = ""; paint(); };
    s.body.querySelector(".tp-list").onclick = (e) => { const x = e.target.closest("[data-d]"); if (x) { set("bdays", get("bdays", []).filter((y) => y.id !== x.dataset.d)); paint(); } };
    paint();
  }

  /* ===== Reminders list ===== */
  function reminders() {
    const s = P.sheet("⏰ Reminders", `<div class="tp-add"><input type="text" placeholder="Remind me to…" maxlength="120"><input type="datetime-local"><button type="button" class="btn btn-small">Add</button></div><div class="tp-list"></div><p class="x3-hint">Chat mein kisi message ko daba ke "Remind me" bhi kar sakte ho.</p>`);
    const [t, w] = s.body.querySelectorAll("input");
    const d = new Date(Date.now() + 3600e3); w.value = `${dkey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const paint = () => { s.body.querySelector(".tp-list").innerHTML = get("rem", []).sort((a, b) => a.at - b.at).map((r) => `<div class="tp-item"><span>${esc(r.text.slice(0, 80))}<small>${new Date(r.at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></span>${r.url ? `<a class="btn btn-small btn-ghost" href="${esc(r.url)}">Open</a>` : ""}<button type="button" class="tp-del" data-d="${r.id}">×</button></div>`).join("") || `<div class="settings-empty">No reminders</div>`; };
    s.body.querySelector(".tp-add button").onclick = () => { const at = new Date(w.value).getTime(); if (!t.value.trim() || !(at > Date.now())) return toast("Text aur future time daalo"); P.addReminder(at, t.value.trim(), null); t.value = ""; paint(); toast("⏰ Reminder set"); };
    s.body.querySelector(".tp-list").onclick = (e) => { const x = e.target.closest("[data-d]"); if (x) { set("rem", get("rem", []).filter((y) => y.id !== x.dataset.d)); paint(); } };
    paint();
  }

  /* ===== Unit converter + tip/split calculator ===== */
  function split() {
    const s = P.sheet("💸 Split the bill", `<div class="tp-mrow"><input type="number" inputmode="decimal" data-a placeholder="Total ₹"><input type="number" inputmode="numeric" data-n placeholder="People" value="2"><input type="number" inputmode="numeric" data-t placeholder="Tip %" value="0"></div><div class="tp-result"><span>Total daalo</span></div>`);
    s.body.addEventListener("input", () => {
      const a = Number(s.body.querySelector("[data-a]").value), n = Math.max(1, Number(s.body.querySelector("[data-n]").value) || 1), t = Number(s.body.querySelector("[data-t]").value) || 0;
      const tot = a * (1 + t / 100);
      s.body.querySelector(".tp-result").innerHTML = a ? `<b>₹${(tot / n).toFixed(2)}</b><span>each · total ₹${tot.toFixed(2)} for ${n}</span><button type="button" class="btn btn-small btn-ghost" data-sh>Share in chat</button>` : `<span>Total daalo</span>`;
      const sh = s.body.querySelector("[data-sh]"); if (sh) sh.onclick = () => P.share("Bill split", `🧾 Bill ₹${tot.toFixed(0)} ÷ ${n} = ₹${(tot / n).toFixed(0)} each. Paise bhejo 😤`);
    });
  }

  /* ===== registry ===== */
  P.toolList = [
    { key: "todo", name: "Homework & to-do", icon: "tp-todo", sec: "Study", fn: todo, badge: () => P.hwDue() || "" },
    { key: "timetable", name: "Timetable", icon: "calendar", sec: "Study", fn: timetable, badge: () => P.nextClass()?.sub || "" },
    { key: "attendance", name: "Attendance (75%)", icon: "tp-hand", sec: "Study", fn: attendance },
    { key: "exams", name: "Exam countdown", icon: "tp-exam", sec: "Study", fn: exams, badge: () => { const e = P.nextExam(); return e ? `${e.days}d` : ""; } },
    { key: "focus", name: "Focus timer", icon: "tp-timer", sec: "Study", fn: focus },
    { key: "flash", name: "Flashcards", icon: "tp-cards", sec: "Study", fn: flash },
    { key: "marks", name: "Marks calculator", icon: "tp-calc", sec: "Study", fn: marks },
    { key: "notes", name: "Notes", icon: "tp-note", sec: "Study", fn: notes },
    { key: "stopwatch", name: "Stopwatch", icon: "tp-stopwatch", sec: "Everyday", fn: stopwatch },
    { key: "reminders", name: "Reminders", icon: "tp-alarm", sec: "Everyday", fn: reminders, badge: () => get("rem", []).length || "" },
    { key: "habits", name: "Habit tracker", icon: "tp-sprout", sec: "Everyday", fn: habits },
    { key: "bdays", name: "Birthdays", icon: "tp-cake", sec: "Everyday", fn: bdays },
    { key: "split", name: "Split the bill", icon: "tp-receipt", sec: "Everyday", fn: split },
    { key: "picker", name: "Random picker", icon: "tp-target", sec: "Fun", fn: picker },
    { key: "coin", name: "Coin & dice", icon: "tp-coin", sec: "Fun", fn: coin },
  ];
  P.openTool = (key) => { const t = P.toolList.find((x) => x.key === key); if (t) t.fn(); };
})();
