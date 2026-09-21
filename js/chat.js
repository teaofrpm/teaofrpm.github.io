let ME = null;
let replyingTo = null;
let pendingImageFile = null;
let pendingImagePreviewUrl = null;
let presenceChannel = null;
let onlineMembers = new Map(); // user_id -> {display_name, role}

let STICKER_URLS = [];

let oldestLoadedAt = null;
let newestLoadedAt = null;
let hasMoreHistory = true;
let lastRenderedDay = null;
let lastRenderedAuthorId = null;
let lastRenderedAt = null;
const PAGE_SIZE = 50;
const GROUP_WINDOW_MS = 5 * 60 * 1000;

let typingUsers = new Map(); // user_id -> { display_name, timeoutId }
let isTypingBroadcasted = false;
let typingClearTimer = null;
let searchDebounceTimer = null;

let pendingAudioBlob = null;
let pendingAudioPreviewUrl = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingTimerInterval = null;

let lastOwnMessageId = null;
let lastOwnMessageAt = null;
let lastMarkedSeenId = null;

async function init() {
  const session = await requireSession("index.html");
  if (!session) return;

  ME = await getMyProfile();
  if (!ME) return;

  if (ME.banned) {
    toast("This account has been banned.");
    await sb.auth.signOut();
    window.location.href = "index.html";
    return;
  }
  if (!ME.is_verified) {
    window.location.href = "verify.html";
    return;
  }

  profileCache.set(ME.id, ME);
  applyIconAttributes();

  document.getElementById("roomNameLabel").textContent = window.TEAOFRPM_CONFIG.ROOM_NAME;
  document.getElementById("headerRoomName").textContent = window.TEAOFRPM_CONFIG.ROOM_NAME;

  await Promise.all([loadStickers(), preloadProfiles(), loadHistory(), loadNotifications()]);

  subscribeRealtime();
  subscribePresence();
  subscribeProfileUpdates();
  subscribeNotifications();
  wireComposer();
  wireHeader();
  wireScrollTracking();
  wireLightbox();
  wireSearch();
  wireGlobalKeys();
  wireNotifications();
  startBackgroundSync();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) markSeen();
  });

  document.getElementById("loadingOverlay").classList.add("hide");
}

async function loadHistory() {
  const { data: msgs, error } = await sb
    .from("messages")
    .select("*")
    .eq("deleted", false)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (error) {
    toast("Could not load messages.");
    console.error(error);
    return;
  }

  const ordered = [...msgs].reverse();
  hasMoreHistory = msgs.length === PAGE_SIZE;
  oldestLoadedAt = ordered.length ? ordered[0].created_at : null;
  newestLoadedAt = ordered.length ? ordered[ordered.length - 1].created_at : newestLoadedAt;

  const ids = [...new Set(ordered.map(m => m.user_id))];
  await Promise.all(ids.map(getProfile));

  const reactionsByMsg = await fetchReactions(ordered.map(m => m.id));

  const container = document.getElementById("messages");
  container.innerHTML = "";
  lastRenderedDay = null;
  lastRenderedAuthorId = null;
  lastRenderedAt = null;
  await appendMessages(container, ordered, reactionsByMsg, "append");
  updateLoadMoreButton();
  scrollToBottom();
  renderSeenBy();
}

async function fetchReactions(ids) {
  if (!ids.length) return {};
  const { data } = await sb.from("message_reactions").select("*").in("message_id", ids);
  return groupReactions(data || []);
}

function groupReactions(rows) {
  const map = {};
  for (const r of rows) {
    (map[r.message_id] = map[r.message_id] || []).push(r);
  }
  return map;
}

async function appendMessages(container, msgs, reactionsByMsg, mode) {
  const frag = document.createDocumentFragment();
  let dayRef = mode === "prepend" ? null : lastRenderedDay;
  let authorRef = mode === "prepend" ? null : lastRenderedAuthorId;
  let atRef = mode === "prepend" ? null : lastRenderedAt;

  for (const m of msgs) {
    const day = new Date(m.created_at).toDateString();
    const dayChanged = day !== dayRef;
    if (dayChanged) {
      frag.appendChild(buildDateDivider(m.created_at));
      dayRef = day;
    }

    const grouped = !dayChanged && authorRef === m.user_id &&
      atRef && (new Date(m.created_at) - new Date(atRef)) < GROUP_WINDOW_MS;

    frag.appendChild(await renderMessage(m, reactionsByMsg[m.id] || [], grouped));
    authorRef = m.user_id;
    atRef = m.created_at;
  }

  if (mode === "prepend") {
    container.insertBefore(frag, container.firstChild);
  } else {
    container.appendChild(frag);
    lastRenderedDay = dayRef;
    lastRenderedAuthorId = authorRef;
    lastRenderedAt = atRef;
  }
}

function buildDateDivider(ts) {
  const div = document.createElement("div");
  div.className = "date-divider";
  div.innerHTML = `<span>${formatDayLabel(ts)}</span>`;
  return div;
}

function formatDayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

function updateLoadMoreButton() {
  const btn = document.getElementById("loadMoreBtn");
  btn.classList.toggle("show", hasMoreHistory);
  btn.textContent = "Load older messages";
  btn.disabled = false;
}

async function loadOlderMessages() {
  if (!hasMoreHistory || !oldestLoadedAt) return;
  const btn = document.getElementById("loadMoreBtn");
  btn.disabled = true;
  btn.textContent = "Loading…";

  const container = document.getElementById("messages");
  const prevHeight = container.scrollHeight;
  const prevScrollTop = container.scrollTop;

  const { data: msgs, error } = await sb
    .from("messages")
    .select("*")
    .eq("deleted", false)
    .lt("created_at", oldestLoadedAt)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (error) {
    toast("Could not load older messages.");
    updateLoadMoreButton();
    return;
  }

  const ordered = [...msgs].reverse();
  hasMoreHistory = msgs.length === PAGE_SIZE;
  if (ordered.length) oldestLoadedAt = ordered[0].created_at;

  const ids = [...new Set(ordered.map(m => m.user_id))];
  await Promise.all(ids.map(getProfile));
  const reactionsByMsg = await fetchReactions(ordered.map(m => m.id));

  await appendMessages(container, ordered, reactionsByMsg, "prepend");
  updateLoadMoreButton();

  container.scrollTop = prevScrollTop + (container.scrollHeight - prevHeight);
}

async function renderMessage(m, reactions = [], grouped = false) {
  const author = await getProfile(m.user_id);
  const isOwn = m.user_id === ME.id;
  const isOwnerMsg = author && author.role === "owner";

  const row = document.createElement("div");
  row.className = `msg-row ${isOwn ? "own" : ""} ${isOwnerMsg ? "owner-msg" : ""} ${grouped ? "grouped" : ""}`;
  row.dataset.msgId = m.id;

  const avatar = document.createElement("a");
  avatar.className = "avatar";
  avatar.href = author?.username ? `profile.html?u=${encodeURIComponent(author.username)}` : "#";
  setAvatarContent(avatar, author);
  row.appendChild(avatar);

  const wrap = document.createElement("div");
  wrap.className = "msg-bubble-wrap";

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.innerHTML = `
    <a class="msg-name" href="${author?.username ? `profile.html?u=${encodeURIComponent(author.username)}` : "#"}">${escapeHTML(author?.display_name || "Unknown")}</a>
    ${author?.username ? `<span class="msg-username">@${escapeHTML(author.username)}</span>` : ""}
    ${isOwnerMsg ? `<span class="owner-badge">Owner</span>` : ""}
    <span>${formatTime(m.created_at)}</span>
  `;
  wrap.appendChild(meta);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (m.sticker_url && !m.content && !m.image_url) {
    bubble.classList.add("sticker-only");
  }

  if (m.reply_to) {
    const replyPrev = document.createElement("div");
    replyPrev.className = "reply-preview";
    const original = await findMessageById(m.reply_to);
    if (original) {
      const origAuthor = await getProfile(original.user_id);
      replyPrev.innerHTML = `<b>${escapeHTML(origAuthor?.display_name || "…")}</b>: ${escapeHTML(previewText(original))}`;
    } else {
      replyPrev.textContent = "Original message";
    }
    replyPrev.addEventListener("click", () => jumpToMessage(m.reply_to));
    bubble.appendChild(replyPrev);
  }

  if (m.sticker_url) {
    const img = document.createElement("img");
    img.className = "sticker-img";
    img.src = m.sticker_url;
    img.loading = "lazy";
    img.addEventListener("click", () => openLightbox(m.sticker_url));
    bubble.appendChild(img);
  }

  if (m.audio_url) {
    const audio = document.createElement("audio");
    audio.className = "chat-audio";
    audio.controls = true;
    audio.src = m.audio_url;
    bubble.appendChild(audio);
  }

  if (m.image_url) {
    const img = document.createElement("img");
    img.className = "chat-img";
    img.src = m.image_url;
    img.loading = "lazy";
    img.addEventListener("click", () => openLightbox(m.image_url));
    bubble.appendChild(img);
  }

  if (m.content) {
    const txt = document.createElement("div");
    txt.className = "msg-text";
    txt.innerHTML = linkify(escapeHTML(m.content)) + (m.edited_at ? ` <span class="edited-tag">(edited)</span>` : "");
    if (m.image_url || m.sticker_url || m.audio_url) txt.style.marginTop = "6px";
    bubble.appendChild(txt);
  }

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  actions.innerHTML = `
    <button class="react-btn" title="React">${svgIcon("smilePlus", 14)}</button>
    <button class="reply-btn" title="Reply">${svgIcon("reply", 14)}</button>
    ${m.content ? `<button class="copy-btn" title="Copy text">${svgIcon("copy", 14)}</button>` : ""}
    ${isOwn && m.content ? `<button class="edit-btn" title="Edit">${svgIcon("edit", 14)}</button>` : ""}
    ${isOwn ? `<button class="delete-btn" title="Delete">${svgIcon("trash", 14)}</button>` : ""}
  `;
  bubble.appendChild(actions);

  wrap.appendChild(bubble);

  const reactRow = document.createElement("div");
  reactRow.className = "reactions-row";
  wrap.appendChild(reactRow);
  renderReactions(reactRow, m.id, reactions);

  row.appendChild(wrap);

  actions.querySelector(".reply-btn").addEventListener("click", () => {
    startReply(m, author);
  });
  actions.querySelector(".react-btn").addEventListener("click", () => {
    openEmojiPicker(bubble, m.id);
  });
  if (m.content) {
    actions.querySelector(".copy-btn").addEventListener("click", () => {
      navigator.clipboard.writeText(m.content).then(() => toast("Copied"));
    });
  }
  if (isOwn && m.content) {
    actions.querySelector(".edit-btn").addEventListener("click", () => startEditMessage(m, bubble));
  }
  if (isOwn) {
    actions.querySelector(".delete-btn").addEventListener("click", () => deleteMessage(m.id, row));
    lastOwnMessageId = m.id;
    lastOwnMessageAt = m.created_at;
  }

  return row;
}

function jumpToMessage(id) {
  const target = document.querySelector(`[data-msg-id="${id}"]`);
  if (!target) { toast("Older message — load older messages to see it."); return; }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  const bubble = target.querySelector(".bubble");
  bubble.classList.add("highlight-flash");
  setTimeout(() => bubble.classList.remove("highlight-flash"), 1500);
}

function linkify(safeText) {
  return safeText.replace(/(https?:\/\/[^\s]+)/g, (url) => {
    const trimmed = url.replace(/[.,!?)\]]+$/, "");
    const trailing = url.slice(trimmed.length);
    return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer">${trimmed}</a>${trailing}`;
  });
}

async function deleteMessage(id, row) {
  if (!confirm("Delete this message?")) return;
  const { error } = await sb.from("messages").update({ deleted: true }).eq("id", id).eq("user_id", ME.id);
  if (error) { toast(error.message || "Could not delete message."); return; }
  row.remove();
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

  const actionsBar = document.createElement("div");
  actionsBar.className = "edit-actions";
  actionsBar.innerHTML = `<button class="edit-cancel">Cancel</button><button class="edit-save">Save</button>`;
  editBox.insertAdjacentElement("afterend", actionsBar);

  function restore(content) {
    const restored = document.createElement("div");
    restored.className = "msg-text";
    restored.innerHTML = linkify(escapeHTML(content)) + (m.edited_at ? ` <span class="edited-tag">(edited)</span>` : "");
    editBox.replaceWith(restored);
    actionsBar.remove();
  }

  actionsBar.querySelector(".edit-cancel").addEventListener("click", () => restore(m.content));

  actionsBar.querySelector(".edit-save").addEventListener("click", async () => {
    const newText = editBox.value.trim();
    if (!newText) { toast("Message can't be empty."); return; }
    if (newText === m.content) { restore(m.content); return; }
    const editedAt = new Date().toISOString();
    const { error } = await sb.from("messages").update({ content: newText, edited_at: editedAt }).eq("id", m.id).eq("user_id", ME.id);
    if (error) { toast(error.message || "Could not edit message."); return; }
    m.content = newText;
    m.edited_at = editedAt;
    restore(newText);
  });
}

function previewText(m) {
  if (m.content) return m.content.slice(0, 60);
  if (m.image_url) return " Photo";
  if (m.sticker_url) return " Sticker";
  return "message";
}

async function findMessageById(id) {
  const { data } = await sb.from("messages").select("*").eq("id", id).single();
  return data;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderReactions(container, messageId, reactions) {
  container.innerHTML = "";
  const grouped = {};
  for (const r of reactions) {
    grouped[r.emoji] = grouped[r.emoji] || [];
    grouped[r.emoji].push(r);
  }
  for (const [emoji, rows] of Object.entries(grouped)) {
    const mine = rows.some(r => r.user_id === ME.id);
    const chip = document.createElement("span");
    chip.className = `reaction-chip ${mine ? "mine" : ""}`;
    chip.textContent = `${emoji} ${rows.length}`;
    chip.addEventListener("click", () => toggleReaction(messageId, emoji, mine));
    container.appendChild(chip);
  }
}

async function toggleReaction(messageId, emoji, alreadyMine) {
  if (alreadyMine) {
    await sb.from("message_reactions").delete()
      .eq("message_id", messageId).eq("user_id", ME.id).eq("emoji", emoji);
  } else {
    await sb.from("message_reactions").insert({ message_id: messageId, user_id: ME.id, emoji });
  }
}

function openEmojiPicker(bubble, messageId) {
  document.querySelectorAll(".emoji-picker").forEach(e => e.remove());
  const quick = ["❤️", "😂", "👍", "👎", "😮", "😢", "🙏", "🔥", "🎉", "😍", "😡", "👏"];
  const picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.innerHTML = quick.map(e => `<span>${e}</span>`).join("");
  bubble.appendChild(picker);
  picker.querySelectorAll("span").forEach(span => {
    span.addEventListener("click", async () => {
      await toggleReaction(messageId, span.textContent, false);
      picker.remove();
    });
  });
  setTimeout(() => {
    document.addEventListener("click", function closeOnce(e) {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener("click", closeOnce);
      }
    });
  }, 10);
}

function startReply(message, author) {
  replyingTo = { id: message.id, name: author?.display_name || "Unknown", text: previewText(message) };
  document.getElementById("replyToName").textContent = replyingTo.name;
  document.getElementById("replyToText").textContent = replyingTo.text;
  document.getElementById("replyBar").classList.add("show");
  document.getElementById("msgInput").focus();
}
document.addEventListener("DOMContentLoaded", () => {
  const cancel = document.getElementById("cancelReply");
  if (cancel) cancel.addEventListener("click", clearReply);
});
function clearReply() {
  replyingTo = null;
  document.getElementById("replyBar").classList.remove("show");
}

async function loadStickers() {
  const { data, error } = await sb.from("stickers").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    STICKER_URLS = [];
  } else {
    STICKER_URLS = (data || []).map(s => ({
      url: sb.storage.from("stickers").getPublicUrl(s.storage_path).data.publicUrl,
      label: s.label || "sticker",
    }));
  }
  buildStickerPanel();
}

const RECENT_STICKERS_KEY = "teaofrpm_recent_stickers";

function getRecentStickers() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_STICKERS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRecentSticker(sticker) {
  const recents = getRecentStickers().filter(s => s.url !== sticker.url);
  recents.unshift(sticker);
  localStorage.setItem(RECENT_STICKERS_KEY, JSON.stringify(recents.slice(0, 8)));
}

function buildStickerPanel() {
  const panel = document.getElementById("stickerPanel");
  if (!STICKER_URLS.length) {
    panel.innerHTML = `<span style="grid-column:1/-1; font-size:12.5px; color:var(--text-muted); padding:8px;">No stickers yet — the admin can add some via the Telegram bot.</span>`;
    return;
  }

  const recents = getRecentStickers().filter(r => STICKER_URLS.some(s => s.url === r.url));

  let html = "";
  if (recents.length) {
    html += `<span class="sticker-section-label">Recently used</span>`;
    html += recents.map(s => `<img src="${s.url}" alt="${escapeHTML(s.label)}" title="${escapeHTML(s.label)}" />`).join("");
    html += `<span class="sticker-section-label">All stickers</span>`;
  }
  html += STICKER_URLS.map(s => `<img src="${s.url}" alt="${escapeHTML(s.label)}" title="${escapeHTML(s.label)}" />`).join("");

  panel.innerHTML = html;
  panel.querySelectorAll("img").forEach((el) => {
    el.addEventListener("click", () => {
      const sticker = STICKER_URLS.find(s => s.url === el.src) || recents.find(r => r.url === el.src);
      if (!sticker) return;
      saveRecentSticker(sticker);
      buildStickerPanel();
      sendMessage({ sticker: sticker.url });
    });
  });
}

async function handlePickedImage(file, labelWhenDone) {
  const sendBtn = document.getElementById("sendBtn");
  clearPendingAudio();
  document.getElementById("attachName").textContent = "Processing photo…";
  document.getElementById("attachPreview").classList.add("show");

  try {
    const compressed = await compressImageFile(file);
    pendingImageFile = compressed;
    if (pendingImagePreviewUrl) URL.revokeObjectURL(pendingImagePreviewUrl);
    pendingImagePreviewUrl = URL.createObjectURL(compressed);
    document.getElementById("attachImg").src = pendingImagePreviewUrl;
    document.getElementById("attachName").textContent = labelWhenDone;
    sendBtn.disabled = false;
  } catch (err) {
    toast(err.message || "Could not process this photo.");
    document.getElementById("attachPreview").classList.remove("show");
    pendingImageFile = null;
  }
}

function clearPendingAudio() {
  pendingAudioBlob = null;
  if (pendingAudioPreviewUrl) { URL.revokeObjectURL(pendingAudioPreviewUrl); pendingAudioPreviewUrl = null; }
  document.getElementById("audioPreview").classList.remove("show");
}

async function toggleVoiceRecording() {
  const btn = document.getElementById("voiceBtn");

  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    toast("Voice notes aren't supported in this browser.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ["audio/mp4", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t)) || "";
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(recordingTimerInterval);
      btn.classList.remove("recording");
      btn.innerHTML = svgIcon("mic", 19);
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      handleRecordedAudio(blob);
    };

    mediaRecorder.start();
    const startedAt = Date.now();
    btn.classList.add("recording");
    recordingTimerInterval = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      btn.textContent = `${secs}s`;
      if (secs >= 120) mediaRecorder.stop();
    }, 500);
  } catch (err) {
    toast("Microphone access denied or unavailable.");
  }
}

function handleRecordedAudio(blob) {
  pendingImageFile = null;
  if (pendingImagePreviewUrl) { URL.revokeObjectURL(pendingImagePreviewUrl); pendingImagePreviewUrl = null; }
  document.getElementById("attachPreview").classList.remove("show");

  pendingAudioBlob = blob;
  if (pendingAudioPreviewUrl) URL.revokeObjectURL(pendingAudioPreviewUrl);
  pendingAudioPreviewUrl = URL.createObjectURL(blob);
  document.getElementById("audioPreviewPlayer").src = pendingAudioPreviewUrl;
  document.getElementById("audioPreview").classList.add("show");
  document.getElementById("sendBtn").disabled = false;
}

function wireComposer() {
  const input = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");
  const stickerToggle = document.getElementById("stickerToggle");
  const stickerPanel = document.getElementById("stickerPanel");
  const imageInput = document.getElementById("imageInput");

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
    sendBtn.disabled = !(input.value.trim() || pendingImageFile || pendingAudioBlob);
  });

  wireTypingBroadcast(input);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendMessage({});
    }
  });

  input.addEventListener("paste", async (e) => {
    const item = [...e.clipboardData.items].find(i => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) await handlePickedImage(file, "Pasted photo");
  });

  sendBtn.addEventListener("click", () => sendMessage({}));

  stickerToggle.addEventListener("click", () => stickerPanel.classList.toggle("show"));

  imageInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await handlePickedImage(file, file.name);
  });

  document.getElementById("removeAttach").addEventListener("click", () => {
    pendingImageFile = null;
    if (pendingImagePreviewUrl) { URL.revokeObjectURL(pendingImagePreviewUrl); pendingImagePreviewUrl = null; }
    imageInput.value = "";
    document.getElementById("attachPreview").classList.remove("show");
    sendBtn.disabled = !(input.value.trim() || pendingAudioBlob);
  });

  document.getElementById("voiceBtn").addEventListener("click", toggleVoiceRecording);

  document.getElementById("removeAudioAttach").addEventListener("click", () => {
    clearPendingAudio();
    sendBtn.disabled = !(input.value.trim() || pendingImageFile);
  });
}

async function sendMessage({ sticker }) {
  const input = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");
  const text = input.value.trim();

  if (!text && !pendingImageFile && !pendingAudioBlob && !sticker) return;

  sendBtn.disabled = true;

  let image_url = null;
  let audio_url = null;
  try {
    if (pendingImageFile) {
      const path = `${ME.id}/${Date.now()}.jpg`;
      const { error: upErr } = await sb.storage.from("chat-images").upload(path, pendingImageFile, {
        contentType: "image/jpeg",
      });
      if (upErr) throw upErr;
      const { data: pub } = sb.storage.from("chat-images").getPublicUrl(path);
      image_url = pub.publicUrl;
    } else if (pendingAudioBlob) {
      const ext = (pendingAudioBlob.type || "").includes("mp4") ? "m4a" : "webm";
      const path = `${ME.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage.from("voice-notes").upload(path, pendingAudioBlob, {
        contentType: pendingAudioBlob.type || "audio/webm",
      });
      if (upErr) throw upErr;
      const { data: pub } = sb.storage.from("voice-notes").getPublicUrl(path);
      audio_url = pub.publicUrl;
    }

    const payload = {
      user_id: ME.id,
      content: text || null,
      image_url,
      audio_url,
      sticker_url: sticker || null,
      reply_to: replyingTo ? replyingTo.id : null,
    };

    const { error } = await sb.from("messages").insert(payload);
    if (error) throw error;

    input.value = "";
    input.style.height = "auto";
    pendingImageFile = null;
    if (pendingImagePreviewUrl) { URL.revokeObjectURL(pendingImagePreviewUrl); pendingImagePreviewUrl = null; }
    document.getElementById("imageInput").value = "";
    document.getElementById("attachPreview").classList.remove("show");
    clearPendingAudio();
    document.getElementById("stickerPanel").classList.remove("show");
    clearReply();
    clearTimeout(typingClearTimer);
    sendTypingState(false);
  } catch (e) {
    toast(e.message || "Message failed to send.");
  } finally {
    sendBtn.disabled = !(input.value.trim() || pendingImageFile || pendingAudioBlob);
  }
}

async function appendLiveMessage(m, reactions) {
  if (document.querySelector(`[data-msg-id="${m.id}"]`)) return;

  const container = document.getElementById("messages");
  const nearBottom = isNearBottom();

  const day = new Date(m.created_at).toDateString();
  const dayChanged = day !== lastRenderedDay;
  if (dayChanged) {
    container.appendChild(buildDateDivider(m.created_at));
    lastRenderedDay = day;
  }
  const grouped = !dayChanged && lastRenderedAuthorId === m.user_id &&
    lastRenderedAt && (new Date(m.created_at) - new Date(lastRenderedAt)) < GROUP_WINDOW_MS;
  container.appendChild(await renderMessage(m, reactions || [], grouped));
  lastRenderedAuthorId = m.user_id;
  lastRenderedAt = m.created_at;
  if (!newestLoadedAt || new Date(m.created_at) > new Date(newestLoadedAt)) {
    newestLoadedAt = m.created_at;
  }

  if (m.user_id !== ME.id) clearTypingUser(m.user_id);

  if (nearBottom) {
    scrollToBottom();
  } else {
    showJumpToLatest();
  }

  if (m.user_id !== ME.id && document.hidden) {
    notifyNewMessage();
  }

  renderSeenBy();
}

function subscribeRealtime() {
  sb.channel("public:messages")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
      const m = payload.new;
      await getProfile(m.user_id);
      const { data: reactions } = await sb.from("message_reactions").select("*").eq("message_id", m.id);
      await appendLiveMessage(m, reactions || []);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
      const m = payload.new;
      const row = document.querySelector(`[data-msg-id="${m.id}"]`);
      if (!row) return;
      if (m.deleted) {
        row.remove();
        return;
      }
      const textEl = row.querySelector(".msg-text");
      if (textEl && !row.querySelector(".edit-box")) {
        textEl.innerHTML = linkify(escapeHTML(m.content || "")) + (m.edited_at ? ` <span class="edited-tag">(edited)</span>` : "");
      }
    })
    .subscribe();

  sb.channel("public:message_reactions")
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, async (payload) => {
      const messageId = payload.new?.message_id || payload.old?.message_id;
      if (!messageId) return;
      const row = document.querySelector(`[data-msg-id="${messageId}"]`);
      if (!row) return;
      const { data: reactions } = await sb.from("message_reactions").select("*").eq("message_id", messageId);
      const reactRow = row.querySelector(".reactions-row");
      renderReactions(reactRow, messageId, reactions || []);
    })
    .subscribe();
}

function startBackgroundSync() {
  setInterval(syncNewMessages, 10000);
}

async function syncNewMessages() {
  if (!newestLoadedAt) return;

  const { data: msgs, error } = await sb
    .from("messages")
    .select("*")
    .eq("deleted", false)
    .gt("created_at", newestLoadedAt)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error || !msgs || !msgs.length) return;

  const ids = [...new Set(msgs.map(m => m.user_id))];
  await Promise.all(ids.map(getProfile));

  for (const m of msgs) {
    const { data: reactions } = await sb.from("message_reactions").select("*").eq("message_id", m.id);
    await appendLiveMessage(m, reactions || []);
  }
}

function isNearBottom() {
  const c = document.getElementById("messages");
  return c.scrollHeight - c.scrollTop - c.clientHeight < 160;
}
function scrollToBottom() {
  const c = document.getElementById("messages");
  c.scrollTop = c.scrollHeight;
  markSeen();
}

function wireScrollTracking() {
  const container = document.getElementById("messages");
  container.addEventListener("scroll", () => {
    if (isNearBottom()) hideJumpToLatest();
  });
  document.getElementById("jumpToLatest").addEventListener("click", () => {
    scrollToBottom();
    hideJumpToLatest();
  });
}
function showJumpToLatest() {
  document.getElementById("jumpToLatest").classList.add("show");
}
function hideJumpToLatest() {
  document.getElementById("jumpToLatest").classList.remove("show");
}

function wireLightbox() {
  document.getElementById("lightbox").addEventListener("click", closeLightbox);
}
function openLightbox(src) {
  document.getElementById("lightboxImg").src = src;
  document.getElementById("lightbox").classList.add("show");
}
function closeLightbox() {
  document.getElementById("lightbox").classList.remove("show");
}

function wireGlobalKeys() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeLightbox();
    document.getElementById("searchPanel").classList.remove("show");
    document.getElementById("notifPanel").classList.remove("show");
    document.getElementById("stickerPanel").classList.remove("show");
    document.querySelectorAll(".emoji-picker").forEach(p => p.remove());
    if (window.innerWidth <= 760) document.getElementById("membersPanel").classList.remove("open");
  });
}

function notifyNewMessage() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
  if (navigator.vibrate) navigator.vibrate(200);
}

function wireTypingBroadcast(input) {
  input.addEventListener("input", () => {
    if (!input.value.trim()) {
      sendTypingState(false);
      return;
    }
    sendTypingState(true);
    clearTimeout(typingClearTimer);
    typingClearTimer = setTimeout(() => sendTypingState(false), 2000);
  });
}

function sendTypingState(typing) {
  if (typing === isTypingBroadcasted) return;
  isTypingBroadcasted = typing;
  presenceChannel?.send({
    type: "broadcast",
    event: "typing",
    payload: { user_id: ME.id, display_name: ME.display_name, typing },
  });
}

function handleTypingBroadcast(payload) {
  if (payload.user_id === ME.id) return;
  if (payload.typing) {
    const existing = typingUsers.get(payload.user_id);
    if (existing) clearTimeout(existing.timeoutId);
    const timeoutId = setTimeout(() => clearTypingUser(payload.user_id), 4000);
    typingUsers.set(payload.user_id, { display_name: payload.display_name, timeoutId });
  } else {
    clearTypingUser(payload.user_id);
    return;
  }
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
  const names = [...typingUsers.values()].map(t => t.display_name);
  if (!names.length) {
    el.textContent = "";
    el.classList.remove("show");
    return;
  }
  const label = names.length === 1
    ? `${names[0]} is typing…`
    : names.length === 2
      ? `${names[0]} and ${names[1]} are typing…`
      : `${names.slice(0, 2).join(", ")} and ${names.length - 2} others are typing…`;
  el.textContent = label;
  el.classList.add("show");
}

async function markSeen() {
  if (!ME) return;
  if (document.hidden || !isNearBottom()) return;
  const rows = document.querySelectorAll("#messages .msg-row[data-msg-id]");
  if (!rows.length) return;
  const lastId = rows[rows.length - 1].dataset.msgId;
  if (lastId === lastMarkedSeenId) return;
  lastMarkedSeenId = lastId;

  const now = new Date().toISOString();
  const { error } = await sb.from("profiles").update({ last_read_at: now }).eq("id", ME.id);
  if (!error) {
    const mine = profileCache.get(ME.id) || {};
    profileCache.set(ME.id, { ...mine, last_read_at: now });
  }
}

function renderSeenBy() {
  document.querySelectorAll(".seen-by-line").forEach(el => el.remove());
  if (!lastOwnMessageId || !lastOwnMessageAt) return;

  const seenNames = [];
  for (const [userId, p] of profileCache.entries()) {
    if (userId === ME.id) continue;
    if (p.last_read_at && new Date(p.last_read_at) >= new Date(lastOwnMessageAt)) {
      seenNames.push(p.display_name);
    }
  }
  if (!seenNames.length) return;

  const row = document.querySelector(`[data-msg-id="${lastOwnMessageId}"]`);
  if (!row) return;
  const wrap = row.querySelector(".msg-bubble-wrap");
  const line = document.createElement("div");
  line.className = "seen-by-line";
  line.textContent = `Seen by ${seenNames.join(", ")}`;
  wrap.appendChild(line);
}

async function preloadProfiles() {
  const { data } = await sb.from("profiles").select("*").eq("is_verified", true);
  (data || []).forEach(p => profileCache.set(p.id, p));
}

function subscribeProfileUpdates() {
  sb.channel("public:profiles")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
      profileCache.set(payload.new.id, payload.new);
      renderMemberList();
      renderSeenBy();
    })
    .subscribe();
}

function subscribePresence() {
  presenceChannel = sb.channel("teaofrpm-online", {
    config: { presence: { key: ME.id } },
  });

  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      onlineMembers = new Map();
      Object.keys(state).forEach((userId) => {
        const info = state[userId][0];
        onlineMembers.set(userId, info);
      });
      renderMemberList();
    })
    .on("broadcast", { event: "typing" }, ({ payload }) => handleTypingBroadcast(payload))
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({
          display_name: ME.display_name,
          role: ME.role,
          online_at: new Date().toISOString(),
        });
        markSeen();
      }
    });

  window.addEventListener("beforeunload", () => {
    presenceChannel?.untrack();
  });
}

function lastSeenLabel(ts) {
  if (!ts) return "Offline";
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return "Active just now";
  if (mins < 60) return `Last seen ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Last seen ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `Last seen ${days}d ago`;
}

function renderMemberList() {
  const list = document.getElementById("memberList");
  const count = onlineMembers.size;
  document.getElementById("onlineCountText").textContent = `${count} online`;
  document.getElementById("headerOnlineText").textContent = `${count} online`;

  const allMembers = [...profileCache.values()].filter(p => p.is_verified);
  allMembers.sort((a, b) => {
    const aOnline = onlineMembers.has(a.id);
    const bOnline = onlineMembers.has(b.id);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return (a.display_name || "").localeCompare(b.display_name || "");
  });

  list.innerHTML = "";
  for (const p of allMembers) {
    const isOnline = onlineMembers.has(p.id);
    const row = document.createElement("a");
    row.className = `member-row ${p.id === ME.id ? "you" : ""}`;
    row.href = `profile.html?u=${encodeURIComponent(p.username)}`;

    const av = document.createElement("span");
    av.className = `avatar ${isOnline ? "is-online" : ""}`;
    av.style.width = "26px"; av.style.height = "26px"; av.style.fontSize = "10.5px";
    setAvatarContent(av, p);
    row.appendChild(av);

    const info = document.createElement("div");
    info.className = "member-info";
    info.innerHTML = `
      <span class="member-name">${escapeHTML(p.display_name)}${p.id === ME.id ? " (you)" : ""}</span>
      <span class="member-status ${isOnline ? "online" : ""}">${isOnline ? "Online" : lastSeenLabel(p.last_read_at)}</span>
    `;
    row.appendChild(info);

    if (p.role === "owner") {
      const tag = document.createElement("span");
      tag.className = "owner-tag";
      tag.textContent = "OWNER";
      row.appendChild(tag);
    }
    list.appendChild(row);
  }
}

function wireHeader() {
  document.getElementById("logoutBtn").addEventListener("click", logoutUser);
  document.getElementById("menuToggle").addEventListener("click", () => {
    document.getElementById("membersPanel").classList.toggle("open");
  });
  document.getElementById("closeMembersPanel").addEventListener("click", () => {
    document.getElementById("membersPanel").classList.remove("open");
  });
  document.getElementById("loadMoreBtn").addEventListener("click", loadOlderMessages);
}

let notifications = [];

async function loadNotifications() {
  const { data, error } = await sb
    .from("notifications")
    .select("*")
    .eq("user_id", ME.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) { console.error(error); return; }
  notifications = data || [];

  const actorIds = [...new Set(notifications.map(n => n.actor_id).filter(Boolean))];
  await Promise.all(actorIds.map(getProfile));

  renderNotifications();
}

function notifText(n, actorName) {
  switch (n.type) {
    case "follow_request": return `<b>${actorName}</b> requested to follow you`;
    case "follow": return `<b>${actorName}</b> started following you`;
    case "follow_accepted": return `<b>${actorName}</b> accepted your follow request`;
    case "like": return `<b>${actorName}</b> liked your post`;
    case "comment": return `<b>${actorName}</b> commented on your post`;
    default: return `<b>${actorName}</b> sent an update`;
  }
}

function buildNotifRow(n) {
  const actor = n.actor_id ? profileCache.get(n.actor_id) : null;
  const actorName = actor ? escapeHTML(actor.display_name) : "Someone";

  const row = document.createElement("a");
  row.className = `notif-row ${n.read ? "" : "unread"}`;
  row.href = actor ? `profile.html?u=${encodeURIComponent(actor.username)}` : "#";

  const av = document.createElement("span");
  av.className = "avatar";
  av.style.width = "30px"; av.style.height = "30px"; av.style.fontSize = "11px"; av.style.flexShrink = "0";
  setAvatarContent(av, actor);
  row.appendChild(av);

  const info = document.createElement("div");
  info.innerHTML = `${notifText(n, actorName)}<div class="notif-time">${formatTime(n.created_at)}</div>`;
  row.appendChild(info);

  row.addEventListener("click", () => markNotifRead(n.id));

  return row;
}

function renderNotifications() {
  const unreadCount = notifications.filter(n => !n.read).length;
  const badge = document.getElementById("notifBadge");
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }

  const results = document.getElementById("notifResults");
  if (!notifications.length) {
    results.innerHTML = `<div class="search-hint">No notifications yet.</div>`;
    return;
  }
  results.innerHTML = "";
  for (const n of notifications) results.appendChild(buildNotifRow(n));
}

async function markNotifRead(id) {
  const n = notifications.find(x => x.id === id);
  if (!n || n.read) return;
  n.read = true;
  await sb.from("notifications").update({ read: true }).eq("id", id);
  renderNotifications();
}

async function markAllNotifsRead() {
  const unread = notifications.filter(n => !n.read);
  if (!unread.length) return;
  unread.forEach(n => { n.read = true; });
  await sb.from("notifications").update({ read: true }).eq("user_id", ME.id).eq("read", false);
  renderNotifications();
}

function subscribeNotifications() {
  sb.channel("public:notifications")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${ME.id}` }, async (payload) => {
      const n = payload.new;
      if (n.actor_id) await getProfile(n.actor_id);
      notifications.unshift(n);
      renderNotifications();
    })
    .subscribe();
}

function wireNotifications() {
  const toggle = document.getElementById("notifToggle");
  const panel = document.getElementById("notifPanel");
  toggle.addEventListener("click", () => {
    const isOpen = panel.classList.toggle("show");
    if (isOpen) markAllNotifsRead();
  });
}

function wireSearch() {
  const toggle = document.getElementById("searchToggle");
  const panel = document.getElementById("searchPanel");
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");

  toggle.addEventListener("click", () => {
    const isOpen = panel.classList.toggle("show");
    if (isOpen) {
      input.focus();
    } else {
      input.value = "";
      results.innerHTML = "";
    }
  });

  input.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    const term = input.value.trim();
    if (!term) { results.innerHTML = ""; return; }
    searchDebounceTimer = setTimeout(() => runMessageSearch(term), 350);
  });
}

async function runMessageSearch(term) {
  const results = document.getElementById("searchResults");
  results.innerHTML = `<div class="search-hint">Searching…</div>`;

  const { data, error } = await sb
    .from("messages")
    .select("*")
    .eq("deleted", false)
    .ilike("content", `%${term}%`)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    results.innerHTML = `<div class="search-hint">Search failed.</div>`;
    return;
  }
  if (!data.length) {
    results.innerHTML = `<div class="search-hint">No messages found.</div>`;
    return;
  }

  const ids = [...new Set(data.map(m => m.user_id))];
  await Promise.all(ids.map(getProfile));

  results.innerHTML = "";
  for (const m of data) {
    const author = await getProfile(m.user_id);
    const row = document.createElement("div");
    row.className = "search-result-row";

    const av = document.createElement("div");
    av.className = "avatar";
    av.style.width = "26px"; av.style.height = "26px"; av.style.fontSize = "10px";
    setAvatarContent(av, author);
    row.appendChild(av);

    const text = document.createElement("div");
    text.className = "search-result-text";
    text.innerHTML = `<a href="profile.html?u=${encodeURIComponent(author?.username || "")}">${escapeHTML(author?.display_name || "Unknown")}</a> · <span>${formatTime(m.created_at)}</span><br>${escapeHTML(m.content)}`;
    row.appendChild(text);

    results.appendChild(row);
  }
}

setTimeout(() => {
  document.getElementById("loadingOverlay")?.classList.add("hide");
}, 8000);

init();
