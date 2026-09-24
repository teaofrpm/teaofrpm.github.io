
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
    document.getElementById("loadingOverlay").classList.add("hide");
    return;
  }
  convo = data;

  await loadMembers();
  renderHeader();
  wireComposer();
  wireInfoSheet();
  document.getElementById("lightbox").addEventListener("click", () => document.getElementById("lightbox").classList.remove("show"));

  await loadMessages();
  subscribeMessages();
  markRead();

  document.addEventListener("visibilitychange", () => { if (!document.hidden) markRead(); });
  document.getElementById("loadingOverlay").classList.add("hide");
}

async function loadMembers() {
  const { data } = await sb.from("conversation_members").select("*").eq("conversation_id", convo.id);
  members = data || [];
  await Promise.all(members.map(m => getProfile(m.user_id)));
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
  await Promise.all([...new Set(ordered.map(m => m.user_id))].map(getProfile));

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
    txt.textContent = m.content;
    if (m.image_url || m.audio_url) txt.style.marginTop = "6px";
    bubble.appendChild(txt);
  }

  if (isOwn) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML = `<button class="delete-btn" title="Delete">${svgIcon("trash", 14)}</button>`;
    actions.querySelector("button").addEventListener("click", async () => {
      if (!confirm("Delete this message?")) return;
      const { error } = await sb.from("messages").update({ deleted: true }).eq("id", m.id).eq("user_id", ME.id);
      if (error) { toast(error.message || "Could not delete."); return; }
      row.remove();
    });
    bubble.appendChild(actions);
  }

  wrap.appendChild(bubble);
  row.appendChild(wrap);
  container.appendChild(row);
}

async function getSharedPostAuthor(postId) {
  const { data } = await sb.from("posts").select("user_id").eq("id", postId).maybeSingle();
  return data ? getProfile(data.user_id) : null;
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
      await getProfile(m.user_id);
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
      if (m.deleted) document.querySelector(`[data-msg-id="${m.id}"]`)?.remove();
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

  sendBtn.addEventListener("click", sendMessage);

  document.getElementById("imageInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) await handlePickedImage(file, file.name);
  });

  document.getElementById("removeAttach").addEventListener("click", () => { clearPendingImage(); refreshSendState(); });
  document.getElementById("removeAudioAttach").addEventListener("click", () => { clearPendingAudio(); refreshSendState(); });
  document.getElementById("voiceBtn").addEventListener("click", toggleVoiceRecording);
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

async function sendMessage() {
  const input = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");
  const text = input.value.trim();
  if (!text && !pendingImageFile && !pendingAudioBlob) return;

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
    });
    if (error) throw error;

    input.value = "";
    input.style.height = "auto";
    clearPendingImage();
    clearPendingAudio();
  } catch (err) {
    toast(err.message || "Message failed to send.");
  } finally {
    refreshSendState();
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
  document.getElementById("groupEditArea").style.display = isGroup && amAdmin ? "block" : "none";
  document.getElementById("leaveGroupBtn").style.display = isGroup ? "block" : "none";
  document.getElementById("addMemberArea").style.display = isGroup && amAdmin ? "block" : "none";

  if (isGroup && amAdmin) {
    document.getElementById("groupNameEdit").value = convo.name || "";
    setGroupAvatar(document.getElementById("groupPfp"), convo);
  }

  const list = document.getElementById("roomMembers");
  list.innerHTML = "";
  for (const member of members) {
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
    name.innerHTML = `${escapeHTML(p.display_name)}<span class="settings-list-sub">${member.role === "admin" ? "Admin" : "@" + escapeHTML(p.username)}</span>`;
    row.appendChild(name);

    if (isGroup && amAdmin && member.user_id !== ME.id) {
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
    list.appendChild(row);
  }

  if (isGroup && amAdmin) await loadAddableMembers();
}

let addablePeople = [];

async function loadAddableMembers() {
  const { data } = await sb.from("follows").select("following_id")
    .eq("follower_id", ME.id).eq("status", "accepted");
  const memberIds = new Set(members.map(m => m.user_id));
  const ids = (data || []).map(f => f.following_id).filter(id => !memberIds.has(id));
  if (ids.length) await Promise.all(ids.map(getProfile));
  addablePeople = ids.map(id => profileCache.get(id)).filter(Boolean);
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

setTimeout(() => document.getElementById("loadingOverlay")?.classList.add("hide"), 8000);

init();
