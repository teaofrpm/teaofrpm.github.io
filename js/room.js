let ME = null;
let convo = null;
let members = [];
let amAdmin = false;
let otherUser = null;

let pendingImageFile = null;
let pendingImagePreviewUrl = null;
let pendingAudioBlob = null;
let pendingAudioPreviewUrl = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingTimer = null;
let lastRenderedDay = null;
let replyingTo = null;
let STICKER_URLS = [];
let presenceChannel = null;
let typingClearTimer = null;
let isTypingBroadcasted = false;
let searchDebounceTimer = null;
const typingUsers = new Map();
const messageCache = new Map();   // id -> message, so a reply preview needn't refetch
const reactionsByMsg = new Map(); // message id -> its reaction rows

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
  if (!ME.is_verified) { window.location.href = "verify.html"; return; }

  profileCache.set(ME.id, ME);
  applyIconAttributes();

  const convoId = new URLSearchParams(location.search).get("c");
  if (!convoId) { window.location.href = "messages.html"; return; }

  const { data, error } = await sb.from("conversations").select("*").eq("id", convoId).maybeSingle();
  if (error || !data) {
    document.getElementById("messages").innerHTML = `<div class="inbox-empty">This chat isn't available.</div>`;
    return;
  }
  convo = data;

  await loadMembers();
  renderHeader();
  wireComposer();
  wireInfoSheet();
  document.getElementById("lightbox").addEventListener("click", () => document.getElementById("lightbox").classList.remove("show"));

  wireSearch();
  loadStickers();

  Skeleton.show("chat", "messages", 6);
  await loadMessages();
  subscribeMessages();
  subscribePresence();
  markRead();

  document.addEventListener("visibilitychange", () => { if (!document.hidden) markRead(); });
}

async function loadMembers() {
  const { data } = await sb.from("conversation_members").select("*").eq("conversation_id", convo.id);
  members = data || [];
  await getProfiles(members.map(m => m.user_id));
  amAdmin = members.some(m => m.user_id === ME.id && m.role === "admin");
  otherUser = convo.kind === "dm"
    ? profileCache.get(members.find(m => m.user_id !== ME.id)?.user_id)
    : null;
}

function renderHeader() {
  const av = document.getElementById("roomAvatar");
  const title = document.getElementById("roomTitle");
  const subtitle = document.getElementById("roomSubtitle");
  const link = document.getElementById("roomTitleLink");

  if (convo.kind === "dm") {
    title.textContent = otherUser?.display_name || "Unknown";
    subtitle.textContent = otherUser ? `@${otherUser.username}` : "";
    setAvatarContent(av, otherUser);
    if (otherUser) link.href = `profile.html?u=${encodeURIComponent(otherUser.username)}`;
    if (otherUser) {
      const audioBtn = document.getElementById("callAudioBtn");
      const videoBtn = document.getElementById("callVideoBtn");
      audioBtn.style.display = "flex";
      videoBtn.style.display = "flex";
      audioBtn.onclick = () => CallManager.start(convo.id, otherUser, "audio");
      videoBtn.onclick = () => CallManager.start(convo.id, otherUser, "video");
    }
  } else {
    title.textContent = convo.name || "Group";
    subtitle.textContent = `${members.length} member${members.length === 1 ? "" : "s"}`;
    setGroupAvatar(av, convo, 0);
  }
}

function setGroupAvatar(el, conversation, fontSize) {
  const name = conversation.name || "Group";
  if (conversation.pfp_url) {
    el.style.backgroundImage = `url("${conversation.pfp_url}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.textContent = "";
  } else {
    el.style.backgroundImage = "";
    el.style.background = colorFromName(name);
    el.textContent = initials(name);
  }
}

/* ---------- Messages ---------- */

async function loadMessages() {
  const { data, error } = await sb.from("messages").select("*")
    .eq("conversation_id", convo.id).eq("deleted", false)
    .order("created_at", { ascending: false }).limit(60);

  if (error) { toast("Could not load messages."); return; }

  const ordered = [...(data || [])].reverse();
  ordered.forEach(m => messageCache.set(m.id, m));
  await getProfiles(ordered.map(m => m.user_id));

  // One query for every reaction on screen, not one per message.
  const map = await fetchReactions(ordered.map(m => m.id));
  map.forEach((v, k) => reactionsByMsg.set(k, v));

  const container = document.getElementById("messages");
  container.innerHTML = "";
  lastRenderedDay = null;
  for (const m of ordered) appendMessage(m, container);
  container.scrollTop = container.scrollHeight;
}

function appendMessage(m, container) {
  const day = new Date(m.created_at).toDateString();
  if (day !== lastRenderedDay) {
    const divider = document.createElement("div");
    divider.className = "date-divider";
    divider.innerHTML = `<span>${formatDayLabel(m.created_at)}</span>`;
    container.appendChild(divider);
    lastRenderedDay = day;
  }

  if (m.call_id) {
    container.appendChild(buildCallLogRow(m));
    return;
  }

  // "Riya changed the group name to …" — written by a database trigger, never
  // by a client, so it can't be faked or sent as an ordinary message.
  if (m.is_system) {
    container.appendChild(buildSystemRow(m));
    return;
  }

  const author = profileCache.get(m.user_id);
  const isOwn = m.user_id === ME.id;

  const row = document.createElement("div");
  row.className = `msg-row ${isOwn ? "own" : ""}`;
  row.dataset.msgId = m.id;

  const avatar = document.createElement("a");
  avatar.className = "avatar";
  if (author) avatar.href = `profile.html?u=${encodeURIComponent(author.username)}`;
  setAvatarContent(avatar, author);
  row.appendChild(avatar);

  const wrap = document.createElement("div");
  wrap.className = "msg-bubble-wrap";

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.innerHTML = `<span class="msg-name">${escapeHTML(author?.display_name || "Unknown")}</span><span>${formatTime(m.created_at)}</span>`;
  wrap.appendChild(meta);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (m.sticker_url && !m.content && !m.image_url) bubble.classList.add("sticker-only");

  if (m.reply_to) {
    const replyPrev = document.createElement("div");
    replyPrev.className = "reply-preview";
    replyPrev.textContent = "Original message";
    findMessageById(m.reply_to).then(async (original) => {
      if (!original) return;
      const origAuthor = await getProfile(original.user_id);
      replyPrev.innerHTML = `<b>${escapeHTML(origAuthor?.display_name || "…")}</b>: ${escapeHTML(previewText(original))}`;
    });
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
    img.addEventListener("click", () => {
      document.getElementById("lightboxImg").src = m.image_url;
      document.getElementById("lightbox").classList.add("show");
    });
    bubble.appendChild(img);
  }
  if (m.shared_post_id) {
    const shared = document.createElement("a");
    shared.className = "shared-post-by";
    shared.href = `profile.html?u=`;
    shared.textContent = "Shared a post";
    shared.style.cssText = "display:block;font-size:11.5px;opacity:.8;margin-top:4px;text-decoration:underline;";
    bubble.appendChild(shared);
    getSharedPostAuthor(m.shared_post_id).then((author) => {
      if (!author) return;
      shared.href = `profile.html?u=${encodeURIComponent(author.username)}`;
      shared.textContent = `Shared a post by @${author.username}`;
    });
  }

  if (m.content) {
    const txt = document.createElement("div");
    txt.className = "msg-text";
    txt.innerHTML = linkify(escapeHTML(m.content)) + (m.edited_at ? ` <span class="edited-tag">(edited)</span>` : "");
    if (m.image_url || m.audio_url || m.sticker_url) txt.style.marginTop = "6px";
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

  actions.querySelector(".reply-btn").addEventListener("click", () => startReply(m, author));
  actions.querySelector(".react-btn").addEventListener("click", () => openEmojiPicker(bubble, m.id));
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
  }

  wrap.appendChild(bubble);

  const reactRow = document.createElement("div");
  reactRow.className = "reactions-row";
  wrap.appendChild(reactRow);
  renderReactions(reactRow, m.id, reactionsByMsg.get(m.id) || []);

  row.appendChild(wrap);
  container.appendChild(row);
}

/* ---------- Message actions ---------- */

function linkify(safeText) {
  return safeText.replace(/(https?:\/\/[^\s]+)/g, (url) => {
    const trimmed = url.replace(/[.,!?)\]]+$/, "");
    return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer">${trimmed}</a>${url.slice(trimmed.length)}`;
  });
}

function previewText(m) {
  if (m.content) return m.content.slice(0, 60);
  if (m.image_url) return "Photo";
  if (m.sticker_url) return "Sticker";
  if (m.audio_url) return "Voice note";
  return "message";
}

async function findMessageById(id) {
  if (messageCache.has(id)) return messageCache.get(id);
  const { data } = await sb.from("messages").select("*").eq("id", id).maybeSingle();
  if (data) messageCache.set(id, data);
  return data;
}

function jumpToMessage(id) {
  const target = document.querySelector(`[data-msg-id="${id}"]`);
  if (!target) { toast("That message is further up — scroll back to see it."); return; }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  const bubble = target.querySelector(".bubble");
  bubble.classList.add("highlight-flash");
  setTimeout(() => bubble.classList.remove("highlight-flash"), 1500);
}

function openLightbox(src) {
  document.getElementById("lightboxImg").src = src;
  document.getElementById("lightbox").classList.add("show");
}

async function deleteMessage(id, row) {
  if (!confirm("Delete this message?")) return;
  const { error } = await sb.from("messages").update({ deleted: true })
    .eq("id", id).eq("user_id", ME.id);
  if (error) { toast(error.message || "Could not delete."); return; }
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

  const bar = document.createElement("div");
  bar.className = "edit-actions";
  bar.innerHTML = `<button class="edit-cancel">Cancel</button><button class="edit-save">Save</button>`;
  editBox.insertAdjacentElement("afterend", bar);

  function restore(content) {
    const restored = document.createElement("div");
    restored.className = "msg-text";
    restored.innerHTML = linkify(escapeHTML(content)) + (m.edited_at ? ` <span class="edited-tag">(edited)</span>` : "");
    editBox.replaceWith(restored);
    bar.remove();
  }

  bar.querySelector(".edit-cancel").addEventListener("click", () => restore(m.content));
  bar.querySelector(".edit-save").addEventListener("click", async () => {
    const newText = editBox.value.trim();
    if (!newText) { toast("Message can't be empty."); return; }
    if (newText === m.content) { restore(m.content); return; }
    const editedAt = new Date().toISOString();
    const { error } = await sb.from("messages")
      .update({ content: newText, edited_at: editedAt })
      .eq("id", m.id).eq("user_id", ME.id);
    if (error) { toast(error.message || "Could not edit."); return; }
    m.content = newText;
    m.edited_at = editedAt;
    restore(newText);
  });
}

/* ---------- Reactions ---------- */

async function fetchReactions(ids) {
  if (!ids.length) return new Map();
  const { data } = await sb.from("message_reactions").select("*").in("message_id", ids);
  const map = new Map();
  for (const r of data || []) {
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id).push(r);
  }
  return map;
}

function renderReactions(container, messageId, reactions) {
  container.innerHTML = "";
  const grouped = {};
  for (const r of reactions) (grouped[r.emoji] = grouped[r.emoji] || []).push(r);

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
  await refreshReactionsFor(messageId);
}

async function refreshReactionsFor(messageId) {
  const row = document.querySelector(`[data-msg-id="${messageId}"] .reactions-row`);
  if (!row) return;
  const map = await fetchReactions([messageId]);
  reactionsByMsg.set(messageId, map.get(messageId) || []);
  renderReactions(row, messageId, reactionsByMsg.get(messageId));
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

/* ---------- Reply ---------- */

function startReply(m, author) {
  replyingTo = { id: m.id, name: author?.display_name || "Unknown", text: previewText(m) };
  document.getElementById("replyToName").textContent = replyingTo.name;
  document.getElementById("replyToText").textContent = replyingTo.text;
  document.getElementById("replyBar").classList.add("show");
  document.getElementById("msgInput").focus();
}

function clearReply() {
  replyingTo = null;
  document.getElementById("replyBar").classList.remove("show");
}

async function getSharedPostAuthor(postId) {
  const { data } = await sb.from("posts").select("user_id").eq("id", postId).maybeSingle();
  return data ? getProfile(data.user_id) : null;
}

function buildSystemRow(m) {
  const row = document.createElement("div");
  row.className = "system-row";
  row.dataset.msgId = m.id;

  const actor = profileCache.get(m.user_id);
  const who = m.user_id === ME.id ? "You" : (actor?.display_name || "Someone");
  const text = m.content || "updated the chat";
  const icon = /photo/i.test(text) ? "image" : /theme/i.test(text) ? "palette" : "edit";

  const chip = document.createElement("div");
  chip.className = "system-chip";
  chip.innerHTML = `${svgIcon(icon, 13)}<span><b>${escapeHTML(who)}</b> ${escapeHTML(text)}</span><small>${formatTime(m.created_at)}</small>`;
  row.appendChild(chip);
  return row;
}

// Written by the database itself whenever the group name, photo or theme
// changes, so the record of who changed what can't be faked by a client.
function buildCallLogRow(m) {
  const row = document.createElement("div");
  row.className = "call-log-row";
  row.dataset.msgId = m.id;

  const text = m.content || "Call";
  const missed = /missed|declined|couldn/i.test(text);
  const isVideo = /video/i.test(text);

  const chip = document.createElement("button");
  chip.className = `call-log-chip ${missed ? "missed" : ""}`;
  chip.innerHTML = `${svgIcon(isVideo ? "video" : "phone", 15)} ${escapeHTML(text)} <small>${formatTime(m.created_at)}</small>`;
  chip.title = "Call back";
  chip.addEventListener("click", () => {
    if (convo.kind === "dm" && otherUser) CallManager.start(convo.id, otherUser, isVideo ? "video" : "audio");
  });
  row.appendChild(chip);
  return row;
}

function formatDayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function subscribeMessages() {
  sb.channel(`room:${convo.id}`)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "messages",
      filter: `conversation_id=eq.${convo.id}`,
    }, async ({ new: m }) => {
      if (document.querySelector(`[data-msg-id="${m.id}"]`)) return;
      messageCache.set(m.id, m);
      await getProfile(m.user_id);
      clearTypingUser(m.user_id);
      const container = document.getElementById("messages");
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 160;
      appendMessage(m, container);
      if (nearBottom) container.scrollTop = container.scrollHeight;
      if (!document.hidden) markRead();
    })
    .on("postgres_changes", {
      event: "UPDATE", schema: "public", table: "messages",
      filter: `conversation_id=eq.${convo.id}`,
    }, ({ new: m }) => {
      const row = document.querySelector(`[data-msg-id="${m.id}"]`);
      if (m.deleted) { row?.remove(); return; }
      messageCache.set(m.id, m);
      const txt = row?.querySelector(".msg-text");
      if (txt && !row.querySelector(".edit-box")) {
        txt.innerHTML = linkify(escapeHTML(m.content || "")) +
          (m.edited_at ? ` <span class="edited-tag">(edited)</span>` : "");
      }
    })
    .on("postgres_changes", {
      event: "*", schema: "public", table: "message_reactions",
    }, ({ new: n, old: o }) => {
      const id = n?.message_id || o?.message_id;
      if (id && document.querySelector(`[data-msg-id="${id}"]`)) refreshReactionsFor(id);
    })
    .subscribe();

  // Someone else renaming the group or changing its photo should be visible
  // here immediately, not only after a reload.
  sb.channel(`convo:${convo.id}`)
    .on("postgres_changes", {
      event: "UPDATE", schema: "public", table: "conversations",
      filter: `id=eq.${convo.id}`,
    }, ({ new: c }) => {
      convo = { ...convo, ...c };
      renderHeader();
      if (document.getElementById("roomInfoSheet").classList.contains("show")) {
        document.getElementById("groupNameEdit").value = convo.name || "";
        setGroupAvatar(document.getElementById("groupPfp"), convo);
      }
    })
    .subscribe();

}

async function markRead() {
  await sb.from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", convo.id).eq("user_id", ME.id);
}

/* ---------- Composer ---------- */

function clearPendingAudio() {
  pendingAudioBlob = null;
  if (pendingAudioPreviewUrl) { URL.revokeObjectURL(pendingAudioPreviewUrl); pendingAudioPreviewUrl = null; }
  document.getElementById("audioPreview").classList.remove("show");
}

function clearPendingImage() {
  pendingImageFile = null;
  if (pendingImagePreviewUrl) { URL.revokeObjectURL(pendingImagePreviewUrl); pendingImagePreviewUrl = null; }
  document.getElementById("imageInput").value = "";
  document.getElementById("attachPreview").classList.remove("show");
}

function refreshSendState() {
  const input = document.getElementById("msgInput");
  document.getElementById("sendBtn").disabled = !(input.value.trim() || pendingImageFile || pendingAudioBlob);
}

function wireComposer() {
  const input = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
    refreshSendState();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendMessage();
    }
  });

  input.addEventListener("paste", async (e) => {
    const item = [...e.clipboardData.items].find(i => i.type.startsWith("image/"));
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
  document.getElementById("removeAudioAttach").addEventListener("click", () => { clearPendingAudio(); refreshSendState(); });
  document.getElementById("voiceBtn").addEventListener("click", toggleVoiceRecording);

  document.getElementById("cancelReply").addEventListener("click", clearReply);

  document.getElementById("stickerToggle").addEventListener("click", () => {
    document.getElementById("stickerPanel").classList.toggle("show");
  });

  wireTypingBroadcast(input);
}

async function handlePickedImage(file, label) {
  clearPendingAudio();
  document.getElementById("attachName").textContent = "Processing photo…";
  document.getElementById("attachPreview").classList.add("show");
  try {
    const blob = await compressImageFile(file);
    pendingImageFile = blob;
    if (pendingImagePreviewUrl) URL.revokeObjectURL(pendingImagePreviewUrl);
    pendingImagePreviewUrl = URL.createObjectURL(blob);
    document.getElementById("attachImg").src = pendingImagePreviewUrl;
    document.getElementById("attachName").textContent = label;
    refreshSendState();
  } catch (err) {
    toast(err.message || "Could not process this photo.");
    clearPendingImage();
  }
}

async function toggleVoiceRecording() {
  const btn = document.getElementById("voiceBtn");

  if (mediaRecorder && mediaRecorder.state === "recording") { mediaRecorder.stop(); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast("Voice notes aren't supported in this browser."); return; }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ["audio/mp4", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t)) || "";
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(recordingTimer);
      btn.classList.remove("recording");
      btn.innerHTML = svgIcon("mic", 19);

      clearPendingImage();
      pendingAudioBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      if (pendingAudioPreviewUrl) URL.revokeObjectURL(pendingAudioPreviewUrl);
      pendingAudioPreviewUrl = URL.createObjectURL(pendingAudioBlob);
      document.getElementById("audioPreviewPlayer").src = pendingAudioPreviewUrl;
      document.getElementById("audioPreview").classList.add("show");
      refreshSendState();
    };

    mediaRecorder.start();
    const startedAt = Date.now();
    btn.classList.add("recording");
    recordingTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      btn.textContent = `${secs}s`;
      if (secs >= 120) mediaRecorder.stop();
    }, 500);
  } catch {
    toast("Microphone access denied or unavailable.");
  }
}

async function sendMessage({ sticker } = {}) {
  const input = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");
  const text = input.value.trim();
  if (!text && !pendingImageFile && !pendingAudioBlob && !sticker) return;

  sendBtn.disabled = true;

  try {
    let image_url = null;
    let audio_url = null;

    if (pendingImageFile) {
      const path = `${ME.id}/${Date.now()}.jpg`;
      const { error: upErr } = await sb.storage.from("chat-images").upload(path, pendingImageFile, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      image_url = sb.storage.from("chat-images").getPublicUrl(path).data.publicUrl;
    } else if (pendingAudioBlob) {
      const ext = (pendingAudioBlob.type || "").includes("mp4") ? "m4a" : "webm";
      const path = `${ME.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage.from("voice-notes").upload(path, pendingAudioBlob, {
        contentType: pendingAudioBlob.type || "audio/webm",
      });
      if (upErr) throw upErr;
      audio_url = sb.storage.from("voice-notes").getPublicUrl(path).data.publicUrl;
    }

    const { error } = await sb.from("messages").insert({
      user_id: ME.id,
      conversation_id: convo.id,
      content: text || null,
      image_url,
      audio_url,
      sticker_url: sticker || null,
      reply_to: replyingTo?.id || null,
    });
    if (error) throw error;

    input.value = "";
    input.style.height = "auto";
    clearPendingImage();
    clearPendingAudio();
    clearReply();
    sendTypingState(false);
  } catch (err) {
    toast(err.message || "Message failed to send.");
  } finally {
    refreshSendState();
  }
}

/* ---------- Stickers ---------- */

const RECENT_STICKERS_KEY = "teaofrpm_recent_stickers";

async function loadStickers() {
  const { data, error } = await sb.from("stickers").select("*")
    .order("created_at", { ascending: false });

  STICKER_URLS = error ? [] : (data || []).map(st => ({
    url: sb.storage.from("stickers").getPublicUrl(st.storage_path).data.publicUrl,
    label: st.label || "sticker",
  }));
  buildStickerPanel();
}

function getRecentStickers() {
  try { return JSON.parse(localStorage.getItem(RECENT_STICKERS_KEY)) || []; }
  catch { return []; }
}

function saveRecentSticker(sticker) {
  const recents = getRecentStickers().filter(st => st.url !== sticker.url);
  recents.unshift(sticker);
  localStorage.setItem(RECENT_STICKERS_KEY, JSON.stringify(recents.slice(0, 8)));
}

function buildStickerPanel() {
  const panel = document.getElementById("stickerPanel");
  if (!panel) return;

  if (!STICKER_URLS.length) {
    panel.innerHTML = `<span style="grid-column:1/-1; font-size:12.5px; color:var(--text-muted); padding:8px;">No stickers yet.</span>`;
    return;
  }

  const recents = getRecentStickers().filter(r => STICKER_URLS.some(st => st.url === r.url));
  const asImg = st => `<img src="${st.url}" alt="${escapeHTML(st.label)}" title="${escapeHTML(st.label)}" loading="lazy" />`;

  let html = "";
  if (recents.length) {
    html += `<span class="sticker-section-label">Recently used</span>${recents.map(asImg).join("")}`;
    html += `<span class="sticker-section-label">All stickers</span>`;
  }
  html += STICKER_URLS.map(asImg).join("");
  panel.innerHTML = html;

  panel.querySelectorAll("img").forEach((el) => {
    el.addEventListener("click", () => {
      const sticker = STICKER_URLS.find(st => st.url === el.src);
      if (!sticker) return;
      saveRecentSticker(sticker);
      buildStickerPanel();
      panel.classList.remove("show");
      sendMessage({ sticker: sticker.url });
    });
  });
}

/* ---------- Typing indicator and presence ----------
   Typing is a broadcast, not a table write: it changes many times a second
   and nobody needs it after the moment has passed, so storing it would be
   pure waste. Presence is Supabase's own tracker on the same channel. */

function subscribePresence() {
  presenceChannel = sb.channel(`room-presence:${convo.id}`, {
    config: { presence: { key: ME.id } },
  });

  presenceChannel
    .on("broadcast", { event: "typing" }, ({ payload }) => handleTypingBroadcast(payload))
    .on("presence", { event: "sync" }, () => renderPresence())
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({ user_id: ME.id, online_at: new Date().toISOString() });
      }
    });

  window.addEventListener("beforeunload", () => sendTypingState(false));
}

function renderPresence() {
  const sub = document.getElementById("roomSubtitle");
  if (!sub) return;

  const state = presenceChannel?.presenceState() || {};
  const onlineIds = new Set(Object.keys(state));

  if (convo.kind === "dm") {
    const other = members.find(m => m.user_id !== ME.id);
    const isOnline = other && onlineIds.has(other.user_id);
    sub.textContent = isOnline ? "Online" : (otherUser ? `@${otherUser.username}` : "");
    sub.classList.toggle("is-online", !!isOnline);
    return;
  }

  // In a group, count everyone currently in the room besides yourself.
  const othersOnline = members.filter(m => m.user_id !== ME.id && onlineIds.has(m.user_id)).length;
  sub.textContent = othersOnline
    ? `${members.length} members · ${othersOnline} online`
    : `${members.length} members`;
  sub.classList.toggle("is-online", othersOnline > 0);
}

function wireTypingBroadcast(input) {
  input.addEventListener("input", () => {
    if (!input.value.trim()) { sendTypingState(false); return; }
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
  if (!payload || payload.user_id === ME.id) return;

  if (!payload.typing) { clearTypingUser(payload.user_id); return; }

  const existing = typingUsers.get(payload.user_id);
  if (existing) clearTimeout(existing.timeoutId);
  // If the sender's "stopped" broadcast never arrives, drop it ourselves.
  const timeoutId = setTimeout(() => clearTypingUser(payload.user_id), 4000);
  typingUsers.set(payload.user_id, { display_name: payload.display_name, timeoutId });
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
  if (!el) return;
  const names = [...typingUsers.values()].map(t => t.display_name);

  if (!names.length) { el.textContent = ""; el.classList.remove("show"); return; }

  el.textContent = names.length === 1
    ? `${names[0]} is typing…`
    : names.length === 2
      ? `${names[0]} and ${names[1]} are typing…`
      : `${names.slice(0, 2).join(", ")} and ${names.length - 2} others are typing…`;
  el.classList.add("show");
}

/* ---------- Search inside this conversation ---------- */

function wireSearch() {
  const toggle = document.getElementById("searchToggle");
  const panel = document.getElementById("searchPanel");
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");
  if (!toggle) return;

  toggle.addEventListener("click", () => {
    const open = panel.classList.toggle("show");
    if (open) input.focus();
    else { input.value = ""; results.innerHTML = ""; }
  });

  input.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    const term = input.value.trim();
    if (!term) { results.innerHTML = ""; return; }
    searchDebounceTimer = setTimeout(() => runMessageSearch(term), 320);
  });
}

async function runMessageSearch(term) {
  const results = document.getElementById("searchResults");
  results.innerHTML = `<div class="search-hint">Searching…</div>`;

  // % and _ are wildcards in ilike, so a literal one must be escaped
  const safe = term.replace(/[%_]/g, m => `\\${m}`);
  const { data, error } = await sb.from("messages").select("*")
    .eq("conversation_id", convo.id)
    .eq("deleted", false)
    .ilike("content", `%${safe}%`)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) { results.innerHTML = `<div class="search-hint">Search failed.</div>`; return; }
  if (!data.length) { results.innerHTML = `<div class="search-hint">No messages found.</div>`; return; }

  await getProfiles(data.map(m => m.user_id));
  results.innerHTML = "";

  for (const m of data) {
    const author = profileCache.get(m.user_id);
    const row = document.createElement("div");
    row.className = "search-result-row";

    const av = document.createElement("div");
    av.className = "avatar";
    av.style.width = "26px"; av.style.height = "26px"; av.style.fontSize = "10px";
    setAvatarContent(av, author);
    row.appendChild(av);

    const text = document.createElement("div");
    text.className = "search-result-text";
    text.innerHTML = `<b>${escapeHTML(author?.display_name || "Unknown")}</b> · <span>${formatTime(m.created_at)}</span><br>${escapeHTML(m.content)}`;
    row.appendChild(text);

    row.addEventListener("click", () => {
      document.getElementById("searchPanel").classList.remove("show");
      jumpToMessage(m.id);
    });
    results.appendChild(row);
  }
}

/* ---------- Details sheet (group rename, pfp, members, leave) ---------- */

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
  document.getElementById("addMemberSearch").addEventListener("input", (e) => renderAddMembers(e.target.value.trim().toLowerCase()));
}

async function renderInfoSheet() {
  document.getElementById("roomInfoTitle").textContent = convo.kind === "dm" ? "Details" : "Group details";

  const isGroup = convo.kind === "group";
  // Any member can rename the group or change its photo — the conversations
  // UPDATE policy allows it, and every change is logged into the chat.
  // Adding/removing members stays with admins, which the database enforces.
  document.getElementById("groupEditArea").style.display = isGroup ? "block" : "none";
  document.getElementById("leaveGroupBtn").style.display = isGroup ? "block" : "none";
  document.getElementById("addMemberArea").style.display = isGroup && amAdmin ? "block" : "none";

  if (isGroup) {
    document.getElementById("groupNameEdit").value = convo.name || "";
    setGroupAvatar(document.getElementById("groupPfp"), convo);
  }

  const list = document.getElementById("roomMembers");
  list.innerHTML = "";
  const ordered = [...members].sort((a, b) =>
    (a.role === "admin" ? 0 : 1) - (b.role === "admin" ? 0 : 1));
  for (const member of ordered) {
    const p = profileCache.get(member.user_id);
    if (!p) continue;
    const row = document.createElement("div");
    row.className = "settings-list-row";

    const av = document.createElement("span");
    av.className = "avatar";
    setAvatarContent(av, p);
    row.appendChild(av);

    const name = document.createElement("a");
    name.className = "settings-list-name";
    name.href = `profile.html?u=${encodeURIComponent(p.username)}`;
    name.innerHTML = `${escapeHTML(p.display_name)}${member.user_id === ME.id ? " (you)" : ""}<span class="settings-list-sub">@${escapeHTML(p.username)}${member.role === "admin" ? ' · <b class="member-admin-tag">Admin</b>' : ""}</span>`;
    row.appendChild(name);

    if (isGroup && amAdmin) {
      const isTargetAdmin = member.role === "admin";

      const roleBtn = document.createElement("button");
      roleBtn.textContent = isTargetAdmin ? "Remove admin" : "Make admin";
      roleBtn.addEventListener("click", async () => {
        const verb = isTargetAdmin ? "remove admin rights from" : "make an admin";
        const who = member.user_id === ME.id ? "yourself" : p.display_name;
        if (!confirm(`${isTargetAdmin ? "Remove admin from" : "Make"} ${who}${isTargetAdmin ? "" : " an admin"}?`)) return;

        roleBtn.disabled = true;
        const { error } = await sb.rpc("set_member_role", {
          p_conversation: convo.id,
          p_user: member.user_id,
          p_role: isTargetAdmin ? "member" : "admin",
        });
        roleBtn.disabled = false;

        // The database refuses to leave a group without an admin, and
        // refuses role changes from non-admins — surface whichever it says.
        if (error) { toast(error.message || `Could not ${verb} them.`); return; }

        await loadMembers();
        renderHeader();
        await renderInfoSheet();
        toast(isTargetAdmin ? "Admin removed" : `${p.display_name} is now an admin`);
      });
      row.appendChild(roleBtn);

      if (member.user_id !== ME.id) {
        const btn = document.createElement("button");
        btn.textContent = "Remove";
        btn.addEventListener("click", async () => {
          if (!confirm(`Remove ${p.display_name} from the group?`)) return;
          const { error } = await sb.from("conversation_members").delete()
            .eq("conversation_id", convo.id).eq("user_id", member.user_id);
          if (error) { toast(error.message || "Could not remove."); return; }
          await loadMembers();
          renderHeader();
          await renderInfoSheet();
        });
        row.appendChild(btn);
      }
    }
    list.appendChild(row);
  }

  if (isGroup && amAdmin) await loadAddableMembers();
}

let addablePeople = [];

async function loadAddableMembers() {
  const memberIds = new Set(members.map(m => m.user_id));
  const { data } = await sb.from("profiles")
    .select("id,username,display_name,pfp_url")
    .eq("is_verified", true)
    .order("display_name", { ascending: true })
    .limit(500);

  (data || []).forEach(p => profileCache.set(p.id, p));
  addablePeople = (data || []).filter(p => !memberIds.has(p.id));
  renderAddMembers();
}

function renderAddMembers(filterText = "") {
  const list = document.getElementById("addMemberList");
  const people = filterText
    ? addablePeople.filter(p => p.display_name.toLowerCase().includes(filterText) || p.username.toLowerCase().includes(filterText))
    : addablePeople;

  if (!people.length) { list.innerHTML = `<div class="settings-empty">Nobody left to add.</div>`; return; }

  list.innerHTML = "";
  for (const p of people) {
    const row = document.createElement("div");
    row.className = "settings-list-row";
    const av = document.createElement("span");
    av.className = "avatar";
    setAvatarContent(av, p);
    row.appendChild(av);

    const name = document.createElement("div");
    name.className = "settings-list-name";
    name.textContent = p.display_name;
    row.appendChild(name);

    const btn = document.createElement("button");
    btn.textContent = "Add";
    btn.addEventListener("click", async () => {
      const { error } = await sb.from("conversation_members")
        .insert({ conversation_id: convo.id, user_id: p.id, role: "member" });
      if (error) { toast(error.message || "Could not add."); return; }
      await loadMembers();
      renderHeader();
      await renderInfoSheet();
      toast(`${p.display_name} added`);
    });
    row.appendChild(btn);
    list.appendChild(row);
  }
}

async function saveGroupName() {
  const name = document.getElementById("groupNameEdit").value.trim();
  if (!name) { toast("Group needs a name."); return; }
  const { error } = await sb.from("conversations").update({ name }).eq("id", convo.id);
  if (error) { toast(error.message || "Could not rename."); return; }
  convo.name = name;
  renderHeader();
  toast("Group updated");
}

async function uploadGroupPfp(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const blob = await compressImageFile(file);
    const path = `group-${convo.id}/${Date.now()}.jpg`;
    const { error: upErr } = await sb.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
    if (upErr) throw upErr;
    const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    const { error } = await sb.from("conversations").update({ pfp_url: url }).eq("id", convo.id);
    if (error) throw error;
    convo.pfp_url = url;
    setGroupAvatar(document.getElementById("groupPfp"), convo);
    renderHeader();
    toast("Group photo updated");
  } catch (err) {
    toast(err.message || "Could not update photo.");
  }
}

async function leaveGroup() {
  if (!confirm("Leave this group?")) return;
  const { error } = await sb.from("conversation_members").delete()
    .eq("conversation_id", convo.id).eq("user_id", ME.id);
  if (error) { toast(error.message || "Could not leave."); return; }
  window.location.href = "messages.html";
}

init();
