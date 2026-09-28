/* ============================================================
   extras3.js — batch 3 of the add-on layer.

   Same contract as extras.js / extras2.js: nothing here edits an existing
   function, every feature attaches from outside, and each one is isolated
   so a failure in one cannot stop the rest. Remove the one <script> tag and
   the app is exactly as it was before this batch.

   Every chat feature works the same in the public room (chat.html) and in
   groups/DMs (room.html). Streaks are the one exception by nature: a streak
   is between two people, so it only exists in DMs.
   ============================================================ */

(function () {
  "use strict";

  /* ---------- small shared helpers ---------- */

  const on = (ev, sel, fn) => document.addEventListener(ev, (e) => {
    const el = e.target.closest?.(sel);
    if (el) fn(e, el);
  });
  const say = (m) => (typeof toast === "function" ? toast(m) : console.log(m));
  const esc = (s) => (typeof escapeHTML === "function")
    ? escapeHTML(String(s ?? ""))
    : String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function feature(name, fn) {
    Promise.resolve().then(fn).catch((err) => console.error(`[extras3] ${name} failed:`, err));
  }

  const page = location.pathname.split("/").pop() || "index.html";
  const isChat = page === "chat.html" || page === "room.html";
  const isInbox = page === "messages.html";
  const convoId = () => new URLSearchParams(location.search).get("c");  // null in the public room
  const chatKey = () => convoId() || "room";
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const hasMe = () => typeof ME !== "undefined" && ME;

  function waitFor(cond, timeoutMs = 6000) {
    return new Promise((resolve) => {
      if (cond()) return resolve(true);
      const t0 = Date.now();
      const id = setInterval(() => {
        if (cond() || Date.now() - t0 > timeoutMs) { clearInterval(id); resolve(!!cond()); }
      }, 80);
    });
  }

  // The database raises readable-but-raw errors ("muted: …", "slowmode: …").
  function friendly(err) {
    const raw = (err && err.message) || "";
    if (raw.startsWith("muted:")) return raw.replace("muted: ", "");
    if (raw.startsWith("antilink:")) return "Links aren't allowed here right now.";
    if (raw.startsWith("slowmode:")) return "Slow mode is on — wait a few seconds.";
    if (raw.startsWith("rate_limited:")) return "Slow down a little.";
    return raw || "Something went wrong.";
  }

  // Sends a message straight into the current chat. The page's own realtime
  // subscription then renders it like any other message.
  async function sendRaw(content) {
    const { error } = await sb.from("messages")
      .insert({ user_id: ME.id, conversation_id: convoId() || null, content });
    if (error) { say(friendly(error)); return false; }
    return true;
  }

  // One observer for the message list, shared by every feature that needs to
  // react to new rows — rather than five observers doing the same work.
  const messageWatchers = [];
  function onMessagesChange(fn) {
    messageWatchers.push(fn);
    if (messageWatchers.length === 1) {
      const msgs = document.getElementById("messages");
      if (!msgs) return;
      let t;
      new MutationObserver(() => {
        clearTimeout(t);
        t = setTimeout(() => messageWatchers.forEach((w) => { try { w(); } catch (e) { console.error(e); } }), 120);
      }).observe(msgs, { childList: true, subtree: true });
    }
    try { fn(); } catch (e) { console.error(e); }
  }

  function makeSheet(title, html) {
    const bd = document.createElement("div");
    bd.className = "app-sheet-backdrop x3-sheet";
    bd.innerHTML = `
      <div class="app-sheet">
        <div class="app-sheet-handle"></div>
        <div class="app-sheet-title">${esc(title)}</div>
        <div class="x3-sheet-body">${html}</div>
      </div>`;
    document.body.appendChild(bd);
    const api = {
      el: bd,
      body: bd.querySelector(".x3-sheet-body"),
      open() { document.querySelectorAll(".x3-sheet.show").forEach((s) => s.classList.remove("show")); bd.classList.add("show"); },
      close() { bd.classList.remove("show"); },
    };
    bd.addEventListener("click", (e) => { if (e.target === bd) api.close(); });
    return api;
  }

  const pad = (n) => String(n).padStart(2, "0");
  const toLocalInput = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  /* ---------- boot ---------- */

  let booted = false;
  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();

  async function boot() {
    if (booted) return;
    booted = true;
    await waitFor(() => typeof sb !== "undefined");

    if (isChat) {
      feature("pill composer", pillComposer);
      feature("plus menu", plusMenu);
      feature("polls", polls);
      feature("countdowns", countdowns);
      feature("message effects", messageEffects);
      feature("catch-up", catchUp);
    }
    if (isInbox || page === "room.html") feature("streaks", streaks);
  }

  /* ============================================================
     0. Instagram-style composer
        chat-polish.css turns the composer row into one rounded box once
        this adds .x-pill (without JS it stays the old, working layout).
        Here we only keep two flags in sync with what the page is doing:
          .has-text  → hide sticker / photo / mic, like Instagram
          .can-send  → show the send button (text OR a pending photo/voice)
        can-send follows the page's own sendBtn.disabled, so the rules for
        "is there anything to send" stay in one place: chat.js / room.js.
     ============================================================ */

  function pillComposer() {
    const row = document.querySelector(".composer-row");
    const input = document.getElementById("msgInput");
    const send = document.getElementById("sendBtn");
    if (!row || !input || !send) return;

    row.classList.add("x-pill");
    const sync = () => {
      row.classList.toggle("has-text", input.value.trim().length > 0);
      row.classList.toggle("can-send", !send.disabled);
    };
    input.addEventListener("input", sync);
    // the page flips sendBtn.disabled itself (after sending, when a photo is
    // attached, after a voice note) — follow it instead of guessing
    new MutationObserver(sync).observe(send, { attributes: true, attributeFilter: ["disabled"] });
    sync();
  }

  /* ============================================================
     1. The + menu
        Everything this layer adds to the composer sits behind ONE button,
        so the text box keeps its width: quick emoji, poll, countdown,
        scheduled message, leaderboard and voice typing.
     ============================================================ */

  let pollSheet, countdownSheet, scheduleSheet;
  const QUICK_EMOJI = ["😂", "❤️", "🔥", "👍", "🙏", "😭", "💯", "🎉"];

  async function plusMenu() {
    const row = document.querySelector(".composer-row");
    const composer = row?.closest(".composer");
    const input = document.getElementById("msgInput");
    if (!row || !composer || row.querySelector(".x3-plus-btn")) return;
    await waitFor(hasMe);
    if (getComputedStyle(composer).position === "static") composer.style.position = "relative";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-btn x3-plus-btn";
    btn.title = "More: poll, countdown, schedule, voice typing…";
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = svgIcon("plus", 20);
    row.insertBefore(btn, row.firstChild);

    const dictation = setupDictation(composer, input);

    const tiles = [
      ["poll", "Poll", "x3-t-poll", () => openPollSheet()],
      ["hourglass", "Countdown", "x3-t-cd", () => openCountdownSheet()],
      ["clock", "Schedule", "x3-t-sch", () => openScheduleSheet()],
      ["trophy", "Leaderboard", "x3-t-top", () => sendRaw("/top")],
      ...(dictation ? [["voiceType", "Voice typing", "x3-t-voice", () => dictation.toggle()]] : []),
    ];

    const menu = document.createElement("div");
    menu.className = "x3-plus";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <div class="x3-plus-emoji">${QUICK_EMOJI.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}</div>
      <div class="x3-plus-grid">
        ${tiles.map(([icon, label, cls], i) => `
          <button type="button" class="x3-tile ${cls}" data-tile="${i}" style="--i:${i}">
            <span class="x3-tile-ic">${svgIcon(icon, 20)}</span><span class="x3-tile-label">${label}</span>
          </button>`).join("")}
      </div>
      ${dictation ? `<div class="x3-plus-lang">
          <span>Voice typing language</span>
          <div class="x3-seg" role="radiogroup">
            <button type="button" data-lang="en-IN">English</button>
            <button type="button" data-lang="hi-IN">हिंदी</button>
          </div>
        </div>` : ""}`;
    composer.appendChild(menu);

    const syncLang = () => menu.querySelectorAll("[data-lang]").forEach((b) =>
      b.classList.toggle("on", b.dataset.lang === dictation.getLang()));
    if (dictation) syncLang();

    const open = () => { menu.classList.add("show"); btn.classList.add("open"); btn.setAttribute("aria-expanded", "true"); };
    const close = () => { menu.classList.remove("show"); btn.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); };

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.contains("show") ? close() : open();
    });
    document.addEventListener("click", (e) => {
      if (menu.classList.contains("show") && !menu.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    menu.addEventListener("click", (e) => {
      e.stopPropagation();
      const em = e.target.closest("[data-emoji]");
      if (em && input) {
        // several emoji in a row is normal, so the menu stays open for these
        const pos = input.selectionStart ?? input.value.length;
        input.value = input.value.slice(0, pos) + em.dataset.emoji + input.value.slice(pos);
        input.setSelectionRange(pos + em.dataset.emoji.length, pos + em.dataset.emoji.length);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      const lang = e.target.closest("[data-lang]");
      if (lang && dictation) { dictation.setLang(lang.dataset.lang); syncLang(); return; }
      const tile = e.target.closest("[data-tile]");
      if (tile) { close(); tiles[Number(tile.dataset.tile)][3](); }
    });

    buildPollSheet();
    buildCountdownSheet();
    buildScheduleSheet();
  }

  /* ---------- poll composer ---------- */

  function buildPollSheet() {
    pollSheet = makeSheet("New poll", `
      <input class="x3-input" id="x3PollQ" maxlength="200" placeholder="Ask a question…" autocomplete="off" />
      <div id="x3PollOpts"></div>
      <button type="button" class="x3-link" id="x3PollAdd">+ Add option</button>
      <button type="button" class="btn x3-full" id="x3PollGo">Create poll</button>
      <p class="x3-hint">Votes are anonymous — people see totals, never who picked what.</p>`);

    const opts = pollSheet.body.querySelector("#x3PollOpts");
    const addOpt = (val = "") => {
      if (opts.children.length >= 10) { say("A poll can have at most 10 options."); return; }
      const i = document.createElement("input");
      i.className = "x3-input x3-opt";
      i.maxLength = 80;
      i.placeholder = `Option ${opts.children.length + 1}`;
      i.value = val;
      opts.appendChild(i);
    };
    pollSheet.body.querySelector("#x3PollAdd").addEventListener("click", () => addOpt());
    pollSheet.reset = () => {
      pollSheet.body.querySelector("#x3PollQ").value = "";
      opts.innerHTML = "";
      addOpt(); addOpt();
    };

    pollSheet.body.querySelector("#x3PollGo").addEventListener("click", async (e) => {
      // "|" is the separator in the /poll command, so it can't live inside text
      const clean = (s) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
      const q = clean(pollSheet.body.querySelector("#x3PollQ").value);
      const options = [...opts.querySelectorAll("input")].map((i) => clean(i.value)).filter(Boolean);
      if (!q) { say("Write a question first."); return; }
      if (options.length < 2) { say("Add at least two options."); return; }

      e.target.disabled = true;
      const ok = await sendRaw(`/poll ${q} | ${options.join(" | ")}`);
      e.target.disabled = false;
      if (ok) pollSheet.close();
    });
  }

  function openPollSheet() {
    pollSheet.reset();
    pollSheet.open();
    setTimeout(() => pollSheet.body.querySelector("#x3PollQ").focus(), 150);
  }

  /* ---------- countdown composer ---------- */

  function buildCountdownSheet() {
    countdownSheet = makeSheet("New countdown", `
      <input class="x3-input" id="x3CdTitle" maxlength="60" placeholder="What's coming? e.g. Board exams" autocomplete="off" />
      <div class="x3-row">
        <input class="x3-input" id="x3CdDate" type="date" />
        <input class="x3-input" id="x3CdTime" type="time" />
      </div>
      <button type="button" class="btn x3-full" id="x3CdGo">Post countdown</button>
      <p class="x3-hint">Time is optional. Everyone sees it tick live.</p>`);

    countdownSheet.body.querySelector("#x3CdGo").addEventListener("click", async (e) => {
      const title = countdownSheet.body.querySelector("#x3CdTitle").value.replace(/\s+/g, " ").trim();
      const date = countdownSheet.body.querySelector("#x3CdDate").value;
      const time = countdownSheet.body.querySelector("#x3CdTime").value;
      if (!title) { say("Give it a name."); return; }
      if (!date) { say("Pick a date."); return; }
      if (new Date(`${date}T${time || "23:59"}:00`) < new Date()) { say("That date has already passed."); return; }

      e.target.disabled = true;
      const ok = await sendRaw(`/countdown ${title} ${date}${time ? " " + time : ""}`);
      e.target.disabled = false;
      if (ok) countdownSheet.close();
    });
  }

  function openCountdownSheet() {
    countdownSheet.body.querySelector("#x3CdTitle").value = "";
    countdownSheet.body.querySelector("#x3CdDate").min = new Date().toISOString().slice(0, 10);
    countdownSheet.body.querySelector("#x3CdDate").value = "";
    countdownSheet.body.querySelector("#x3CdTime").value = "";
    countdownSheet.open();
  }

  /* ---------- scheduled messages ---------- */

  function buildScheduleSheet() {
    scheduleSheet = makeSheet("Schedule a message", `
      <textarea class="x3-input" id="x3SchText" rows="3" maxlength="2000" placeholder="What should be sent later?"></textarea>
      <div class="x3-chips">
        <button type="button" data-q="1h">In 1 hour</button>
        <button type="button" data-q="midnight">12:00 AM tonight</button>
        <button type="button" data-q="7am">Next 7:00 AM</button>
      </div>
      <input class="x3-input" id="x3SchAt" type="datetime-local" />
      <button type="button" class="btn x3-full" id="x3SchGo">Schedule</button>
      <div class="x3-subhead">Scheduled in this chat</div>
      <div id="x3SchList" class="x3-schlist"></div>`);

    const at = scheduleSheet.body.querySelector("#x3SchAt");

    scheduleSheet.body.querySelector(".x3-chips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-q]");
      if (!b) return;
      const d = new Date();
      if (b.dataset.q === "1h") d.setHours(d.getHours() + 1);
      if (b.dataset.q === "midnight") { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); }
      if (b.dataset.q === "7am") {
        if (d.getHours() >= 7) d.setDate(d.getDate() + 1);
        d.setHours(7, 0, 0, 0);
      }
      at.value = toLocalInput(d);
    });

    scheduleSheet.body.querySelector("#x3SchGo").addEventListener("click", async (e) => {
      const text = scheduleSheet.body.querySelector("#x3SchText").value.trim();
      if (!text) { say("Write the message first."); return; }
      if (!at.value) { say("Pick when to send it."); return; }
      const when = new Date(at.value);            // datetime-local is read as local time
      if (when.getTime() < Date.now() + 30000) { say("Pick a time at least a minute from now."); return; }

      e.target.disabled = true;
      const { error } = await sb.from("scheduled_messages").insert({
        user_id: ME.id,
        conversation_id: convoId() || null,
        content: text,
        send_at: when.toISOString(),
      });
      e.target.disabled = false;

      if (error) { say(friendly(error)); return; }
      scheduleSheet.body.querySelector("#x3SchText").value = "";
      say(`Will send ${when.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`);
      loadScheduled();
    });

    scheduleSheet.body.querySelector("#x3SchList").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-cancel]");
      if (!b) return;
      const { error } = await sb.from("scheduled_messages")
        .update({ status: "cancelled" }).eq("id", b.dataset.cancel);
      if (error) { say("Could not cancel."); return; }
      say("Cancelled");
      loadScheduled();
    });
  }

  function openScheduleSheet() {
    const at = scheduleSheet.body.querySelector("#x3SchAt");
    at.min = toLocalInput(new Date(Date.now() + 60000));
    if (!at.value) at.value = toLocalInput(new Date(Date.now() + 3600000));
    scheduleSheet.open();
    loadScheduled();
  }

  async function loadScheduled() {
    const list = scheduleSheet.body.querySelector("#x3SchList");
    let q = sb.from("scheduled_messages")
      .select("id,content,send_at,status,error")
      .in("status", ["pending", "failed"])
      .order("send_at", { ascending: true })
      .limit(30);
    q = convoId() ? q.eq("conversation_id", convoId()) : q.is("conversation_id", null);
    const { data } = await q;

    if (!data?.length) { list.innerHTML = `<div class="x3-empty">Nothing scheduled here.</div>`; return; }
    list.innerHTML = data.map((s) => `
      <div class="x3-sch ${s.status}">
        <div class="x3-sch-main">
          <b>${esc(new Date(s.send_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}</b>
          <span>${esc(s.content.slice(0, 90))}</span>
          ${s.status === "failed" ? `<small>Didn't send: ${esc(s.error || "unknown reason")}</small>` : ""}
        </div>
        ${s.status === "pending" ? `<button type="button" data-cancel="${s.id}">Cancel</button>` : ""}
      </div>`).join("");
  }

  /* ============================================================
     2. Polls — a "/poll Q | A | B" message becomes a live, votable card.
        The poll row itself is created by a database trigger, so a poll
        exists the moment its message does, for everyone at once.
     ============================================================ */

  const pollsById = new Map();

  async function polls() {
    await waitFor(hasMe);
    onMessagesChange(scanPolls);

    // total_votes is bumped on every vote, which is what makes this fire
    sb.channel(`x3-polls:${chatKey()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "polls" }, ({ new: p }) => {
        if (!p || !pollsById.has(p.id)) return;
        pollsById.set(p.id, { ...pollsById.get(p.id), ...p });
        refreshResults([p.id]);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "polls" }, () => scanPolls())
      .subscribe();

    on("click", ".x3-poll-opt", async (e, b) => {
      const card = b.closest(".x3-poll");
      const id = card?.dataset.poll;
      if (!id || card.classList.contains("closed")) return;
      card.classList.add("busy");
      const { error } = await sb.rpc("vote_poll", { p_poll: id, p_option: Number(b.dataset.i) });
      card.classList.remove("busy");
      if (error) { say(friendly(error)); return; }
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch {} }
      refreshResults([id]);
    });

    on("click", ".x3-poll-close", async (e, b) => {
      const id = b.closest(".x3-poll")?.dataset.poll;
      if (!id || !confirm("Close this poll? No one will be able to vote after this.")) return;
      const { error } = await sb.rpc("close_poll", { p_poll: id });
      if (error) { say(friendly(error)); return; }
      pollsById.set(id, { ...pollsById.get(id), closed: true });
      refreshResults([id]);
    });
  }

  function pendingPollRows() {
    return [...document.querySelectorAll("[data-msg-id]")].filter((r) => {
      if (r.dataset.x3poll) return false;
      const t = r.querySelector(".msg-text")?.textContent.trim() || "";
      return /^\/poll\s/i.test(t);
    });
  }

  async function scanPolls() {
    const rows = pendingPollRows();
    if (!rows.length) return;
    rows.forEach((r) => { r.dataset.x3poll = "loading"; });

    const { data } = await sb.from("polls").select("*").in("message_id", rows.map((r) => r.dataset.msgId));
    const byMessage = new Map((data || []).map((p) => [p.message_id, p]));
    const found = [];

    for (const row of rows) {
      const p = byMessage.get(row.dataset.msgId);
      if (!p) {
        // an invalid "/poll" (the bot already replied with help) — or, rarely,
        // a render that beat the realtime event. Try once more, then leave it.
        if (!row.dataset.x3retry) {
          row.dataset.x3retry = "1";
          delete row.dataset.x3poll;
          setTimeout(scanPolls, 1500);
        } else {
          row.dataset.x3poll = "none";
        }
        continue;
      }
      row.dataset.x3poll = p.id;
      pollsById.set(p.id, p);
      mountPoll(row, p);
      found.push(p.id);
    }
    if (found.length) refreshResults(found);
  }

  function mountPoll(row, p) {
    const textEl = row.querySelector(".msg-text");
    if (!textEl) return;
    const mine = p.created_by === ME.id;
    textEl.classList.add("x3-has-card");
    textEl.innerHTML = `
      <div class="x3-poll" data-poll="${p.id}">
        <div class="x3-poll-q"><span class="x3-inline-ic">${svgIcon("poll", 15)}</span>${esc(p.question)}</div>
        <div class="x3-poll-opts">
          ${p.options.map((o, i) => `
            <button type="button" class="x3-poll-opt" data-i="${i}">
              <span class="x3-poll-bar"></span>
              <span class="x3-poll-label">${esc(o)}</span>
              <span class="x3-poll-count"></span>
            </button>`).join("")}
        </div>
        <div class="x3-poll-foot">
          <span class="x3-poll-total">No votes yet</span>
          ${mine ? `<button type="button" class="x3-poll-close">Close poll</button>` : ""}
        </div>
      </div>`;
  }

  async function refreshResults(ids) {
    const { data, error } = await sb.rpc("poll_results", { p_polls: ids });
    if (error) return;

    for (const id of ids) {
      const card = document.querySelector(`.x3-poll[data-poll="${id}"]`);
      const p = pollsById.get(id);
      if (!card || !p) continue;

      const rows = (data || []).filter((r) => r.poll_id === id);
      const total = rows.reduce((s, r) => s + r.votes, 0);
      const myChoice = rows.find((r) => r.mine)?.option_idx;

      card.querySelectorAll(".x3-poll-opt").forEach((b) => {
        const i = Number(b.dataset.i);
        const votes = rows.find((r) => r.option_idx === i)?.votes || 0;
        const pct = total ? Math.round((votes / total) * 100) : 0;
        b.querySelector(".x3-poll-bar").style.width = `${pct}%`;
        b.querySelector(".x3-poll-count").textContent = total ? `${pct}%` : "";
        b.classList.toggle("mine", myChoice === i);
        b.disabled = !!p.closed;
      });

      card.classList.toggle("closed", !!p.closed);
      card.classList.toggle("voted", myChoice !== undefined);
      card.querySelector(".x3-poll-total").textContent =
        (total ? `${total} vote${total === 1 ? "" : "s"}` : "No votes yet") +
        (p.closed ? " · Poll closed" : myChoice !== undefined ? " · tap your choice to undo" : "");
      if (p.closed) card.querySelector(".x3-poll-close")?.remove();
    }
  }

  /* ============================================================
     3. Countdowns — "/countdown Board exams 2026-03-01 09:30" becomes
        a card that ticks live for everyone who has the chat open.
     ============================================================ */

  const CD_RE = /^\/countdown\s+(.+?)\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?\s*$/i;

  function countdowns() {
    onMessagesChange(() => {
      document.querySelectorAll("[data-msg-id]").forEach((row) => {
        if (row.dataset.x3cd) return;
        const textEl = row.querySelector(".msg-text");
        const m = (textEl?.textContent.trim() || "").match(CD_RE);
        if (!m) return;
        row.dataset.x3cd = "1";

        const [, title, date, hh, mm] = m;
        const target = new Date(`${date}T${pad(hh || 0)}:${mm || "00"}:00`);
        if (isNaN(target)) return;

        textEl.classList.add("x3-has-card");
        textEl.innerHTML = `
          <div class="x3-cd" data-target="${target.getTime()}">
            <div class="x3-cd-title"><span class="x3-inline-ic">${svgIcon("hourglass", 15)}</span>${esc(title)}</div>
            <div class="x3-cd-time"></div>
            <div class="x3-cd-date">${esc(target.toLocaleString([], {
              weekday: "short", day: "numeric", month: "short", year: "numeric",
              ...(hh ? { hour: "numeric", minute: "2-digit" } : {}),
            }))}</div>
          </div>`;
        tick();
      });
    });

    setInterval(tick, 1000);
  }

  function tick() {
    const now = Date.now();
    document.querySelectorAll(".x3-cd").forEach((card) => {
      const diff = Number(card.dataset.target) - now;
      const out = card.querySelector(".x3-cd-time");
      if (diff <= 0) {
        if (!card.classList.contains("done")) {
          card.classList.add("done");
          out.textContent = "It's here! 🎉";
        }
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      out.innerHTML = [
        d ? `<b>${d}</b><small>days</small>` : "",
        `<b>${pad(h)}</b><small>hrs</small>`,
        `<b>${pad(m)}</b><small>min</small>`,
        `<b>${pad(s)}</b><small>sec</small>`,
      ].join("");
    });
  }

  /* ============================================================
     4. Message effects — a live "happy birthday" rains confetti,
        "love you" floats hearts. Only for messages that arrive while
        you're watching, never for old history as it loads.
     ============================================================ */

  const CONFETTI_RE = /(happy\s*birthday|\bhbd\b|congrat|badhai|mubarak|🎉|🥳|happy\s*new\s*year|happy\s*diwali)/i;
  const HEARTS_RE = /(love\s*(you|u)\b|\bluv\s*u\b|❤️|💖|😍|🥰)/i;

  function messageEffects() {
    if (reduceMotion) return;
    const seen = new Set();
    let settled = false;

    setTimeout(() => {
      document.querySelectorAll("[data-msg-id]").forEach((r) => seen.add(r.dataset.msgId));
      settled = true;
    }, 2500);

    onMessagesChange(() => {
      if (!settled) return;
      const rows = [...document.querySelectorAll("[data-msg-id]")];
      // new messages land at the bottom; "load older" adds to the top and
      // must not set off fireworks for a week-old birthday wish
      rows.slice(-3).forEach((r) => {
        if (seen.has(r.dataset.msgId)) return;
        seen.add(r.dataset.msgId);
        const t = r.querySelector(".msg-text, .bot-msg-text")?.textContent || "";
        if (CONFETTI_RE.test(t)) confetti();
        else if (HEARTS_RE.test(t)) hearts();
      });
      rows.forEach((r) => seen.add(r.dataset.msgId));
    });
  }

  function confetti() {
    const c = document.createElement("canvas");
    c.className = "x3-fx";
    document.body.appendChild(c);
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);

    const colors = ["#f5b700", "#ff4d6d", "#4cc9f0", "#80ed99", "#c77dff", "#ff9f1c"];
    const bits = Array.from({ length: 150 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 80,
      y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 13 - 4,
      r: Math.random() * 6 + 3,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[(Math.random() * colors.length) | 0],
    }));

    const t0 = performance.now();
    (function frame(t) {
      const age = t - t0;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.globalAlpha = Math.max(0, 1 - age / 2800);
      for (const b of bits) {
        b.vy += 0.32; b.vx *= 0.99;
        b.x += b.vx; b.y += b.vy; b.rot += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y); ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2);
        ctx.restore();
      }
      if (age < 2800) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  function hearts() {
    for (let i = 0; i < 16; i++) {
      const h = document.createElement("span");
      h.className = "x3-heart";
      h.textContent = ["❤️", "💖", "💕"][i % 3];
      h.style.left = `${10 + Math.random() * 80}%`;
      h.style.animationDelay = `${Math.random() * 0.6}s`;
      h.style.fontSize = `${18 + Math.random() * 16}px`;
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 2600);
    }
  }

  /* ============================================================
     5. Voice typing — speak and it types, in English or Hindi.
        Started from the + menu. While it listens, a small pill above the
        composer shows it and stops it. Returns null where the browser
        has no speech recognition, and the menu then hides the option.
     ============================================================ */

  function setupDictation(composer, input) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !input) return null;

    let lang = localStorage.getItem("teaofrpm_dictlang") || "en-IN";
    let rec = null;

    const pill = document.createElement("div");
    pill.className = "x3-listening";
    pill.innerHTML = `<span class="x3-listening-ic">${svgIcon("mic", 15)}</span>
      <span class="x3-listening-text"></span>
      <button type="button" class="x3-listening-stop">Stop</button>`;
    composer.appendChild(pill);
    pill.querySelector(".x3-listening-stop").addEventListener("click", () => rec && rec.stop());

    const label = () => (lang === "hi-IN" ? "हिंदी" : "English");

    function start() {
      rec = new SR();
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false;
      const base = input.value;
      const glue = base && !/\s$/.test(base) ? " " : "";

      rec.onresult = (e) => {
        const heard = [...e.results].map((r) => r[0].transcript).join("");
        input.value = base + glue + heard;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") say("Allow microphone access to use voice typing.");
        else if (e.error !== "no-speech" && e.error !== "aborted") say("Voice typing stopped.");
      };
      rec.onend = () => { rec = null; pill.classList.remove("show"); input.focus(); };

      try {
        rec.start();
        pill.querySelector(".x3-listening-text").textContent = `Listening… ${label()}`;
        pill.classList.add("show");
      } catch {
        rec = null;
        say("Voice typing isn't available right now.");
      }
    }

    return {
      toggle: () => (rec ? rec.stop() : start()),
      getLang: () => lang,
      setLang: (l) => {
        lang = l;
        localStorage.setItem("teaofrpm_dictlang", l);
        say(`Voice typing: ${label()}`);
      },
    };
  }

  /* ============================================================
     6. Catch-up — away for a while? A card shows how much you missed
        and the messages people reacted to most, so you can skip
        scrolling through hundreds of messages.
     ============================================================ */

  async function catchUp() {
    const key = `teaofrpm_seen_at_${chatKey()}`;
    const prev = localStorage.getItem(key);
    const markSeen = () => { try { localStorage.setItem(key, new Date().toISOString()); } catch {} };

    window.addEventListener("pagehide", markSeen);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") markSeen(); });

    if (!prev || Date.now() - Date.parse(prev) < 2 * 3600000) { markSeen(); return; }
    await waitFor(hasMe);

    let q = sb.from("messages")
      .select("id,content,user_id,created_at,image_url,sticker_url")
      .eq("deleted", false).eq("is_bot", false).eq("is_system", false)
      .neq("user_id", ME.id)
      .gt("created_at", prev)
      .order("created_at", { ascending: false })
      .limit(150);
    q = convoId() ? q.eq("conversation_id", convoId()) : q.is("conversation_id", null);
    const { data: missed } = await q;

    markSeen();
    if (!missed || missed.length < 5) return;

    const { data: reacts } = await sb.from("message_reactions")
      .select("message_id").in("message_id", missed.map((m) => m.id));
    const counts = new Map();
    (reacts || []).forEach((r) => counts.set(r.message_id, (counts.get(r.message_id) || 0) + 1));

    const top = missed
      .filter((m) => counts.get(m.id))
      .sort((a, b) => counts.get(b.id) - counts.get(a.id))
      .slice(0, 3);
    await getProfiles(top.map((m) => m.user_id));

    const card = document.createElement("div");
    card.className = "x3-catchup";
    card.innerHTML = `
      <div class="x3-catchup-head">
        <b><span class="x3-inline-ic">${svgIcon("clock", 14)}</span>While you were away</b>
        <span>${missed.length >= 150 ? "150+" : missed.length} new messages</span>
        <button type="button" class="x3-catchup-x" aria-label="Dismiss">${svgIcon("close", 14)}</button>
      </div>
      ${top.length ? `<div class="x3-catchup-list">${top.map((m) => {
        const who = profileCache.get(m.user_id)?.display_name || "Someone";
        const what = m.content || (m.image_url ? "📷 Photo" : m.sticker_url ? "Sticker" : "Message");
        return `<button type="button" data-jump="${m.id}">
          <small>${svgIcon("flame", 12)}${counts.get(m.id)}</small><span><b>${esc(who)}</b>: ${esc(what.slice(0, 90))}</span>
        </button>`;
      }).join("")}</div>` : ""}`;

    card.querySelector(".x3-catchup-x").addEventListener("click", () => card.remove());
    card.addEventListener("click", (e) => {
      const b = e.target.closest("[data-jump]");
      if (!b) return;
      const row = document.querySelector(`[data-msg-id="${b.dataset.jump}"]`);
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        row.querySelector(".bubble")?.classList.add("highlight-flash");
        setTimeout(() => row.querySelector(".bubble")?.classList.remove("highlight-flash"), 1500);
      } else {
        say("That one is further up — scroll back to find it.");
      }
    });

    document.querySelector(".chat-header")?.insertAdjacentElement("afterend", card);
  }

  /* ============================================================
     7. Streaks 🔥 — how many days in a row you and a friend have
        both messaged each other. ⏳ means it ends today unless you talk.
     ============================================================ */

  async function streaks() {
    await waitFor(hasMe);
    let map = new Map();

    async function load() {
      const { data, error } = await sb.rpc("my_streaks");
      if (error) return;
      map = new Map((data || []).map((s) => [s.conversation_id, s]));
      paint();
    }

    function badgeFor(s) {
      const b = document.createElement("span");
      b.className = `x3-streak${s.alive_today ? "" : " at-risk"}`;
      b.dataset.key = `${s.streak}:${s.alive_today ? 1 : 0}`;
      b.innerHTML = `${svgIcon("flame", 12)}${s.streak}${s.alive_today ? "" : svgIcon("hourglass", 11)}`;
      b.title = s.alive_today
        ? `${s.streak}-day streak`
        : `${s.streak}-day streak — message today or it resets`;
      return b;
    }

    // Idempotent on purpose: it only touches the DOM when a badge is missing
    // or wrong, so the observer below can't trigger itself in a loop.
    function paint() {
      if (isInbox) {
        document.querySelectorAll('a.thread-row[href*="room.html?c="]').forEach((a) => {
          const id = new URL(a.href, location.href).searchParams.get("c");
          const s = map.get(id);
          const host = a.querySelector(".thread-text b") || a;
          const existing = host.querySelector(".x3-streak");
          if (!s || s.streak < 2) { existing?.remove(); return; }
          const fresh = badgeFor(s);
          if (existing?.dataset.key === fresh.dataset.key) return;
          existing?.remove();
          host.appendChild(fresh);
        });
      } else {
        const s = map.get(convoId());
        const title = document.getElementById("roomTitle");
        const existing = document.querySelector(".chat-header .x3-streak");
        if (!title || !s || s.streak < 2) { existing?.remove(); return; }
        const fresh = badgeFor(s);
        if (existing?.dataset.key === fresh.dataset.key) return;
        existing?.remove();
        title.insertAdjacentElement("afterend", fresh);
      }
    }

    await load();

    // the inbox list is re-rendered by messages.js as chats update
    let t;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(paint, 150); })
      .observe(document.body, { childList: true, subtree: true });

    setInterval(load, 120000);
  }
})();
