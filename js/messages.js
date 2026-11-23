let ME = null;
let inboxRows = [];
let streaks = new Map();
let chatFilter = "";
let myNote = null;

async function init() {
  // Paint the last known inbox instantly, then refresh it.
  const cached = store.get("teaofrpm_inbox");
  if (cached?.rows?.length) { inboxRows = cached.rows; } else Skeleton.show("rows", "threadList", 6);

  ME = await App.boot();
  if (inboxRows.length) renderInbox();

  wireNewChat();
  wireNotes();
  wireChatSearch();
  addHeaderTools();
  loadNotes();
  loadPublicRoomRow();
  installBar();
  Presence.onChange(renderActive);

  await Promise.all([loadInbox(), loadStreaks()]);
  subscribeInbox();
}

/* ---------- inbox list ---------- */

async function loadInbox() {
  const { data, error } = await sb.rpc("my_conversations");
  if (error || !data) {
    if (!inboxRows.length) document.getElementById("threadList").innerHTML = `<div class="inbox-empty">Could not load your chats.</div>`;
    return;
  }
  inboxRows = data;
  store.set("teaofrpm_inbox", { at: Date.now(), rows: data });
  AppNav.setBadge("messages", data.reduce((n, c) => n + (c.unread > 0 && !c.muted && !c.is_request ? 1 : 0), 0));
  if (showRequests && !data.some((c) => c.is_request)) showRequests = false;
  // the inbox RPC already carries each DM partner's profile — no extra request
  data.forEach((c) => c.other_profile && rememberProfile(c.other_profile));
  await getProfiles(data.filter((c) => c.other_user_id && !c.other_profile).map((c) => c.other_user_id));
  renderInbox();
}

function titleFor(c) {
  const other = c.other_user_id ? profileCache.get(c.other_user_id) : null;
  return c.kind === "dm" ? (other?.display_name || "Unknown") : c.kind === "bot" ? "Tea" : (c.name || "Group");
}

let showRequests = false;

// Tea, the AI bot, always has a chat at the top of the inbox
async function openTeaChat(e) {
  e?.preventDefault();
  const existing = inboxRows.find((c) => c.kind === "bot");
  if (existing) { location.href = `room.html?c=${existing.id}`; return; }
  const { data, error } = await sb.rpc("get_or_create_bot_chat");
  if (error) { toast(friendlyError(error, "Could not open Tea.")); return; }
  location.href = `room.html?c=${data}`;
}

function renderInbox() {
  const list = document.getElementById("threadList");
  const requests = inboxRows.filter((c) => c.is_request);
  const mine = inboxRows.filter((c) => !c.is_request);
  const q = chatFilter.toLowerCase();
  const base = showRequests ? requests : mine;
  const rows = q ? base.filter((c) => {
    const other = c.other_user_id ? profileCache.get(c.other_user_id) : null;
    return titleFor(c).toLowerCase().includes(q) || (other?.username || "").includes(q);
  }) : base;

  const frag = document.createDocumentFragment();
  if (showRequests) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "inbox-req-row";
    back.innerHTML = `${svgIcon("back", 16)} Message requests <small style="margin-left:auto;font-weight:500;color:var(--text-muted)">They won't know you've seen it until you reply or accept</small>`;
    back.addEventListener("click", () => { showRequests = false; renderInbox(); });
    frag.appendChild(back);
  } else if (!q) {
    if (requests.length) {
      const r = document.createElement("button");
      r.type = "button";
      r.className = "inbox-req-row";
      r.innerHTML = `${svgIcon("inbox", 18)} Message requests <span class="count">${requests.length}</span>`;
      r.addEventListener("click", () => { showRequests = true; renderInbox(); });
      frag.appendChild(r);
    }
    if (!mine.some((c) => c.kind === "bot")) {
      const tea = document.createElement("a");
      tea.className = "thread-row bot-thread";
      tea.href = "#";
      tea.innerHTML = `<span class="avatar thread-avatar"><img src="images/bot.png" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover"></span>
        <div class="thread-text"><b>Tea <span class="tea-ai-chip">AI</span></b><span>Ask anything — reminders, notes, jokes…</span></div>`;
      tea.addEventListener("click", openTeaChat);
      frag.appendChild(tea);
    }
  }
  if (!rows.length && !frag.childNodes.length) {
    list.innerHTML = q ? `<div class="inbox-empty">No chats match "${escapeHTML(chatFilter)}".</div>` : `<div class="inbox-empty">No chats yet.<br>Tap + to message someone or create a group.</div>`;
    return;
  }

  // keep rows that didn't change (no re-created avatars, no replayed animation = no flicker)
  const old = new Map([...list.querySelectorAll(".thread-row[data-convo]")].map((r) => [r.dataset.convo, r]));
  for (const c of rows) {
    const other = c.other_user_id ? profileCache.get(c.other_user_id) : null;
    const title = titleFor(c);
    const s0 = streaks.get(c.id);
    const sig = [title, other?.pfp_url, c.pfp_url, c.last_message, c.last_user_id, c.last_at, c.unread, c.muted, c.is_request, s0?.streak, s0?.alive_today].join("|");
    const prev = old.get(c.id);
    if (prev && prev.dataset.sig === sig) { prev.querySelector(".thread-avatar")?.classList.toggle("x4-online", !!(other && Presence.online.has(other.id))); frag.appendChild(prev); continue; }
    const row = document.createElement("a");
    row.dataset.sig = sig;
    row.className = `thread-row ${c.unread > 0 && !c.is_request ? "has-unread" : ""}${c.kind === "bot" ? " bot-thread" : ""}`;
    row.href = `room.html?c=${c.id}`;
    row.dataset.convo = c.id;
    if (other) row.dataset.other = other.id;

    const av = document.createElement("span");
    av.className = "avatar thread-avatar";
    if (c.kind === "bot") av.innerHTML = `<img src="images/bot.png" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    else if (c.kind === "group") setGroupAvatar(av, c); else setAvatarContent(av, other);
    if (other && Presence.online.has(other.id)) av.classList.add("x4-online");
    row.appendChild(av);

    const s = streaks.get(c.id);
    const text = document.createElement("div");
    text.className = "thread-text";
    const preview = c.last_message ? (c.last_user_id === ME.id ? `You: ${c.last_message}` : c.last_message) : "No messages yet";
    text.innerHTML = `<b>${escapeHTML(title)}${c.kind === "bot" ? ' <span class="tea-ai-chip">AI</span>' : ""}${s && s.streak >= 2 ? streakBadge(s) : ""}${c.muted ? ` <span class="thread-muted" title="Muted">${svgIcon("bellOff", 11)}</span>` : ""}</b><span>${escapeHTML(preview)}</span>`;
    row.appendChild(text);

    const meta = document.createElement("div");
    meta.className = "thread-meta";
    meta.innerHTML = `${c.last_at ? `<span class="thread-time" data-ts="${c.last_at}">${timeAgo(c.last_at)}</span>` : ""}
      ${c.unread > 0 ? `<span class="thread-unread">${c.unread > 9 ? "9+" : c.unread}</span>` : ""}`;
    row.appendChild(meta);
    if (list.classList.contains("settled")) row.classList.add("tr-new");
    frag.appendChild(row);
  }
  // timestamps tick on reused rows too
  frag.querySelectorAll?.(".thread-time[data-ts]").forEach((t) => { t.textContent = timeAgo(t.dataset.ts); });
  list.replaceChildren(frag);
  requestAnimationFrame(() => list.classList.add("settled"));
}

function streakBadge(s) {
  return `<span class="x3-streak${s.alive_today ? "" : " at-risk"}" title="${s.alive_today ? `${s.streak}-day streak` : `${s.streak}-day streak — message today or it resets`}">${svgIcon("flame", 12)}${s.streak}${s.alive_today ? "" : svgIcon("hourglass", 11)}</span>`;
}

async function loadStreaks() {
  const { data, error } = await sb.rpc("my_streaks");
  if (error) return;
  streaks = new Map((data || []).map((s) => [s.conversation_id, s]));
  renderInbox();
}

// A single realtime event no longer reloads everything: changes are
// batched, so a burst of 30 public-room messages costs one refresh.
const refreshSoon = debounce(loadInbox, 900);

function subscribeInbox() {
  sb.channel("inbox:messages")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, ({ new: m }) => {
      if (!m.conversation_id) return;
      if (m.conversation_id === PUBLIC_ROOM_ID) { paintPublicLast(m); return; }
      refreshSoon();
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations" }, refreshSoon)
    // someone added me to a group → it shows up straight away
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_members", filter: `user_id=eq.${ME.id}` }, refreshSoon)
    .subscribe((status) => { if (status === "SUBSCRIBED") refreshSoon(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshSoon(); });
}

function wireChatSearch() {
  const scroll = document.getElementById("inboxScroll");
  const box = document.createElement("div");
  box.className = "inbox-search";
  box.innerHTML = `${svgIcon("search", 15)}<input type="search" placeholder="Search chats" autocomplete="off" aria-label="Search chats" />`;
  scroll.insertBefore(box, document.getElementById("notesRail").nextSibling);
  box.querySelector("input").addEventListener("input", debounce((e) => { chatFilter = e.target.value.trim(); renderInbox(); }, 100));
}

/* ---------- the public room row (pinned on top) ---------- */

async function loadPublicRoomRow() {
  const row = document.querySelector("a.thread-row.pinned");
  if (!row) return;
  const [{ data: room }, { data: last }] = await Promise.all([
    sb.from("conversations").select("id,name,pfp_url").eq("id", PUBLIC_ROOM_ID).maybeSingle(),
    sb.from("messages").select("content,image_url,sticker_url,audio_url,user_id,created_at,is_bot")
      .eq("conversation_id", PUBLIC_ROOM_ID).eq("deleted", false).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (room) {
    if (room.name) row.querySelector(".thread-text b").textContent = room.name;
    setGroupAvatar(row.querySelector(".thread-avatar"), room);
    store.set("teaofrpm_pubrow", { ...(store.get("teaofrpm_pubrow") || {}), name: room.name || "", pfp_url: room.pfp_url || "" });
  }
  if (last) paintPublicLast(last);
}

async function paintPublicLast(m) {
  const row = document.querySelector("a.thread-row.pinned");
  if (!row) return;
  const who = m.is_bot ? "teaBot" : (await getProfile(m.user_id))?.display_name?.split(" ")[0] || "Someone";
  const what = m.content || (m.image_url ? "📷 Photo" : m.sticker_url ? "Sticker" : m.audio_url ? "🎤 Voice note" : "Message");
  row.querySelector(".thread-text span").textContent = `${who}: ${what}`;
  store.set("teaofrpm_pubrow", { ...(store.get("teaofrpm_pubrow") || {}), last: `${who}: ${what}` });
  let meta = row.querySelector(".thread-meta");
  if (!meta) { meta = document.createElement("div"); meta.className = "thread-meta"; row.appendChild(meta); }
  meta.innerHTML = `<span class="thread-time" data-ts="${m.created_at}">${timeAgo(m.created_at)}</span>`;
}

/* ---------- active now ---------- */

async function renderActive(online) {
  let strip = document.getElementById("x4Active");
  if (!strip) {
    const scroll = document.getElementById("inboxScroll");
    strip = document.createElement("div");
    strip.id = "x4Active";
    strip.className = "x4-active";
    scroll.insertBefore(strip, scroll.firstChild);
    strip.addEventListener("click", (e) => {
      const b = e.target.closest("[data-uid]");
      if (b) startDmWithPerson({ id: b.dataset.uid });
    });
  }
  const ids = [...online].slice(0, 20);
  if (!ids.length) { strip.innerHTML = ""; strip.classList.remove("show"); }
  else {
    const people = await getProfiles(ids);
    strip.innerHTML = `<div class="x4-active-label">Active now · ${people.length}</div>
      <div class="x4-active-row">${people.map((p) => `
        <button type="button" class="x4-active-person" data-uid="${p.id}">
          <span class="avatar x4-active-av" data-av="${p.id}"></span>
          <span class="x4-active-name">${escapeHTML((p.display_name || "").split(" ")[0])}</span>
        </button>`).join("")}</div>`;
    people.forEach((p) => setAvatarContent(strip.querySelector(`[data-av="${p.id}"]`), p));
    strip.classList.add("show");
  }
  document.querySelectorAll("a.thread-row[data-other]").forEach((a) => {
    a.querySelector(".thread-avatar")?.classList.toggle("x4-online", online.has(a.dataset.other));
  });
}

/* ---------- notes (24h, one line) ---------- */

async function loadNotes() {
  const rail = document.getElementById("notesRail");
  if (!rail) return;
  rail.replaceChildren(buildNote(ME, myNote, true));

  const { data, error } = await sb.from("notes").select("user_id,content,created_at").order("created_at", { ascending: false });
  if (error) { console.error("notes load failed:", error); return; }
  const notes = data || [];
  myNote = notes.find((n) => n.user_id === ME.id) || null;
  const others = notes.filter((n) => n.user_id !== ME.id);
  await getProfiles(others.map((n) => n.user_id));

  const frag = document.createDocumentFragment();
  frag.appendChild(buildNote(ME, myNote, true));
  for (const n of others) {
    const p = profileCache.get(n.user_id);
    if (p) frag.appendChild(buildNote(p, n, false));
  }
  rail.replaceChildren(frag);
}

function buildNote(person, note, isMine) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = `note-item ${isMine ? "mine" : ""}`;
  item.innerHTML = `<span class="note-bubble ${note ? "" : "empty"}"></span><span class="avatar note-avatar"></span><span class="note-name"></span>`;
  item.querySelector(".note-bubble").textContent = note ? note.content : (isMine ? "Leave a note…" : "");
  item.querySelector(".note-name").textContent = isMine ? "Your note" : person.display_name;
  setAvatarContent(item.querySelector(".avatar"), person);
  item.addEventListener("click", () => { if (isMine) openNoteSheet(); else startDmWithPerson(person); });
  return item;
}

function wireNotes() {
  const sheet = document.getElementById("noteSheet");
  const input = document.getElementById("noteInput");
  sheet.addEventListener("click", (e) => { if (e.target === sheet) AppNav.exitFullscreen(); });
  input.addEventListener("input", () => { document.getElementById("noteCount").textContent = input.value.length; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveNote(); } });
  document.getElementById("noteSaveBtn").addEventListener("click", saveNote);
  document.getElementById("noteDeleteBtn").addEventListener("click", deleteNote);
}

function openNoteSheet() {
  const sheet = document.getElementById("noteSheet");
  const input = document.getElementById("noteInput");
  input.value = myNote?.content || "";
  document.getElementById("noteCount").textContent = input.value.length;
  document.getElementById("noteDeleteBtn").style.display = myNote ? "block" : "none";
  sheet.classList.add("show");
  AppNav.enterFullscreen(() => sheet.classList.remove("show"));
  setTimeout(() => input.focus(), 120);
}

async function saveNote() {
  const btn = document.getElementById("noteSaveBtn");
  const text = document.getElementById("noteInput").value.trim();
  if (!text) { toast("Write something first."); return; }
  btn.disabled = true;
  // The RPC also replaces a note that has already expired, which a plain
  // upsert can't (an expired note is invisible to you, so it can't be updated).
  const { error } = await sb.rpc("set_my_note", { p_content: text });
  btn.disabled = false;
  if (error) { toast(friendlyError(error, "Could not share the note.")); return; }
  AppNav.exitFullscreen();
  myNote = { user_id: ME.id, content: text, created_at: new Date().toISOString() };
  await loadNotes();
  toast("Note shared");
}

async function deleteNote() {
  const { error } = await sb.from("notes").delete().eq("user_id", ME.id);
  if (error) { toast(friendlyError(error, "Could not delete.")); return; }
  myNote = null;
  AppNav.exitFullscreen();
  await loadNotes();
}

async function startDmWithPerson(person) {
  const { data, error } = await sb.rpc("get_or_create_dm", { other_user: person.id });
  if (error) { toast(friendlyError(error, "Could not open that chat.")); return; }
  location.href = `room.html?c=${data}`;
}

/* ---------- new chat: DM anyone, or make a group ---------- */

function wireNewChat() {
  const menu = document.getElementById("newChatMenu");
  document.getElementById("newChatBtn").addEventListener("click", (e) => { e.stopPropagation(); menu.classList.toggle("show"); });
  document.addEventListener("click", () => menu.classList.remove("show"));
  menu.addEventListener("click", async (e) => {
    const choice = e.target.closest("[data-new]");
    if (!choice) return;
    menu.classList.remove("show");
    if (choice.dataset.new === "dm") {
      const picked = await pickPeople({ title: "New message", multiple: false, exclude: [ME.id] });
      if (picked?.[0]) { toast("Opening chat…"); startDmWithPerson(picked[0]); }
    } else openGroupSheet();
  });

  document.getElementById("newGroupSheet").addEventListener("click", (e) => { if (e.target.id === "newGroupSheet") AppNav.exitFullscreen(); });
  document.getElementById("groupMemberSearch").addEventListener("input", debounce((e) => renderGroupMembers(e.target.value.trim()), 150));
  document.getElementById("createGroupBtn").addEventListener("click", createGroup);
}

const selectedMembers = new Set();
let groupPeople = [];

async function openGroupSheet() {
  const sheet = document.getElementById("newGroupSheet");
  selectedMembers.clear();
  document.getElementById("groupNameInput").value = "";
  document.getElementById("groupMemberSearch").value = "";
  document.getElementById("groupError").textContent = "";
  Skeleton.show("rows", "groupMemberList", 5);
  sheet.classList.add("show");
  AppNav.enterFullscreen(() => sheet.classList.remove("show"));
  renderGroupMembers("");
}

let groupToken = 0;
const pickedPeople = new Map();
async function renderGroupMembers(filterText = "") {
  const list = document.getElementById("groupMemberList");
  const my = ++groupToken;
  groupPeople = (await peopleFor(filterText)).filter((p) => p.id !== ME.id);
  if (my !== groupToken) return;
  // people already picked stay on top even when the search changes
  const shownIds = new Set(groupPeople.map((p) => p.id));
  const people = [...[...selectedMembers].filter((id) => !shownIds.has(id)).map((id) => pickedPeople.get(id)).filter(Boolean), ...groupPeople];
  if (!people.length) { list.innerHTML = `<div class="settings-empty">${filterText.length < 2 ? "Type a name to find people." : "No one found."}</div>`; return; }

  const frag = document.createDocumentFragment();
  for (const p of people) {
    const row = document.createElement("div");
    row.className = `settings-list-row group-member-row ${selectedMembers.has(p.id) ? "selected" : ""}`;
    row.innerHTML = `<span class="avatar"></span><div class="settings-list-name">${escapeHTML(p.display_name)}<span class="settings-list-sub">@${escapeHTML(p.username)}</span></div><span class="group-member-check">${selectedMembers.has(p.id) ? svgIcon("check", 13) : ""}</span>`;
    setAvatarContent(row.querySelector(".avatar"), p);
    row.addEventListener("click", () => {
      const on = selectedMembers.has(p.id);
      if (on) selectedMembers.delete(p.id); else { selectedMembers.add(p.id); pickedPeople.set(p.id, p); }
      row.classList.toggle("selected", !on);
      row.querySelector(".group-member-check").innerHTML = on ? "" : svgIcon("check", 13);
      updateGroupCount();
    });
    frag.appendChild(row);
  }
  list.replaceChildren(frag);
  updateGroupCount();
}

function updateGroupCount() {
  document.getElementById("createGroupBtn").textContent = selectedMembers.size ? `Create group · ${selectedMembers.size} selected` : "Create group";
}

async function createGroup() {
  const errEl = document.getElementById("groupError");
  const btn = document.getElementById("createGroupBtn");
  const name = document.getElementById("groupNameInput").value.trim();
  errEl.textContent = "";
  if (!name) { errEl.textContent = "Give the group a name."; return; }
  if (!selectedMembers.size) { errEl.textContent = "Pick at least one person."; return; }
  btn.disabled = true;
  btn.textContent = "Creating…";
  const { data, error } = await sb.rpc("create_group", { p_name: name, p_members: [...selectedMembers] });
  btn.disabled = false;
  updateGroupCount();
  if (error) { errEl.textContent = error.message || "Could not create group."; return; }
  location.href = `room.html?c=${data}`;
}

/* ---------- header tools: saved messages + search everything ---------- */

function addHeaderTools() {
  const header = document.querySelector(".profile-topbar");
  const wrap = header.querySelector(".new-chat-wrap");

  const starBtn = document.createElement("button");
  starBtn.className = "header-icon-btn x2-ic-star";
  starBtn.title = "Saved messages";
  starBtn.innerHTML = svgIcon("star", 18);
  const searchBtn = document.createElement("button");
  searchBtn.className = "header-icon-btn x2-ic-search";
  searchBtn.title = "Search all messages";
  searchBtn.innerHTML = svgIcon("search", 17);
  header.insertBefore(searchBtn, wrap);
  header.insertBefore(starBtn, wrap);

  const starred = makeSheet({ title: "Saved messages", html: `<div class="settings-list"></div>` });
  starBtn.addEventListener("click", async () => {
    starred.open();
    const list = starred.body.querySelector(".settings-list");
    Skeleton.show("rows", list, 3);
    const { data, error } = await sb.from("message_stars")
      .select("message_id, created_at, messages(id, content, sticker_url, image_url, audio_url, user_id, conversation_id, created_at)")
      .eq("user_id", ME.id).order("created_at", { ascending: false }).limit(100);
    const rows = (data || []).filter((r) => r.messages);
    if (error || !rows.length) { list.innerHTML = `<div class="settings-empty">Nothing saved yet — tap ⋯ → Save on any message.</div>`; return; }
    await getProfiles(rows.map((r) => r.messages.user_id));
    list.innerHTML = rows.map(({ messages: m }) => `
      <a class="settings-list-row" href="room.html?c=${m.conversation_id || PUBLIC_ROOM_ID}#m=${m.id}">
        <div style="flex:1;min-width:0;">
          <div class="settings-list-name">${escapeHTML(profileCache.get(m.user_id)?.display_name || "Someone")} <span class="settings-list-sub" style="display:inline">· ${timeAgo(m.created_at)}</span></div>
          <div class="settings-list-sub" style="white-space:normal;">${escapeHTML((m.content || (m.image_url ? "📷 Photo" : m.sticker_url ? "Sticker" : m.audio_url ? "🎤 Voice note" : "Message")).slice(0, 140))}</div>
        </div>
      </a>`).join("");
  });

  const search = makeSheet({ title: "Search all chats", html: `
    <input type="search" class="settings-search" placeholder="Search your messages…" autocomplete="off" />
    <div class="settings-list"></div>` });
  const input = search.body.querySelector("input");
  const results = search.body.querySelector(".settings-list");
  searchBtn.addEventListener("click", () => { search.open(); setTimeout(() => input.focus(), 150); });
  let token = 0;
  input.addEventListener("input", debounce(async () => {
    const q = input.value.trim();
    const my = ++token;
    if (q.length < 2) { results.innerHTML = q ? `<div class="settings-empty">Type at least 2 letters.</div>` : ""; return; }
    results.innerHTML = `<div class="settings-empty">Searching…</div>`;
    // searched server-side over every chat you're in (trigram-indexed), with the chat's name
    const { data, error } = await sb.rpc("search_my_messages", { p_query: q, p_limit: 40 });
    if (my !== token) return;
    if (error || !data?.length) { results.innerHTML = `<div class="settings-empty">Nothing found.</div>`; return; }
    await getProfiles(data.map((m) => m.user_id));
    if (my !== token) return;
    const rx = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    results.innerHTML = data.map((m) => `
      <a class="settings-list-row" href="room.html?c=${m.conversation_id || PUBLIC_ROOM_ID}#m=${m.id}">
        <div style="flex:1;min-width:0;">
          <div class="settings-list-name">${escapeHTML(profileCache.get(m.user_id)?.display_name || "Someone")} <span class="settings-list-sub" style="display:inline">${m.chat_name ? `in ${escapeHTML(m.chat_name)} ` : ""}· ${timeAgo(m.created_at)}</span></div>
          <div class="settings-list-sub" style="white-space:normal;">${escapeHTML(m.content.slice(0, 160)).replace(rx, "<mark>$1</mark>")}</div>
        </div>
      </a>`).join("");
  }, 280));
}

/* ---------- install as an app ---------- */

function installBar() {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone || Date.now() < Number(store.raw("teaofrpm_install_snooze") || 0)) return;
  const scroll = document.getElementById("inboxScroll");
  const show = (html, onGo) => {
    if (document.querySelector(".x4-install")) return;
    const bar = document.createElement("div");
    bar.className = "x4-install";
    bar.innerHTML = `<span class="x4-install-text">${html}</span>
      ${onGo ? `<button type="button" class="x4-install-go">Install</button>` : ""}
      <button type="button" class="x4-install-x" aria-label="Not now">${svgIcon("close", 14)}</button>`;
    bar.querySelector(".x4-install-x").addEventListener("click", () => {
      store.setRaw("teaofrpm_install_snooze", String(Date.now() + 7 * 86400000));
      bar.remove();
    });
    if (onGo) bar.querySelector(".x4-install-go").addEventListener("click", onGo);
    scroll.insertBefore(bar, scroll.firstChild);
  };
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    show(`<span class="x4-inline-ic">${svgIcon("download", 15)}</span><b>Install teaofrpm</b> — opens like an app, faster`, async () => {
      e.prompt();
      const { outcome } = await e.userChoice;
      document.querySelector(".x4-install")?.remove();
      if (outcome === "accepted") toast("Installed");
    });
  });
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !store.raw("teaofrpm_ios_hint")) {
    store.setRaw("teaofrpm_ios_hint", "1");
    show(`<span class="x4-inline-ic">${svgIcon("share", 15)}</span><b>Use it like an app:</b> tap <b>Share</b> → <b>Add to Home Screen</b>`);
  }
}

init();
