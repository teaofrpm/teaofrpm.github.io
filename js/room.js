/* ============================================================
   room.js — every chat: the public room, groups and DMs.

   Everything that used to be bolted on from outside by extras*.js
   (⋯ menu, pins, polls, countdowns, swipe-to-reply, seen receipts …)
   now lives here and runs directly when a message is drawn — no
   MutationObservers re-scanning the whole chat on every change, which is
   what made long chats stutter.
   ============================================================ */

let ME = null;
let convo = null;
let members = [];
let amAdmin = false;
let otherUser = null;
let isPublic = false;
let channel = null;

const PAGE_SIZE = 50;
const GROUP_WINDOW_MS = 5 * 60 * 1000;

const rendered = new Map();         // message id -> row element
const messageCache = new Map();     // message id -> message
const reactionsByMsg = new Map();   // message id -> [reaction rows]
const reactionMsg = new Map();      // reaction id -> message id (deletes only carry the id)
const starredIds = new Set();
const typingUsers = new Map();

let oldestAt = null, newestAt = null, hasMore = true, loadingOlder = false;
let lastMeta = null;                // what the newest node in the list is, for grouping/dividers
let atBottom = true, newCount = 0;
let replyingTo = null;
let pendingImageFile = null, pendingImagePreviewUrl = null;
let pendingVideoFile = null, pendingVideoUrl = null, pendingViewOnce = false, pendingOriginal = null;
let pendingAudioBlob = null, pendingAudioPreviewUrl = null;
let mediaRecorder = null, recordedChunks = [], recordingTimer = null;
let STICKERS = [];
let isTypingBroadcasted = false, typingClearTimer = null;
let selecting = false;
const selected = new Set();

const box = () => document.getElementById("messages");
const convoIdParam = new URLSearchParams(location.search).get("c");

/* ============================================================
   Boot
   ============================================================ */

async function init() {
  if (!convoIdParam) { location.replace("messages.html"); return; }
  const list = box();
  list.style.scrollBehavior = "auto";       // programmatic scrolling must be instant
  Skeleton.show("chat", list, 6);
  // Draw the header from last visit and make the composer usable right away,
  // so nothing on screen changes shape once the network answers.
  earlyHeader();
  wireComposer();

  ME = await App.boot();

  // Three independent requests at once instead of one after another.
  const [convoRes, membersRes, firstPage] = await Promise.all([
    sb.from("conversations").select("*").eq("id", convoIdParam).maybeSingle(),
    sb.from("conversation_members").select("*").eq("conversation_id", convoIdParam),
    fetchPage({}),
  ]);
  if (convoRes.error || !convoRes.data) {
    list.innerHTML = `<div class="inbox-empty">This chat isn't available.</div>`;
    return;
  }
  convo = convoRes.data;
  isPublic = !!convo.is_public || convo.id === PUBLIC_ROOM_ID;
  setMembers(membersRes.data || []);
  if (!isPublic) await getProfiles(members.map((m) => m.user_id));
  otherUser = convo.kind === "dm" ? profileCache.get(members.find((m) => m.user_id !== ME.id)?.user_id) : null;

  renderHeader();
  wireMessageEvents();
  wireScroll();
  wireInfoSheet();
  wireSearch();
  loadStickers();
  renderRequestBanner();

  await renderInitial(firstPage);
  subscribe();
  markReadSoon();
  renderPinnedBanner();
  welcomeCard();
  catchUp();
  loadStreak();
  wireGapFill();

  const deep = location.hash.match(/m=([\w-]+)/);
  if (deep) setTimeout(() => jumpToMessage(deep[1]), 300);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) rememberLastSeen();
    else markReadSoon();
  });
  window.addEventListener("pagehide", rememberLastSeen);
}

function setMembers(rows) {
  members = rows;
  amAdmin = members.some((m) => m.user_id === ME.id && m.role === "admin");
}

/* ============================================================
   Loading messages
   ============================================================ */

async function fetchPage({ before = null, after = null, from = null, limit = PAGE_SIZE }) {
  let q = sb.from("messages").select("*").eq("conversation_id", convoIdParam).eq("deleted", false);
  if (after) q = q.gt("created_at", after).order("created_at", { ascending: true }).limit(limit);
  else {
    if (before) q = q.lt("created_at", before);
    if (from) q = q.gte("created_at", from);
    q = q.order("created_at", { ascending: false }).limit(limit);
  }
  const { data, error } = await q;
  if (error) { toast("Could not load messages."); return []; }
  return after ? data : data.reverse();
}

// Everything a batch of messages needs, fetched together: authors,
// reactions, which ones you saved, and the messages they reply to.
async function prepareBatch(list) {
  if (!list.length) return;
  list.forEach((m) => messageCache.set(m.id, m));
  const ids = list.map((m) => m.id);
  // reactions + my stars + the messages being replied to: ONE request
  const { data: x } = await sb.rpc("message_extras", { p_ids: ids });
  const replies = x?.replies || [];
  replies.forEach((m) => { if (!messageCache.has(m.id)) messageCache.set(m.id, m); });
  await getProfiles([...list.map((m) => m.user_id), ...replies.map((m) => m.user_id)]);
  ids.forEach((id) => { if (!reactionsByMsg.has(id)) reactionsByMsg.set(id, []); });
  for (const r of x?.reactions || []) {
    if (reactionMsg.has(r.id)) continue;
    reactionMsg.set(r.id, r.message_id);
    reactionsByMsg.get(r.message_id)?.push(r);
  }
  (x?.stars || []).forEach((id) => starredIds.add(id));
}

async function renderInitial(list) {
  await prepareBatch(list);
  const el = box();
  el.innerHTML = "";
  const loader = document.createElement("div");
  loader.className = "load-more-btn";
  loader.id = "olderLoader";
  el.appendChild(loader);

  lastMeta = null;
  const frag = document.createDocumentFragment();
  list.forEach((m) => appendNode(frag, m));
  el.appendChild(frag);

  hasMore = list.length === PAGE_SIZE;
  oldestAt = list[0]?.created_at || null;
  newestAt = list[list.length - 1]?.created_at || null;
  if (!list.length) showEmptyHint();

  insertUnreadDivider();
  scrollToBottom();
  mountPolls();
  paintSeen();
  requestAnimationFrame(scrollToBottom);
}

function showEmptyHint() {
  if (box().querySelector(".chat-empty")) return;
  const d = document.createElement("div");
  d.className = "chat-empty";
  d.innerHTML = `${svgIcon("chat", 30)}<div>No messages yet.<br>Say hi 👋</div>`;
  box().appendChild(d);
}

async function loadOlder() {
  if (loadingOlder || !hasMore || !oldestAt) return;
  loadingOlder = true;
  const loader = document.getElementById("olderLoader");
  loader.textContent = "Loading earlier messages…";
  loader.classList.add("show");
  try {
    const list = await fetchPage({ before: oldestAt });
    hasMore = list.length === PAGE_SIZE;
    if (list.length) await prependBatch(list);
  } finally {
    loadingOlder = false;
    loader.classList.toggle("show", !hasMore && rendered.size > 20);
    loader.textContent = hasMore ? "" : "Beginning of the chat";
  }
}

async function prependBatch(list) {
  await prepareBatch(list);
  const el = box();
  const anchorH = el.scrollHeight, anchorTop = el.scrollTop;

  const saved = lastMeta;
  lastMeta = null;
  const frag = document.createDocumentFragment();
  list.forEach((m) => appendNode(frag, m));
  const batchMeta = lastMeta;
  lastMeta = saved;

  const loader = document.getElementById("olderLoader");
  const firstOld = loader.nextElementSibling;
  loader.after(frag);
  oldestAt = list[0].created_at;

  // seam between the new batch and what was already there
  if (firstOld && batchMeta) {
    if (firstOld.classList.contains("date-divider") && firstOld.dataset.day === batchMeta.day) {
      const after = firstOld.nextElementSibling;
      firstOld.remove();
      if (after && canGroupWith(batchMeta, after)) after.classList.add("grouped");
    }
  }
  el.scrollTop = anchorTop + (el.scrollHeight - anchorH);
  mountPolls();
}

function canGroupWith(meta, row) {
  return meta && meta.type === "msg" && row.classList.contains("msg-row") &&
    row.dataset.uid === meta.uid && row.dataset.day === meta.day &&
    new Date(row.dataset.at) - new Date(meta.at) < GROUP_WINDOW_MS;
}

// Appends one message (and a date divider if the day changed) to `target`.
function appendNode(target, m) {
  if (rendered.has(m.id)) return null;
  const day = new Date(m.created_at).toDateString();
  if (!lastMeta || lastMeta.day !== day) {
    const divider = document.createElement("div");
    divider.className = "date-divider";
    divider.dataset.day = day;
    divider.innerHTML = `<span>${formatDayLabel(m.created_at)}</span>`;
    target.appendChild(divider);
    lastMeta = { type: "divider", day };
  }
  const normal = !m.call_id && !m.is_bot && !m.is_system;
  const grouped = normal && lastMeta.type === "msg" && lastMeta.uid === m.user_id &&
    new Date(m.created_at) - new Date(lastMeta.at) < GROUP_WINDOW_MS;
  const row = buildRow(m, grouped);
  target.appendChild(row);
  rendered.set(m.id, row);
  lastMeta = normal ? { type: "msg", uid: m.user_id, at: m.created_at, day } : { type: "other", day };
  return row;
}

/* ============================================================
   Drawing a message
   ============================================================ */

function buildRow(m, grouped) {
  if (m.call_id) return buildCallLogRow(m);
  if (m.is_bot) return buildBotRow(m);
  if (m.is_system) return buildSystemRow(m);

  const author = profileCache.get(m.user_id);
  const isOwn = m.user_id === ME.id;
  const ownerMsg = isPublic && author?.role === "owner";

  const row = document.createElement("div");
  row.className = `msg-row${isOwn ? " own" : ""}${ownerMsg ? " owner-msg" : ""}${grouped ? " grouped" : ""}${m._pending ? " sending" : ""}${starredIds.has(m.id) ? " starred" : ""}`;
  row.dataset.msgId = m.id;
  row.dataset.uid = m.user_id;
  row.dataset.at = m.created_at;
  row.dataset.day = new Date(m.created_at).toDateString();

  const profileHref = author ? `profile.html?u=${encodeURIComponent(author.username)}` : "#";
  const showUsername = convo.kind !== "dm" && author;
  row.innerHTML = `
    <a class="avatar" href="${profileHref}"></a>
    <div class="msg-bubble-wrap">
      <div class="msg-meta">
        <a class="msg-name" href="${profileHref}">${escapeHTML(author?.display_name || "Unknown")}</a>
        ${showUsername && !isOwn ? `<span class="msg-username">@${escapeHTML(author.username)}</span>` : ""}
        ${ownerMsg ? `<span class="owner-badge">Owner</span>` : ""}
        <span class="msg-time" title="${escapeHTML(new Date(m.created_at).toLocaleString())}">${formatTime(m.created_at)}</span>
      </div>
      <div class="bubble"></div>
      <div class="reactions-row"></div>
    </div>`;
  setAvatarContent(row.querySelector(".avatar"), author);
  fillBubble(row.querySelector(".bubble"), m, isOwn);
  renderReactions(row.querySelector(".reactions-row"), m.id);
  return row;
}

function fillBubble(bubble, m, isOwn) {
  bubble.innerHTML = "";
  if (m.sticker_url && !m.content && !m.image_url) bubble.classList.add("sticker-only");

  if (m.reply_to) {
    const rp = document.createElement("div");
    rp.className = "reply-preview";
    rp.dataset.jump = m.reply_to;
    const orig = messageCache.get(m.reply_to);
    if (orig) rp.innerHTML = `<b>${escapeHTML(profileCache.get(orig.user_id)?.display_name || "…")}</b>: ${escapeHTML(previewText(orig))}`;
    else {
      rp.textContent = "Original message";
      findMessageById(m.reply_to).then(async (o) => {
        if (!o) { rp.textContent = "Message deleted"; return; }
        const a = await getProfile(o.user_id);
        rp.innerHTML = `<b>${escapeHTML(a?.display_name || "…")}</b>: ${escapeHTML(previewText(o))}`;
      });
    }
    bubble.appendChild(rp);
  }

  if (m.sticker_url) {
    const img = document.createElement("img");
    img.className = "sticker-img";
    img.src = m.sticker_url;
    img.loading = "lazy";
    img.alt = "Sticker";
    bubble.appendChild(img);
  }
  if (m.audio_url) {
    const audio = document.createElement("audio");
    audio.className = "chat-audio";
    audio.controls = true;
    audio.preload = "none";
    audio.src = m.audio_url;
    bubble.appendChild(audio);
  }
  if (m.view_once) {
    const card = document.createElement("div");
    card.className = "vo-card";
    bubble.appendChild(card);
    paintVoCard(card, m, isOwn);
  }
  if (m.image_url) {
    const img = document.createElement("img");
    img.className = "chat-img";
    img.src = m.image_url;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "Photo";
    bubble.appendChild(img);
  }
  if (m.video_url) {
    const v = document.createElement("video");
    v.className = "chat-video";
    v.controls = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.src = m.video_url;
    bubble.appendChild(v);
  }
  if (m.shared_post_id) {
    const a = document.createElement("a");
    a.className = "shared-post-by";
    a.href = `profile.html?post=${m.shared_post_id}`;
    a.textContent = "View shared post";
    bubble.appendChild(a);
    sharedPostAuthor(m.shared_post_id).then((author) => {
      if (!author) return;
      a.href = `profile.html?u=${encodeURIComponent(author.username)}&post=${m.shared_post_id}`;
      a.textContent = `View post by @${author.username}`;
    });
  }

  if (m.content) {
    const txt = document.createElement("div");
    txt.className = "msg-text";
    const raw = m.content.trim();
    const cd = raw.match(CD_RE);
    if (/^\/poll\s/i.test(raw) && !m._pending) {
      txt.classList.add("x3-has-card");
      txt.dataset.poll = "pending";
      txt.textContent = raw;
    } else if (cd) {
      txt.classList.add("x3-has-card");
      txt.innerHTML = countdownCard(cd);
      startCountdownTicker();
    } else {
      txt.innerHTML = formatChat(linkifyMentions(escapeHTML(m.content))) + (m.edited_at ? ` <span class="edited-tag">(edited)</span>` : "");
      if (m.content.length > 700 || (m.content.match(/\n/g) || []).length > 9) {
        txt.classList.add("extras-clamped");
        txt.dataset.rm = "1";
      }
    }
    if (m.image_url || m.audio_url || m.sticker_url || m.video_url) txt.style.marginTop = "6px";
    bubble.appendChild(txt);
    if (txt.dataset.rm) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "extras-readmore";
      more.textContent = "Read more";
      bubble.appendChild(more);
    }
  }

  if (m._failed) {
    const f = document.createElement("button");
    f.type = "button";
    f.className = "msg-failed";
    f.innerHTML = `${svgIcon("refresh", 12)} Not sent · tap to retry`;
    bubble.appendChild(f);
  }

  if (!m._pending) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML = `
      <button type="button" class="react-btn" title="React">${svgIcon("smilePlus", 14)}</button>
      <button type="button" class="reply-btn" title="Reply">${svgIcon("reply", 14)}</button>
      ${m.content ? `<button type="button" class="copy-btn" title="Copy text">${svgIcon("copy", 14)}</button>` : ""}
      ${isOwn && m.content && !m.shared_post_id ? `<button type="button" class="edit-btn" title="Edit">${svgIcon("edit", 14)}</button>` : ""}
      ${isOwn ? `<button type="button" class="delete-btn" title="Delete">${svgIcon("trash", 14)}</button>` : ""}
      <button type="button" class="more-msg-btn" title="More">${svgIcon("more", 15)}</button>`;
    bubble.appendChild(actions);
  }
}

function previewText(m) {
  if (m.content) return m.content.slice(0, 60);
  if (m.view_once) return "📷 View once";
  if (m.video_url) return "🎥 Video";
  if (m.image_url) return "📷 Photo";
  if (m.sticker_url) return "Sticker";
  if (m.audio_url) return "🎤 Voice note";
  return "message";
}

async function findMessageById(id) {
  if (messageCache.has(id)) return messageCache.get(id);
  const { data } = await sb.from("messages").select("*").eq("id", id).maybeSingle();
  if (data) messageCache.set(id, data);
  return data;
}

const postAuthorCache = new Map();
function sharedPostAuthor(postId) {
  if (!postAuthorCache.has(postId)) {
    postAuthorCache.set(postId, sb.from("posts").select("user_id").eq("id", postId).maybeSingle()
      .then(({ data }) => (data ? getProfile(data.user_id) : null)));
  }
  return postAuthorCache.get(postId);
}

// The bot has no profile row; it borrows the commanding user's id but
// is_bot decides how it looks.
function buildBotRow(m) {
  const row = document.createElement("div");
  row.className = "bot-msg-row";
  row.dataset.msgId = m.id;
  row.innerHTML = `
    <img class="bot-avatar" src="images/bot.png" alt="" width="26" height="26" loading="lazy" />
    <div class="bot-msg-body">
      <div class="bot-msg-head"><b>teaBot</b><span class="bot-badge">BOT</span></div>
      <div class="bot-msg-text">${linkify(escapeHTML(m.content || ""))}</div>
      <span class="bot-msg-time">${formatTime(m.created_at)}</span>
    </div>`;
  return row;
}

function buildSystemRow(m) {
  const row = document.createElement("div");
  row.className = "system-row";
  row.dataset.msgId = m.id;
  const actor = profileCache.get(m.user_id);
  const who = m.user_id === ME.id ? "You" : (actor?.display_name || "Someone");
  const text = m.content || "updated the chat";
  const icon = /photo/i.test(text) ? "image" : /theme/i.test(text) ? "palette" : /pin/i.test(text) ? "pin" : "edit";
  row.innerHTML = `<div class="system-chip">${svgIcon(icon, 13)}<span><b>${escapeHTML(who)}</b> ${escapeHTML(text)}</span><small>${formatTime(m.created_at)}</small></div>`;
  return row;
}

function buildCallLogRow(m) {
  const row = document.createElement("div");
  row.className = "call-log-row";
  row.dataset.msgId = m.id;
  const text = m.content || "Call";
  const missed = /missed|declined|couldn/i.test(text);
  const isVideo = /video/i.test(text);
  row.innerHTML = `<button type="button" class="call-log-chip ${missed ? "missed" : ""}" data-video="${isVideo ? 1 : 0}" title="Call back">${svgIcon(isVideo ? "video" : "phone", 15)} ${escapeHTML(text)} <small>${formatTime(m.created_at)}</small></button>`;
  return row;
}

function formatDayLabel(ts) {
  const d = new Date(ts), today = new Date(), yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: d > new Date(Date.now() - 6 * 864e5) ? "long" : undefined, day: "numeric", month: "short", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}

/* ============================================================
   Live updates (one channel for the whole chat)
   ============================================================ */

function subscribe() {
  channel = sb.channel(`room:${convo.id}`, { config: { presence: { key: ME.id }, broadcast: { self: false } } });
  const f = `conversation_id=eq.${convo.id}`;
  channel
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: f }, ({ new: m }) => onLiveInsert(m))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: f }, ({ new: m }) => onLiveUpdate(m))
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, onReactionChange)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${convo.id}` }, ({ new: c }) => {
      const pinChanged = c.pinned_message_id !== convo.pinned_message_id;
      convo = { ...convo, ...c };
      renderHeader();
      if (pinChanged) renderPinnedBanner();
      const sheet = document.getElementById("roomInfoSheet");
      if (sheet.classList.contains("show")) {
        document.getElementById("groupNameEdit").value = convo.name || "";
        setGroupAvatar(document.getElementById("groupPfp"), convo);
        renderThemeRow();
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members", filter: f }, ({ eventType, new: n }) => {
      if (eventType === "UPDATE" && n) {
        const mem = members.find((x) => x.user_id === n.user_id);
        const wasReq = mem?.request;
        if (mem) Object.assign(mem, n);
        paintSeen();
        if (wasReq !== n.request) renderRequestBanner();
      } else reloadMembersSoon();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "polls", filter: f }, ({ new: p }) => {
      if (!p) return;
      if (pollsById.has(p.id)) { pollsById.set(p.id, { ...pollsById.get(p.id), ...p }); refreshPollResults([p.id]); }
      else mountPolls();
    })
    .on("broadcast", { event: "typing" }, ({ payload }) => handleTypingBroadcast(payload))
    .on("presence", { event: "sync" }, renderPresence)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") await channel.track({ user_id: ME.id, online_at: new Date().toISOString() });
    });
  window.addEventListener("beforeunload", () => sendTypingState(false));
}

const reloadMembersSoon = debounce(async () => {
  const { data } = await sb.from("conversation_members").select("*").eq("conversation_id", convo.id);
  setMembers(data || []);
  if (!isPublic) await getProfiles(members.map((m) => m.user_id));
  renderHeader();
}, 600);

async function onLiveInsert(m) {
  if (rendered.has(m.id)) return;
  if (m.user_id === ME.id && adoptPending(m)) return;
  await appendLive([m]);
}

async function appendLive(list) {
  list = list.filter((m) => !rendered.has(m.id));
  if (!list.length) return;
  // someone changed the disappearing timer → pick up the new setting
  if (list.some((m) => m.is_system && /disappearing messages/.test(m.content || ""))) {
    sb.from("conversations").select("disappear_seconds").eq("id", convo.id).maybeSingle().then(({ data }) => {
      if (!data) return;
      convo.disappear_seconds = data.disappear_seconds;
      paintVanishChip();
      if (document.getElementById("roomInfoSheet")?.classList.contains("show")) renderVanishRow();
    });
  }
  await prepareBatch(list);
  const el = box();
  el.querySelector(".chat-empty")?.remove();
  const stick = atBottom || list.some((m) => m.user_id === ME.id);
  let added = 0;
  for (const m of list) {
    if (rendered.has(m.id)) continue;
    appendNode(el, m)?.classList.add("anim-in");
    added++;
    clearTypingUser(m.user_id);
    if (m.created_at > (newestAt || "")) newestAt = m.created_at;
    if (m.user_id !== ME.id && !m.is_system) messageEffect(m);
  }
  if (!added) return;
  mountPolls();
  if (stick) scrollToBottom(true);
  else { newCount += added; updateJumpButton(); }
  if (list.some((m) => m.user_id === ME.id)) paintSeen();
  if (!document.hidden) markReadSoon();
}

function onLiveUpdate(m) {
  const row = rendered.get(m.id);
  if (m.deleted) { if (row) removeRow(m.id); return; }
  const prev = messageCache.get(m.id);
  messageCache.set(m.id, m);
  if (!row || row.querySelector(".edit-box")) return;
  if (prev && prev.content === m.content && prev.edited_at === m.edited_at) return;
  const txt = row.querySelector(".msg-text");
  if (txt && !txt.classList.contains("x3-has-card")) {
    txt.innerHTML = formatChat(linkifyMentions(escapeHTML(m.content || ""))) + (m.edited_at ? ` <span class="edited-tag">(edited)</span>` : "");
  }
}

function removeRow(id) {
  const row = rendered.get(id);
  if (!row) return;
  const next = row.nextElementSibling;
  const prev = row.previousElementSibling;
  row.remove();
  rendered.delete(id);
  // the next message may have been "grouped" under this one
  if (next && next.classList.contains("grouped")) {
    const p = next.previousElementSibling;
    if (!p || !p.classList.contains("msg-row") || p.dataset.uid !== next.dataset.uid) next.classList.remove("grouped");
  }
  // a date divider with nothing under it
  if (prev && prev.classList.contains("date-divider") && (!next || next.classList.contains("date-divider"))) prev.remove();
  const last = box().lastElementChild;
  if (!last || !last.classList.contains("msg-row")) lastMeta = last?.classList.contains("date-divider") ? { type: "divider", day: last.dataset.day } : (last ? { type: "other", day: lastMeta?.day } : null);
  else lastMeta = { type: "msg", uid: last.dataset.uid, at: last.dataset.at, day: last.dataset.day };
  paintSeen();
}

// Phones drop the live connection when the screen locks; on return,
// fetch whatever arrived in between.
function wireGapFill() {
  let leftAt = null;
  const fill = async () => {
    if (!newestAt) return;
    const list = await fetchPage({ after: newestAt, limit: 100 });
    if (list.length) {
      const fresh = list.filter((m) => !rendered.has(m.id));
      await appendLive(fresh);
      if (fresh.length && !atBottom) toast(`${fresh.length} new message${fresh.length === 1 ? "" : "s"}`);
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { leftAt = Date.now(); return; }
    if (leftAt && Date.now() - leftAt > 8000) fill();
    leftAt = null;
  });
  window.addEventListener("online", fill);
}

/* ---------- read state ---------- */

let markTimer = null, lastMark = 0;
function markReadSoon() {
  if (!convo) return;
  clearTimeout(markTimer);
  const wait = Math.max(0, 3000 - (Date.now() - lastMark));
  markTimer = setTimeout(async () => {
    if (document.hidden) return;
    lastMark = Date.now();
    const at = new Date().toISOString();
    const mine = members.find((m) => m.user_id === ME.id);
    if (mine) mine.last_read_at = at;
    await sb.from("conversation_members").update({ last_read_at: at }).eq("conversation_id", convo.id).eq("user_id", ME.id);
  }, wait);
}

function lastRealOwnRow() {
  const rows = box().querySelectorAll(".msg-row.own[data-msg-id]:not(.sending):not(.failed)");
  return rows[rows.length - 1] || null;
}

// "Seen" under your newest message (DMs) / "Seen by N" (groups).
// "Seen 5m ago" / "Seen 10:42 PM" / "Seen Mon 9:10 PM" — when exactly they opened the chat
function seenWhen(iso) {
  const d = new Date(iso), now = new Date();
  const mins = (now - d) / 60000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `at ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `yesterday ${time}`;
  if (now - d < 6 * 864e5) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

function paintSeen() {
  document.querySelectorAll(".extras2-seen").forEach((el) => el.remove());
  if (isPublic || !convo || convo.kind === "bot") return;
  const row = lastRealOwnRow();
  if (!row) return;
  const at = row.dataset.at;
  const others = members.filter((m) => m.user_id !== ME.id);
  const seenBy = others.filter((m) => m.last_read_at && m.last_read_at >= at)
    .sort((a, b) => (b.last_read_at > a.last_read_at ? 1 : -1));
  const tag = document.createElement("div");
  tag.className = "extras2-seen";
  if (!seenBy.length) {
    tag.classList.add("not-seen");
    tag.innerHTML = `${svgIcon("check", 12)} Sent`;
  } else if (others.length === 1) {
    tag.innerHTML = `${svgIcon("checks", 12)} Seen <span data-seen="${seenBy[0].last_read_at}">${seenWhen(seenBy[0].last_read_at)}</span>`;
    tag.title = new Date(seenBy[0].last_read_at).toLocaleString();
  } else {
    const names = seenBy.map((m) => profileCache.get(m.user_id)?.display_name?.split(" ")[0]).filter(Boolean);
    tag.innerHTML = `${svgIcon("checks", 12)} Seen by ${seenBy.length === others.length ? "everyone" : names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "")}`;
    tag.style.cursor = "pointer";
    tag.addEventListener("click", () => openMessageInfo(messageCache.get(row.dataset.msgId)));
  }
  row.querySelector(".msg-bubble-wrap").appendChild(tag);
  startSeenTicker();
}

// keep "Seen 3m ago" fresh without re-rendering the chat
let seenTicker = null;
function startSeenTicker() {
  if (seenTicker) return;
  seenTicker = setInterval(() => {
    document.querySelectorAll(".extras2-seen [data-seen]").forEach((s) => { s.textContent = seenWhen(s.dataset.seen); });
  }, 30000);
}

// WhatsApp-style message info: who read it and when
async function openMessageInfo(m) {
  if (!m) return;
  const others = members.filter((x) => x.user_id !== ME.id);
  await getProfiles(others.map((x) => x.user_id));
  const read = others.filter((x) => x.last_read_at && x.last_read_at >= m.created_at).sort((a, b) => (a.last_read_at < b.last_read_at ? -1 : 1));
  const unread = others.filter((x) => !read.includes(x));
  const rowHTML = (x, seen) => {
    const p = profileCache.get(x.user_id);
    return `<div class="settings-list-row"><span class="avatar" data-uid="${x.user_id}"></span><div style="flex:1;min-width:0"><div class="settings-list-name">${escapeHTML(p?.display_name || "Someone")}</div>
      <div class="settings-list-sub">${seen ? `${svgIcon("checks", 11)} Seen ${escapeHTML(seenWhen(x.last_read_at))} · ${new Date(x.last_read_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Not seen yet"}</div></div></div>`;
  };
  const s = makeSheet({ title: "Message info", html: `
    <div class="msg-info-preview">${escapeHTML(previewText(m))}<small>Sent ${new Date(m.created_at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></div>
    <div class="settings-group-title">${svgIcon("checks", 13)} Read by ${read.length}${others.length > 1 ? ` of ${others.length}` : ""}</div>
    <div class="settings-list">${read.map((x) => rowHTML(x, true)).join("") || `<div class="settings-empty">Nobody has seen it yet.</div>`}</div>
    ${unread.length ? `<div class="settings-group-title">${svgIcon("check", 13)} Delivered</div><div class="settings-list">${unread.map((x) => rowHTML(x, false)).join("")}</div>` : ""}` });
  s.body.querySelectorAll(".avatar[data-uid]").forEach((a) => setAvatarContent(a, profileCache.get(a.dataset.uid)));
  s.onClose = () => setTimeout(() => s.el.remove(), 300);
  s.open();
}

/* ---------- "new messages" line + catch-up ---------- */

const lastSeenKey = () => `teaofrpm_lastmsg_${convo.id}`;
function rememberLastSeen() {
  if (!convo) return;
  const rows = [...box().querySelectorAll("[data-msg-id]")].filter((r) => !r.dataset.msgId.startsWith("tmp-"));
  const last = rows[rows.length - 1];
  if (last) store.setRaw(lastSeenKey(), last.dataset.msgId);
  store.setRaw(`teaofrpm_seen_at_${convo.id}`, new Date().toISOString());
}

function insertUnreadDivider() {
  const lastSeen = store.raw(lastSeenKey());
  if (!lastSeen || !rendered.has(lastSeen)) return;
  let next = rendered.get(lastSeen).nextElementSibling;
  while (next && !next.dataset.msgId) next = next.nextElementSibling;
  if (!next || next.classList.contains("own")) return;
  const d = document.createElement("div");
  d.className = "extras-newline";
  d.innerHTML = "<span>New messages</span>";
  next.before(d);
}

async function catchUp() {
  const key = `teaofrpm_seen_at_${convo.id}`;
  const prev = store.raw(key);
  store.setRaw(key, new Date().toISOString());
  if (!prev || Date.now() - Date.parse(prev) < 2 * 3600000) return;

  const { data: missed } = await sb.from("messages")
    .select("id,content,user_id,created_at,image_url,sticker_url")
    .eq("conversation_id", convo.id).eq("deleted", false).eq("is_bot", false).eq("is_system", false)
    .neq("user_id", ME.id).gt("created_at", prev).order("created_at", { ascending: false }).limit(150);
  if (!missed || missed.length < 5) return;

  const { data: reacts } = await sb.from("message_reactions").select("message_id").in("message_id", missed.map((m) => m.id));
  const counts = new Map();
  (reacts || []).forEach((r) => counts.set(r.message_id, (counts.get(r.message_id) || 0) + 1));
  const top = missed.filter((m) => counts.get(m.id)).sort((a, b) => counts.get(b.id) - counts.get(a.id)).slice(0, 3);
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
      return `<button type="button" data-jump="${m.id}"><small>${svgIcon("flame", 12)}${counts.get(m.id)}</small><span><b>${escapeHTML(who)}</b>: ${escapeHTML(what.slice(0, 90))}</span></button>`;
    }).join("")}</div>` : ""}`;
  card.querySelector(".x3-catchup-x").addEventListener("click", () => card.remove());
  card.addEventListener("click", (e) => { const b = e.target.closest("[data-jump]"); if (b) jumpToMessage(b.dataset.jump); });
  document.querySelector(".chat-header").after(card);
}

async function welcomeCard() {
  let { data } = await sb.from("bot_settings").select("welcome,rules").eq("conversation_id", convo.id).maybeSingle();
  if (!data && isPublic) ({ data } = await sb.from("bot_room_settings").select("welcome,rules").eq("id", 1).maybeSingle());
  const welcome = (data?.welcome || "").trim(), rules = (data?.rules || "").trim();
  if (!welcome && !rules) return;
  const key = `teaofrpm_welcome_${convo.id}`;
  const fp = `${welcome.length}:${rules.length}:${welcome.slice(0, 40)}|${rules.slice(0, 40)}`;
  if (store.raw(key) === fp) return;

  const card = document.createElement("div");
  card.className = "x4-welcome";
  card.innerHTML = `
    <img src="images/bot.png" alt="" class="x4-welcome-bot" width="30" height="30" />
    <div class="x4-welcome-body">
      <div class="x4-welcome-text">${escapeHTML(welcome || "Welcome!")}</div>
      ${rules ? `<details class="x4-welcome-rules"><summary>Read the rules</summary><div>${escapeHTML(rules)}</div></details>` : ""}
      <button type="button" class="x4-welcome-ok">Got it</button>
    </div>`;
  card.querySelector(".x4-welcome-ok").addEventListener("click", () => { store.setRaw(key, fp); card.remove(); });
  (document.querySelector(".x3-catchup") || document.querySelector(".chat-header")).after(card);
}

/* ============================================================
   Scrolling
   ============================================================ */

// Already at (or right next to) the bottom → snap instantly. A smooth
// animation there fights the finger and the new row's fade-in, which is
// what made the end of the chat wobble. Smooth only for a real "jump".
function scrollToBottom(smooth = false) {
  const el = box();
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (smooth && dist > 300 && dist < 1500) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  else el.scrollTop = el.scrollHeight;
  atBottom = true;
  newCount = 0;
  updateJumpButton();
}

let jumpState = "";
function updateJumpButton() {
  const btn = document.getElementById("jumpLatest");
  if (!btn) return;
  const el = box();
  const far = el.scrollHeight - el.scrollTop - el.clientHeight > 500;
  const state = (far || newCount > 0 ? "1" : "0") + newCount;
  if (state === jumpState) return;          // runs on every scroll frame — don't touch the DOM for nothing
  jumpState = state;
  btn.classList.toggle("show", far || newCount > 0);
  btn.innerHTML = newCount ? `${svgIcon("arrowDown", 14)} ${newCount} new` : svgIcon("arrowDown", 16);
}

function wireScroll() {
  const el = box();
  // browsers already deliver scroll at most once per frame, so no extra throttle
  el.addEventListener("scroll", () => {
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom = dist < 120;
    if (atBottom && newCount) newCount = 0;
    updateJumpButton();
    if (el.scrollTop < 400) loadOlder();
  }, { passive: true });

  // Keep the newest message pinned when the chat area changes size — the
  // keyboard opening, the composer growing, a reply bar or pinned banner
  // appearing. Without this the last message slid under the composer.
  if (window.ResizeObserver) {
    let lastH = el.clientHeight;
    new ResizeObserver(() => {
      const h = el.clientHeight;
      if (h !== lastH && atBottom) el.scrollTop = el.scrollHeight;
      lastH = h;
    }).observe(el);
  }
  // only a real finger/wheel closes the ⋯ menu — not the chat auto-scrolling
  // down when a new message arrives
  ["wheel", "touchmove"].forEach((ev) => el.addEventListener(ev, closeMoreMenu, { passive: true }));

  // a photo finishing loading must not leave you short of the newest message
  el.addEventListener("load", () => { if (atBottom) el.scrollTop = el.scrollHeight; }, true);
  document.getElementById("jumpLatest").addEventListener("click", () => scrollToBottom(true));
}

async function jumpToMessage(id) {
  if (!rendered.has(id)) {
    const target = await findMessageById(id);
    if (!target || target.deleted || target.conversation_id !== convo.id) { toast("That message isn't available."); return; }
    if (oldestAt && target.created_at < oldestAt) {
      toast("Loading earlier messages…", 1500);
      const list = await fetchPage({ before: oldestAt, from: target.created_at, limit: 1000 });
      if (list.length) await prependBatch(list);
    }
  }
  const row = rendered.get(id);
  if (!row) { toast("That message isn't available."); return; }
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  const bubble = row.querySelector(".bubble, .bot-msg-body, .system-chip");
  bubble?.classList.add("highlight-flash");
  setTimeout(() => bubble?.classList.remove("highlight-flash"), 1600);
}

/* ============================================================
   Header, presence, typing
   ============================================================ */

function renderHeader() {
  const av = document.getElementById("roomAvatar");
  const title = document.getElementById("roomTitle");
  const subtitle = document.getElementById("roomSubtitle");
  const link = document.getElementById("roomTitleLink");

  if (convo.kind === "dm") {
    title.textContent = otherUser?.display_name || "Unknown";
    setAvatarContent(av, otherUser);
    if (otherUser) {
      link.href = `profile.html?u=${encodeURIComponent(otherUser.username)}`;
      const audioBtn = document.getElementById("callAudioBtn");
      const videoBtn = document.getElementById("callVideoBtn");
      audioBtn.style.display = "flex";
      videoBtn.style.display = "flex";
      audioBtn.onclick = () => CallManager.start(convo.id, otherUser, "audio");
      videoBtn.onclick = () => CallManager.start(convo.id, otherUser, "video");
    } else {
      document.getElementById("callAudioBtn").style.display = "none";
      document.getElementById("callVideoBtn").style.display = "none";
    }
  } else if (convo.kind === "bot") {
    title.innerHTML = `Tea <span class="tea-ai-chip">AI</span>`;
    av.innerHTML = `<img src="images/bot.png" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    link.removeAttribute("href");
    link.onclick = null;
    subtitle.textContent = "Always online · normal Hinglish me baat karo";
  } else {
    title.textContent = convo.name || (isPublic ? "RPM Public Room" : "Group");
    setGroupAvatar(av, convo);
    link.removeAttribute("href");
    link.onclick = () => document.getElementById("roomInfoBtn").click();
  }
  document.title = `${title.textContent} — 𝓉𝑒𝒶𝑜𝒻𝓇𝓅𝓂`;
  paintVanishChip();
  applyChatTheme(convo.theme);
  renderPresence();
  const prev = store.get(headerKey()) || {};
  store.set(headerKey(), {
    // never cache "Online"/"typing…" — they'd be stale next time
    kind: convo.kind, title: title.textContent, theme: convo.theme || "default",
    sub: convo.kind === "dm" ? (otherUser ? `@${otherUser.username}` : "") : `${members.length} member${members.length === 1 ? "" : "s"}`,
    convo: { id: convo.id, name: convo.name, pfp_url: convo.pfp_url, kind: convo.kind, is_public: convo.is_public },
    other: otherUser ? { id: otherUser.id, username: otherUser.username, display_name: otherUser.display_name, pfp_url: otherUser.pfp_url, avatar_color: otherUser.avatar_color } : null,
    streak: prev.streak || null,
  });
}

const headerKey = () => "teaofrpm_rh_" + convoIdParam;

/* ---------- message requests (Instagram-style) ---------- */

function renderRequestBanner() {
  document.getElementById("reqBanner")?.remove();
  if (convo.kind !== "dm") return;
  const mine = members.find((m) => m.user_id === ME.id);
  const theirs = members.find((m) => m.user_id !== ME.id);
  const composer = document.querySelector(".composer");
  const b = document.createElement("div");
  b.id = "reqBanner";
  b.className = "req-banner";
  if (mine?.request) {
    const name = otherUser?.display_name || "Someone";
    b.innerHTML = `<b>${escapeHTML(name)} wants to send you a message</b>
      <p>They don't know you've seen this yet. Accept to move it to your chats — or just reply.</p>
      <div class="req-actions"><button type="button" class="danger" data-a="block">Block</button><button type="button" data-a="delete">Delete</button><button type="button" class="primary" data-a="accept">Accept</button></div>`;
    b.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (!a) return;
      if (a === "accept") {
        const { error } = await sb.rpc("accept_message_request", { p_conversation: convo.id });
        if (error) { toast(friendlyError(error)); return; }
        mine.request = false; b.remove(); toast("Accepted — it's in your chats now");
      } else if (a === "delete" || a === "block") {
        if (a === "block" && otherUser) await sb.from("blocks").insert({ blocker_id: ME.id, blocked_id: otherUser.id });
        await sb.from("conversation_members").delete().eq("conversation_id", convo.id).eq("user_id", ME.id);
        store.remove("teaofrpm_inbox");
        location.replace("messages.html");
      }
    });
  } else if (theirs?.request) {
    b.innerHTML = `<p style="margin:0">${svgIcon("inbox", 13)} Your messages land in their <b style="display:inline">Message requests</b> until they accept.</p>`;
    b.style.padding = "10px";
  } else return;
  composer.parentNode.insertBefore(b, composer);
}

/* ---------- chat themes (Messenger-style: one theme, everyone in the chat sees it) ---------- */

const CHAT_THEMES = [
  ["default", "Classic", "#FDFBF6", "#6A1B9A", "#fff"],
  ["midnight", "Midnight", "#1e1b4b", "#7c6cf3", "#1e293b"],
  ["ocean", "Ocean", "#d6f0fd", "#0aa1d6", "#fff"],
  ["sunset", "Sunset", "#ffeee8", "#f3586f", "#fff"],
  ["lavender", "Lavender", "#efeafe", "#8e63f1", "#fff"],
  ["mint", "Mint", "#ddf8ea", "#0fa98a", "#fff"],
  ["rose", "Rose", "#fdeaf0", "#ea3a77", "#fff"],
  ["aurora", "Aurora", "#0c4a6e", "#5fb3f0", "#24476b"],
  ["neon", "Neon", "#0f0f12", "#b45cf0", "#18181b"],
  ["forest", "Forest", "#0d4024", "#4fb82a", "#2a5a3a"],
  ["candy", "Candy", "#f3eefc", "#ab8cf0", "#fff"],
  ["coffee", "Coffee", "#ecdfd4", "#94704f", "#fffaf5"],
  ["mono", "Mono", "#f4f4f5", "#18181b", "#fff"],
  ["galaxy", "Galaxy", "#1d1650", "#b14bb0", "#2d2766"],
];

function applyChatTheme(theme) {
  const t = CHAT_THEMES.some(([k]) => k === theme) ? theme : "default";
  if (t === "default") document.documentElement.removeAttribute("data-chat-theme");
  else document.documentElement.setAttribute("data-chat-theme", t);
}

function renderThemeRow() {
  const body = document.querySelector("#roomInfoSheet .room-info-body");
  let row = body.querySelector(".theme-row");
  const canEdit = !isPublic || ME.role === "owner";
  if (!row) {
    row = document.createElement("div");
    row.className = "theme-row";
    body.insertBefore(row, body.querySelector(".mute-row") || body.querySelector(".settings-group-title"));
  }
  const cur = convo.theme || "default";
  row.innerHTML = `<b>${svgIcon("palette", 14)} Chat theme</b>
    <span class="hint">${canEdit ? "Everyone in this chat sees the theme you pick." : "Only the owner can change the public room's theme."}</span>
    <div class="theme-grid">${CHAT_THEMES.map(([k, name, bg, own, other]) =>
      `<button type="button" class="theme-swatch${k === cur ? " on" : ""}" data-k="${k}" style="background:${bg}" ${canEdit ? "" : "disabled"} aria-label="${name}">
        <i style="background:${other}"></i><i class="o" style="background:${own}"></i><i style="background:${other}"></i><em>${name}</em></button>`).join("")}</div>`;
  row.querySelectorAll(".theme-swatch").forEach((b) => b.addEventListener("click", async () => {
    const k = b.dataset.k, before = convo.theme || "default";
    if (k === before) return;
    convo.theme = k;
    applyChatTheme(k);
    renderThemeRow();
    if (typeof buzz === "function") buzz(10);
    const { error } = await sb.from("conversations").update({ theme: k }).eq("id", convo.id);
    if (error) {
      convo.theme = before; applyChatTheme(before); renderThemeRow();
      toast(friendlyError(error, "Could not change the theme."));
    }
  }));
}

/* ---------- disappearing messages (WhatsApp-style timer per chat) ---------- */

const VANISH = [[null, "Off"], [3600, "1 hour"], [86400, "24 hours"], [604800, "7 days"], [7776000, "90 days"]];
const vanishLabel = (s) => VANISH.find(([v]) => v === s)?.[1] || "";

function paintVanishChip() {
  const title = document.getElementById("roomTitle");
  let chip = document.getElementById("vanishChip");
  if (!convo?.disappear_seconds) { chip?.remove(); return; }
  if (!chip) {
    chip = document.createElement("span");
    chip.id = "vanishChip";
    chip.className = "vanish-chip";
    title.insertAdjacentElement("afterend", chip);
  }
  chip.title = `Disappearing messages: ${vanishLabel(convo.disappear_seconds)}`;
  chip.innerHTML = `${svgIcon("clock", 12)}${vanishLabel(convo.disappear_seconds).replace(" hours", "h").replace(" hour", "h").replace(" days", "d")}`;
}

function renderVanishRow() {
  const body = document.querySelector("#roomInfoSheet .room-info-body");
  let row = body.querySelector(".vanish-row");
  if (isPublic || convo.kind === "bot") { row?.remove(); return; }
  const canEdit = convo.kind === "dm" || amAdmin;
  if (!row) {
    row = document.createElement("div");
    row.className = "vanish-row";
    body.insertBefore(row, body.querySelector(".settings-group-title"));
  }
  row.innerHTML = `<b>${svgIcon("clock", 14)} Disappearing messages</b>
    <span>${canEdit ? "New messages vanish for everyone after the time you pick." : "Only group admins can change this."}</span>
    <div class="vanish-options">${VANISH.map(([v, l]) => `<button type="button" data-v="${v ?? ""}" class="${(convo.disappear_seconds ?? null) === v ? "on" : ""}" ${canEdit ? "" : "disabled"}>${l}</button>`).join("")}</div>`;
  row.querySelectorAll("button").forEach((b) => b.addEventListener("click", async () => {
    const v = b.dataset.v ? Number(b.dataset.v) : null;
    if ((convo.disappear_seconds ?? null) === v) return;
    const { error } = await sb.rpc("set_disappearing", { p_conversation: convo.id, p_seconds: v });
    if (error) { toast(friendlyError(error, "Could not change the timer.")); return; }
    convo.disappear_seconds = v;
    renderVanishRow();
    paintVanishChip();
    toast(v ? `New messages will vanish after ${vanishLabel(v)}` : "Disappearing messages off");
  }));
}

// Same header as last time, painted before any request goes out.
function earlyHeader() {
  const hc = store.get(headerKey());
  const title = document.getElementById("roomTitle");
  if (!hc) { title.textContent = ""; return; }
  applyChatTheme(hc.theme);   // no flash of the default colours
  title.textContent = hc.title || "";
  document.getElementById("roomSubtitle").textContent = hc.sub || "";
  const av = document.getElementById("roomAvatar");
  try {
    if (hc.kind === "dm") setAvatarContent(av, hc.other);
    else setGroupAvatar(av, hc.convo);
  } catch {}
  if (hc.kind === "dm") {
    document.getElementById("callAudioBtn").style.display = "flex";
    document.getElementById("callVideoBtn").style.display = "flex";
    if (hc.streak) paintStreak(hc.streak);
  }
  document.title = `${title.textContent || "Chat"} — 𝓉𝑒𝒶𝑜𝒻𝓇𝓅𝓂`;
}

function paintStreak(s) {
  document.querySelector(".room-title .x3-streak")?.remove();
  if (!s || s.streak < 2) return;
  const b = document.createElement("span");
  b.className = `x3-streak${s.alive_today ? "" : " at-risk"}`;
  b.title = s.alive_today ? `${s.streak}-day streak` : `${s.streak}-day streak — message today or it resets`;
  b.innerHTML = `${svgIcon("flame", 12)}${s.streak}${s.alive_today ? "" : svgIcon("hourglass", 11)}`;
  document.getElementById("roomTitle").after(b);
}

function renderPresence() {
  const sub = document.getElementById("roomSubtitle");
  if (!sub || !convo) return;
  const online = new Set(Object.keys(channel?.presenceState() || {}));
  online.delete(ME.id);
  if (typingUsers.size) return;    // the typing line takes the subtitle while active
  if (convo.kind === "bot") { sub.textContent = "Always online · normal Hinglish me baat karo"; sub.classList.add("is-online"); return; }

  if (convo.kind === "dm") {
    const other = members.find((m) => m.user_id !== ME.id);
    const isOnline = other && (online.has(other.user_id) || Presence.online.has(other.user_id));
    sub.textContent = isOnline ? "Online" : (otherUser ? `@${otherUser.username}` : "");
    sub.classList.toggle("is-online", !!isOnline);
    return;
  }
  const n = members.length;
  const here = isPublic ? online.size : members.filter((m) => m.user_id !== ME.id && online.has(m.user_id)).length;
  sub.textContent = here ? `${n} members · ${here} here now` : `${n} member${n === 1 ? "" : "s"}`;
  sub.classList.toggle("is-online", here > 0);
}

async function loadStreak() {
  if (convo.kind !== "dm") return;
  const { data } = await sb.rpc("my_streaks");
  if (!data) return;                      // request failed: keep what's shown
  const s = data.find((x) => x.conversation_id === convo.id);
  const streak = s && s.streak >= 2 ? { streak: s.streak, alive_today: s.alive_today } : null;
  paintStreak(streak);
  const hc = store.get(headerKey());
  if (hc) { hc.streak = streak; store.set(headerKey(), hc); }
}

function wireTypingBroadcast(input) {
  input.addEventListener("input", () => {
    if (!input.value.trim()) { sendTypingState(false); return; }
    sendTypingState(true);
    clearTimeout(typingClearTimer);
    typingClearTimer = setTimeout(() => sendTypingState(false), 2500);
  });
}

function sendTypingState(typing) {
  if (typing === isTypingBroadcasted || !channel) return;
  isTypingBroadcasted = typing;
  channel.send({ type: "broadcast", event: "typing", payload: { user_id: ME.id, display_name: ME.display_name, typing } });
}

function handleTypingBroadcast(p) {
  if (!p || p.user_id === ME.id) return;
  if (!p.typing) { clearTypingUser(p.user_id); return; }
  const existing = typingUsers.get(p.user_id);
  if (existing) clearTimeout(existing.timeoutId);
  const timeoutId = setTimeout(() => clearTypingUser(p.user_id), 4500);
  typingUsers.set(p.user_id, { display_name: p.display_name, timeoutId });
  renderTypingIndicator();
}

function clearTypingUser(userId) {
  const existing = typingUsers.get(userId);
  if (!existing) return;
  clearTimeout(existing.timeoutId);
  typingUsers.delete(userId);
  renderTypingIndicator();
}

function renderTypingIndicator() {
  const el = document.getElementById("typingIndicator");
  const names = [...typingUsers.values()].map((t) => (t.display_name || "Someone").split(" ")[0]);
  if (!names.length) { el.textContent = ""; el.classList.remove("show"); renderPresence(); return; }
  const text = names.length === 1 ? `${names[0]} is typing…`
    : names.length === 2 ? `${names[0]} and ${names[1]} are typing…`
    : `${names.slice(0, 2).join(", ")} and ${names.length - 2} others are typing…`;
  el.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span> ${escapeHTML(text)}`;
  el.classList.add("show");
  if (convo.kind === "dm") {
    const sub = document.getElementById("roomSubtitle");
    sub.textContent = "typing…";
    sub.classList.add("is-online");
  }
}

/* ============================================================
   Taps, swipes and the action bar — one owner for every gesture
   ============================================================ */

function wireMessageEvents() {
  const el = box();
  const DOUBLE_MS = 280;
  let pending = null, lastRow = null, lastAt = 0;
  const closeAll = () => el.querySelectorAll(".show-actions").forEach((r) => r.classList.remove("show-actions"));

  el.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-msg-id]");
    const t = e.target;

    if (t.closest(".call-log-chip")) {
      if (convo.kind === "dm" && otherUser) CallManager.start(convo.id, otherUser, t.closest(".call-log-chip").dataset.video === "1" ? "video" : "audio");
      return;
    }
    if (!row) { closeAll(); return; }
    const id = row.dataset.msgId;
    const m = messageCache.get(id);

    if (selecting) {
      e.preventDefault();
      if (row.classList.contains("own") && !row.classList.contains("sending")) toggleSelect(row);
      return;
    }
    if (t.closest(".msg-failed")) { retrySend(id); return; }
    if (t.closest(".react-btn")) { openEmojiPicker(row.querySelector(".bubble"), id); return; }
    if (t.closest(".reply-btn")) { startReply(m); closeAll(); return; }
    if (t.closest(".copy-btn")) { copyText(m.content); closeAll(); return; }
    if (t.closest(".edit-btn")) { startEditMessage(m, row.querySelector(".bubble")); closeAll(); return; }
    if (t.closest(".delete-btn")) { deleteMessage(id); return; }
    if (t.closest(".more-msg-btn")) { e.stopPropagation(); openMoreMenu(row, t.closest(".more-msg-btn")); return; }
    const chip = t.closest(".reaction-chip");
    if (chip) { toggleReaction(id, chip.dataset.emoji); return; }
    if (t.closest(".reply-preview")) { jumpToMessage(t.closest(".reply-preview").dataset.jump); return; }
    if (t.closest(".extras-readmore")) {
      const txt = row.querySelector(".msg-text");
      const open = txt.classList.toggle("extras-clamped");
      t.closest(".extras-readmore").textContent = open ? "Read more" : "Show less";
      return;
    }
    if (t.matches("img.chat-img, img.sticker-img")) { openMediaViewer(t.src); return; }
    const pollOpt = t.closest(".x3-poll-opt");
    if (pollOpt) { votePoll(pollOpt); return; }
    if (t.closest(".x3-poll-close")) { closePoll(t.closest(".x3-poll").dataset.poll); return; }
    const link = t.closest(".msg-text a[href^='http']");
    if (link) {
      let host; try { host = new URL(link.href).hostname; } catch { return; }
      if (host !== location.hostname && !confirm(`Open ${host}?\n\nThis link was posted by another user.`)) e.preventDefault();
      return;
    }
    if (t.closest("a, button, audio, video, textarea, input, label, .emoji-picker, .x3-poll, .x3-cd")) return;
    if (!t.closest(".bubble") || !row.classList.contains("msg-row") || row.classList.contains("sending")) return;
    if (Date.now() - swipedAt < 450) return;

    // single tap → this message's actions; double tap → ❤️
    const now = Date.now();
    if (row === lastRow && now - lastAt < DOUBLE_MS) {
      clearTimeout(pending); pending = null; lastRow = null;
      heartReact(row);
      return;
    }
    lastRow = row; lastAt = now;
    clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      const wasOpen = row.classList.contains("show-actions");
      closeAll();
      if (!wasOpen) row.classList.add("show-actions");
    }, DOUBLE_MS);
  });

  document.addEventListener("click", (e) => { if (!e.target.closest("#messages, .x2-more")) closeAll(); });

  // swipe right → reply; long-press your own message → select mode
  let sx = 0, sy = 0, srow = null, dragging = false, swipedAt = 0, pressTimer = null;
  el.addEventListener("touchstart", (e) => {
    const r = e.target.closest(".msg-row[data-msg-id]");
    if (!r || r.classList.contains("sending")) return;
    srow = r; dragging = false;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    if (r.classList.contains("own") && !selecting) {
      pressTimer = setTimeout(() => { srow = null; startSelecting(r); }, 520);
    }
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    clearTimeout(pressTimer);
    if (!srow || selecting) return;
    const dx = e.touches[0].clientX - sx, dy = Math.abs(e.touches[0].clientY - sy);
    if (dy > 24 || dx < 0) { resetSwipe(); return; }
    if (dx > 10) {
      dragging = true;
      srow.style.transform = `translateX(${Math.min(dx, 70)}px)`;
      srow.classList.toggle("extras-swipe-armed", dx > 55);
    }
  }, { passive: true });
  el.addEventListener("touchend", () => {
    clearTimeout(pressTimer);
    if (srow && dragging) {
      swipedAt = Date.now();
      if (srow.classList.contains("extras-swipe-armed")) { startReply(messageCache.get(srow.dataset.msgId)); buzz(12); }
    }
    resetSwipe();
  });
  el.addEventListener("touchcancel", () => { clearTimeout(pressTimer); resetSwipe(); });
  function resetSwipe() {
    if (srow) { srow.style.transform = ""; srow.classList.remove("extras-swipe-armed"); }
    srow = null; dragging = false;
  }

  // long-press the header → jump to the newest message
  const header = document.querySelector(".chat-header");
  let ht;
  header.addEventListener("touchstart", (e) => {
    if (e.target.closest("button, a, input")) return;
    ht = setTimeout(() => { scrollToBottom(true); toast("Jumped to the latest"); }, 550);
  }, { passive: true });
  ["touchend", "touchmove", "touchcancel"].forEach((ev) => header.addEventListener(ev, () => clearTimeout(ht), { passive: true }));

  wireSelectBar();
}

/* ---------- reactions ---------- */

function renderReactions(container, messageId) {
  const rows = reactionsByMsg.get(messageId) || [];
  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.emoji)) grouped.set(r.emoji, []);
    grouped.get(r.emoji).push(r);
  }
  container.innerHTML = [...grouped.entries()].map(([emoji, list]) => {
    const mine = list.some((r) => r.user_id === ME.id);
    const names = list.map((r) => r.user_id === ME.id ? "You" : (profileCache.get(r.user_id)?.display_name || "Someone")).join(", ");
    return `<button type="button" class="reaction-chip ${mine ? "mine" : ""}" data-emoji="${escapeHTML(emoji)}" title="${escapeHTML(names)}">${escapeHTML(emoji)} ${list.length}</button>`;
  }).join("");
}

function repaintReactions(id) {
  const row = rendered.get(id);
  const c = row?.querySelector(".reactions-row");
  if (c) renderReactions(c, id);
}

// Flips on screen first, then tells the database.
async function toggleReaction(messageId, emoji) {
  const list = reactionsByMsg.get(messageId) || [];
  reactionsByMsg.set(messageId, list);
  const mineIdx = list.findIndex((r) => r.user_id === ME.id && r.emoji === emoji);
  if (mineIdx >= 0) {
    const [removed] = list.splice(mineIdx, 1);
    repaintReactions(messageId);
    const { error } = await sb.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", ME.id).eq("emoji", emoji);
    if (error) { list.push(removed); repaintReactions(messageId); toast("Could not update."); }
    return;
  }
  const temp = { id: `tmp-${Math.random()}`, message_id: messageId, user_id: ME.id, emoji };
  list.push(temp);
  repaintReactions(messageId);
  const { data, error } = await sb.from("message_reactions").insert({ message_id: messageId, user_id: ME.id, emoji }).select().single();
  const i = list.indexOf(temp);
  if (error) { if (i >= 0) list.splice(i, 1); repaintReactions(messageId); toast("Could not react."); return; }
  if (reactionMsg.has(data.id)) { if (i >= 0) list.splice(i, 1); }      // realtime got here first
  else if (i >= 0) { list[i] = data; reactionMsg.set(data.id, messageId); }
  repaintReactions(messageId);
}

function onReactionChange({ eventType, new: n, old: o }) {
  if (eventType === "INSERT" && n) {
    if (!rendered.has(n.message_id) || reactionMsg.has(n.id)) return;
    const list = reactionsByMsg.get(n.message_id) || [];
    // our own optimistic copy may still be waiting for its id
    const t = list.findIndex((r) => String(r.id).startsWith("tmp-") && r.user_id === n.user_id && r.emoji === n.emoji);
    if (t >= 0) list[t] = n; else list.push(n);
    reactionsByMsg.set(n.message_id, list);
    reactionMsg.set(n.id, n.message_id);
    repaintReactions(n.message_id);
  } else if (eventType === "DELETE" && o) {
    const msgId = o.message_id || reactionMsg.get(o.id);
    if (!msgId) return;
    reactionMsg.delete(o.id);
    const list = reactionsByMsg.get(msgId) || [];
    const i = list.findIndex((r) => r.id === o.id);
    if (i >= 0) { list.splice(i, 1); repaintReactions(msgId); }
  }
}

function heartReact(row) {
  const id = row.dataset.msgId;
  const bubble = row.querySelector(".bubble");
  const burst = document.createElement("span");
  burst.className = "x2-heart";
  burst.textContent = "❤️";
  bubble.appendChild(burst);
  setTimeout(() => burst.remove(), 750);
  buzz(12);
  const already = (reactionsByMsg.get(id) || []).some((r) => r.user_id === ME.id && r.emoji === "❤️");
  if (!already) toggleReaction(id, "❤️");
}

function openEmojiPicker(bubble, messageId) {
  document.querySelectorAll(".emoji-picker").forEach((e) => e.remove());
  const quick = ["❤️", "😂", "👍", "😮", "😢", "🙏", "🔥", "🎉", "😍", "😡", "👏", "💯"];
  const picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.innerHTML = quick.map((e) => `<span role="button" tabindex="0">${e}</span>`).join("");
  bubble.appendChild(picker);
  picker.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = e.target.closest("span");
    if (!s) return;
    picker.remove();
    const mine = (reactionsByMsg.get(messageId) || []).some((r) => r.user_id === ME.id && r.emoji === s.textContent);
    if (!mine) toggleReaction(messageId, s.textContent);
  });
  setTimeout(() => {
    document.addEventListener("click", function closeOnce(ev) {
      if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener("click", closeOnce); }
    });
  }, 10);
}

/* ---------- the ⋯ menu ---------- */

let moreMenu = null;
function closeMoreMenu() {
  if (!moreMenu) return;
  const m = moreMenu; moreMenu = null;
  m.classList.remove("show");
  setTimeout(() => m.remove(), 160);
}
document.addEventListener("click", (e) => { if (moreMenu && !moreMenu.contains(e.target)) closeMoreMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMoreMenu(); });

function openMoreMenu(row, anchor) {
  const id = row.dataset.msgId;
  const wasHere = moreMenu && moreMenu.dataset.for === id;
  closeMoreMenu();
  if (wasHere) return;
  const m = messageCache.get(id);
  const own = row.classList.contains("own");
  const saved = starredIds.has(id);
  const pinned = convo.pinned_message_id === id;
  const items = [
    ["star", saved ? "Unsave" : "Save", () => toggleStar(id), saved ? "is-on" : ""],
    ["pin", pinned ? "Unpin" : "Pin", () => setPinned(pinned ? null : id)],
    ["forward", "Forward", () => forwardMessage(m)],
    ["link", "Copy link", () => copyText(`${location.origin}${location.pathname}?c=${convo.id}#m=${id}`, "Link copied")],
    ...(own && !isPublic && convo.kind !== "bot" ? [["eye", "Info", () => openMessageInfo(m)]] : []),
    ...(own ? [["select", "Select", () => startSelecting(row)]] : []),
    ...(own ? [] : [["flag", "Report", () => reportSheet("message", id), "is-danger"]]),
  ];
  const menu = document.createElement("div");
  menu.className = "x2-more";
  menu.dataset.for = id;
  menu.innerHTML = items.map(([icon, label, , cls], i) => `
    <button type="button" class="x2-more-item x2-ic-${icon} ${cls || ""}" data-i="${i}" style="--i:${i}">${svgIcon(icon, 17)}<span>${label}</span></button>`).join("")
    + `<div class="x2-more-time">${escapeHTML(new Date(m.created_at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}</div>`;
  document.body.appendChild(menu);

  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth || 180, h = menu.offsetHeight || 240;
  const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
  const below = r.bottom + 6 + h < window.innerHeight - 8;
  menu.style.left = `${left}px`;
  menu.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
  menu.style.transformOrigin = below ? "top right" : "bottom right";
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    e.stopPropagation();
    closeMoreMenu();
    row.classList.remove("show-actions");
    items[Number(b.dataset.i)][2]();
  });
  moreMenu = menu;
  void menu.offsetWidth;            // start the open animation now, without waiting for a frame
  menu.classList.add("show");
}

async function toggleStar(id) {
  const was = starredIds.has(id);
  if (was) starredIds.delete(id); else starredIds.add(id);
  rendered.get(id)?.classList.toggle("starred", !was);
  const { error } = was
    ? await sb.from("message_stars").delete().eq("message_id", id).eq("user_id", ME.id)
    : await sb.from("message_stars").insert({ message_id: id, user_id: ME.id });
  if (error) {
    if (was) starredIds.add(id); else starredIds.delete(id);
    rendered.get(id)?.classList.toggle("starred", was);
    toast("Could not update.");
  } else toast(was ? "Removed from saved" : "Saved — find it in Messages → ★");
}

/* ---------- pinned message ---------- */

async function setPinned(messageId) {
  const { error } = await sb.rpc("set_pinned_message", { p_conversation: convo.id, p_message: messageId });
  if (error) { toast(friendlyError(error, "Could not pin.")); return; }
  convo.pinned_message_id = messageId;
  toast(messageId ? "Pinned" : "Unpinned");
  renderPinnedBanner();
}

async function renderPinnedBanner() {
  document.querySelector(".extras2-pin-banner")?.remove();
  const id = convo.pinned_message_id;
  if (!id) return;
  const m = await findMessageById(id);
  if (!m || m.deleted || convo.pinned_message_id !== id) return;
  const author = await getProfile(m.user_id);
  document.querySelector(".extras2-pin-banner")?.remove();
  const banner = document.createElement("div");
  banner.className = "extras2-pin-banner";
  banner.innerHTML = `
    <span class="pin-icon">${svgIcon("pin", 15)}</span>
    <button type="button" class="pin-text"><b>${escapeHTML(author?.display_name || "Someone")}</b>: ${escapeHTML(previewText(m).slice(0, 80))}</button>
    <button type="button" class="pin-clear x2-ic-close" title="Unpin">${svgIcon("close", 14)}</button>`;
  banner.querySelector(".pin-text").addEventListener("click", () => jumpToMessage(id));
  banner.querySelector(".pin-clear").addEventListener("click", () => setPinned(null));
  document.querySelector(".chat-header").after(banner);
}

/* ---------- forward ---------- */

async function forwardMessage(m) {
  const s = makeSheet({ title: "Forward to…", html: `<div class="settings-list"><div class="settings-empty">Loading your chats…</div></div>` });
  s.onClose = () => setTimeout(() => s.el.remove(), 300);
  s.open();
  const { data, error } = await sb.rpc("my_conversations");
  const list = s.body.querySelector(".settings-list");
  if (error) { list.innerHTML = `<div class="settings-empty">Could not load your chats.</div>`; return; }
  const chats = [{ id: PUBLIC_ROOM_ID, kind: "group", name: "RPM Public Room" }, ...(data || [])];
  await getProfiles(chats.map((c) => c.other_user_id));
  list.innerHTML = "";
  for (const c of chats) {
    const other = c.other_user_id ? profileCache.get(c.other_user_id) : null;
    const label = c.kind === "dm" ? (other?.display_name || "Chat") : (c.name || "Group");
    const row = document.createElement("button");
    row.type = "button";
    row.className = "settings-list-row";
    row.innerHTML = `<span class="avatar"></span><div class="settings-list-name">${escapeHTML(label)}${c.id === convo.id ? ' <span class="settings-list-sub" style="display:inline">(this chat)</span>' : ""}</div><span class="send-to-btn">Send</span>`;
    if (c.kind === "dm") setAvatarContent(row.querySelector(".avatar"), other); else setGroupAvatar(row.querySelector(".avatar"), c);
    row.addEventListener("click", async () => {
      row.disabled = true;
      const { error: e } = await sb.from("messages").insert({
        user_id: ME.id, conversation_id: c.id,
        content: m.content, image_url: m.image_url, sticker_url: m.sticker_url, audio_url: m.audio_url, shared_post_id: m.shared_post_id,
      });
      if (e) { row.disabled = false; toast(friendlyError(e, "Could not forward.")); return; }
      row.querySelector(".send-to-btn").textContent = "Sent";
      buzz(10);
    });
    list.appendChild(row);
  }
}

/* ---------- select several of your messages ---------- */

function wireSelectBar() {
  const bar = document.createElement("div");
  bar.className = "extras2-selectbar";
  bar.innerHTML = `<span id="extras2-selcount">0 selected</span><button type="button" id="extras2-seldelete">Delete</button><button type="button" id="extras2-selcancel">Cancel</button>`;
  document.body.appendChild(bar);
  bar.querySelector("#extras2-selcancel").addEventListener("click", stopSelecting);
  bar.querySelector("#extras2-seldelete").addEventListener("click", async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} message${selected.size === 1 ? "" : "s"}? This can't be undone.`)) return;
    const ids = [...selected];
    const { error } = await sb.from("messages").update({ deleted: true }).in("id", ids).eq("user_id", ME.id);
    if (error) { toast(friendlyError(error, "Some messages could not be deleted.")); return; }
    ids.forEach(removeRow);
    stopSelecting();
    toast("Deleted");
  });
}

function startSelecting(row) {
  if (selecting) return;
  selecting = true;
  buzz(15);
  document.body.classList.add("extras2-selecting");
  document.querySelector(".extras2-selectbar").classList.add("show");
  box().querySelectorAll(".show-actions").forEach((r) => r.classList.remove("show-actions"));
  toggleSelect(row);
}
function toggleSelect(row) {
  const id = row.dataset.msgId;
  if (selected.has(id)) { selected.delete(id); row.classList.remove("extras2-selected"); }
  else { selected.add(id); row.classList.add("extras2-selected"); }
  document.getElementById("extras2-selcount").textContent = `${selected.size} selected`;
}
function stopSelecting() {
  selecting = false;
  selected.clear();
  document.body.classList.remove("extras2-selecting");
  document.querySelectorAll(".extras2-selected").forEach((r) => r.classList.remove("extras2-selected"));
  document.querySelector(".extras2-selectbar").classList.remove("show");
}

/* ---------- edit / delete ---------- */

async function deleteMessage(id) {
  if (!confirm("Delete this message?")) return;
  const { error } = await sb.from("messages").update({ deleted: true }).eq("id", id).eq("user_id", ME.id);
  if (error) { toast(friendlyError(error, "Could not delete.")); return; }
  removeRow(id);
}

function startEditMessage(m, bubble) {
  const textEl = bubble.querySelector(".msg-text");
  if (!textEl || bubble.querySelector(".edit-box")) return;
  const editBox = document.createElement("textarea");
  editBox.className = "edit-box";
  editBox.rows = 2;
  editBox.value = m.content || "";
  textEl.replaceWith(editBox);
  editBox.focus();
  editBox.setSelectionRange(editBox.value.length, editBox.value.length);

  const bar = document.createElement("div");
  bar.className = "edit-actions";
  bar.innerHTML = `<button type="button" class="edit-cancel">Cancel</button><button type="button" class="edit-save">Save</button>`;
  editBox.after(bar);

  const restore = () => {
    const t = document.createElement("div");
    t.className = "msg-text";
    t.innerHTML = formatChat(linkifyMentions(escapeHTML(m.content))) + (m.edited_at ? ` <span class="edited-tag">(edited)</span>` : "");
    editBox.replaceWith(t);
    bar.remove();
  };
  const save = async () => {
    const newText = editBox.value.trim();
    if (!newText) { toast("Message can't be empty."); return; }
    if (newText === m.content) { restore(); return; }
    const editedAt = new Date().toISOString();
    const { error } = await sb.from("messages").update({ content: newText, edited_at: editedAt }).eq("id", m.id).eq("user_id", ME.id);
    if (error) { toast(friendlyError(error, "Could not edit.")); return; }
    m.content = newText;
    m.edited_at = editedAt;
    restore();
  };
  bar.querySelector(".edit-cancel").addEventListener("click", (e) => { e.stopPropagation(); restore(); });
  bar.querySelector(".edit-save").addEventListener("click", (e) => { e.stopPropagation(); save(); });
  editBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === "Escape") { e.stopPropagation(); restore(); }
  });
}

/* ============================================================
   Polls and countdowns
   ============================================================ */

const pollsById = new Map();
const CD_RE = /^\/countdown\s+(.+?)\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?\s*$/i;
const pad2 = (n) => String(n).padStart(2, "0");

async function mountPolls(retry = false) {
  const txts = [...box().querySelectorAll('.msg-text[data-poll="pending"]')];
  if (!txts.length) return;
  const byMsg = new Map(txts.map((t) => [t.closest("[data-msg-id]").dataset.msgId, t]));
  txts.forEach((t) => { t.dataset.poll = "loading"; });
  const { data } = await sb.from("polls").select("*").in("message_id", [...byMsg.keys()]);
  const found = [];
  for (const [msgId, txt] of byMsg) {
    const p = (data || []).find((x) => x.message_id === msgId);
    if (!p) {
      // the poll row is made by a trigger a moment after the message — try once more
      txt.dataset.poll = retry ? "none" : "pending";
      continue;
    }
    pollsById.set(p.id, p);
    txt.dataset.poll = p.id;
    txt.innerHTML = `
      <div class="x3-poll" data-poll="${p.id}">
        <div class="x3-poll-q"><span class="x3-inline-ic">${svgIcon("poll", 15)}</span>${escapeHTML(p.question)}</div>
        <div class="x3-poll-opts">${p.options.map((o, i) => `
          <button type="button" class="x3-poll-opt" data-i="${i}"><span class="x3-poll-bar"></span><span class="x3-poll-label">${escapeHTML(o)}</span><span class="x3-poll-count"></span></button>`).join("")}
        </div>
        <div class="x3-poll-foot"><span class="x3-poll-total">No votes yet</span>${p.created_by === ME.id ? `<button type="button" class="x3-poll-close">Close poll</button>` : ""}</div>
      </div>`;
    found.push(p.id);
  }
  if (found.length) refreshPollResults(found);
  if (!retry && byMsg.size > found.length) setTimeout(() => mountPolls(true), 1500);
}

async function refreshPollResults(ids) {
  const { data, error } = await sb.rpc("poll_results", { p_polls: ids });
  if (error) return;
  for (const id of ids) {
    const card = box().querySelector(`.x3-poll[data-poll="${id}"]`);
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

async function votePoll(btn) {
  const card = btn.closest(".x3-poll");
  const id = card?.dataset.poll;
  if (!id || card.classList.contains("closed") || card.classList.contains("busy")) return;
  card.classList.add("busy");
  const { error } = await sb.rpc("vote_poll", { p_poll: id, p_option: Number(btn.dataset.i) });
  card.classList.remove("busy");
  if (error) { toast(friendlyError(error)); return; }
  buzz(10);
  refreshPollResults([id]);
}

async function closePoll(id) {
  if (!id || !confirm("Close this poll? No one will be able to vote after this.")) return;
  const { error } = await sb.rpc("close_poll", { p_poll: id });
  if (error) { toast(friendlyError(error)); return; }
  pollsById.set(id, { ...pollsById.get(id), closed: true });
  refreshPollResults([id]);
}

function countdownCard([, title, date, hh, mm]) {
  const target = new Date(`${date}T${pad2(hh || 0)}:${mm || "00"}:00`);
  if (isNaN(target)) return escapeHTML(title);
  return `<div class="x3-cd" data-target="${target.getTime()}">
    <div class="x3-cd-title"><span class="x3-inline-ic">${svgIcon("hourglass", 15)}</span>${escapeHTML(title)}</div>
    <div class="x3-cd-time"></div>
    <div class="x3-cd-date">${escapeHTML(target.toLocaleString([], { weekday: "short", day: "numeric", month: "short", year: "numeric", ...(hh ? { hour: "numeric", minute: "2-digit" } : {}) }))}</div>
  </div>`;
}

// One timer for every countdown on screen, and only while there is one.
let cdTimer = null;
function startCountdownTicker() {
  if (cdTimer) return;
  cdTimer = setInterval(tickCountdowns, 1000);
  requestAnimationFrame(tickCountdowns);
}
function tickCountdowns() {
  if (document.hidden) return;
  const cards = box().querySelectorAll(".x3-cd:not(.done)");
  if (!cards.length) { clearInterval(cdTimer); cdTimer = null; return; }
  const now = Date.now();
  cards.forEach((card) => {
    const diff = Number(card.dataset.target) - now;
    const out = card.querySelector(".x3-cd-time");
    if (diff <= 0) { card.classList.add("done"); out.textContent = "It's here! 🎉"; return; }
    const d = Math.floor(diff / 864e5), h = Math.floor((diff % 864e5) / 36e5), m = Math.floor((diff % 36e5) / 6e4), s = Math.floor((diff % 6e4) / 1000);
    const html = `${d ? `<b>${d}</b><small>days</small>` : ""}<b>${pad2(h)}</b><small>hrs</small><b>${pad2(m)}</b><small>min</small><b>${pad2(s)}</b><small>sec</small>`;
    if (out._last !== html) { out.innerHTML = html; out._last = html; }
  });
}

/* ---------- message effects (live messages only) ---------- */

const CONFETTI_RE = /(happy\s*birthday|\bhbd\b|congrat|badhai|mubarak|🎉|🥳|happy\s*new\s*year|happy\s*diwali)/i;
const HEARTS_RE = /(love\s*(you|u)\b|\bluv\s*u\b|❤️|💖|😍|🥰)/i;
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function messageEffect(m) {
  if (reduceMotion || !m.content || document.hidden) return;
  if (CONFETTI_RE.test(m.content)) confetti();
  else if (HEARTS_RE.test(m.content)) hearts();
}

function confetti() {
  if (document.querySelector(".x3-fx")) return;
  const c = document.createElement("canvas");
  c.className = "x3-fx";
  document.body.appendChild(c);
  const ctx = c.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ["#f5b700", "#ff4d6d", "#4cc9f0", "#80ed99", "#c77dff", "#ff9f1c"];
  const bits = Array.from({ length: 120 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80, y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 13 - 4,
    r: Math.random() * 6 + 3, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    color: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  (function frame(t) {
    const age = t - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - age / 2800);
    for (const b of bits) {
      b.vy += 0.32; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.rot += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
      ctx.fillStyle = b.color; ctx.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2);
      ctx.restore();
    }
    if (age < 2800) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

function hearts() {
  for (let i = 0; i < 14; i++) {
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
   Composer
   ============================================================ */

function refreshSendState() {
  const input = document.getElementById("msgInput");
  const send = document.getElementById("sendBtn");
  const has = input.value.trim().length > 0;
  send.disabled = !(has || pendingImageFile || pendingVideoFile || pendingAudioBlob);
  const row = document.querySelector(".composer-row");
  row.classList.toggle("has-text", has);
  row.classList.toggle("can-send", !send.disabled);
}

function autoGrow(input) {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
}

function wireComposer() {
  const input = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");
  document.querySelector(".composer-row").classList.add("x-pill");

  input.addEventListener("input", () => { autoGrow(input); refreshSendState(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!sendBtn.disabled) sendMessage();
    }
    if (e.key === "ArrowUp" && !input.value) {
      // ↑ in an empty box edits your last message, like desktop chat apps
      const row = lastRealOwnRow();
      const m = row && messageCache.get(row.dataset.msgId);
      if (m?.content) { e.preventDefault(); startEditMessage(m, row.querySelector(".bubble")); }
    }
  });
  input.addEventListener("paste", async (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) await handlePickedImage(file, "Pasted photo");
  });
  sendBtn.addEventListener("click", () => sendMessage());

  document.getElementById("imageInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) await handlePickedImage(file, file.name);
  });
  document.getElementById("removeAttach").addEventListener("click", () => { clearPendingImage(); refreshSendState(); });
  document.getElementById("viewOnceBtn")?.addEventListener("click", () => {
    pendingViewOnce = !pendingViewOnce;
    paintAttachOpts();
    if (pendingViewOnce) toast("View once: they can open it just one time", 1800);
  });
  document.getElementById("editAttach")?.addEventListener("click", () => {
    const orig = pendingOriginal, vo = pendingViewOnce;
    if (orig) handlePickedImage(orig, orig.name || "Photo", { viewOnce: vo });
  });
  document.getElementById("removeAudioAttach").addEventListener("click", () => { clearPendingAudio(); refreshSendState(); });
  document.getElementById("voiceBtn").addEventListener("click", toggleVoiceRecording);
  document.getElementById("cancelReply").addEventListener("click", clearReply);
  document.getElementById("stickerToggle").addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("stickerPanel").classList.toggle("show");
  });
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("stickerPanel");
    if (panel.classList.contains("show") && !panel.contains(e.target) && !e.target.closest("#stickerToggle")) panel.classList.remove("show");
  });

  // drag & drop a photo onto the chat (desktop)
  const main = document.querySelector(".chat-main");
  main.addEventListener("dragover", (e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) { e.preventDefault(); main.classList.add("drop-hover"); } });
  main.addEventListener("dragleave", (e) => { if (!main.contains(e.relatedTarget)) main.classList.remove("drop-hover"); });
  main.addEventListener("drop", (e) => {
    main.classList.remove("drop-hover");
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
    if (f) { e.preventDefault(); handlePickedImage(f, f.name); }
  });

  wireTypingBroadcast(input);
  wireDraft(input);
  wireCharCounter(input);
  wireAutocomplete(input);
  plusMenu(input);
  refreshSendState();
}

function wireDraft(input) {
  const key = "teaofrpm_draft_" + convoIdParam;
  const saved = store.raw(key);
  if (saved && !input.value) { input.value = saved; autoGrow(input); }
  input.addEventListener("input", debounce(() => {
    if (input.value.trim()) store.setRaw(key, input.value); else store.remove(key);
  }, 400));
}

function wireCharCounter(input) {
  const c = document.createElement("div");
  c.className = "extras-charcount";
  document.querySelector(".composer").appendChild(c);
  input.addEventListener("input", () => {
    const n = input.value.length;
    c.textContent = n > 300 ? `${n} / 2000` : "";
    c.classList.toggle("show", n > 300);
  });
  input.maxLength = 2000;
}

/* ---------- / commands and @mentions ---------- */

const SLASH_CMDS = [
  ["/help", "show every command"], ["/poll Question | A | B", "start a poll"],
  ["/countdown Exams 2026-10-15", "live countdown card"], ["/top", "most active people this week"],
  ["/rules", "show the rules"], ["/warns @user", "how many warnings someone has"],
  ["/info @user", "their standing here"], ["/admins", "who the admins are"],
  ["/setrules ", "admin — set the rules"], ["/welcome ", "admin — set the welcome text"],
  ["/warn @user ", "admin — warn someone"], ["/resetwarns @user", "admin — clear warnings"],
  ["/mute @user 10m", "admin — mute for a while"], ["/unmute @user", "admin — let them talk"],
  ["/kick @user", "admin — remove from group"], ["/antilink on", "admin — block links"],
  ["/slowmode 30", "admin — gap between messages"],
];

function wireAutocomplete(input) {
  const composer = input.closest(".composer");
  if (getComputedStyle(composer).position === "static") composer.style.position = "relative";
  const pop = document.createElement("div");
  pop.className = "extras-cmdbox";
  pop.setAttribute("role", "listbox");
  composer.appendChild(pop);
  let items = [], active = 0, mode = null;

  const hide = () => { pop.classList.remove("show"); items = []; mode = null; };
  const paint = () => {
    pop.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" class="${i === active ? "active" : ""}"><b>${escapeHTML(it.title)}</b><span>${escapeHTML(it.sub)}</span></button>`).join("");
    pop.classList.toggle("show", items.length > 0);
  };
  const choose = (i) => {
    const it = items[i];
    if (!it) return;
    if (mode === "cmd") input.value = it.title.split(" ")[0] + " ";
    else {
      const pos = input.selectionStart;
      const before = input.value.slice(0, pos).replace(/@([a-zA-Z0-9_.]*)$/, `@${it.username} `);
      input.value = before + input.value.slice(pos);
      input.setSelectionRange(before.length, before.length);
    }
    hide();
    input.focus();
    refreshSendState();
  };

  input.addEventListener("input", async () => {
    const v = input.value;
    if (v.startsWith("/") && !v.includes(" ") && !v.includes("\n")) {
      const q = v.slice(1).toLowerCase();
      items = SLASH_CMDS.filter(([c]) => c.slice(1).toLowerCase().startsWith(q)).slice(0, 6).map(([title, sub]) => ({ title, sub }));
      mode = "cmd"; active = 0; paint();
      return;
    }
    const upto = v.slice(0, input.selectionStart);
    const m = upto.match(/(?:^|\s)@([a-zA-Z0-9_.]*)$/);
    if (!m) { hide(); return; }
    const people = await loadAllPeople();
    const q = m[1].toLowerCase();
    const memberIds = new Set(members.map((x) => x.user_id));
    items = people
      .filter((p) => p.id !== ME.id && (p.username.startsWith(q) || (p.display_name || "").toLowerCase().startsWith(q)))
      .sort((a, b) => (memberIds.has(b.id) - memberIds.has(a.id)))
      .slice(0, 6)
      .map((p) => ({ title: "@" + p.username, sub: p.display_name, username: p.username }));
    mode = "mention"; active = 0; paint();
  });
  input.addEventListener("keydown", (e) => {
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
    else if (e.key === "Tab" || (e.key === "Enter" && mode === "mention")) { e.preventDefault(); e.stopImmediatePropagation(); choose(active); }
    else if (e.key === "Escape") hide();
  }, true);
  pop.addEventListener("mousedown", (e) => e.preventDefault());
  pop.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) choose(Number(b.dataset.i)); });
  input.addEventListener("blur", () => setTimeout(hide, 150));
}

/* ---------- photos and voice notes ---------- */

function clearPendingAudio() {
  pendingAudioBlob = null;
  if (pendingAudioPreviewUrl) { URL.revokeObjectURL(pendingAudioPreviewUrl); pendingAudioPreviewUrl = null; }
  document.getElementById("audioPreview").classList.remove("show");
}

function clearPendingImage(revoke = true) {
  pendingImageFile = null;
  if (pendingImagePreviewUrl && revoke) URL.revokeObjectURL(pendingImagePreviewUrl);
  pendingImagePreviewUrl = null;
  pendingVideoFile = null;
  if (pendingVideoUrl && revoke) URL.revokeObjectURL(pendingVideoUrl);
  pendingVideoUrl = null;
  pendingViewOnce = false;
  pendingOriginal = null;
  document.getElementById("imageInput").value = "";
  const prev = document.getElementById("attachPreview");
  prev.classList.remove("show", "is-video");
  const v = document.getElementById("attachVideo");
  if (v) v.removeAttribute("src");
  paintAttachOpts();
}

function paintAttachOpts() {
  const vo = document.getElementById("viewOnceBtn"), ed = document.getElementById("editAttach");
  if (!vo || !ed) return;
  const hasMedia = !!(pendingImageFile || pendingVideoFile);
  vo.hidden = !hasMedia || isPublic || convo?.kind === "bot";
  vo.classList.toggle("on", pendingViewOnce);
  vo.innerHTML = `${svgIcon("once", 15)}${pendingViewOnce ? "View once" : ""}`;
  ed.hidden = !pendingImageFile || !pendingOriginal;
  ed.innerHTML = `${svgIcon("pen", 14)}Edit`;
}

async function handlePickedImage(file, label, { viewOnce = false } = {}) {
  if ((file.type || "").startsWith("video/")) return handlePickedVideo(file, { viewOnce });
  clearPendingAudio();
  let edited = file;
  if (window.MediaEditor) {
    edited = await MediaEditor.edit(file, { title: "Send photo", doneLabel: "Next", aspects: ["original", "1:1", "4:5", "9:16", "16:9"] });
    if (!edited) { document.getElementById("imageInput").value = ""; return; }
  }
  document.getElementById("attachName").textContent = "Processing photo…";
  document.getElementById("attachPreview").classList.add("show");
  document.getElementById("attachPreview").classList.remove("is-video");
  try {
    const blob = await compressImageFile(edited);
    pendingImageFile = blob;
    pendingOriginal = file;
    pendingVideoFile = null;
    pendingViewOnce = viewOnce && !isPublic;
    if (pendingImagePreviewUrl) URL.revokeObjectURL(pendingImagePreviewUrl);
    pendingImagePreviewUrl = URL.createObjectURL(blob);
    document.getElementById("attachImg").src = pendingImagePreviewUrl;
    document.getElementById("attachName").textContent = label;
    paintAttachOpts();
    refreshSendState();
    document.getElementById("msgInput").focus();
  } catch (err) {
    toast(err.message || "Could not process this photo.");
    clearPendingImage();
  }
}

const VIDEO_MAX = 50 * 1024 * 1024;
function handlePickedVideo(file, { viewOnce = false } = {}) {
  clearPendingAudio();
  if (file.size > VIDEO_MAX) { toast("Video 50 MB se chhota hona chahiye."); document.getElementById("imageInput").value = ""; return; }
  clearPendingImage();
  pendingVideoFile = file;
  pendingViewOnce = viewOnce && !isPublic;
  pendingVideoUrl = URL.createObjectURL(file);
  const v = document.getElementById("attachVideo");
  v.src = pendingVideoUrl + "#t=0.1";
  const prev = document.getElementById("attachPreview");
  prev.classList.add("show", "is-video");
  document.getElementById("attachName").textContent = `🎥 Video · ${(file.size / 1048576).toFixed(1)} MB`;
  paintAttachOpts();
  refreshSendState();
}

// Videos go to Telegram (via our edge function) when it's set up and the file is ≤ 20 MB,
// otherwise to Supabase storage. Returns a URL a <video> can play.
let tgStatus = null;
async function uploadVideo(file, onProgress) {
  const fnUrl = `${window.TEAOFRPM_CONFIG.SUPABASE_URL}/functions/v1/tg-media`;
  if (tgStatus === null) {
    try { tgStatus = await (await fetch(`${fnUrl}?status=1`)).json(); } catch { tgStatus = { telegram: false }; }
  }
  if (tgStatus.telegram && file.size <= (tgStatus.max || 20971520)) {
    try {
      const { data } = await sb.auth.getSession();
      const url = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", fnUrl);
        xhr.setRequestHeader("Authorization", `Bearer ${data.session.access_token}`);
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
        xhr.onload = () => { try { const r = JSON.parse(xhr.responseText); r.url ? resolve(r.url) : reject(new Error(r.error || "upload failed")); } catch (e) { reject(e); } };
        xhr.onerror = () => reject(new Error("network"));
        const fd = new FormData();
        fd.append("file", file, file.name || "video.mp4");
        xhr.send(fd);
      });
      return url;
    } catch (e) {
      console.warn("telegram upload failed, using storage", e);
    }
  }
  onProgress?.(0.15);
  const ext = ((file.name || "").match(/\.(\w{2,4})$/) || [, "mp4"])[1].toLowerCase();
  const url = await uploadPublic("chat-videos", `${ME.id}/${Date.now()}.${ext}`, file, file.type || "video/mp4");
  onProgress?.(1);
  return url;
}

async function openViewOnce(m, card) {
  const { data, error } = await sb.rpc("open_view_once", { p_message: m.id });
  if (error) { toast(friendlyError(error, "Can't open this.")); if (/opened/i.test(error.message || "")) markVoOpened(card); return; }
  const v = document.createElement("div");
  v.className = "vo-viewer";
  const secs = data.kind === "video" ? 0 : 12;
  v.innerHTML = `<div class="vo-bar"><span>${svgIcon("once", 16)} View once</span><button type="button">Close</button></div>
    ${secs ? `<div class="vo-ring" style="animation-duration:${secs}s"></div>` : ""}
    ${data.kind === "video" ? `<video src="${escapeHTML(data.url)}" autoplay playsinline controlslist="nodownload noplaybackrate" disablepictureinpicture></video>` : `<img src="${escapeHTML(data.url)}" alt="" draggable="false" />`}`;
  v.addEventListener("contextmenu", (e) => e.preventDefault());
  document.body.appendChild(v);
  AppNav.hide?.();
  let t = secs ? setTimeout(close, secs * 1000) : null;
  const vid = v.querySelector("video");
  if (vid) vid.addEventListener("ended", close);
  function close() { clearTimeout(t); t = null; v.remove(); AppNav.show?.(); markVoOpened(card); }
  v.querySelector("button").addEventListener("click", close);
}

function markVoOpened(card) {
  if (!card) return;
  card.classList.add("opened");
  card.innerHTML = `${svgIcon("once", 22)}<div>Opened<small>View-once media can't be opened again</small></div>`;
}

async function paintVoCard(card, m, isOwn) {
  const kind = m._voKind || "Photo";
  card.innerHTML = `${svgIcon("once", 22)}<div>${isOwn ? `${kind} · view once` : `Tap to view`}<small>${m._pending ? "Sending…" : isOwn ? "…" : "Opens one time only"}</small></div>`;
  if (m._pending) return;
  const { data } = await sb.from("view_once_opens").select("user_id").eq("message_id", m.id);
  const opens = data || [];
  if (isOwn) {
    card.classList.toggle("opened", opens.length > 0);
    card.querySelector("small").textContent = opens.length ? (convo.kind === "dm" ? "Opened ✓" : `Opened by ${opens.length}`) : "Not opened yet";
  } else if (opens.some((o) => o.user_id === ME.id)) markVoOpened(card);
  else card.addEventListener("click", (e) => { e.stopPropagation(); if (!card.classList.contains("opened")) openViewOnce(m, card); }, { once: true });
}

async function toggleVoiceRecording() {
  const btn = document.getElementById("voiceBtn");
  if (mediaRecorder && mediaRecorder.state === "recording") { mediaRecorder.stop(); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast("Voice notes aren't supported in this browser."); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recordingTimer);
      btn.classList.remove("recording");
      btn.innerHTML = svgIcon("mic", 19);
      clearPendingImage();
      pendingAudioBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      if (pendingAudioBlob.size < 800) { pendingAudioBlob = null; toast("That was too short."); refreshSendState(); return; }
      if (pendingAudioPreviewUrl) URL.revokeObjectURL(pendingAudioPreviewUrl);
      pendingAudioPreviewUrl = URL.createObjectURL(pendingAudioBlob);
      document.getElementById("audioPreviewPlayer").src = pendingAudioPreviewUrl;
      document.getElementById("audioPreview").classList.add("show");
      refreshSendState();
    };
    mediaRecorder.start();
    const startedAt = Date.now();
    btn.classList.add("recording");
    btn.textContent = "0s";
    buzz(15);
    recordingTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      btn.textContent = `${secs}s`;
      if (secs >= 120) mediaRecorder.stop();
    }, 500);
  } catch {
    toast("Microphone access denied or unavailable.");
  }
}

/* ---------- reply ---------- */

function startReply(m) {
  if (!m) return;
  const author = profileCache.get(m.user_id);
  replyingTo = { id: m.id };
  document.getElementById("replyToName").textContent = m.user_id === ME.id ? "yourself" : (author?.display_name || "Unknown");
  document.getElementById("replyToText").textContent = previewText(m);
  document.getElementById("replyBar").classList.add("show");
  document.getElementById("msgInput").focus();
}

function clearReply() {
  replyingTo = null;
  document.getElementById("replyBar").classList.remove("show");
}

/* ---------- sending (shows up instantly, confirmed in the background) ---------- */

let tmpSeq = 0;
const pendingSends = [];          // { tmpId, payload, files, real }

async function sendMessage({ sticker } = {}) {
  const input = document.getElementById("msgInput");
  const text = input.value.trim();
  if (!text && !pendingImageFile && !pendingVideoFile && !pendingAudioBlob && !sticker) return;
  if (!convo || !ME) { toast("Still connecting — one sec…", 1500); return; }

  const viewOnce = pendingViewOnce && !!(pendingImageFile || pendingVideoFile);
  // a view-once photo travels alone; any typed text follows as its own message
  if (viewOnce && text) setTimeout(() => { input.value = text; sendMessage(); }, 400);
  const payload = {
    user_id: ME.id, conversation_id: convo.id,
    content: viewOnce ? null : (text || null), sticker_url: sticker || null, reply_to: viewOnce ? null : (replyingTo?.id || null),
    image_url: null, audio_url: null, video_url: null,
  };
  const files = { image: pendingImageFile, imagePreview: pendingImagePreviewUrl, audio: pendingAudioBlob, audioPreview: pendingAudioPreviewUrl,
    video: pendingVideoFile, videoPreview: pendingVideoUrl, viewOnce };

  // clear the composer straight away
  input.value = "";
  autoGrow(input);
  store.remove("teaofrpm_draft_" + convoIdParam);
  clearPendingImage(false);
  pendingAudioBlob = null; pendingAudioPreviewUrl = null;
  document.getElementById("audioPreview").classList.remove("show");
  clearReply();
  sendTypingState(false);
  refreshSendState();
  document.querySelectorAll(".extras-cmdbox.show").forEach((p) => p.classList.remove("show"));

  const tmpId = `tmp-${++tmpSeq}`;
  const temp = viewOnce
    ? { ...payload, id: tmpId, created_at: new Date().toISOString(), view_once: true, _voKind: files.video ? "Video" : "Photo", _pending: true }
    : { ...payload, id: tmpId, created_at: new Date().toISOString(), image_url: files.imagePreview, audio_url: files.audioPreview, video_url: files.videoPreview, _pending: true };
  messageCache.set(tmpId, temp);
  box().querySelector(".chat-empty")?.remove();
  appendNode(box(), temp)?.classList.add("anim-in");
  scrollToBottom(true);

  const entry = { tmpId, tmpAt: temp.created_at, payload, files, real: null };
  pendingSends.push(entry);
  await deliver(entry);
}

async function deliver(entry) {
  const { payload, files } = entry;
  // upload progress shows on the message bubble itself
  let bar = null;
  const progress = (p) => {
    const row = rendered.get(entry.tmpId);
    if (!bar && row) {
      bar = document.createElement("div");
      bar.className = "upload-progress";
      bar.innerHTML = "<i></i>";
      row.querySelector(".bubble")?.appendChild(bar);
    }
    if (bar) { bar.hidden = p >= 1; bar.firstChild.style.width = `${Math.round(p * 100)}%`; }
  };
  try {
    if (files.viewOnce) {
      // upload privately-named media, then the server records it as view-once
      if (!entry.mediaUrl) {
        entry.mediaUrl = files.video
          ? await uploadVideo(files.video, progress)
          : await uploadPublic("chat-images", `${ME.id}/vo-${crypto.randomUUID?.() || Date.now()}.jpg`, files.image);
      }
      const { data: id, error } = await sb.rpc("send_view_once", { p_conversation: convo.id, p_url: entry.mediaUrl, p_kind: files.video ? "video" : "image" });
      if (error) throw error;
      if (!entry.real) adopt(entry, { ...payload, id, created_at: new Date().toISOString(), view_once: true, deleted: false });
      return;
    }
    if (files.video && !payload.video_url) {
      progress(0.02);
      payload.video_url = await uploadVideo(files.video, progress);
      progress(1);
    } else if (files.image && !payload.image_url) {
      payload.image_url = await uploadPublic("chat-images", `${ME.id}/${Date.now()}.jpg`, files.image);
    } else if (files.audio && !payload.audio_url) {
      const ext = (files.audio.type || "").includes("mp4") ? "m4a" : "webm";
      payload.audio_url = await uploadPublic("voice-notes", `${ME.id}/${Date.now()}.${ext}`, files.audio, files.audio.type || "audio/webm");
    }
    const { data, error } = await sb.from("messages").insert(payload).select().single();
    if (error) throw error;
    if (!entry.real) adopt(entry, data);
  } catch (err) {
    if (bar) bar.hidden = true;
    const temp = messageCache.get(entry.tmpId);
    const row = rendered.get(entry.tmpId);
    if (temp && row) {
      temp._failed = true;
      row.classList.remove("sending");
      row.classList.add("failed");
      fillBubble(row.querySelector(".bubble"), temp, true);
    }
    toast(friendlyError(err, "Message failed to send."));
  }
}

function retrySend(tmpId) {
  const entry = pendingSends.find((p) => p.tmpId === tmpId);
  const temp = messageCache.get(tmpId);
  const row = rendered.get(tmpId);
  if (!entry || !temp || !row) return;
  actionSheet("Message not sent", [
    { icon: "refresh", label: "Try again", onClick: () => {
      temp._failed = false;
      row.classList.remove("failed");
      row.classList.add("sending");
      fillBubble(row.querySelector(".bubble"), temp, true);
      deliver(entry);
    } },
    { icon: "trash", label: "Delete", danger: true, onClick: () => {
      pendingSends.splice(pendingSends.indexOf(entry), 1);
      removeRow(tmpId);
      messageCache.delete(tmpId);
    } },
  ]);
}

// Realtime may deliver our own message before the insert call returns.
function adoptPending(m) {
  const entry = pendingSends.find((p) => !p.real &&
    (p.payload.content || null) === (m.content || null) &&
    (p.payload.sticker_url || null) === (m.sticker_url || null) &&
    (p.payload.reply_to || null) === (m.reply_to || null) &&
    !!p.files.viewOnce === !!m.view_once &&
    (p.files.viewOnce || (!!p.files.image === !!m.image_url && !!p.files.video === !!m.video_url)) &&
    !!p.files.audio === !!m.audio_url);
  if (!entry) return false;
  adopt(entry, m);
  return true;
}

async function adopt(entry, real) {
  entry.real = real;
  pendingSends.splice(pendingSends.indexOf(entry), 1);
  const row = rendered.get(entry.tmpId);
  messageCache.delete(entry.tmpId);
  messageCache.set(real.id, real);
  reactionsByMsg.set(real.id, []);
  if (rendered.has(real.id)) { if (row) removeRow(entry.tmpId); return; }
  if (!row) return;
  const fresh = buildRow(real, row.classList.contains("grouped"));
  // keep showing the local copy of a photo so it doesn't flash while the real one loads
  const localImg = row.querySelector("img.chat-img");
  if (localImg && real.image_url) {
    const img = fresh.querySelector("img.chat-img");
    const preload = new Image();
    img.src = localImg.src;
    preload.onload = () => { img.src = real.image_url; URL.revokeObjectURL(localImg.src); };
    preload.src = real.image_url;
  }
  row.replaceWith(fresh);
  rendered.delete(entry.tmpId);
  rendered.set(real.id, fresh);
  if (lastMeta?.type === "msg" && lastMeta.at === entry.tmpAt) lastMeta.at = real.created_at;
  if (real.created_at > (newestAt || "")) newestAt = real.created_at;
  if (/^\/poll\s/i.test((real.content || "").trim())) mountPolls();
  paintSeen();
}

/* ---------- stickers ---------- */

const RECENT_STICKERS_KEY = "teaofrpm_recent_stickers";

async function loadStickers() {
  const cached = store.get("teaofrpm_stickers");
  if (cached?.length) { STICKERS = cached; buildStickerPanel(); }
  const { data, error } = await sb.from("stickers").select("*").order("created_at", { ascending: false });
  if (error) { if (!STICKERS.length) buildStickerPanel(); return; }
  STICKERS = (data || []).map((st) => ({
    url: sb.storage.from("stickers").getPublicUrl(st.storage_path).data.publicUrl,
    label: st.label || "sticker",
  }));
  store.set("teaofrpm_stickers", STICKERS);
  buildStickerPanel();
}

function buildStickerPanel() {
  const panel = document.getElementById("stickerPanel");
  if (!STICKERS.length) {
    panel.innerHTML = `<span style="grid-column:1/-1; font-size:12.5px; color:var(--text-muted); padding:8px;">No stickers yet.</span>`;
    return;
  }
  const recents = store.get(RECENT_STICKERS_KEY, []).filter((r) => STICKERS.some((st) => st.url === r.url));
  const asImg = (st) => `<img src="${st.url}" data-url="${escapeHTML(st.url)}" alt="${escapeHTML(st.label)}" title="${escapeHTML(st.label)}" loading="lazy" />`;
  let html = "";
  if (recents.length) html += `<span class="sticker-section-label">Recently used</span>${recents.map(asImg).join("")}<span class="sticker-section-label">All stickers</span>`;
  panel.innerHTML = html + STICKERS.map(asImg).join("");
  if (!panel.dataset.wired) {
    panel.dataset.wired = "1";
    panel.addEventListener("click", (e) => {
      const img = e.target.closest("img[data-url]");
      if (!img) return;
      const sticker = STICKERS.find((st) => st.url === img.dataset.url);
      if (!sticker) return;
      const recentsNow = store.get(RECENT_STICKERS_KEY, []).filter((st) => st.url !== sticker.url);
      recentsNow.unshift(sticker);
      store.set(RECENT_STICKERS_KEY, recentsNow.slice(0, 8));
      panel.classList.remove("show");
      sendMessage({ sticker: sticker.url });
      setTimeout(buildStickerPanel, 300);
    });
  }
}

/* ---------- the + menu: emoji, poll, countdown, schedule, leaderboard, voice typing ---------- */

function plusMenu(input) {
  const row = document.querySelector(".composer-row");
  const composer = row.closest(".composer");
  // the button is already in room.html so the composer never changes shape on load
  let btn = row.querySelector(".x3-plus-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-btn x3-plus-btn";
    btn.innerHTML = svgIcon("plus", 20);
    row.insertBefore(btn, row.firstChild);
  }
  btn.title = "More: poll, countdown, schedule, voice typing…";
  btn.setAttribute("aria-expanded", "false");

  const dictation = setupDictation(composer, input);
  const pick = (accept, viewOnce) => {
    const f = document.createElement("input");
    f.type = "file"; f.accept = accept;
    f.addEventListener("change", () => { const file = f.files[0]; if (file) handlePickedImage(file, file.name || "Photo", { viewOnce }); });
    f.click();
  };
  const tiles = [
    ["video", "Video", "x3-t-video", () => pick("video/*", false)],
    ...(!isPublic && convo?.kind !== "bot" ? [["once", "View once", "x3-t-once", () => pick("image/*,video/*", true)]] : []),
    ["poll", "Poll", "x3-t-poll", openPollSheet],
    ["hourglass", "Countdown", "x3-t-cd", openCountdownSheet],
    ["clock", "Schedule", "x3-t-sch", openScheduleSheet],
    ["trophy", "Leaderboard", "x3-t-top", () => sendRawCommand("/top")],
    ...(dictation ? [["voiceType", "Voice typing", "x3-t-voice", () => dictation.toggle()]] : []),
  ];
  const QUICK = ["😂", "❤️", "🔥", "👍", "🙏", "😭", "💯", "🎉"];
  const menu = document.createElement("div");
  menu.className = "x3-plus";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <div class="x3-plus-emoji">${QUICK.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}</div>
    <div class="x3-plus-grid">${tiles.map(([icon, label, cls], i) => `
      <button type="button" class="x3-tile ${cls}" data-tile="${i}" style="--i:${i}"><span class="x3-tile-ic">${svgIcon(icon, 20)}</span><span class="x3-tile-label">${label}</span></button>`).join("")}</div>
    ${dictation ? `<div class="x3-plus-lang"><span>Voice typing language</span><div class="x3-seg" role="radiogroup"><button type="button" data-lang="en-IN">English</button><button type="button" data-lang="hi-IN">हिंदी</button></div></div>` : ""}`;
  composer.appendChild(menu);

  const syncLang = () => menu.querySelectorAll("[data-lang]").forEach((b) => b.classList.toggle("on", b.dataset.lang === dictation.getLang()));
  if (dictation) syncLang();
  const open = () => { menu.classList.add("show"); btn.classList.add("open"); btn.setAttribute("aria-expanded", "true"); };
  const close = () => { menu.classList.remove("show"); btn.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.classList.contains("show") ? close() : open(); });
  document.addEventListener("click", (e) => { if (menu.classList.contains("show") && !menu.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    const em = e.target.closest("[data-emoji]");
    if (em) {
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, pos) + em.dataset.emoji + input.value.slice(pos);
      input.setSelectionRange(pos + em.dataset.emoji.length, pos + em.dataset.emoji.length);
      refreshSendState();
      return;
    }
    const lang = e.target.closest("[data-lang]");
    if (lang && dictation) { dictation.setLang(lang.dataset.lang); syncLang(); return; }
    const tile = e.target.closest("[data-tile]");
    if (tile) { close(); if (convo) tiles[Number(tile.dataset.tile)][3](); }
  });
}

async function sendRawCommand(content) {
  const { error } = await sb.from("messages").insert({ user_id: ME.id, conversation_id: convo.id, content });
  if (error) { toast(friendlyError(error)); return false; }
  return true;
}

function openPollSheet() {
  const s = makeSheet({ title: "New poll", html: `
    <input class="x3-input" id="x3PollQ" maxlength="200" placeholder="Ask a question…" autocomplete="off" />
    <div id="x3PollOpts"></div>
    <button type="button" class="x3-link" id="x3PollAdd">+ Add option</button>
    <button type="button" class="btn x3-full" id="x3PollGo">Create poll</button>
    <p class="x3-hint">Votes are anonymous — people see totals, never who picked what.</p>` });
  s.onClose = () => setTimeout(() => s.el.remove(), 300);
  const opts = s.body.querySelector("#x3PollOpts");
  const addOpt = () => {
    if (opts.children.length >= 10) { toast("A poll can have at most 10 options."); return; }
    const i = document.createElement("input");
    i.className = "x3-input x3-opt";
    i.maxLength = 80;
    i.placeholder = `Option ${opts.children.length + 1}`;
    opts.appendChild(i);
    return i;
  };
  addOpt(); addOpt();
  s.body.querySelector("#x3PollAdd").addEventListener("click", () => addOpt()?.focus());
  s.body.querySelector("#x3PollGo").addEventListener("click", async (e) => {
    const clean = (v) => v.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
    const q = clean(s.body.querySelector("#x3PollQ").value);
    const options = [...opts.querySelectorAll("input")].map((i) => clean(i.value)).filter(Boolean);
    if (!q) { toast("Write a question first."); return; }
    if (options.length < 2) { toast("Add at least two options."); return; }
    e.target.disabled = true;
    const ok = await sendRawCommand(`/poll ${q} | ${options.join(" | ")}`);
    e.target.disabled = false;
    if (ok) s.close();
  });
  s.open();
  setTimeout(() => s.body.querySelector("#x3PollQ").focus(), 150);
}

function openCountdownSheet() {
  const s = makeSheet({ title: "New countdown", html: `
    <input class="x3-input" id="x3CdTitle" maxlength="60" placeholder="What's coming? e.g. Board exams" autocomplete="off" />
    <div class="x3-row"><input class="x3-input" id="x3CdDate" type="date" /><input class="x3-input" id="x3CdTime" type="time" /></div>
    <button type="button" class="btn x3-full" id="x3CdGo">Post countdown</button>
    <p class="x3-hint">Time is optional. Everyone sees it tick live.</p>` });
  s.onClose = () => setTimeout(() => s.el.remove(), 300);
  s.body.querySelector("#x3CdDate").min = new Date().toISOString().slice(0, 10);
  s.body.querySelector("#x3CdGo").addEventListener("click", async (e) => {
    const title = s.body.querySelector("#x3CdTitle").value.replace(/\s+/g, " ").trim();
    const date = s.body.querySelector("#x3CdDate").value;
    const time = s.body.querySelector("#x3CdTime").value;
    if (!title) { toast("Give it a name."); return; }
    if (!date) { toast("Pick a date."); return; }
    if (new Date(`${date}T${time || "23:59"}:00`) < new Date()) { toast("That date has already passed."); return; }
    e.target.disabled = true;
    const ok = await sendRawCommand(`/countdown ${title} ${date}${time ? " " + time : ""}`);
    e.target.disabled = false;
    if (ok) s.close();
  });
  s.open();
}

function openScheduleSheet() {
  const toLocalInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const s = makeSheet({ title: "Schedule a message", html: `
    <textarea class="x3-input" id="x3SchText" rows="3" maxlength="2000" placeholder="What should be sent later?"></textarea>
    <div class="x3-chips"><button type="button" data-q="1h">In 1 hour</button><button type="button" data-q="midnight">12:00 AM tonight</button><button type="button" data-q="7am">Next 7:00 AM</button></div>
    <input class="x3-input" id="x3SchAt" type="datetime-local" />
    <button type="button" class="btn x3-full" id="x3SchGo">Schedule</button>
    <div class="x3-subhead">Scheduled in this chat</div>
    <div id="x3SchList" class="x3-schlist"></div>` });
  s.onClose = () => setTimeout(() => s.el.remove(), 300);
  const at = s.body.querySelector("#x3SchAt");
  at.min = toLocalInput(new Date(Date.now() + 60000));
  at.value = toLocalInput(new Date(Date.now() + 3600000));
  const draft = document.getElementById("msgInput").value.trim();
  if (draft) s.body.querySelector("#x3SchText").value = draft;

  const loadScheduled = async () => {
    const list = s.body.querySelector("#x3SchList");
    const { data } = await sb.from("scheduled_messages").select("id,content,send_at,status,error")
      .eq("conversation_id", convo.id).in("status", ["pending", "failed"]).order("send_at", { ascending: true }).limit(30);
    if (!data?.length) { list.innerHTML = `<div class="x3-empty">Nothing scheduled here.</div>`; return; }
    list.innerHTML = data.map((x) => `
      <div class="x3-sch ${x.status}">
        <div class="x3-sch-main"><b>${escapeHTML(new Date(x.send_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}</b>
        <span>${escapeHTML(x.content.slice(0, 90))}</span>
        ${x.status === "failed" ? `<small>Didn't send: ${escapeHTML(x.error || "unknown reason")}</small>` : ""}</div>
        ${x.status === "pending" ? `<button type="button" data-cancel="${x.id}">Cancel</button>` : ""}
      </div>`).join("");
  };

  s.body.querySelector(".x3-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-q]");
    if (!b) return;
    const d = new Date();
    if (b.dataset.q === "1h") d.setHours(d.getHours() + 1);
    if (b.dataset.q === "midnight") { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); }
    if (b.dataset.q === "7am") { if (d.getHours() >= 7) d.setDate(d.getDate() + 1); d.setHours(7, 0, 0, 0); }
    at.value = toLocalInput(d);
  });
  s.body.querySelector("#x3SchGo").addEventListener("click", async (e) => {
    const text = s.body.querySelector("#x3SchText").value.trim();
    if (!text) { toast("Write the message first."); return; }
    if (!at.value) { toast("Pick when to send it."); return; }
    const when = new Date(at.value);
    if (when.getTime() < Date.now() + 30000) { toast("Pick a time at least a minute from now."); return; }
    e.target.disabled = true;
    const { error } = await sb.from("scheduled_messages").insert({ user_id: ME.id, conversation_id: convo.id, content: text, send_at: when.toISOString() });
    e.target.disabled = false;
    if (error) { toast(friendlyError(error)); return; }
    s.body.querySelector("#x3SchText").value = "";
    if (draft && draft === text) { const i = document.getElementById("msgInput"); i.value = ""; refreshSendState(); store.remove("teaofrpm_draft_" + convoIdParam); }
    toast(`Will send ${when.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`);
    loadScheduled();
  });
  s.body.querySelector("#x3SchList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cancel]");
    if (!b) return;
    const { error } = await sb.from("scheduled_messages").update({ status: "cancelled" }).eq("id", b.dataset.cancel);
    if (error) { toast("Could not cancel."); return; }
    toast("Cancelled");
    loadScheduled();
  });
  s.open();
  loadScheduled();
}

// Speak and it types, in English or Hindi.
function setupDictation(composer, input) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  let lang = store.raw("teaofrpm_dictlang") || "en-IN";
  let rec = null;
  const pill = document.createElement("div");
  pill.className = "x3-listening";
  pill.innerHTML = `<span class="x3-listening-ic">${svgIcon("mic", 15)}</span><span class="x3-listening-text"></span><button type="button" class="x3-listening-stop">Stop</button>`;
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
      input.value = base + glue + [...e.results].map((r) => r[0].transcript).join("");
      autoGrow(input);
      refreshSendState();
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Allow microphone access to use voice typing.");
      else if (e.error !== "no-speech" && e.error !== "aborted") toast("Voice typing stopped.");
    };
    rec.onend = () => { rec = null; pill.classList.remove("show"); input.focus(); };
    try {
      rec.start();
      pill.querySelector(".x3-listening-text").textContent = `Listening… ${label()}`;
      pill.classList.add("show");
    } catch { rec = null; toast("Voice typing isn't available right now."); }
  }
  return {
    toggle: () => (rec ? rec.stop() : start()),
    getLang: () => lang,
    setLang: (l) => { lang = l; store.setRaw("teaofrpm_dictlang", l); toast(`Voice typing: ${label()}`); },
  };
}

/* ============================================================
   Search inside this chat
   ============================================================ */

function wireSearch() {
  const toggle = document.getElementById("searchToggle");
  const panel = document.getElementById("searchPanel");
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = panel.classList.toggle("show");
    if (open) input.focus(); else { input.value = ""; results.innerHTML = ""; }
  });
  document.addEventListener("click", (e) => { if (!panel.contains(e.target) && e.target !== toggle) panel.classList.remove("show"); });

  let token = 0;
  input.addEventListener("input", debounce(async () => {
    const term = input.value.trim();
    const my = ++token;
    if (!term) { results.innerHTML = ""; return; }
    results.innerHTML = `<div class="search-hint">Searching…</div>`;
    const safe = term.replace(/[%_\\]/g, (m) => `\\${m}`);
    const { data, error } = await sb.from("messages").select("*")
      .eq("conversation_id", convo.id).eq("deleted", false).eq("is_bot", false)
      .ilike("content", `%${safe}%`).order("created_at", { ascending: false }).limit(30);
    if (my !== token) return;
    if (error) { results.innerHTML = `<div class="search-hint">Search failed.</div>`; return; }
    if (!data.length) { results.innerHTML = `<div class="search-hint">No messages found.</div>`; return; }
    await getProfiles(data.map((m) => m.user_id));
    if (my !== token) return;
    data.forEach((m) => messageCache.set(m.id, m));
    const rx = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    const frag = document.createDocumentFragment();
    for (const m of data) {
      const author = profileCache.get(m.user_id);
      const row = document.createElement("div");
      row.className = "search-result-row";
      row.innerHTML = `<div class="avatar" style="width:26px;height:26px;font-size:10px;"></div>
        <div class="search-result-text"><b>${escapeHTML(author?.display_name || "Unknown")}</b> · <span>${escapeHTML(new Date(m.created_at).toLocaleDateString([], { day: "numeric", month: "short" }))} ${formatTime(m.created_at)}</span><br>${escapeHTML(m.content).replace(rx, "<mark>$1</mark>")}</div>`;
      setAvatarContent(row.querySelector(".avatar"), author);
      row.addEventListener("click", () => { panel.classList.remove("show"); jumpToMessage(m.id); });
      frag.appendChild(row);
    }
    results.replaceChildren(frag);
  }, 300));
}

/* ============================================================
   Details sheet: group name/photo, members, roles, mute, photos, leave
   ============================================================ */

function wireInfoSheet() {
  const sheet = document.getElementById("roomInfoSheet");
  document.getElementById("roomInfoBtn").addEventListener("click", async () => {
    sheet.classList.add("show");
    AppNav.enterFullscreen(() => sheet.classList.remove("show"));
    await renderInfoSheet();
  });
  sheet.addEventListener("click", (e) => { if (e.target === sheet) AppNav.exitFullscreen(); });
  document.getElementById("saveGroupBtn").addEventListener("click", saveGroupName);
  document.getElementById("groupPfpInput").addEventListener("change", uploadGroupPfp);
  document.getElementById("leaveGroupBtn").addEventListener("click", leaveGroup);
  document.getElementById("addMemberSearch").addEventListener("input", debounce((e) => renderAddMembers(e.target.value.trim().toLowerCase()), 120));
}

async function renderInfoSheet() {
  const isGroup = convo.kind === "group";
  const isOwner = ME.role === "owner";
  document.getElementById("roomInfoTitle").textContent = convo.kind === "dm" ? "Details" : (isPublic ? "Public room" : "Group details");
  document.getElementById("groupEditArea").style.display = isGroup && (!isPublic || isOwner) ? "block" : "none";
  document.getElementById("leaveGroupBtn").style.display = isGroup && !isPublic ? "block" : "none";
  document.getElementById("addMemberArea").style.display = isGroup && amAdmin && !isPublic ? "block" : "none";
  if (isGroup) {
    document.getElementById("groupNameEdit").value = convo.name || "";
    setGroupAvatar(document.getElementById("groupPfp"), convo);
  }

  renderMuteRow();
  renderThemeRow();
  renderVanishRow();
  renderMediaGrid();

  const list = document.getElementById("roomMembers");
  if (isPublic) {
    list.innerHTML = `<div class="settings-empty">Everyone at RPM is in this room · ${members.length} members</div>`;
    return;
  }
  await getProfiles(members.map((m) => m.user_id));
  list.innerHTML = "";
  const ordered = [...members].sort((a, b) => (a.role === "admin" ? 0 : 1) - (b.role === "admin" ? 0 : 1));
  for (const member of ordered) {
    const p = profileCache.get(member.user_id);
    if (!p) continue;
    const row = document.createElement("div");
    row.className = "settings-list-row";
    const online = Presence.online.has(p.id) ? ' <span class="member-online">● online</span>' : "";
    row.innerHTML = `<span class="avatar"></span><a class="settings-list-name" href="profile.html?u=${encodeURIComponent(p.username)}">${escapeHTML(p.display_name)}${member.user_id === ME.id ? " (you)" : ""}${online}<span class="settings-list-sub">@${escapeHTML(p.username)}${member.role === "admin" ? ' · <b class="member-admin-tag">Admin</b>' : ""}</span></a>`;
    setAvatarContent(row.querySelector(".avatar"), p);

    if (isGroup && amAdmin) {
      const isTargetAdmin = member.role === "admin";
      const roleBtn = document.createElement("button");
      roleBtn.textContent = isTargetAdmin ? "Remove admin" : "Make admin";
      roleBtn.addEventListener("click", async () => {
        const who = member.user_id === ME.id ? "yourself" : p.display_name;
        if (!confirm(`${isTargetAdmin ? "Remove admin from" : "Make"} ${who}${isTargetAdmin ? "" : " an admin"}?`)) return;
        roleBtn.disabled = true;
        const { error } = await sb.rpc("set_member_role", { p_conversation: convo.id, p_user: member.user_id, p_role: isTargetAdmin ? "member" : "admin" });
        roleBtn.disabled = false;
        if (error) { toast(friendlyError(error)); return; }
        await reloadMembersNow();
        toast(isTargetAdmin ? "Admin removed" : `${p.display_name} is now an admin`);
      });
      row.appendChild(roleBtn);
      if (member.user_id !== ME.id) {
        const btn = document.createElement("button");
        btn.textContent = "Remove";
        btn.addEventListener("click", async () => {
          if (!confirm(`Remove ${p.display_name} from the group?`)) return;
          const { error } = await sb.from("conversation_members").delete().eq("conversation_id", convo.id).eq("user_id", member.user_id);
          if (error) { toast(friendlyError(error, "Could not remove.")); return; }
          await reloadMembersNow();
        });
        row.appendChild(btn);
      }
    }
    list.appendChild(row);
  }
  if (isGroup && amAdmin) await loadAddableMembers();
}

async function reloadMembersNow() {
  const { data } = await sb.from("conversation_members").select("*").eq("conversation_id", convo.id);
  setMembers(data || []);
  await getProfiles(members.map((m) => m.user_id));
  renderHeader();
  await renderInfoSheet();
}

async function renderMuteRow() {
  const body = document.querySelector("#roomInfoSheet .room-info-body");
  let row = body.querySelector(".mute-row");
  if (!row) {
    row = document.createElement("label");
    row.className = "settings-toggle-row mute-row";
    row.innerHTML = `<div><b>Mute notifications</b><span>You'll still get messages, just quietly</span></div><input type="checkbox" />`;
    body.insertBefore(row, body.querySelector(".settings-group-title"));
    row.querySelector("input").addEventListener("change", async (e) => {
      const { error } = await sb.from("conversation_members").update({ muted: e.target.checked }).eq("conversation_id", convo.id).eq("user_id", ME.id);
      if (error) { e.target.checked = !e.target.checked; toast("Could not update."); return; }
      const mine = members.find((m) => m.user_id === ME.id);
      if (mine) mine.muted = e.target.checked;
      toast(e.target.checked ? "Muted" : "Unmuted");
    });
  }
  row.querySelector("input").checked = !!members.find((m) => m.user_id === ME.id)?.muted;
}

async function renderMediaGrid() {
  const body = document.querySelector("#roomInfoSheet .room-info-body");
  let wrap = body.querySelector(".room-media");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "room-media";
    body.insertBefore(wrap, body.querySelector(".settings-group-title"));
  }
  const { data } = await sb.from("messages").select("id,image_url").eq("conversation_id", convo.id).eq("deleted", false)
    .not("image_url", "is", null).order("created_at", { ascending: false }).limit(24);
  if (!data?.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = `<div class="settings-group-title">Photos</div><div class="room-media-grid">${data.map((m) => `<img src="${escapeHTML(m.image_url)}" data-src="${escapeHTML(m.image_url)}" loading="lazy" alt="" />`).join("")}</div>`;
  wrap.querySelector(".room-media-grid").onclick = (e) => { const img = e.target.closest("img"); if (img) openMediaViewer(img.dataset.src); };
}

let addablePeople = [];
async function loadAddableMembers() {
  const memberIds = new Set(members.map((m) => m.user_id));
  addablePeople = (await loadAllPeople()).filter((p) => !memberIds.has(p.id));
  renderAddMembers(document.getElementById("addMemberSearch").value.trim().toLowerCase());
}

function renderAddMembers(filterText = "") {
  const list = document.getElementById("addMemberList");
  const people = filterText
    ? addablePeople.filter((p) => p.display_name.toLowerCase().includes(filterText) || p.username.includes(filterText))
    : addablePeople;
  if (!people.length) { list.innerHTML = `<div class="settings-empty">Nobody left to add.</div>`; return; }
  const frag = document.createDocumentFragment();
  for (const p of people.slice(0, 100)) {
    const row = document.createElement("div");
    row.className = "settings-list-row";
    row.innerHTML = `<span class="avatar"></span><div class="settings-list-name">${escapeHTML(p.display_name)}<span class="settings-list-sub">@${escapeHTML(p.username)}</span></div><button>Add</button>`;
    setAvatarContent(row.querySelector(".avatar"), p);
    row.querySelector("button").addEventListener("click", async (e) => {
      e.target.disabled = true;
      const { error } = await sb.from("conversation_members").insert({ conversation_id: convo.id, user_id: p.id, role: "member" });
      if (error) { e.target.disabled = false; toast(friendlyError(error, "Could not add.")); return; }
      toast(`${p.display_name} added`);
      await reloadMembersNow();
    });
    frag.appendChild(row);
  }
  list.replaceChildren(frag);
}

async function saveGroupName() {
  const name = document.getElementById("groupNameEdit").value.trim();
  if (!name) { toast("Group needs a name."); return; }
  if (name === convo.name) { toast("No changes."); return; }
  // the public room's name can only be changed through the owner-only RPC
  const { error } = isPublic
    ? await sb.rpc("set_room_profile", { p_name: name })
    : await sb.from("conversations").update({ name }).eq("id", convo.id);
  if (error) { toast(friendlyError(error, "Could not rename.")); return; }
  convo.name = name;
  renderHeader();
  toast(isPublic ? "Room renamed" : "Group updated");
}

async function uploadGroupPfp(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const blob = await compressImageFile(file, 600);
    const url = await uploadPublic("avatars", `${isPublic ? "public-room" : `group-${convo.id}`}/${Date.now()}.jpg`, blob);
    const { error } = isPublic
      ? await sb.rpc("set_room_profile", { p_pfp_url: url })
      : await sb.from("conversations").update({ pfp_url: url }).eq("id", convo.id);
    if (error) throw error;
    convo.pfp_url = url;
    setGroupAvatar(document.getElementById("groupPfp"), convo);
    renderHeader();
    toast(isPublic ? "Room photo updated" : "Group photo updated");
  } catch (err) {
    toast(friendlyError(err, "Could not update photo."));
  }
}

async function leaveGroup() {
  if (!confirm("Leave this group?")) return;
  const { error } = await sb.from("conversation_members").delete().eq("conversation_id", convo.id).eq("user_id", ME.id);
  if (error) { toast(friendlyError(error, "Could not leave.")); return; }
  location.href = "messages.html";
}

init();
