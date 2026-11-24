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

  // ONE request: the server bundles the chat, members, first page (+ reactions, replies,
  // authors, polls), welcome card, streak and "while you were away".
  const seenKey = `teaofrpm_seen_at_${convoIdParam}`, since = store.raw(seenKey);
  store.setRaw(seenKey, new Date().toISOString());
  const { data: open, error: openErr } = await sb.rpc("chat_open", { p_convo: convoIdParam, p_limit: PAGE_SIZE, p_since: since || null });
  if (openErr || !open?.convo) {
    list.innerHTML = `<div class="inbox-empty">This chat isn't available.</div>`;
    return;
  }
  convo = open.convo;
  isPublic = !!convo.is_public || convo.id === PUBLIC_ROOM_ID;
  memberTotal = open.member_total || 0;
  setMembers(open.members || []);
  (open.member_profiles || []).forEach(rememberProfile);
  setNicknames(open.nicknames);
  const firstPage = absorbPage(open.page);
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
  welcomeCard(open.welcome);
  catchUp(open.catchup);
  if (convo.kind === "dm") paintStreakRow(open.streak);
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

// The public room has everyone in it — thousands of rows nobody needs. Load just
// my own row + the admins, and count the rest on the server.
let memberTotal = 0;
const memberCount = () => (isPublic ? memberTotal || members.length : members.length);
async function fetchMemberRows(pub = isPublic) {
  const cid = convo?.id || convoIdParam;
  if (!pub) {
    const res = await sb.from("conversation_members").select("*").eq("conversation_id", cid);
    memberTotal = res.data?.length || 0;
    return res;
  }
  const [rows, count] = await Promise.all([
    sb.from("conversation_members").select("*").eq("conversation_id", cid).or(`user_id.eq.${ME.id},role.eq.admin`).limit(200),
    sb.from("conversation_members").select("user_id", { count: "exact", head: true }).eq("conversation_id", cid),
  ]);
  if (typeof count.count === "number") memberTotal = count.count;
  return rows;
}

/* ============================================================
   Loading messages
   ============================================================ */

// The server returns a page already sorted oldest→newest, with everything it needs
// (reactions, my stars, replied-to messages, authors, polls + results) in the same answer.
async function fetchPage({ before = null, after = null, from = null, limit = PAGE_SIZE }) {
  const { data, error } = await sb.rpc("chat_page", { p_convo: convoIdParam, p_before: before, p_after: after, p_from: from, p_limit: limit });
  if (error || !data) { toast("Could not load messages."); return []; }
  return absorbPage(data);
}

const absorbed = new Set();                 // messages whose extras are already known
const pollByMsg = new Map(), pollResults = new Map();
function absorbPage(x) {
  const list = x?.messages || [];
  list.forEach((m) => messageCache.set(m.id, m));
  (x?.replies || []).forEach((m) => { if (!messageCache.has(m.id)) messageCache.set(m.id, m); });
  (x?.profiles || []).forEach(rememberProfile);
  absorbExtras(list.map((m) => m.id), x);
  (x?.polls || []).forEach((p) => { pollByMsg.set(p.message_id, p); pollResults.set(p.id, []); });
  for (const r of x?.poll_results || []) pollResults.get(r.poll_id)?.push(r);
  return list;
}
function absorbExtras(ids, x) {
  ids.forEach((id) => { absorbed.add(id); if (!reactionsByMsg.has(id)) reactionsByMsg.set(id, []); });
  for (const r of x?.reactions || []) {
    if (reactionMsg.has(r.id)) continue;
    reactionMsg.set(r.id, r.message_id);
    reactionsByMsg.get(r.message_id)?.push(r);
  }
  (x?.stars || []).forEach((id) => starredIds.add(id));
}

// Live messages arrive one by one over realtime; only those still need their extras.
async function prepareBatch(list) {
  list.forEach((m) => messageCache.set(m.id, m));
  const ids = list.map((m) => m.id).filter((id) => !absorbed.has(id));
  if (!ids.length) return;
  const { data: x } = await sb.rpc("message_extras", { p_ids: ids });
  const replies = x?.replies || [];
  replies.forEach((m) => { if (!messageCache.has(m.id)) messageCache.set(m.id, m); });
  await getProfiles([...list.map((m) => m.user_id), ...replies.map((m) => m.user_id)]);
  absorbExtras(ids, x);
}

async function renderInitial(list) {
  await prepareBatch(list);
  const el = box();
  // No flicker: the skeleton moves to a cover layer, the real chat is built invisibly underneath,
  // pinned to the bottom while photos/cards settle, then the two cross-fade in one smooth step.
  const cover = document.createElement("div");
  cover.className = "messages chat-sk-cover";
  cover.setAttribute("aria-hidden", "true");
  while (el.firstChild) cover.appendChild(el.firstChild);
  el.parentElement.appendChild(cover);
  el.classList.add("chat-prep");
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
  await settleChat(el);
  el.classList.remove("chat-prep");
  cover.classList.add("gone");
  setTimeout(() => cover.remove(), 320);
}

// wait (briefly) for the last screenful of photos to get their size, re-pinning to the bottom
async function settleChat(el) {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  await frame(); scrollToBottom();
  const rows = [...el.querySelectorAll(".msg-row")].slice(-14);
  const imgs = rows.flatMap((r) => [...r.querySelectorAll("img")]).filter((i) => !i.complete);
  if (imgs.length) {
    await Promise.race([
      Promise.all(imgs.map((i) => new Promise((r) => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); }))),
      new Promise((r) => setTimeout(r, 450)),
    ]);
  }
  await frame(); scrollToBottom();
  await frame(); scrollToBottom();
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
        <a class="msg-name" href="${profileHref}">${escapeHTML(nameOf(m.user_id, author) || "Unknown")}</a>
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

/* ---------- voice notes: round play button, a waveform that fills as it plays ---------- */
const VN_BARS = 34;
function vnShape(seed) {
  // the same message always draws the same, speech-like wave
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  const out = [];
  let prev = 0.4;
  for (let i = 0; i < VN_BARS; i++) {
    const env = 0.55 + 0.45 * Math.sin((i / VN_BARS) * Math.PI);       // louder in the middle
    prev = Math.min(1, Math.max(0.12, prev * 0.45 + rnd() * 0.75 * env + (rnd() < 0.12 ? 0.3 : 0)));
    out.push(prev);
  }
  return out;
}
const vnTime = (s) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
const VN_PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';
const VN_PAUSE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.4" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.4" fill="currentColor"/></svg>';
let vnSeen = null;
function buildVoiceNote(m) {
  const wrap = document.createElement("div");
  wrap.className = "vn";
  const bars = vnShape(m.id || m.audio_url).map((v) => `<i style="--h:${(v * 100).toFixed(0)}%"></i>`).join("");
  wrap.innerHTML = `<button type="button" class="vn-play" aria-label="Play voice note">${VN_PLAY}</button>
    <div class="vn-body"><div class="vn-wave" role="slider" aria-label="Seek" tabindex="-1"><div class="vn-bars">${bars}</div><div class="vn-bars vn-fill">${bars}</div></div>
    <div class="vn-meta"><span class="vn-time">0:00</span><button type="button" class="aud-speed">1×</button></div></div>`;
  const audio = document.createElement("audio");
  audio.className = "chat-audio";
  audio.preload = "none";
  audio.src = m.audio_url;
  wrap.appendChild(audio);
  wireVoiceNote(wrap, audio);
  // read the length only once it scrolls into view, so a long chat doesn't fetch every clip
  vnSeen ||= new IntersectionObserver((ents) => ents.forEach((en) => {
    if (!en.isIntersecting) return;
    vnSeen.unobserve(en.target);
    const a = en.target.querySelector("audio");
    if (a && a.preload === "none") { a.preload = "metadata"; try { a.load(); } catch {} }
  }), { rootMargin: "200px" });
  vnSeen.observe(wrap);
  return wrap;
}
function wireVoiceNote(wrap, audio) {
  const btn = wrap.querySelector(".vn-play"), time = wrap.querySelector(".vn-time"), wave = wrap.querySelector(".vn-wave");
  let raf = 0, dur = NaN, fixing = false;
  const paint = () => {
    const d = Number.isFinite(audio.duration) ? audio.duration : dur;
    const p = d > 0 ? Math.min(1, audio.currentTime / d) : 0;
    wrap.style.setProperty("--p", p.toFixed(4));
    time.textContent = audio.paused && !audio.currentTime ? vnTime(d) : vnTime(audio.currentTime);
  };
  const loop = () => { paint(); if (!audio.paused) raf = requestAnimationFrame(loop); };
  audio.addEventListener("loadedmetadata", () => {
    // recorded webm clips often report an endless length until you jump to the end once
    if (audio.duration === Infinity && !fixing) {
      fixing = true;
      audio.addEventListener("durationchange", function once() {
        if (!Number.isFinite(audio.duration)) return;
        audio.removeEventListener("durationchange", once);
        dur = audio.duration; fixing = false; audio.currentTime = 0; paint();
      });
      audio.currentTime = 1e7;
    } else { dur = audio.duration; paint(); }
  });
  audio.addEventListener("play", () => {
    document.querySelectorAll(".vn.playing audio").forEach((a) => { if (a !== audio) a.pause(); });
    wrap.classList.add("playing"); btn.innerHTML = VN_PAUSE; btn.setAttribute("aria-label", "Pause voice note");
    cancelAnimationFrame(raf); loop();
  });
  audio.addEventListener("pause", () => { wrap.classList.remove("playing"); btn.innerHTML = VN_PLAY; btn.setAttribute("aria-label", "Play voice note"); cancelAnimationFrame(raf); paint(); });
  audio.addEventListener("ended", () => { audio.currentTime = 0; wrap.classList.add("heard"); paint(); });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (audio.paused) { audio.preload = "auto"; audio.play().catch(() => toast("Couldn't play this voice note.")); } else audio.pause();
  });
  wave.addEventListener("click", (e) => {
    e.stopPropagation();
    const d = Number.isFinite(audio.duration) ? audio.duration : dur;
    const r = wave.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (d > 0) { audio.currentTime = ratio * d; paint(); }
    if (audio.paused) audio.play().catch(() => {});
  });
}

function fillBubble(bubble, m, isOwn) {
  bubble.innerHTML = "";
  if (m.sticker_url && !m.content && !m.image_url) bubble.classList.add("sticker-only");
  // photo / video on its own: no bubble frame around it, just the rounded picture
  bubble.classList.toggle("media-only", !!((m.image_url || m.video_url) && !m.content && !m.reply_to && !m.shared_post_id && !m.view_once && !m.story_url));
  bubble.classList.toggle("has-audio", !!m.audio_url);

  if (m.reply_to) {
    const rp = document.createElement("div");
    rp.className = "reply-preview";
    rp.dataset.jump = m.reply_to;
    const orig = messageCache.get(m.reply_to);
    if (orig) rp.innerHTML = `<b>${escapeHTML(nameOf(orig.user_id) || "…")}</b>: ${escapeHTML(previewText(orig))}`;
    else {
      rp.textContent = "Original message";
      findMessageById(m.reply_to).then(async (o) => {
        if (!o) { rp.textContent = "Message deleted"; return; }
        const a = await getProfile(o.user_id);
        rp.innerHTML = `<b>${escapeHTML(nameOf(o.user_id, a) || "…")}</b>: ${escapeHTML(previewText(o))}`;
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
  if (m.audio_url) bubble.appendChild(buildVoiceNote(m));
  if (m.view_once) {
    const card = document.createElement("div");
    card.className = "vo-card";
    bubble.appendChild(card);
    paintVoCard(card, m, isOwn);
  }
  if (m.story_id || m.story_url) {
    // reply to a story: show the story it answers, Instagram style
    const sc = document.createElement("div");
    sc.className = "story-reply-card";
    sc.innerHTML = `<small>${svgIcon("reply", 11)} ${isOwn ? "You replied to their story" : "Replied to your story"}</small>${m.story_url ? `<img alt="Story" loading="lazy" decoding="async" />` : `<div class="src-gone">Story no longer available</div>`}`;
    if (m.story_url) sc.querySelector("img").src = m.story_url;
    bubble.classList.add("has-story");
    bubble.appendChild(sc);
  }
  if (m.image_url && !m.shared_post_id) {
    // photo + caption: the photo sits flush in the bubble with a thin inset, caption under it
    bubble.classList.toggle("photo-cap", !!m.content && !bubble.classList.contains("media-only"));
    const img = document.createElement("img");
    img.className = "chat-img is-loading";
    img.addEventListener("load", () => img.classList.remove("is-loading"), { once: true });
    img.addEventListener("error", () => img.classList.remove("is-loading"), { once: true });
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
    // shared post: a mini post card with the author's photo + name on top
    bubble.classList.add("has-sp");
    const a = document.createElement("a");
    a.className = "sp-card";
    a.href = `profile.html?post=${m.shared_post_id}`;
    a.innerHTML = `<div class="sp-head"><span class="avatar sp-av"></span><span class="sp-who"><b>Post</b><small></small></span></div>
      ${m.image_url ? `<img class="sp-img" alt="Post" loading="lazy" decoding="async" />` : ""}
      ${m.content ? `<div class="sp-cap"></div>` : ""}
      <div class="sp-foot shared-post-by">View post ${svgIcon("chevron", 12)}</div>`;
    if (m.image_url) a.querySelector(".sp-img").src = m.image_url;
    if (m.content) a.querySelector(".sp-cap").textContent = m.content;
    bubble.appendChild(a);
    sharedPostAuthor(m.shared_post_id).then((author) => {
      if (!author) { a.querySelector(".sp-who b").textContent = "Post unavailable"; return; }
      setAvatarContent(a.querySelector(".sp-av"), author);
      a.querySelector(".sp-who b").textContent = author.display_name || author.username;
      a.querySelector(".sp-who small").textContent = `@${author.username}`;
      a.href = `profile.html?u=${encodeURIComponent(author.username)}&post=${m.shared_post_id}`;
    });
  }

  if (m.content && !m.shared_post_id) {
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
    if (!txt.classList.contains("x3-has-card") && !m.image_url && !m.video_url && !m.shared_post_id && !m.is_system) attachLinkPreview(bubble, m.content);
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
  if (m.shared_post_id) return "📮 Shared a post";
  if (m.story_id && m.content) return `↩ Story: ${m.content.slice(0, 50)}`;
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

/* group calls: the header phone/video buttons + a "Join" banner while a call is on */
function wireGroupCall() {
  if (!window.GroupCall || !ME) return;
  const a = document.getElementById("callAudioBtn"), v = document.getElementById("callVideoBtn");
  a.style.display = v.style.display = "flex";
  a.title = "Group voice call"; v.title = "Group video call";
  a.onclick = () => GroupCall.join(false);
  v.onclick = () => GroupCall.join(true);
  if (document.getElementById("gcBanner")) return;
  GroupCall.watch(convo, ME);
  const b = document.createElement("div");
  b.id = "gcBanner"; b.className = "gc-banner";
  document.querySelector(".messages-wrap")?.prepend(b);
  GroupCall.mountBanner(b);
  GroupCall.onCount((n) => {
    a.classList.toggle("gc-live-btn", n > 0); v.classList.toggle("gc-live-btn", n > 0);
    document.querySelectorAll(".system-row .gc-join").forEach((j) => { j.hidden = !n; });
  });
}

function buildSystemRow(m) {
  const row = document.createElement("div");
  row.className = "system-row";
  row.dataset.msgId = m.id;
  const actor = profileCache.get(m.user_id);
  const who = m.user_id === ME.id ? "You" : (nameOf(m.user_id, actor) || "Someone");
  const text = m.content || "updated the chat";
  // one quiet line, like Instagram: "Riya added Aman · 4:12 PM"
  row.innerHTML = `<div class="system-chip"><span><b>${escapeHTML(who)}</b> ${escapeHTML(text)}</span><small>${formatTime(m.created_at)}</small></div>`;
  if (/^started a group call/.test(text) && window.GroupCall) {
    const j = document.createElement("button");
    j.type = "button"; j.className = "gc-join"; j.innerHTML = `${svgIcon("phone", 13)} Join`;
    j.hidden = !GroupCall.count();
    j.addEventListener("click", (e) => { e.stopPropagation(); GroupCall.join(false); });
    row.querySelector(".system-chip").appendChild(j);
  }
  row.title = new Date(m.created_at).toLocaleString();
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
    // only this chat's reactions (deletes carry no columns, so those stay unfiltered)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reactions", filter: f }, onReactionChange)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "message_reactions", filter: f }, onReactionChange)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "message_reactions" }, onReactionChange)
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
      if (status === "SUBSCRIBED") {
        // re-joined after a drop (bad network, phone slept): pull in what we missed
        if (channel._wasDown) { channel._wasDown = false; gapFill?.(); reloadMembersSoon(); }
        await channel.track({ user_id: ME.id, online_at: new Date().toISOString() });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        channel._wasDown = true;
      }
    });
  window.addEventListener("beforeunload", () => sendTypingState(false));
}

const reloadMembersSoon = debounce(async () => {
  const { data, error } = await fetchMemberRows();
  if (error) return;               // keep what we have rather than blanking the list
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
  try { window.ChatPlus?.onLive?.(list); } catch (e) { console.error(e); }
  // someone changed the disappearing timer → pick up the new setting
  // someone set a nickname → everyone in the chat sees it right away
  if (list.some((m) => m.is_system && /nickname/.test(m.content || ""))) reloadNicknames();
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
  const newRows = [];
  for (const m of list) {
    if (rendered.has(m.id)) continue;
    const row = appendNode(el, m);
    if (row) { row.classList.add("anim-in"); newRows.push(row); }
    added++;
    clearTypingUser(m.user_id);
    if (m.created_at > (newestAt || "")) newestAt = m.created_at;
    if (m.user_id !== ME.id && !m.is_system) messageEffect(m);
  }
  if (!added) return;
  mountPolls();
  if (stick) glideIn(newRows);
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
  // GTA 6 Vibes theme: a deleted message gets stamped before it vanishes
  if (document.documentElement.getAttribute("data-chat-theme") === "heist" && !row.dataset.stamped && row.querySelector(".bubble") && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    row.dataset.stamped = "1";
    const s = document.createElement("div");
    s.className = "caught-stamp"; s.textContent = "CAUGHT 🚨";
    row.querySelector(".bubble").appendChild(s);
    row.classList.add("is-caught");
    setTimeout(() => removeRow(id), 950);
    return;
  }
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
let gapFill = null;
function wireGapFill() {
  let leftAt = null;
  const fill = gapFill = async () => {
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

// The server counts what you missed and picks the most-reacted messages (chat_open).
function catchUp(cu) {
  if (!cu || cu.count < 5) return;
  (cu.profiles || []).forEach(rememberProfile);
  const top = cu.top || [];
  const counts = new Map(top.map((m) => [m.id, m.reacts]));
  const missed = { length: cu.count };

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

function welcomeCard(data) {
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
// Instagram-style arrival: the chat snaps to the bottom, then the rows already on
// screen glide up by the new rows' height while the new ones rise in — so nothing
// "jumps". Pure transforms on the visible rows only, so it stays 60fps.
const REDUCE_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
function glideIn(newRows, { own = false } = {}) {
  const el = box();
  const before = el.scrollHeight - el.scrollTop - el.clientHeight;
  el.scrollTop = el.scrollHeight;
  atBottom = true; newCount = 0; updateJumpButton();
  if (REDUCE_MOTION || !newRows.length || !newRows[0].animate) return;
  const first = newRows[0], last = newRows[newRows.length - 1];
  const shift = Math.min(last.getBoundingClientRect().bottom - first.getBoundingClientRect().top + 6, el.clientHeight * 0.6);
  if (shift <= 0 || before > el.clientHeight) return;   // came from far up: a plain snap reads better
  const ease = "cubic-bezier(.16,1,.3,1)";      // soft expo-out: fast start, long gentle settle
  const top = el.getBoundingClientRect().top;
  // older rows still visible on screen
  for (let r = first.previousElementSibling, n = 0; r && n < 24; r = r.previousElementSibling, n++) {
    if (r.getBoundingClientRect().bottom < top - shift) break;
    r.animate([{ transform: `translateY(${shift}px)` }, { transform: "none" }], { duration: 420, easing: ease });
  }
  for (const r of newRows) {
    r.classList.remove("anim-in");
    const origin = own ? "100% 100%" : "0 100%";
    r.animate([
      { transform: `translateY(${shift}px) scale(${own ? .9 : .92})`, opacity: own ? .5 : 0, transformOrigin: origin },
      { transform: "translateY(-2px) scale(1.012)", opacity: 1, offset: .62, transformOrigin: origin },
      { transform: "none", opacity: 1, transformOrigin: origin },
    ], { duration: own ? 440 : 480, easing: ease });
  }
}

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

/* ---------- nicknames (shared with everyone in this DM/group) ---------- */
const nicknames = new Map();
// the name to show for someone in this chat: their nickname here, else their real name
const nameOf = (uid, p = profileCache.get(uid)) => nicknames.get(uid) || p?.display_name;
function setNicknames(obj) {
  nicknames.clear();
  Object.entries(obj || {}).forEach(([uid, nick]) => nick && nicknames.set(uid, nick));
}
async function reloadNicknames() {
  const { data, error } = await sb.rpc("chat_nickname_map", { p_convo: convo.id });
  if (error) return;
  setNicknames(data);
  repaintNames();
}
function repaintNames() {
  renderHeader();
  document.querySelectorAll("#messages .msg-row[data-uid]").forEach((row) => {
    const nm = row.querySelector(".msg-name");
    const name = nameOf(row.dataset.uid);
    if (nm && name && nm.textContent !== name) nm.textContent = name;
  });
}

function renderHeader() {
  const av = document.getElementById("roomAvatar");
  const title = document.getElementById("roomTitle");
  const subtitle = document.getElementById("roomSubtitle");
  const link = document.getElementById("roomTitleLink");

  if (convo.kind === "dm") {
    title.textContent = nameOf(otherUser?.id, otherUser) || "Unknown";
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
    subtitle.textContent = "Always online · ask anything";
  } else {
    title.textContent = convo.name || (isPublic ? "Global room" : "Group");
  if (isPublic && convo.name) store.set("teaofrpm_pubrow", { ...(store.get("teaofrpm_pubrow") || {}), name: convo.name, pfp_url: convo.pfp_url || "" });
    setGroupAvatar(av, convo);
    link.removeAttribute("href");
    link.onclick = () => document.getElementById("roomInfoBtn").click();
    wireGroupCall();
  }
  document.title = `${title.textContent} — 𝓉𝑒𝒶𝑜𝒻𝓇𝓅𝓂`;
  paintVanishChip();
  applyChatTheme(convo.theme);
  if (!loadDbThemes.started) { loadDbThemes.started = true; loadDbThemes(); }
  window.ChatPlus?.applyLook?.();     // shared chat wallpaper
  renderPresence();
  const prev = store.get(headerKey()) || {};
  store.set(headerKey(), {
    // never cache "Online"/"typing…" — they'd be stale next time
    kind: convo.kind, title: title.textContent, theme: convo.theme || "default",
    sub: convo.kind === "dm" ? (otherUser ? `@${otherUser.username}` : "") : `${memberCount()} member${memberCount() === 1 ? "" : "s"}`,
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
  ["heist", "GTA 6 Vibes", "#12061f", "#fc3f93", "#2b1055"],
  // live (animated) backgrounds
  ["stars", "Starry night", "linear-gradient(180deg,#0b1026,#1b2550)", "#6d8cff", "#26325c"],
  ["northern", "Northern lights", "linear-gradient(160deg,#020617,#064e3b 55%,#312e81)", "#34d399", "#1e293b"],
  ["bubbles", "Bubbles", "linear-gradient(180deg,#0369a1,#0c4a6e)", "#22d3ee", "#0e5a85"],
  ["sakura", "Sakura", "linear-gradient(180deg,#fff1f5,#fbcfe8)", "#f472b6", "#fff"],
  ["hearts", "Love", "linear-gradient(180deg,#ffe4ec,#fecdd3)", "#e11d48", "#fff"],
  ["snow", "Snowfall", "linear-gradient(180deg,#1e3a5f,#3b6a9a)", "#60a5fa", "#2c5078"],
  ["fireflies", "Fireflies", "linear-gradient(180deg,#052e16,#020a05)", "#a3e635", "#14301d"],
  ["lava", "Lava lamp", "linear-gradient(180deg,#1a0505,#2b0a0a)", "#f97316", "#3a1414"],
  ["rain", "Rainy day", "linear-gradient(180deg,#1e293b,#0f172a)", "#38bdf8", "#273449"],
  ["confetti", "Party", "linear-gradient(135deg,#fffbeb,#fdf4ff)", "#ec4899", "#fff"],
  ["beach", "Beach sunset", "linear-gradient(180deg,#5b2a86,#f47c5c 70%,#e6a07a)", "#f97316", "#4b2670"],
  ["warp", "Hyperspace", "radial-gradient(circle,#3b1d7a,#03020a 70%)", "#8b5cf6", "#1e1b3a"],
];
const MOTION_COUNTS = { stars: 46, northern: 4, bubbles: 18, sakura: 16, hearts: 14, snow: 38, fireflies: 22, lava: 6, rain: 44, confetti: 26, beach: 1, warp: 1 };

// animated chat background: a layer of particles behind the messages, pure CSS
// transforms (GPU), paused whenever the app is in the background
function applyChatMotion(theme) {
  const wrap = document.querySelector(".messages-wrap");
  if (!wrap) return;
  const cur = wrap.querySelector(".chat-motion");
  const count = MOTION_COUNTS[theme];
  if (cur?.dataset.kind === theme) return;
  cur?.remove();
  if (!count) { document.documentElement.removeAttribute("data-chat-motion"); return; }
  document.documentElement.setAttribute("data-chat-motion", theme);
  // v47: detailed canvas scenes (js/livebg.js); the old CSS particles stay as a fallback
  if (window.LiveBG?.has(theme)) { const el = LiveBG.mount(wrap, theme); if (el) { wrap.prepend(el); return; } }
  const rnd = (a, b) => a + Math.random() * (b - a);
  let html = "";
  for (let i = 0; i < count; i++) html += `<i style="--x:${rnd(0, 100).toFixed(1)}%;--y:${rnd(0, 100).toFixed(1)}%;--s:${rnd(0.5, 1.4).toFixed(2)};--d:${rnd(7, 16).toFixed(1)}s;--delay:-${rnd(0, 16).toFixed(1)}s;--h:${Math.floor(rnd(0, 360))}"></i>`;
  if (theme === "stars") html += `<b class="shoot"></b><b class="shoot s2"></b>`;
  const layer = document.createElement("div");
  layer.className = `chat-motion cm-${theme}`;
  layer.dataset.kind = theme;
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = html;
  wrap.prepend(layer);
}
document.addEventListener("visibilitychange", () => document.documentElement.classList.toggle("cm-paused", document.hidden));

/* ---------- themes from the database (chat_themes): new ones need no app update ---------- */
const DB_THEMES = new Map();
function useDbThemes(list) {
  for (const t of list || []) {
    DB_THEMES.set(t.key, t);
    const row = [t.key, t.name, t.swatch_bg || "#1f1b2e", t.swatch_own || "#8b5cf6", t.swatch_other || "#2d2766"];
    const i = CHAT_THEMES.findIndex(([k]) => k === t.key);
    if (i >= 0) CHAT_THEMES[i] = row; else CHAT_THEMES.push(row);
  }
  let st = document.getElementById("dbThemeVars");
  if (!st) { st = document.createElement("style"); st.id = "dbThemeVars"; document.head.appendChild(st); }
  // only well-formed --ct-* variables get through
  st.textContent = [...DB_THEMES.values()].map((t) => `:root[data-chat-theme="${t.key.replace(/[^a-z0-9_-]/g, "")}"]{${Object.entries(t.vars || {})
    .filter(([k, v]) => /^--ct-[a-z0-9-]+$/.test(k) && !/[;{}<>]/.test(String(v))).map(([k, v]) => `${k}:${v}`).join(";")}}`).join("\n");
}
async function loadDbThemes() {
  useDbThemes(store.get("teaofrpm_dbthemes", []));
  const { data, error } = await sb.from("chat_themes")
    .select("key,name,swatch_bg,swatch_own,swatch_other,vars,is_dark,art_url,art_wide_url,art_dark_url,sort,version")
    .eq("builtin", false).eq("active", true).order("sort");
  if (error || !data) return;
  store.set("teaofrpm_dbthemes", data);
  useDbThemes(data);
  if (convo && DB_THEMES.has(convo.theme)) applyChatTheme(convo.theme);
  if (document.querySelector("#roomInfoSheet .theme-row")) renderThemeRow();
}

function applyChatTheme(theme) {
  const t = CHAT_THEMES.some(([k]) => k === theme) ? theme : "default";
  if (t === "default") document.documentElement.removeAttribute("data-chat-theme");
  else document.documentElement.setAttribute("data-chat-theme", t);
  applyChatMotion(t);
  const wrap = document.querySelector(".messages-wrap");
  const dbt = DB_THEMES.get(t);
  document.documentElement.toggleAttribute("data-ct-dark", !!dbt?.is_dark);
  if (wrap && window.ThemeArt) {
    if (dbt?.art_url) ThemeArt.applyUrl(wrap, dbt);
    else ThemeArt.apply(wrap, MOTION_COUNTS[t] ? "" : t);
  }
}

function renderThemeRow() {
  const body = document.querySelector("#roomInfoSheet .room-info-body");
  let row = body.querySelector(".theme-row");
  const canEdit = !isPublic || ME.role === "owner";
  if (!row) {
    row = document.createElement("div");
    row.className = "theme-row ri-acc";
    row.dataset.acc = "theme";
    (body.querySelector(".ri-slot-theme") || body).appendChild(row);
  }
  const cur = convo.theme || "default";
  const curT = CHAT_THEMES.find(([k]) => k === cur) || CHAT_THEMES[0];
  row.innerHTML = `<button type="button" class="ri-row ri-acc-head">${riRow("palette", "Chat theme", "",
      `<span class="ri-val"><i class="ri-dot" style="background:${curT[2]};box-shadow:inset 0 0 0 4px ${curT[3]}"></i>${escapeHTML(curT[1])}</span><span class="ri-chev">${svgIcon("chevronDown", 16)}</span>`)}</button>
    <div class="ri-acc-body"><span class="hint">${canEdit ? "Everyone in this chat sees the theme you pick." : "Only the owner can change the public room's theme."}</span>
    <div class="theme-grid">${CHAT_THEMES.map(([k, name, bg, own, other]) =>
      `<button type="button" class="theme-swatch${k === cur ? " on" : ""}${window.ThemeArt?.has(k) || DB_THEMES.get(k)?.art_url ? " has-art" : ""}" data-k="${k}" style="background:${window.ThemeArt?.has(k) ? `center/cover no-repeat url('data:image/svg+xml;charset=utf-8,${encodeURIComponent(ThemeArt.svgFor(k, document.documentElement.dataset.theme === "dark"))}'), ${bg}` : DB_THEMES.get(k)?.art_url ? `center/cover no-repeat url("${encodeURI(DB_THEMES.get(k).art_url)}"), ${bg}` : bg}" ${canEdit ? "" : "disabled"} aria-label="${escapeHTML(name)}">
        <i style="background:${other}"></i><i class="o" style="background:${own}"></i><i style="background:${other}"></i><em>${name}</em>${MOTION_COUNTS[k] ? `<s class="live">LIVE</s>` : ""}</button>`).join("")}</div></div>`;
  wireAccordion(row, "theme");
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
    row.className = "vanish-row ri-acc";
    row.dataset.acc = "vanish";
    (body.querySelector(".ri-slot-vanish") || body).appendChild(row);
  }
  row.innerHTML = `<button type="button" class="ri-row ri-acc-head">${riRow("clock", "Disappearing messages", "",
      `<span class="ri-val${convo.disappear_seconds ? " is-on" : ""}">${vanishLabel(convo.disappear_seconds ?? null)}</span><span class="ri-chev">${svgIcon("chevronDown", 16)}</span>`)}</button>
    <div class="ri-acc-body"><span class="hint">${canEdit ? "New messages vanish for everyone after the time you pick." : "Only group admins can change this."}</span>
    <div class="vanish-options">${VANISH.map(([v, l]) => `<button type="button" data-v="${v ?? ""}" class="${(convo.disappear_seconds ?? null) === v ? "on" : ""}" ${canEdit ? "" : "disabled"}>${l}</button>`).join("")}</div></div>`;
  wireAccordion(row, "vanish");
  row.querySelectorAll(".vanish-options button").forEach((b) => b.addEventListener("click", async () => {
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
  if (convo.kind === "bot") { sub.textContent = "Always online · ask anything"; sub.classList.add("is-online"); return; }

  if (convo.kind === "dm") {
    const other = members.find((m) => m.user_id !== ME.id);
    const isOnline = other && (online.has(other.user_id) || Presence.online.has(other.user_id));
    sub.textContent = isOnline ? "Online" : (otherUser ? `@${otherUser.username}` : "");
    sub.classList.toggle("is-online", !!isOnline);
    return;
  }
  const n = memberCount();
  const here = isPublic ? online.size : members.filter((m) => m.user_id !== ME.id && online.has(m.user_id)).length;
  sub.textContent = here ? `${n} members · ${here} here now` : `${n} member${n === 1 ? "" : "s"}`;
  sub.classList.toggle("is-online", here > 0);
}

// chat_open already carries this DM's streak row (or null)
function paintStreakRow(s) {
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

let typingBeatAt = 0;
function sendTypingState(typing) {
  if (!channel) return;
  // while you keep typing, a quiet heartbeat every 3 s stops the other side timing it out and flickering
  if (typing === isTypingBroadcasted && !(typing && Date.now() - typingBeatAt > 3000)) return;
  if (typing) typingBeatAt = Date.now();
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
  const wrap = el.parentElement, list = document.getElementById("messages");
  const ids = [...typingUsers.keys()];
  const names = ids.map((uid) => (nicknames.get(uid) || typingUsers.get(uid).display_name || "Someone").split(" ")[0]);
  if (!names.length) {
    if (!el.classList.contains("show")) return;
    el.classList.remove("show"); wrap.classList.remove("typing-on");
    el.dataset.key = "";
    renderPresence();
    return;
  }
  // build the bubble once; afterwards only swap faces/text, so the dots never restart mid-bounce
  if (!el.querySelector(".ty-bub")) {
    el.innerHTML = `<span class="ty-avs"></span><span class="ty-bub"><i></i><i></i><i></i></span><span class="ty-txt"></span>`;
  }
  const key = ids.join(",") + "|" + names.join(",");
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    const avs = el.querySelector(".ty-avs");
    avs.innerHTML = "";
    ids.slice(0, 3).forEach((uid) => {
      const a = document.createElement("span");
      a.className = "avatar ty-av";
      const p = profileCache.get(uid) || { id: uid, display_name: typingUsers.get(uid).display_name };
      try { setAvatarContent(a, p); } catch { a.textContent = (p.display_name || "?")[0]; }
      avs.appendChild(a);
    });
    el.querySelector(".ty-txt").textContent = convo.kind === "dm" ? ""
      : names.length === 1 ? names[0]
      : names.length === 2 ? `${names[0]} & ${names[1]}`
      : `${names[0]} +${names.length - 1}`;
  }
  if (!el.classList.contains("show")) {
    // make room under the last message so the bubble never covers it
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    el.classList.add("show"); wrap.classList.add("typing-on");
    if (nearBottom) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }
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
    if (t.closest(".aud-speed")) {
      const b = t.closest(".aud-speed"), a = (b.closest(".vn") || b.parentNode).querySelector("audio");
      const next = { "1×": 1.5, "1.5×": 2, "2×": 1 }[b.textContent] || 1;
      if (a) { a.playbackRate = next; a.preservesPitch = true; }
      b.textContent = `${next}×`;
      return;
    }
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
    if (t.matches("img.chat-img, img.sticker-img, .story-reply-card img")) { openMediaViewer(t.src); return; }
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
    const tapX = e.clientX, tapY = e.clientY;
    pending = setTimeout(() => {
      pending = null;
      // touch: a quick, playful response (the full menu is on long-press)
      if (!matchMedia("(hover: hover) and (pointer: fine)").matches) { tapResponse(row, tapX, tapY); return; }
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
    if (!selecting) {
      pressTimer = setTimeout(() => { srow = null; swipedAt = Date.now(); openMessageFocus(r); }, 430);
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
  // right-click on a computer opens the same menu
  el.addEventListener("contextmenu", (e) => {
    const r = e.target.closest(".msg-row[data-msg-id]");
    if (!r || selecting || e.target.closest("a, video, audio, input, textarea")) return;
    e.preventDefault();
    if (focusEl && focusEl.dataset.for === r.dataset.msgId) return;   // Android fires this after our long-press too
    openMessageFocus(r);
  });
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

/* ---------- link previews (WhatsApp-style cards) ---------- */
const LP_CACHE = new Map();
function firstLink(text) {
  const m = (text || "").match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  try {
    const u = new URL(m[0].replace(/[).,!?]+$/, ""));
    return u.hostname === location.hostname ? null : u.toString();
  } catch { return null; }
}
function loadPreview(url) {
  if (LP_CACHE.has(url)) return LP_CACHE.get(url);
  const p = (async () => {
    const k = "teaofrpm_lp_" + url;
    try { const c = sessionStorage.getItem(k); if (c) return JSON.parse(c); } catch {}
    try {
      const r = await fetch(`${window.TEAOFRPM_CONFIG.SUPABASE_URL}/functions/v1/link-preview?url=${encodeURIComponent(url)}`);
      if (!r.ok) return null;
      const d = await r.json();
      try { sessionStorage.setItem(k, JSON.stringify(d)); } catch {}
      return d;
    } catch { return null; }
  })();
  LP_CACHE.set(url, p);
  return p;
}
function attachLinkPreview(bubble, text) {
  const url = firstLink(text);
  if (!url) return;
  const host = new URL(url).hostname.replace(/^www\./, "");
  const isYT = /(?:youtube\.com\/(?:watch|shorts)|youtu\.be\/)/.test(url);
  const card = document.createElement("a");
  card.className = "link-card lc-loading";
  card.href = url; card.target = "_blank"; card.rel = "noopener noreferrer";
  card.innerHTML = `<div class="lc-body"><small>${escapeHTML(host)}</small><b class="lc-skel"></b></div>`;
  bubble.appendChild(card);
  loadPreview(url).then((d) => {
    card.classList.remove("lc-loading");
    if (!d || (!d.title && !d.image)) { card.classList.add("lc-min"); card.innerHTML = `<div class="lc-body"><small>${svgIcon("link", 12)} ${escapeHTML(host)}</small></div>`; return; }
    const stick = atBottom;
    card.innerHTML = `${d.image ? `<div class="lc-img"><img src="${escapeHTML(d.image)}" loading="lazy" alt="" referrerpolicy="no-referrer">${isYT ? `<span class="lc-play">▶</span>` : ""}</div>` : ""}
      <div class="lc-body"><small>${escapeHTML(d.site || host)}</small><b>${escapeHTML(d.title || host)}</b>${d.description ? `<span>${escapeHTML(d.description)}</span>` : ""}</div>`;
    card.querySelector(".lc-img img")?.addEventListener("error", (e) => e.target.parentNode.remove());
    if (stick) box().scrollTop = box().scrollHeight;
  });
}

/* ---------- quick replies (saved phrases, one tap to send) ---------- */
const QUICK_KEY = "teaofrpm_quick_replies";
const quickReplies = () => store.get(QUICK_KEY) || ["Sure 👍", "Busy right now, talk later", "Where are you? 👀", "In class 📚", "Ok done ✅", "Thank you 🙏", "Good night 🌙"];
function openQuickReplies(input) {
  const s = makeSheet({ title: "Quick replies", html: `<div class="qr-list"></div>
    <div class="qr-add"><input type="text" maxlength="200" placeholder="Add a reply you send a lot…" /><button type="button" class="btn btn-small">Add</button></div>
    <p class="x3-hint" style="margin-top:8px">Tap to send · hold × to remove</p>` });
  const list = s.body.querySelector(".qr-list");
  const paint = () => {
    list.innerHTML = quickReplies().map((q, i) => `<div class="qr-row"><button type="button" class="qr-send" data-i="${i}">${escapeHTML(q)}</button><button type="button" class="qr-x" data-x="${i}" aria-label="Remove">${svgIcon("close", 13)}</button></div>`).join("") || `<div class="settings-empty">No quick replies yet.</div>`;
  };
  paint();
  list.addEventListener("click", (e) => {
    const x = e.target.closest("[data-x]");
    if (x) { const l = quickReplies(); l.splice(Number(x.dataset.x), 1); store.set(QUICK_KEY, l); paint(); return; }
    const b = e.target.closest("[data-i]");
    if (b) { s.close(); input.value = quickReplies()[Number(b.dataset.i)]; refreshSendState(); setTimeout(sendMessage, 60); }
  });
  const inp = s.body.querySelector(".qr-add input");
  const add = () => { const v = inp.value.trim(); if (!v) return; store.set(QUICK_KEY, [v, ...quickReplies()].slice(0, 30)); inp.value = ""; paint(); };
  s.body.querySelector(".qr-add button").addEventListener("click", add);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  s.onClose = () => setTimeout(() => s.el.remove(), 300);
  s.open();
}

function pickAnyReaction(messageId) {
  EmojiPicker.open({ title: "React", onPick: (emoji) => {
    const mine = (reactionsByMsg.get(messageId) || []).some((r) => r.user_id === ME.id && r.emoji === emoji);
    if (!mine) toggleReaction(messageId, emoji);
  } });
}

function speak(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/https?:\/\/\S+/g, "link"));
    u.lang = /[\u0900-\u097F]/.test(text) ? "hi-IN" : "en-IN";
    u.rate = 1;
    speechSynthesis.speak(u);
  } catch { toast("Read-aloud isn't available on this phone"); }
}

async function replyPrivately(m) {
  const { data, error } = await sb.rpc("get_or_create_dm", { other_user: m.user_id });
  if (error || !data) { toast(friendlyError(error, "Could not open chat.")); return; }
  store.setRaw(`teaofrpm_draft_${data}`, `↩️ "${(m.content || previewText(m)).slice(0, 80)}" — `);
  location.href = `room.html?c=${data}`;
}

// Instagram-style: hold a message → the chat blurs, the message lifts, reactions on top, actions below
let focusEl = null, focusOpenedAt = 0;
function closeMessageFocus() {
  if (!focusEl) return;
  const f = focusEl; focusEl = null;
  f.classList.remove("show");
  setTimeout(() => f.remove(), 220);
}
// A single tap on a message: the bubble squishes, a ripple spreads from your finger
// and the exact time (plus seen / edited) pops up underneath for a moment.
function tapResponse(row, x, y) {
  const bubble = row.querySelector(".bubble"), m = messageCache.get(row.dataset.msgId);
  if (!bubble || !m) return;
  buzz(6);
  bubble.classList.remove("tap-pop"); void bubble.offsetWidth; bubble.classList.add("tap-pop");
  const r = bubble.getBoundingClientRect(), rip = document.createElement("span");
  rip.className = "tap-ripple";
  rip.style.left = `${(x || r.left + r.width / 2) - r.left}px`; rip.style.top = `${(y || r.top + r.height / 2) - r.top}px`;
  bubble.appendChild(rip);
  setTimeout(() => rip.remove(), 650);
  document.querySelectorAll(".tap-info").forEach((x) => x.remove());
  const d = new Date(m.created_at), today = d.toDateString() === new Date().toDateString();
  const bits = [`${today ? "Today" : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`];
  if (m.edited_at) bits.push("edited");
  const react = (reactionsByMsg.get(m.id) || []).length;
  if (react) bits.push(`${react} reaction${react > 1 ? "s" : ""}`);
  const info = document.createElement("div");
  info.className = "tap-info";
  info.innerHTML = `${escapeHTML(bits.join(" · "))}<span>Hold for more</span>`;
  bubble.parentNode.insertBefore(info, bubble.nextSibling);
  clearTimeout(tapResponse._t);
  tapResponse._t = setTimeout(() => { info.classList.add("out"); setTimeout(() => info.remove(), 250); }, 2200);
}

function openMessageFocus(row) {
  document.querySelectorAll(".tap-info").forEach((x) => x.remove());
  closeMessageFocus();
  closeMoreMenu();
  document.querySelectorAll(".emoji-picker").forEach((p) => p.remove());
  const id = row.dataset.msgId, m = messageCache.get(id);
  const bubble = row.querySelector(".bubble");
  if (!m || !bubble || id.startsWith("tmp-") || m.deleted || m.is_system) return;
  const own = row.classList.contains("own");
  const saved = starredIds.has(id), pinned = convo.pinned_message_id === id;
  const mine = new Set((reactionsByMsg.get(id) || []).filter((r) => r.user_id === ME.id).map((r) => r.emoji));
  const QUICK = [...new Set(["❤️", "😂", "😮", "😢", "🔥", "👍", ...EmojiPicker.recents()])].slice(0, 6);
  const acts = [
    ["reply", "Reply", () => startReply(m)],
    ...(m.content ? [["copy", "Copy", () => copyText(m.content)]] : []),
    ["forward", "Forward", () => forwardMessage(m)],
    ["star", saved ? "Unsave" : "Save", () => toggleStar(id)],
    ["pin", pinned ? "Unpin" : "Pin", () => setPinned(pinned ? null : id)],
    ...(m.content && "speechSynthesis" in window ? [["volume", "Read aloud", () => speak(m.content)]] : []),
    ...(own && m.content && !m.shared_post_id ? [["edit", "Edit", () => startEditMessage(m, rendered.get(id)?.querySelector(".bubble"))]] : []),
    ...(own && !isPublic && convo.kind !== "bot" ? [["eye", "Info", () => openMessageInfo(m)]] : []),
    ...(own ? [["select", "Select", () => startSelecting(rendered.get(id) || row)]] : []),
    ...(!own && convo.kind !== "dm" && convo.kind !== "bot" && m.user_id && !m.is_bot ? [["send", "Reply privately", () => replyPrivately(m)]] : []),
    ...(window.ChatPlus ? ChatPlus.focusActions(m, own, row) : []),
    ...(own ? [["trash", "Unsend", () => deleteMessage(id), "danger"]] : [["flag", "Report", () => reportSheet("message", id), "danger"]]),
  ];

  const f = document.createElement("div");
  f.className = "mf-overlay";
  f.dataset.for = id;
  f.innerHTML = `<div class="mf-stack ${own ? "own" : ""}">
      <div class="mf-react">${QUICK.map((e) => `<button type="button" data-r="${e}" class="${mine.has(e) ? "on" : ""}">${e}</button>`).join("")}<button type="button" class="mf-more" data-r="+" aria-label="All emoji">${svgIcon("plus", 18)}</button></div>
      <div class="mf-bubble-slot"></div>
      <div class="mf-acts">${acts.map(([ic, label, , cls], i) => `<button type="button" data-a="${i}" class="${cls || ""}"><span>${label}</span>${svgIcon(ic, 18)}</button>`).join("")}
        <div class="mf-time">${escapeHTML(new Date(m.created_at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}</div></div>
    </div>`;
  // the lifted copy keeps the chat's bubble styles by living inside a message-row shell
  const shell = document.createElement("div");
  shell.className = row.className.replace(/\b(show-actions|anim-in|sending|slow|selected)\b/g, "") + " mf-row";
  const clone = bubble.cloneNode(true);
  clone.querySelectorAll(".msg-actions, .emoji-picker, .upload-progress, video, audio").forEach((x) => {
    if (x.tagName === "VIDEO" || x.tagName === "AUDIO") { const ph = document.createElement("div"); ph.className = "mf-media"; ph.textContent = x.tagName === "VIDEO" ? "🎥 Video" : "🎤 Voice note"; x.replaceWith(ph); }
    else x.remove();
  });
  clone.style.maxWidth = `${Math.min(bubble.offsetWidth, innerWidth - 32)}px`;
  shell.appendChild(clone);
  f.querySelector(".mf-bubble-slot").appendChild(shell);
  document.body.appendChild(f);
  focusEl = f; focusOpenedAt = Date.now();
  buzz(14);

  // place it: the message stays where it was if the menu fits, otherwise the stack slides into view
  const stack = f.querySelector(".mf-stack");
  const rect = bubble.getBoundingClientRect();
  const reactH = f.querySelector(".mf-react").offsetHeight + 10;
  const safeTop = 12 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sat")) || 0);
  const actsEl = f.querySelector(".mf-acts"), slot = f.querySelector(".mf-bubble-slot");
  const room = innerHeight - safeTop - 8 - reactH - slot.offsetHeight - 10 - 20;
  actsEl.style.maxHeight = `${Math.max(176, Math.min(actsEl.scrollHeight, room))}px`;
  if (actsEl.scrollHeight > actsEl.clientHeight + 4) {
    actsEl.classList.add("mf-scroll");
    actsEl.addEventListener("scroll", () => actsEl.classList.toggle("mf-end", actsEl.scrollTop + actsEl.clientHeight >= actsEl.scrollHeight - 4), { passive: true });
  }
  const ideal = rect.top - reactH;
  const top = Math.max(safeTop + 8, Math.min(ideal, innerHeight - stack.offsetHeight - 16));
  stack.style.top = `${top}px`;
  stack.style.setProperty("--from", `${ideal - top}px`);
  void f.offsetWidth;          // commit the start state so the open animation always plays
  f.classList.add("show");

  f.addEventListener("click", (e) => {
    if (Date.now() - focusOpenedAt < 350) return;    // the finger lifting from the long-press
    const r = e.target.closest("[data-r]");
    if (r) {
      closeMessageFocus();
      if (r.dataset.r === "+") { pickAnyReaction(id); return; }
      EmojiPicker.remember(r.dataset.r);
      toggleReaction(id, r.dataset.r);
      return;
    }
    const a = e.target.closest("[data-a]");
    if (a) { closeMessageFocus(); setTimeout(() => acts[Number(a.dataset.a)][2](), 120); return; }
    if (!e.target.closest(".mf-bubble-slot")) closeMessageFocus();
  });
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMessageFocus(); });
window.addEventListener("popstate", closeMessageFocus);

function openEmojiPicker(bubble, messageId) {
  document.querySelectorAll(".emoji-picker").forEach((e) => e.remove());
  const quick = ["❤️", "😂", "👍", "😮", "😢", "🙏", "🔥", "🎉", "😍", "😡", "👏", "💯"];
  const picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.innerHTML = quick.map((e) => `<span role="button" tabindex="0">${e}</span>`).join("") + `<span role="button" tabindex="0" class="ep-more" aria-label="All emoji">${svgIcon("plus", 15)}</span>`;
  bubble.appendChild(picker);
  picker.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = e.target.closest("span[role=button]");
    if (!s) return;
    picker.remove();
    if (s.classList.contains("ep-more")) { pickAnyReaction(messageId); return; }
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
  const { data, error } = await sb.rpc("my_conversations_v2");
  const list = s.body.querySelector(".settings-list");
  if (error) { list.innerHTML = `<div class="settings-empty">Could not load your chats.</div>`; return; }
  const chats = [{ id: PUBLIC_ROOM_ID, kind: "group", name: store.get("teaofrpm_pubrow")?.name || "Global room" }, ...(data || [])];
  await getProfiles(chats.map((c) => c.other_user_id));
  list.innerHTML = "";
  for (const c of chats) {
    const other = c.other_user_id ? profileCache.get(c.other_user_id) : null;
    const label = c.kind === "dm" ? (c.nick || other?.display_name || "Chat") : (c.name || "Group");
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
  // polls that came with the page need no request; only brand-new ones are fetched
  const missing = [...byMsg.keys()].filter((id) => !pollByMsg.has(id));
  let data = [...byMsg.keys()].map((id) => pollByMsg.get(id)).filter(Boolean);
  if (missing.length) {
    const { data: fresh } = await sb.from("polls").select("*").in("message_id", missing);
    (fresh || []).forEach((p) => pollByMsg.set(p.message_id, p));
    data = data.concat(fresh || []);
  }
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
  let data;
  if (ids.every((id) => pollResults.has(id))) {          // results came with the page (used once)
    data = ids.flatMap((id) => pollResults.get(id));
    ids.forEach((id) => pollResults.delete(id));
  } else {
    const res = await sb.rpc("poll_results", { p_polls: ids });
    if (res.error) return;
    data = res.data;
  }
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

let mentionToken = 0;
const _mentionCache = new Map();
async function mentionCandidates(q) {
  const key = q;
  if (!_mentionCache.has(key)) {
    _mentionCache.set(key, new Promise((r) => setTimeout(r, q ? 120 : 0)).then(() =>
      sb.rpc("mention_candidates", { p_conversation: convo.id, p_query: q, p_limit: 8 })).then(({ data, error }) => {
      if (error) { _mentionCache.delete(key); return []; }
      (data || []).forEach((p) => { if (!profileCache.has(p.id)) rememberProfile(p); });
      return data || [];
    }));
    setTimeout(() => _mentionCache.delete(key), 60000);
  }
  return _mentionCache.get(key);
}

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
    // only people in THIS chat, looked up on the server (never the whole school)
    const q = m[1].toLowerCase();
    const my = ++mentionToken;
    const people = await mentionCandidates(q);
    if (my !== mentionToken || input.value.slice(0, input.selectionStart) !== upto) return;
    items = people.slice(0, 6).map((p) => ({ title: "@" + p.username, sub: p.display_name, username: p.username }));
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
  if (revoke) { dropUpload(pendingImageFile); dropUpload(pendingVideoFile); }   // removed, not sent
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
  vo.hidden = !hasMedia || convo?.kind === "bot";
  vo.classList.toggle("on", pendingViewOnce);
  vo.innerHTML = `${svgIcon("once", 15)}${pendingViewOnce ? "View once" : ""}`;
  ed.hidden = !pendingImageFile || !pendingOriginal;
  ed.innerHTML = `${svgIcon("pen", 14)}Edit`;
}

async function handlePickedImage(file, label, { viewOnce = false } = {}) {
  if ((file.type || "").startsWith("video/")) return handlePickedVideo(file, { viewOnce });
  clearPendingAudio();
  let edited = file;
  // GIFs go as they are, so they keep moving (the editor would flatten them to a JPEG)
  if (file.type === "image/gif") {
    if (file.size > 6 * 1024 * 1024) { toast("That GIF is too big (max 6 MB)."); return; }
    dropUpload(pendingImageFile); dropUpload(pendingVideoFile);
    pendingImageFile = file; pendingOriginal = null; pendingVideoFile = null; pendingViewOnce = false;
    startChatImage(file);
    if (pendingImagePreviewUrl) URL.revokeObjectURL(pendingImagePreviewUrl);
    pendingImagePreviewUrl = URL.createObjectURL(file);
    document.getElementById("attachImg").src = pendingImagePreviewUrl;
    document.getElementById("attachName").textContent = label || "GIF";
    const ap = document.getElementById("attachPreview"); ap.classList.add("show"); ap.classList.remove("is-video");
    paintAttachOpts(); refreshSendState();
    return;
  }
  if (window.MediaEditor) {
    edited = await MediaEditor.edit(file, { title: "Send photo", doneLabel: "Next", aspects: ["original", "1:1", "4:5", "9:16", "16:9"] });
    if (!edited) { document.getElementById("imageInput").value = ""; return; }
  }
  document.getElementById("attachName").textContent = "Processing photo…";
  document.getElementById("attachPreview").classList.add("show");
  document.getElementById("attachPreview").classList.remove("is-video");
  try {
    const blob = await compressImageFile(edited);
    dropUpload(pendingImageFile); dropUpload(pendingVideoFile);
    pendingImageFile = blob;
    startChatImage(blob);
    pendingOriginal = file;
    pendingVideoFile = null;
    pendingViewOnce = viewOnce && convo?.kind !== "bot";
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

const chatImageUpload = (blob) => () => uploadPublic("chat-images", `${ME.id}/${fileId()}.${blob.type === "image/gif" ? "gif" : "jpg"}`, blob, blob.type === "image/gif" ? "image/gif" : undefined);
function startChatImage(blob) { if (ME) uploadSoon(blob, chatImageUpload(blob)); }

const VIDEO_MAX = 500 * 1024 * 1024;        // big ones go to Telegram in parts
const STORAGE_VIDEO_MAX = 50 * 1024 * 1024; // Supabase bucket limit
function handlePickedVideo(file, { viewOnce = false } = {}) {
  clearPendingAudio();
  if (file.size > VIDEO_MAX) { toast("Videos must be under 500 MB."); document.getElementById("imageInput").value = ""; return; }
  clearPendingImage();
  pendingVideoFile = file;
  if (ME) uploadSoon(file, (rep) => uploadVideo(file, rep));
  pendingViewOnce = viewOnce && convo?.kind !== "bot";
  pendingVideoUrl = URL.createObjectURL(file);
  const v = document.getElementById("attachVideo");
  v.src = pendingVideoUrl + "#t=0.1";
  const prev = document.getElementById("attachPreview");
  prev.classList.add("show", "is-video");
  document.getElementById("attachName").textContent = `🎥 Video · ${(file.size / 1048576).toFixed(1)} MB`;
  paintAttachOpts();
  refreshSendState();
}

// Where videos live:
//  • up to 50 MB → Supabase storage first (fastest to play). A server job keeps only the
//    newest 5 there and moves older ones to our Telegram channel automatically.
//  • bigger (or if storage fails) → straight to Telegram, cut into 19 MB parts.
let tgStatus = null;
const TG_FN = () => `${window.TEAOFRPM_CONFIG.SUPABASE_URL}/functions/v1/tg-media`;

function tgPost(url, body, token, onProgress, contentType) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let r = {};
      try { r = JSON.parse(xhr.responseText); } catch {}
      xhr.status < 300 && !r.error ? resolve(r) : reject(new Error(r.error || `upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(body);
  });
}

async function uploadVideoTelegram(file, onProgress) {
  if (tgStatus === null) {
    try { tgStatus = await (await fetch(`${TG_FN()}?status=1`)).json(); } catch { tgStatus = { telegram: false }; }
  }
  if (!tgStatus.telegram) throw new Error("Video storage isn't available right now — try a shorter video.");
  const { data } = await sb.auth.getSession();
  const token = data.session.access_token;
  const CH = tgStatus.chunk || 19 * 1024 * 1024;

  if (file.size <= CH) {
    const fd = new FormData();
    fd.append("file", file, file.name || "video.mp4");
    return (await tgPost(TG_FN(), fd, token, onProgress)).url;
  }
  const start = await tgPost(`${TG_FN()}?op=start`, JSON.stringify({ size: file.size, mime: file.type || "video/mp4" }), token, null, "application/json");
  let url = null;
  for (let i = 0; i < start.parts; i++) {
    const piece = file.slice(i * start.chunk, Math.min(file.size, (i + 1) * start.chunk));
    let r, tries = 0;
    while (true) {
      try {
        r = await tgPost(`${TG_FN()}?op=part&id=${start.id}&i=${i}`, piece, token,
          (p) => onProgress?.((i + p) / start.parts), "application/octet-stream");
        break;
      } catch (e) {
        if (++tries >= 3) throw e;          // a flaky network gets two more chances per part
        await new Promise((res) => setTimeout(res, 1500 * tries));
      }
    }
    if (r.done) url = r.url;
  }
  if (!url) throw new Error("The upload didn't finish — please try again.");
  return url;
}

async function uploadVideo(file, onProgress) {
  if (file.size <= STORAGE_VIDEO_MAX) {
    try {
      onProgress?.(0.1);
      const ext = ((file.name || "").match(/\.(\w{2,4})$/) || [, "mp4"])[1].toLowerCase();
      const url = await uploadPublic("chat-videos", `${ME.id}/${Date.now()}.${ext}`, file, file.type || "video/mp4");
      onProgress?.(1);
      return url;
    } catch (e) {
      console.warn("storage upload failed, sending to Telegram", e);
    }
  }
  const url = await uploadVideoTelegram(file, onProgress);
  onProgress?.(1);
  return url;
}

async function openViewOnce(m, card) {
  const { data, error } = await sb.rpc("open_view_once", { p_message: m.id });
  if (error) { toast(friendlyError(error, "Can't open this.")); if (/opened/i.test(error.message || "")) markVoOpened(card); return; }
  // Screenshots can't be blocked from a web page, so we make them hard and traceable:
  // the photo only shows while you press and hold, it's drawn on a canvas (no "save image"),
  // it carries the viewer's @username as a watermark, and it vanishes the instant the app
  // loses focus (screenshot tools, recents screen, screen recorder overlays).
  const v = document.createElement("div");
  v.className = "vo-viewer vo-guard";
  const secs = data.kind === "video" ? 0 : 12;
  const mark = `@${ME.username || "me"} · ${new Date().toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  const svgMark = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="150"><text x="10" y="80" transform="rotate(-24 130 75)" font-family="Inter,Arial" font-size="15" font-weight="700" fill="white" fill-opacity=".34">${escapeHTML(mark)}</text></svg>`;
  v.innerHTML = `<div class="vo-bar"><span>${svgIcon("once", 16)} View once</span><button type="button">Close</button></div>
    ${secs ? `<div class="vo-ring" style="animation-duration:${secs}s"></div>` : ""}
    <div class="vo-media">${data.kind === "video" ? `<video src="${escapeHTML(data.url)}" playsinline muted controlslist="nodownload noplaybackrate noremoteplayback" disablepictureinpicture disableremoteplayback></video>` : `<canvas></canvas>`}
      <div class="vo-mark" style="background-image:url('data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMark)}')"></div></div>
    <div class="vo-hint">${svgIcon("eye", 18)} Press &amp; hold to view</div>`;
  ["contextmenu", "dragstart", "selectstart", "copy"].forEach((ev) => v.addEventListener(ev, (e) => e.preventDefault()));
  document.body.appendChild(v);
  AppNav.hide?.();
  const vid = v.querySelector("video"), cv = v.querySelector("canvas"), ring = v.querySelector(".vo-ring");
  if (cv) {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(innerWidth * devicePixelRatio / img.width, innerHeight * devicePixelRatio / img.height, 1.5);
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    };
    img.src = data.url;
  }
  if (vid) { vid.muted = false; vid.addEventListener("ended", close); }
  // the 12 s only tick while you're holding
  let left = secs * 1000, since = 0, t = null, closed = false;
  const hold = (on) => {
    if (closed) return;
    v.classList.toggle("holding", on);
    if (ring) ring.style.animationPlayState = on ? "running" : "paused";
    if (vid) { if (on) vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); }); else vid.pause(); }
    if (!secs) return;
    if (on) { since = Date.now(); t = setTimeout(close, left); }
    else if (since) { left -= Date.now() - since; since = 0; clearTimeout(t); }
  };
  v.addEventListener("pointerdown", (e) => { if (!e.target.closest(".vo-bar")) { e.preventDefault(); hold(true); } });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => v.addEventListener(ev, () => hold(false)));
  // a web page can't block screenshots, but it can notice the usual signs and tell the sender
  let reported = false;
  const caught = () => {
    if (reported) return; reported = true;
    sb.rpc("report_view_once_capture", { p_message: m.id }).then(({ data }) => { if (data) toast("The sender will see that you took a screenshot."); });
  };
  const away = () => { if (v.classList.contains("holding")) caught(); close(); };
  const keys = (e) => { if (e.key === "PrintScreen" || (e.metaKey && e.shiftKey) || (e.ctrlKey && e.key === "p")) { e.preventDefault(); caught(); close(); } };
  // three-finger screenshot swipe (most Android phones)
  const fingers = new Set();
  v.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") { fingers.add(e.pointerId); if (fingers.size >= 3) { caught(); close(); } } });
  ["pointerup", "pointercancel"].forEach((ev) => v.addEventListener(ev, (e) => fingers.delete(e.pointerId)));
  document.addEventListener("visibilitychange", away);
  addEventListener("blur", away);
  addEventListener("keydown", keys, true);
  function close() {
    if (closed) return; closed = true;
    clearTimeout(t);
    document.removeEventListener("visibilitychange", away); removeEventListener("blur", away); removeEventListener("keydown", keys, true);
    if (cv) { cv.width = 1; cv.height = 1; }
    if (vid) { vid.pause(); vid.removeAttribute("src"); vid.load(); }
    v.remove(); AppNav.show?.(); markVoOpened(card);
  }
  v.querySelector(".vo-bar button").addEventListener("click", close);
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
  const { data } = await sb.from("view_once_opens").select("user_id, captured_at").eq("message_id", m.id);
  const opens = data || [];
  if (isOwn) {
    card.classList.toggle("opened", opens.length > 0);
    const caps = opens.filter((o) => o.captured_at).length;
    card.querySelector("small").textContent = (opens.length ? (convo.kind === "dm" ? "Opened ✓" : `Opened by ${opens.length}`) : "Not opened yet") + (caps ? ` · 📸 ${caps}` : "");
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
  document.getElementById("replyToName").textContent = m.user_id === ME.id ? "yourself" : (nameOf(m.user_id, author) || "Unknown");
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
  try { if (window.ChatPlus && !sticker && ChatPlus.beforeSend(input) === false) return; } catch (e) { console.error(e); }
  const text = input.value.trim();
  if (!text && !pendingImageFile && !pendingVideoFile && !pendingAudioBlob && !sticker) return;
  if (!convo || !ME) { toast("Still connecting — one sec…", 1500); return; }

  const viewOnce = pendingViewOnce && !!(pendingImageFile || pendingVideoFile);
  // a view-once photo travels alone; any typed text follows as its own message
  if (viewOnce && text) setTimeout(() => { input.value = text; sendMessage(); }, 400);
  const payload = {
    // the id is made here, so a retry after a dropped connection can never create a second copy
    ...(crypto.randomUUID ? { id: crypto.randomUUID() } : {}),
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
  const tempRow = appendNode(box(), temp);
  if (tempRow) glideIn([tempRow], { own: true }); else scrollToBottom();
  try { dispatchEvent(new Event("tea:sent")); } catch { /* live background reaction is optional */ }
  navigator.vibrate?.(8);   // tiny tap feel on Android
  // only say "sending…" if it's actually slow (bad network) — instant sends stay clean
  setTimeout(() => rendered.get(tmpId)?.classList.add("slow"), 900);

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
          ? await takeUpload(files.video, (rep) => uploadVideo(files.video, rep), progress)
          : await takeUpload(files.image, chatImageUpload(files.image));
      }
      const { data: id, error } = await sb.rpc("send_view_once", { p_conversation: convo.id, p_url: entry.mediaUrl, p_kind: files.video ? "video" : "image" });
      if (error) throw error;
      if (!entry.real) adopt(entry, { ...payload, id, created_at: new Date().toISOString(), view_once: true, deleted: false });
      return;
    }
    if (files.video && !payload.video_url) {
      progress(0.02);
      payload.video_url = await takeUpload(files.video, (rep) => uploadVideo(files.video, rep), progress);
      progress(1);
    } else if (files.image && !payload.image_url) {
      payload.image_url = await takeUpload(files.image, chatImageUpload(files.image));
    } else if (files.audio && !payload.audio_url) {
      const ext = (files.audio.type || "").includes("mp4") ? "m4a" : "webm";
      payload.audio_url = await uploadPublic("voice-notes", `${ME.id}/${Date.now()}.${ext}`, files.audio, files.audio.type || "audio/webm");
    }
    const { data, error } = await sb.from("messages").insert(payload).select().single();
    if (error) {
      // already saved by an earlier attempt whose reply got lost: just pick that copy up
      if (error.code === "23505" && payload.id) {
        const { data: got } = await sb.from("messages").select("*").eq("id", payload.id).maybeSingle();
        if (got) { if (!entry.real) adopt(entry, got); return; }
      }
      throw error;
    }
    if (!entry.real) adopt(entry, data);
  } catch (err) {
    if (entry.real) return;
    // flaky network: try again quietly a few times before showing "not sent"
    const netFail = !navigator.onLine || err instanceof TypeError || /fetch|network|timeout|load failed/i.test(err?.message || "") || err?.status === 0 || (err?.status >= 500);
    const safeToRepeat = !files.viewOnce || !entry.mediaUrl;   // view-once RPC is not idempotent
    entry.tries = (entry.tries || 0) + 1;
    if (netFail && safeToRepeat && entry.tries <= 3 && pendingSends.includes(entry)) {
      setTimeout(() => { if (!entry.real && pendingSends.includes(entry)) deliver(entry); }, [1000, 3000, 8000][entry.tries - 1]);
      return;
    }
    entry.failed = true;
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
      entry.tries = 0; entry.failed = false;
      deliver(entry);
    } },
    { icon: "trash", label: "Delete", danger: true, onClick: () => {
      pendingSends.splice(pendingSends.indexOf(entry), 1);
      removeRow(tmpId);
      messageCache.delete(tmpId);
    } },
  ]);
}

// back online: anything that gave up while offline goes out by itself, in order
addEventListener("online", () => {
  for (const entry of pendingSends.filter((p) => p.failed && !p.real && (!p.files.viewOnce || !p.mediaUrl))) {
    const temp = messageCache.get(entry.tmpId), row = rendered.get(entry.tmpId);
    if (temp) temp._failed = false;
    if (row) { row.classList.remove("failed"); row.classList.add("sending"); fillBubble(row.querySelector(".bubble"), temp, true); }
    entry.tries = 0; entry.failed = false;
    deliver(entry);
  }
});

// Realtime may deliver our own message before the insert call returns.
function adoptPending(m) {
  const byId = m.id && pendingSends.find((p) => !p.real && p.payload.id === m.id);
  if (byId) { adopt(byId, m); return true; }
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
    panel.addEventListener("click", async (e) => {
      const img = e.target.closest("img[data-url]");
      if (!img) return;
      const sticker = STICKERS.find((st) => st.url === img.dataset.url);
      if (!sticker) return;
      if (!(await previewMedia({ src: sticker.url, frame: "bubble", title: "Send sticker", actions: [{ label: "Cancel", value: false, ghost: true }, { label: "Send", value: true, icon: "send" }] }))) return;
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
  // The picker input lives in the page until a file comes back: a detached input can be thrown
  // away by the phone while the gallery is open (slow video picks), and then nothing arrives.
  const pick = (accept, viewOnce, capture) => {
    document.getElementById("x3PickInput")?.remove();
    const f = document.createElement("input");
    f.type = "file"; f.accept = accept; f.id = "x3PickInput";
    if (capture) f.setAttribute("capture", capture);
    f.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0";
    document.body.appendChild(f);
    f.addEventListener("change", () => {
      const file = f.files[0];
      setTimeout(() => f.remove(), 0);
      if (file) handlePickedImage(file, file.name || "Photo", { viewOnce });
    });
    f.click();
  };
  const tiles = [
    ["camera", "Camera", "x3-t-cam", () => pick("image/*", false, "environment")],
    ["video", "Video", "x3-t-video", () => pick("video/*", false)],
    ["gif", "GIF", "x3-t-gif", () => openGifPicker(() => pick("image/gif", false))],
    ["bolt", "Quick replies", "x3-t-quick", () => openQuickReplies(input)],
    ["sparkle", "More fun", "x3-t-fun", () => window.ChatPlus?.openFun(input)],
    ...(convo?.kind !== "bot" ? [["once", "View once", "x3-t-once", () => pick("image/*,video/*", true)]] : []),
    ["poll", "Poll", "x3-t-poll", openPollSheet],
    ["hourglass", "Countdown", "x3-t-cd", openCountdownSheet],
    ["clock", "Schedule", "x3-t-sch", openScheduleSheet],
    ["trophy", "Leaderboard", "x3-t-top", () => sendRawCommand("/top")],
    ...(dictation ? [["voiceType", "Voice typing", "x3-t-voice", () => dictation.toggle()]] : []),
  ];
  const QUICK = ["😂", "❤️", "🔥", "👍", "🙏", "😭", "💯", "🎉"];
  const menu = document.createElement("div");
  menu.className = "x3-plus x3-plus-dial";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <div class="x3-plus-emoji">${[...new Set([...EmojiPicker.recents().slice(0, 4), ...QUICK])].slice(0, 8).map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}<button type="button" class="x3-emoji-more" data-more-emoji aria-label="All emoji">${svgIcon("plus", 16)}</button></div>
    <div class="x3-dial" role="group" aria-label="Tools — drag to turn">
      <svg class="x3-dial-art" aria-hidden="true"></svg>
      <div class="x3-dial-items">${tiles.map(([icon, label, cls], i) => `
        <button type="button" class="x3-tile ${cls}" data-tile="${i}" data-key="${cls}"><span class="x3-tile-ic">${svgIcon(icon, 21)}</span><span class="x3-tile-label">${label}</span></button>`).join("")}</div>
      <div class="x3-dial-hub"><b>Most used</b><small>${tiles.length > 6 ? "drag to turn ⟲" : "tools"}</small></div>
    </div>
    ${dictation ? `<div class="x3-plus-lang"><span>Voice typing language</span><div class="x3-seg" role="radiogroup"><button type="button" data-lang="en-IN">English</button><button type="button" data-lang="hi-IN">हिंदी</button></div></div>` : ""}`;
  composer.appendChild(menu);

  const syncLang = () => menu.querySelectorAll("[data-lang]").forEach((b) => b.classList.toggle("on", b.dataset.lang === dictation.getLang()));
  if (dictation) syncLang();
  const dial = wireDial(menu, tiles);
  const open = () => { dial.arrange(); menu.classList.add("show"); btn.classList.add("open"); btn.setAttribute("aria-expanded", "true"); };
  const close = () => { menu.classList.remove("show"); btn.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.classList.contains("show") ? close() : open(); });
  document.addEventListener("click", (e) => { if (menu.classList.contains("show") && !menu.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    const insertEmoji = (emoji) => {
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, pos) + emoji + input.value.slice(pos);
      input.setSelectionRange(pos + emoji.length, pos + emoji.length);
      refreshSendState();
    };
    if (e.target.closest("[data-more-emoji]")) {
      close();
      EmojiPicker.open({ title: "Emoji", keepOpen: true, onPick: insertEmoji });
      return;
    }
    const em = e.target.closest("[data-emoji]");
    if (em) { insertEmoji(em.dataset.emoji); EmojiPicker.remember(em.dataset.emoji); return; }
    const lang = e.target.closest("[data-lang]");
    if (lang && dictation) { dictation.setLang(lang.dataset.lang); syncLang(); return; }
    const tile = e.target.closest("[data-tile]");
    if (tile) { if (dial.dragged()) return; dial.used(tile.dataset.key); close(); if (convo) tiles[Number(tile.dataset.tile)][3](); }
  });
}

/* ---------- the + dial: a half-circle of tools, most used first, turn it for the rest ---------- */
function wireDial(menu, tiles) {
  const box = menu.querySelector(".x3-dial"), art = box.querySelector(".x3-dial-art"), hub = box.querySelector(".x3-dial-hub b");
  const KEY = "teaofrpm_dial_use", STEP = 30, SHOW = 6;
  let order = [], rot = 0, R = 130, cx = 0, cy = 0, moved = false, dragging = false;
  const btns = () => [...box.querySelectorAll(".x3-tile")];
  const maxRot = () => Math.max(0, (order.length - SHOW) * STEP);
  function place(animate) {
    btns().forEach((b) => {
      const i = order.indexOf(b.dataset.key);
      const th = 165 - STEP * i + rot;                     // degrees, 180 = left end of the arc
      const rad = th * Math.PI / 180;
      const vis = th > -8 && th < 188;
      const edge = Math.min(1, Math.max(0, Math.min(th + 8, 188 - th) / 22));
      b.style.transition = animate ? "" : "none";
      b.style.transform = `translate(${(cx + R * Math.cos(rad)).toFixed(1)}px, ${(cy - R * Math.sin(rad)).toFixed(1)}px) translate(-50%, -50%) scale(${(0.7 + 0.3 * edge).toFixed(3)})`;
      b.style.opacity = vis ? edge.toFixed(3) : "0";
      b.style.pointerEvents = vis && edge > 0.5 ? "" : "none";
      b.tabIndex = vis ? 0 : -1;
    });
    const top = order[Math.round((rot + 75) / STEP)] ;
    const t = tiles.find((x) => x[2] === top);
    if (t) hub.textContent = rot < 1 ? "Most used" : t[1];
    box.style.setProperty("--rot", `${rot}deg`);
  }
  function measure() {
    const w = box.clientWidth || 340;
    R = Math.max(104, Math.min(150, (w - 64) / 2));
    cx = w / 2; cy = R + 34;
    box.style.height = `${cy + 22}px`;
    // the dial face: rings, tick marks and a soft glow (drawn once per size)
    const ticks = Array.from({ length: 37 }, (_, i) => {
      const a = Math.PI * i / 36, long = i % 6 === 0, r1 = R + 30, r2 = r1 - (long ? 9 : 5);
      return `<line x1="${(cx + r1 * Math.cos(a)).toFixed(1)}" y1="${(cy - r1 * Math.sin(a)).toFixed(1)}" x2="${(cx + r2 * Math.cos(a)).toFixed(1)}" y2="${(cy - r2 * Math.sin(a)).toFixed(1)}" class="${long ? "tk-l" : "tk"}"/>`;
    }).join("");
    art.setAttribute("viewBox", `0 0 ${w} ${cy + 22}`);
    art.innerHTML = `<defs><radialGradient id="dlg" cx="50%" cy="100%" r="75%"><stop offset="0" stop-color="var(--dial-glow)" stop-opacity=".55"/><stop offset="1" stop-color="var(--dial-glow)" stop-opacity="0"/></radialGradient></defs>
      <path d="M ${cx - R - 34} ${cy} A ${R + 34} ${R + 34} 0 0 1 ${cx + R + 34} ${cy} Z" fill="url(#dlg)"/>
      <path class="ring" d="M ${cx - R - 26} ${cy} A ${R + 26} ${R + 26} 0 0 1 ${cx + R + 26} ${cy}"/>
      <path class="ring2" d="M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}"/>
      <path class="ring3" d="M ${cx - R + 30} ${cy} A ${R - 30} ${R - 30} 0 0 1 ${cx + R - 30} ${cy}"/>
      <g class="ticks">${ticks}</g>`;
  }
  function arrange() {
    const use = store.get(KEY, {}) || {};
    const base = tiles.map((t) => t[2]);
    order = [...base].sort((a, b) => (use[b] || 0) - (use[a] || 0) || base.indexOf(a) - base.indexOf(b));
    rot = 0;
    requestAnimationFrame(() => { measure(); place(false); requestAnimationFrame(() => box.classList.add("ready")); });
  }
  let sx = 0, sRot = 0, lastX = 0, lastT = 0, vel = 0;
  box.addEventListener("pointerdown", (e) => { dragging = true; moved = false; sx = lastX = e.clientX; sRot = rot; lastT = e.timeStamp; vel = 0; });
  addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx;
    if (!moved && Math.abs(dx) < 6) return;
    if (!moved) { moved = true; try { box.setPointerCapture(e.pointerId); } catch {} }
    let r = sRot - (dx / R) * (180 / Math.PI);
    if (r < 0) r = r / 3; if (r > maxRot()) r = maxRot() + (r - maxRot()) / 3;   // rubber band at the ends
    vel = (e.clientX - lastX) / Math.max(1, e.timeStamp - lastT); lastX = e.clientX; lastT = e.timeStamp;
    rot = r; place(false);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (!moved) return;
    const fling = -vel * 140;                                // a quick flick spins a little further
    rot = Math.min(maxRot(), Math.max(0, Math.round((rot + fling) / STEP) * STEP));
    place(true);
    setTimeout(() => { moved = false; }, 60);
  };
  addEventListener("pointerup", end); addEventListener("pointercancel", end);
  box.addEventListener("wheel", (e) => { e.preventDefault(); rot = Math.min(maxRot(), Math.max(0, rot + Math.sign(e.deltaY || e.deltaX) * STEP)); place(true); }, { passive: false });
  addEventListener("resize", () => { if (menu.classList.contains("show")) { measure(); place(false); } });
  return {
    arrange,
    dragged: () => moved,
    used(k) { const u = store.get(KEY, {}) || {}; u[k] = (u[k] || 0) + 1; store.set(KEY, u); },
  };
}

// Built-in animated emoji (Google Noto Animated Emoji, CC BY 4.0) - works with no GIF key at all.
const NOTO_GIFS = [
  ["1f602", "haha lol laugh joy funny"], ["1f923", "haha rofl lol laugh rolling"], ["1f606", "haha laugh lol xd"], ["1f605", "haha sweat nervous oops"],
  ["1f60d", "love heart eyes crush"], ["1f970", "love hearts cute aww"], ["1f618", "love kiss bye"], ["2764_fe0f", "love heart red"], ["1f496", "love heart sparkle"],
  ["1f494", "sad broken heart"], ["1f62d", "sad cry crying sob"], ["1f622", "sad cry tear"], ["1f97a", "sad please pleading cute"], ["1f614", "sad pensive"],
  ["1f44d", "ok yes thumbs up good"], ["1f44c", "ok perfect"], ["1f64f", "thank you thanks please pray"], ["1f44f", "clap wow nice congrats"], ["1f64c", "yay celebrate praise"],
  ["1f62e", "wow surprised shock"], ["1f632", "wow astonished shock"], ["1f92f", "wow mind blown"], ["1f631", "wow scream scared omg"], ["1f633", "wow flushed embarrassed"],
  ["1f483", "dance party girl"], ["1f57a", "dance party boy"], ["1f389", "party congrats celebrate"], ["1f973", "party birthday celebrate"], ["1f38a", "party confetti"],
  ["1f44b", "bye hi hello wave"], ["1f60e", "cool sunglasses"], ["1f525", "fire lit hot"], ["1f4af", "100 perfect"], ["2728", "sparkles magic"],
  ["1f914", "think hmm"], ["1f644", "eye roll whatever"], ["1f612", "unamused meh"], ["1f624", "angry huff"], ["1f621", "angry mad rage"], ["1f620", "angry mad"],
  ["1f92c", "angry swear"], ["1f608", "devil naughty"], ["1f480", "dead skull dying lol"], ["1f47b", "ghost boo"], ["1f921", "clown"], ["1f4a9", "poop"],
  ["1f634", "sleep tired zzz"], ["1f971", "yawn bored tired"], ["1f924", "drool yummy"], ["1f60b", "yummy tasty food"], ["1f911", "money rich"], ["1f917", "hug"],
  ["1f92d", "oops giggle"], ["1f92b", "shh secret quiet"], ["1f910", "zip quiet"], ["1f62c", "grimace awkward"], ["1f925", "liar"], ["1f975", "hot sweat"],
  ["1f976", "cold freezing"], ["1f974", "woozy drunk"], ["1f635", "dizzy"], ["1f920", "cowboy yeehaw"], ["1f913", "nerd study exam"], ["1f9d0", "monocle hmm"],
  ["1f607", "angel innocent"], ["1f642", "smile ok"], ["1f609", "wink"], ["1f61c", "tongue wink crazy"], ["1f92a", "crazy zany"], ["1f601", "grin happy"],
  ["1f600", "happy smile"], ["1f603", "happy smile"], ["1f604", "happy smile"], ["1f60a", "blush happy"], ["1f929", "star struck wow"], ["1f60c", "relieved"],
  ["1f440", "eyes look"], ["1f4aa", "strong muscle gym"], ["1f91d", "deal handshake"], ["270c_fe0f", "peace victory"], ["1f91e", "fingers crossed luck"],
  ["1f3cf", "cricket bat"], ["26bd", "football goal"], ["1f3c6", "trophy win champion"], ["1f382", "birthday cake"], ["1f381", "gift present"],
  ["1f4a5", "boom"], ["1f4a8", "dash fast"], ["1f30d", "world earth"], ["2600_fe0f", "sun sunny"], ["1f308", "rainbow"], ["2614", "rain"], ["26a1", "lightning"],
  ["1f431", "cat"], ["1f436", "dog"], ["1f648", "monkey see no evil oops"], ["1f649", "monkey hear"], ["1f64a", "monkey speak"], ["1f984", "unicorn"],
];
function notoGifs(q) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? NOTO_GIFS.filter(([, k]) => words.every((w) => k.includes(w))) : NOTO_GIFS;
  return (hits.length ? hits : NOTO_GIFS).map(([c, k]) => ({ id: c, url: `https://fonts.gstatic.com/s/e/notoemoji/latest/${c}/512.gif`, preview: `https://fonts.gstatic.com/s/e/notoemoji/latest/${c}/512.webp`, w: 1, h: 1, title: k.split(" ")[0] }));
}

// GIF search (gif-search edge function -> KLIPY/GIPHY), else built-in animated emoji. Tap one to send it.
function openGifPicker(uploadOwn) {
  const s = makeSheet({ title: "GIFs", className: "gif-sheet", html: `
    <div class="ss-search"><span>${svgIcon("search", 15)}</span><input type="search" placeholder="Search GIFs…" autocomplete="off" enterkeyhint="search" /></div>
    <div class="gif-chips">${["haha", "love", "ok", "sad", "wow", "dance", "bye", "thank you", "bollywood", "cricket"].map((t) => `<button type="button" data-q="${t}">${t}</button>`).join("")}</div>
    <div class="gif-grid"><div class="settings-empty">Loading…</div></div>
    <button type="button" class="btn btn-ghost gif-own" style="width:100%;margin-top:8px">${svgIcon("image", 15)} Send a GIF from your phone</button>
    <small class="gif-credit"></small>` });
  s.onClose = () => setTimeout(() => s.el.remove(), 300);
  s.open();
  const grid = s.body.querySelector(".gif-grid"), input = s.body.querySelector("input");
  let q = "", next = "", busy = false, token = 0, noKey = false;
  const anonId = () => { let h = 0; for (const c of String(ME?.id || "")) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return "u" + (h >>> 0).toString(36); };
  const load = async (more = false) => {
    if (busy && more) return;
    busy = true;
    const my = ++token;
    if (!more) { next = ""; grid.innerHTML = `<div class="settings-empty">Loading…</div>`; }
    let { data, error } = noKey ? { data: { error: "no_key" } } : await sb.functions.invoke("gif-search", { body: { q, pos: next, limit: 24, uid: anonId() } });
    busy = false;
    if (my !== token) return;
    if (error || data?.error) {
      // no GIF key on the server (or it's down): free animated emoji instead (Google Noto, CC BY 4.0)
      if (data?.error === "no_key") noKey = true;
      if (more) return;
      data = { provider: "noto", items: notoGifs(q), next: "" };
    }
    if (!more) grid.innerHTML = "";
    s.body.querySelector(".gif-credit").textContent = data.provider === "giphy" ? "Powered by GIPHY" : data.provider === "tenor" ? "Via Tenor" : data.provider === "klipy" ? "Powered by KLIPY" : data.provider === "noto" ? "Animated emoji · Google Noto" : "";
    grid.classList.toggle("gif-noto", data.provider === "noto");
    for (const g of data.items || []) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "gif-item";
      b.style.aspectRatio = `${g.w || 1} / ${g.h || 1}`;
      b.innerHTML = `<img alt="${escapeHTML(g.title || "GIF")}" loading="lazy" decoding="async" />`;
      b.querySelector("img").src = g.preview || g.url;
      b.querySelector("img").addEventListener("error", () => b.remove(), { once: true });
      b.addEventListener("click", async () => {
        s.close();
        await new Promise((r) => setTimeout(r, 80));
        if (!(await previewMedia({ src: g.url, frame: "bubble", title: "Send GIF", actions: [{ label: "Cancel", value: false, ghost: true }, { label: "Send", value: true, icon: "send" }] }))) return;
        const { error: e } = await sb.from("messages").insert({ user_id: ME.id, conversation_id: convo.id, image_url: g.url, reply_to: replyingTo?.id || null });
        if (e) toast(friendlyError(e, "Couldn't send the GIF."));
        else clearReply();
      });
      grid.appendChild(b);
    }
    if (!grid.children.length) grid.innerHTML = `<div class="settings-empty">No GIFs found.</div>`;
    next = data.next || "";
  };
  input.addEventListener("input", debounce(() => { q = input.value.trim(); load(); }, 350));
  s.body.querySelector(".gif-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) { input.value = q = b.dataset.q; load(); } });
  s.body.querySelector(".gif-own").addEventListener("click", () => { s.close(); setTimeout(uploadOwn, 80); });
  s.body.addEventListener("scroll", () => { if (next && s.body.scrollTop + s.body.clientHeight > s.body.scrollHeight - 400) load(true); }, { passive: true });
  load();
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

  // fixed order inside the settings card, whatever finishes first
  const card = document.getElementById("riSettings");
  if (!card.querySelector(".ri-slot-mute")) card.innerHTML = `<div class="ri-slot-mute"></div><div class="ri-slot-theme"></div><div class="ri-slot-vanish"></div>`;
  renderInfoHero();
  renderMuteRow();
  try { window.ChatPlus?.renderInfo?.(document.querySelector("#roomInfoSheet .room-info-body")); } catch (e) { console.error(e); }
  renderThemeRow();
  renderVanishRow();
  renderMediaGrid();

  const list = document.getElementById("roomMembers");
  document.getElementById("riMembersTitle").textContent = isPublic ? "Members" : `${members.length} member${members.length === 1 ? "" : "s"}`;
  if (isPublic) {
    list.innerHTML = `<div class="settings-empty">Everyone at RPM is in this room · ${memberCount()} members</div>`;
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
  const { data, error } = await fetchMemberRows();
  if (error) return;
  setMembers(data || []);
  await getProfiles(members.map((m) => m.user_id));
  renderHeader();
  await renderInfoSheet();
}

// Top of the details sheet: who this chat is with, and the few things people reach for most
function renderInfoHero() {
  const h = document.getElementById("riHero");
  if (!h) return;
  const dm = convo.kind === "dm", bot = convo.kind === "bot";
  const name = dm ? (nameOf(otherUser?.id, otherUser) || "Unknown") : bot ? "Tea AI" : (convo.name || (isPublic ? "Global room" : "Group"));
  const sub = dm ? (otherUser ? `@${otherUser.username}${nameOf(otherUser.id, otherUser) !== otherUser.display_name ? ` · ${otherUser.display_name}` : ""}` : "")
    : bot ? "Always online · ask anything"
    : `${isPublic ? memberCount() : members.length} members${isPublic ? " · everyone at RPM" : ""}`;
  const muted = !!members.find((m) => m.user_id === ME.id)?.muted;
  const acts = [];
  if (dm && otherUser) {
    acts.push(["person", "Profile", () => { location.href = `profile.html?u=${encodeURIComponent(otherUser.username)}`; }]);
    acts.push(["phone", "Call", () => { AppNav.exitFullscreen(); setTimeout(() => CallManager.start(convo.id, otherUser, "audio"), 120); }]);
    acts.push(["video", "Video", () => { AppNav.exitFullscreen(); setTimeout(() => CallManager.start(convo.id, otherUser, "video"), 120); }]);
  }
  if (convo.kind === "group" && amAdmin && !isPublic) acts.push(["userPlus", "Add", () => { const s = document.getElementById("addMemberSearch"); s.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => s.focus(), 350); }]);
  acts.push(["search", "Search", () => { AppNav.exitFullscreen(); setTimeout(() => document.getElementById("searchToggle").click(), 160); }]);
  if (!bot) acts.push([muted ? "bellOff" : "bell", muted ? "Unmute" : "Mute", () => document.querySelector("#roomInfoSheet .mute-row input")?.click(), muted ? "on" : ""]);
  h.innerHTML = `<span class="ri-hero-av"></span><div class="ri-hero-name">${escapeHTML(name)}</div>${sub ? `<div class="ri-hero-sub">${escapeHTML(sub)}</div>` : ""}
    <div class="ri-quick">${acts.map(([ic, label, , cls], i) => `<button type="button" class="${cls || ""}" data-qa="${i}"><span>${svgIcon(ic, 19)}</span>${label}</button>`).join("")}</div>`;
  const av = h.querySelector(".ri-hero-av");
  if (dm) setAvatarContent(av, otherUser);
  else if (bot) av.innerHTML = `<img src="images/bot.png" alt="" />`;
  else setGroupAvatar(av, convo);
  h.querySelector(".ri-quick").onclick = (e) => { const b = e.target.closest("[data-qa]"); if (b) acts[Number(b.dataset.qa)][2](); };
}

// one tidy row: icon · title (+ small line) · value / control
const riRow = (icon, title, small, end = "") =>
  `<span class="ri-ic">${svgIcon(icon, 17)}</span><span class="ri-txt"><b>${title}</b>${small ? `<small>${small}</small>` : ""}</span>${end}`;
let riOpen = null;   // which tap-to-open row is expanded: "theme" | "vanish"
function wireAccordion(row, key) {
  row.querySelector(".ri-acc-head").onclick = () => {
    riOpen = riOpen === key ? null : key;
    document.querySelectorAll("#riSettings .ri-acc").forEach((r) => r.classList.toggle("open", r.dataset.acc === riOpen));
  };
  row.classList.toggle("open", riOpen === key);
}

async function renderMuteRow() {
  const body = document.querySelector("#roomInfoSheet .room-info-body");
  let row = body.querySelector(".mute-row");
  if (!row) {
    row = document.createElement("label");
    row.className = "ri-row ri-toggle mute-row";
    row.innerHTML = riRow("bell", "Mute notifications", "Messages still arrive, just quietly", `<input type="checkbox" /><i class="ri-switch"></i>`);
    (body.querySelector(".ri-slot-mute") || body).appendChild(row);
    row.querySelector("input").addEventListener("change", async (e) => {
      const { error } = await sb.from("conversation_members").update({ muted: e.target.checked }).eq("conversation_id", convo.id).eq("user_id", ME.id);
      if (error) { e.target.checked = !e.target.checked; toast("Could not update."); return; }
      const mine = members.find((m) => m.user_id === ME.id);
      if (mine) mine.muted = e.target.checked;
      toast(e.target.checked ? "Muted" : "Unmuted");
      renderInfoHero();
    });
  }
  row.querySelector("input").checked = !!members.find((m) => m.user_id === ME.id)?.muted;
}

// Shared media, like WhatsApp / Instagram: photos, videos, links and voice notes in tabs
let mediaTab = "photos";
async function renderMediaGrid() {
  const body = document.querySelector("#roomInfoSheet .room-info-body");
  let wrap = body.querySelector(".room-media");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "room-media";
    (document.getElementById("riMedia") || body).appendChild(wrap);
  }
  const base = () => sb.from("messages").select("id,image_url,video_url,audio_url,content,created_at,user_id")
    .eq("conversation_id", convo.id).eq("deleted", false).order("created_at", { ascending: false });
  const [ph, vi, li, vo] = await Promise.all([
    base().not("image_url", "is", null).limit(60),
    base().not("video_url", "is", null).limit(30),
    base().ilike("content", "%http%").limit(60),
    base().not("audio_url", "is", null).limit(40),
  ]);
  const links = [];
  for (const m of li.data || []) for (const u of (m.content.match(/https?:\/\/[^\s<>"']+/gi) || [])) links.push({ url: u.replace(/[).,!?]+$/, ""), m });
  const tabs = [["photos", "Photos", ph.data || []], ["videos", "Videos", vi.data || []], ["links", "Links", links], ["voice", "Voice", vo.data || []]];
  if (!tabs.some(([, , l]) => l.length)) { wrap.innerHTML = ""; return; }
  if (!tabs.find(([k]) => k === mediaTab)[2].length) mediaTab = tabs.find(([, , l]) => l.length)[0];
  const when = (iso) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
  const paint = () => {
    const list = tabs.find(([k]) => k === mediaTab)[2];
    let html = "";
    if (mediaTab === "photos") html = `<div class="room-media-grid">${list.map((m) => `<img src="${escapeHTML(m.image_url)}" data-src="${escapeHTML(m.image_url)}" loading="lazy" alt="" />`).join("")}</div>`;
    else if (mediaTab === "videos") html = `<div class="room-media-grid">${list.map((m) => `<button type="button" class="rm-vid" data-v="${escapeHTML(m.video_url)}"><video src="${escapeHTML(m.video_url)}#t=0.1" preload="metadata" muted playsinline></video><span>▶</span></button>`).join("")}</div>`;
    else if (mediaTab === "links") html = `<div class="rm-links">${list.map(({ url, m }) => { let host = url; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {} return `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer"><span class="rm-ic">${svgIcon("link", 16)}</span><div><b>${escapeHTML(host)}</b><small>${escapeHTML(url.slice(0, 80))}</small></div><em>${when(m.created_at)}</em></a>`; }).join("")}</div>`;
    else html = `<div class="rm-voice">${list.map((m) => `<div><small>${escapeHTML(profileCache.get(m.user_id)?.display_name || "")} · ${when(m.created_at)}</small><audio controls preload="none" src="${escapeHTML(m.audio_url)}"></audio></div>`).join("")}</div>`;
    wrap.innerHTML = `<div class="ri-title">Media, links & voice</div>
      <div class="ri-card ri-media"><div class="rm-tabs">${tabs.map(([k, label, l]) => `<button type="button" data-t="${k}" class="${k === mediaTab ? "on" : ""}" ${l.length ? "" : "disabled"}>${label}<i>${l.length}</i></button>`).join("")}</div>${html}</div>`;
  };
  paint();
  wrap.onclick = (e) => {
    const tb = e.target.closest("[data-t]");
    if (tb) { mediaTab = tb.dataset.t; paint(); return; }
    const img = e.target.closest("img[data-src]");
    if (img) { openMediaViewer(img.dataset.src); return; }
    const v = e.target.closest(".rm-vid");
    if (v) {
      const ov = document.createElement("div");
      ov.className = "vo-viewer";
      ov.innerHTML = `<div class="vo-bar"><span>${svgIcon("video", 16)} Video</span><button type="button">Close</button></div><video src="${escapeHTML(v.dataset.v)}" controls autoplay playsinline></video>`;
      document.body.appendChild(ov);
      ov.querySelector("button").onclick = () => ov.remove();
    }
  };
}
async function loadAddableMembers() {
  renderAddMembers(document.getElementById("addMemberSearch").value.trim().toLowerCase());
}

let addToken = 0;
async function renderAddMembers(filterText = "") {
  const list = document.getElementById("addMemberList");
  const my = ++addToken;
  const memberIds = new Set(members.map((m) => m.user_id));
  const people = (await peopleFor(filterText)).filter((p) => !memberIds.has(p.id) && p.id !== ME.id);
  if (my !== addToken) return;
  if (!people.length) { list.innerHTML = `<div class="settings-empty">${filterText.length < 2 ? "Type a name to find people to add." : "No one found."}</div>`; return; }
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
    let blob = await editAndCompress(file, { title: isPublic ? "Room photo" : "Group photo", aspects: ["1:1"], circle: true, maxSize: 1080 }, 600);
    if (!blob) return;
    const look = URL.createObjectURL(blob);
    const ok = await previewMedia({ src: look, frame: "circle", title: isPublic ? "Room photo" : "Group photo", note: "Everyone in this chat will see it", actions: [
      { label: "Cancel", value: false, ghost: true }, { label: "Set photo", value: true, icon: "check" },
    ] });
    setTimeout(() => URL.revokeObjectURL(look), 1000);
    if (!ok) return;
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

/* the composer floats over the chat: keep its live height in --cmp-h so the last message,
   the typing bubble and the jump button always sit just above it */
(() => {
  const c = document.querySelector(".room-shell .composer"), shell = document.querySelector(".room-shell");
  if (!c || !shell || !window.ResizeObserver) return;
  let last = 0;
  new ResizeObserver(() => {
    const h = Math.round(c.getBoundingClientRect().height);
    if (h === last) return;
    const list = document.getElementById("messages");
    const atBottom = list && list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    last = h;
    shell.style.setProperty("--cmp-h", `${h}px`);
    if (atBottom) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }).observe(c);
})();