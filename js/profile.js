let ME = null;
let viewedUser = null;
let isOwnProfile = false;
let followState = "none"; // none | pending | accepted
let pendingPfpFile = null;
let pendingPostImageFile = null;
let pendingPostImagePreviewUrl = null;

async function init() {
  const session = await requireSession("index.html");
  if (!session) return;

  ME = await getMyProfile();
  if (!ME) return;

  applyIconAttributes();

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

  const params = new URLSearchParams(window.location.search);
  const targetUsername = (params.get("u") || ME.username).toLowerCase();

  viewedUser = targetUsername === ME.username ? ME : await getProfileByUsername(targetUsername);
  if (!viewedUser) {
    document.getElementById("profileScroll").innerHTML =
      `<div class="locked-posts">User not found.</div>`;
    document.getElementById("loadingOverlay").classList.add("hide");
    return;
  }

  isOwnProfile = viewedUser.id === ME.id;
  document.getElementById("profileTopTitle").textContent = isOwnProfile ? "Your profile" : `@${viewedUser.username}`;

  await loadFollowState();
  renderProfileHeader();
  await renderStats();
  renderActions();
  wireEditProfile();
  wireNewPost();
  wirePfpUpload();
  wireFollowListModal();
  await loadPosts();
  await loadFollowRequests();

  document.getElementById("loadingOverlay").classList.add("hide");
}

async function loadFollowRequests() {
  if (!isOwnProfile) return;

  const { data, error } = await sb
    .from("follows").select("*")
    .eq("following_id", ME.id).eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error || !data || !data.length) return;

  const panel = document.getElementById("requestsPanel");
  const list = document.getElementById("requestsList");
  panel.style.display = "block";
  list.innerHTML = "";

  const requesterIds = data.map(r => r.follower_id);
  await Promise.all(requesterIds.map(getProfile));

  for (const req of data) {
    const p = await getProfile(req.follower_id);
    const row = document.createElement("div");
    row.className = "request-row";

    const av = document.createElement("span");
    av.className = "avatar";
    av.style.width = "34px"; av.style.height = "34px"; av.style.fontSize = "12px";
    if (p?.pfp_url) { av.style.backgroundImage = `url("${p.pfp_url}")`; av.style.backgroundSize = "cover"; }
    else { av.style.background = colorFromName(p?.display_name || "?"); av.textContent = initials(p?.display_name); }
    row.appendChild(av);

    const info = document.createElement("div");
    info.className = "request-info";
    info.innerHTML = `<div class="follow-list-name">${escapeHTML(p?.display_name || "Unknown")}</div><div class="follow-list-username">@${escapeHTML(p?.username || "")}</div>`;
    row.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "request-actions";

    const acceptBtn = document.createElement("button");
    acceptBtn.className = "request-accept";
    acceptBtn.textContent = "Accept";
    acceptBtn.addEventListener("click", async () => {
      const { error: aErr } = await sb.from("follows").update({ status: "accepted" }).eq("id", req.id);
      if (aErr) { toast(aErr.message || "Could not accept."); return; }
      row.remove();
      await renderStats();
      if (!list.children.length) panel.style.display = "none";
    });
    actions.appendChild(acceptBtn);

    const declineBtn = document.createElement("button");
    declineBtn.className = "request-decline";
    declineBtn.textContent = "Decline";
    declineBtn.addEventListener("click", async () => {
      const { error: dErr } = await sb.from("follows").delete().eq("id", req.id);
      if (dErr) { toast(dErr.message || "Could not decline."); return; }
      row.remove();
      if (!list.children.length) panel.style.display = "none";
    });
    actions.appendChild(declineBtn);

    row.appendChild(actions);
    list.appendChild(row);
  }
}

function renderProfileHeader() {
  const pfp = document.getElementById("pfpCircle");
  if (viewedUser.pfp_url) {
    pfp.style.backgroundImage = `url("${viewedUser.pfp_url}")`;
    pfp.textContent = "";
  } else {
    pfp.style.backgroundImage = "";
    pfp.style.background = colorFromName(viewedUser.display_name);
    pfp.textContent = initials(viewedUser.display_name);
  }

  document.getElementById("profileDisplayName").textContent = viewedUser.display_name;
  document.getElementById("profileUsername").textContent = `@${viewedUser.username}`;
  document.getElementById("profileBio").textContent = viewedUser.bio || (isOwnProfile ? "Add a bio…" : "");
  document.getElementById("privateBadge").style.display = viewedUser.is_private ? "inline-block" : "none";

  if (isOwnProfile) {
    document.getElementById("pfpEditBtn").style.display = "flex";
  }
}

function canSeePosts() {
  return isOwnProfile || !viewedUser.is_private || followState === "accepted";
}

async function renderStats() {
  const { count: postsCount } = await sb
    .from("posts").select("id", { count: "exact", head: true })
    .eq("user_id", viewedUser.id).eq("deleted", false);
  const { count: followersCount } = await sb
    .from("follows").select("id", { count: "exact", head: true })
    .eq("following_id", viewedUser.id).eq("status", "accepted");
  const { count: followingCount } = await sb
    .from("follows").select("id", { count: "exact", head: true })
    .eq("follower_id", viewedUser.id).eq("status", "accepted");

  document.getElementById("postsCount").textContent = postsCount || 0;
  document.getElementById("followersCount").textContent = followersCount || 0;
  document.getElementById("followingCount").textContent = followingCount || 0;
}

async function loadFollowState() {
  if (isOwnProfile) { followState = "none"; return; }
  const { data } = await sb
    .from("follows").select("status")
    .eq("follower_id", ME.id).eq("following_id", viewedUser.id)
    .maybeSingle();
  followState = data ? data.status : "none";
}

function renderActions() {
  const actions = document.getElementById("profileActions");
  actions.innerHTML = "";

  if (isOwnProfile) {
    const btn = document.createElement("button");
    btn.className = "btn-outline btn";
    btn.textContent = "Edit profile";
    btn.addEventListener("click", () => {
      const panel = document.getElementById("editPanel");
      const open = panel.style.display !== "none";
      panel.style.display = open ? "none" : "block";
      if (!open) {
        document.getElementById("editDisplayName").value = viewedUser.display_name || "";
        document.getElementById("editUsername").value = viewedUser.username || "";
        document.getElementById("editBio").value = viewedUser.bio || "";
        document.getElementById("editPrivate").checked = !!viewedUser.is_private;
      }
    });
    actions.appendChild(btn);
    document.getElementById("newPostBox").style.display = "block";
    return;
  }

  const btn = document.createElement("button");
  btn.className = "follow-btn";
  if (followState === "accepted") {
    btn.textContent = "Following";
    btn.classList.add("following");
  } else if (followState === "pending") {
    btn.textContent = "Requested";
    btn.classList.add("pending");
  } else {
    btn.textContent = "Follow";
  }
  btn.addEventListener("click", toggleFollow);
  actions.appendChild(btn);
}

async function toggleFollow() {
  if (followState === "none") {
    const { error } = await sb.from("follows").insert({
      follower_id: ME.id,
      following_id: viewedUser.id,
    });
    if (error) { toast(error.message || "Could not follow."); return; }
  } else {
    const { error } = await sb.from("follows")
      .delete()
      .eq("follower_id", ME.id).eq("following_id", viewedUser.id);
    if (error) { toast(error.message || "Could not update follow status."); return; }
  }
  await loadFollowState();
  renderActions();
  await renderStats();
  await loadPosts();
}

function wireEditProfile() {
  document.getElementById("cancelEditBtn").addEventListener("click", () => {
    document.getElementById("editPanel").style.display = "none";
    document.getElementById("editError").textContent = "";
  });

  document.getElementById("saveEditBtn").addEventListener("click", async () => {
    const errEl = document.getElementById("editError");
    errEl.textContent = "";
    const newDisplayName = document.getElementById("editDisplayName").value.trim();
    const newUsername = document.getElementById("editUsername").value.trim().toLowerCase();
    const newBio = document.getElementById("editBio").value.trim();
    const newPrivate = document.getElementById("editPrivate").checked;

    if (!newDisplayName) { errEl.textContent = "Display name can't be empty."; return; }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(newUsername)) {
      errEl.textContent = "Username must be 3–20 characters: letters, numbers, underscore only.";
      return;
    }

    const saveBtn = document.getElementById("saveEditBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    if (newUsername !== ME.username) {
      const { error: rpcErr } = await sb.rpc("change_own_username", { new_username: newUsername });
      if (rpcErr) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
        errEl.textContent = rpcErr.message.includes("taken")
          ? "That username is already taken."
          : (rpcErr.message || "Could not change username.");
        return;
      }
    }

    const { error } = await sb.from("profiles").update({
      display_name: newDisplayName,
      bio: newBio || null,
      is_private: newPrivate,
    }).eq("id", ME.id);

    saveBtn.disabled = false;
    saveBtn.textContent = "Save";

    if (error) {
      errEl.textContent = error.message || "Could not save changes.";
      return;
    }

    Object.assign(ME, { display_name: newDisplayName, username: newUsername, bio: newBio || null, is_private: newPrivate });
    viewedUser = ME;
    document.getElementById("editPanel").style.display = "none";
    renderProfileHeader();

    if (newUsername !== new URLSearchParams(window.location.search).get("u")) {
      history.replaceState(null, "", `profile.html?u=${encodeURIComponent(newUsername)}`);
    }
    toast("Profile updated");
  });
}

function wirePfpUpload() {
  const input = document.getElementById("pfpInput");
  if (!input) return;
  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file);
      const path = `${ME.id}/${Date.now()}.jpg`;
      const { error: upErr } = await sb.storage.from("avatars").upload(path, compressed, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { data: pub } = sb.storage.from("avatars").getPublicUrl(path);
      const { error } = await sb.from("profiles").update({ pfp_url: pub.publicUrl }).eq("id", ME.id);
      if (error) throw error;
      ME.pfp_url = pub.publicUrl;
      viewedUser = ME;
      renderProfileHeader();
      toast("Profile photo updated");
    } catch (err) {
      toast(err.message || "Could not update photo.");
    }
  });
}

function wireNewPost() {
  const input = document.getElementById("postImageInput");
  const previewBox = document.getElementById("postAttachPreview");
  const previewImg = document.getElementById("postAttachImg");

  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file);
      pendingPostImageFile = compressed;
      if (pendingPostImagePreviewUrl) URL.revokeObjectURL(pendingPostImagePreviewUrl);
      pendingPostImagePreviewUrl = URL.createObjectURL(compressed);
      previewImg.src = pendingPostImagePreviewUrl;
      previewBox.classList.add("show");
    } catch (err) {
      toast(err.message || "Could not process this photo.");
    }
  });

  document.getElementById("removePostAttach").addEventListener("click", () => {
    pendingPostImageFile = null;
    if (pendingPostImagePreviewUrl) { URL.revokeObjectURL(pendingPostImagePreviewUrl); pendingPostImagePreviewUrl = null; }
    previewBox.classList.remove("show");
    input.value = "";
  });

  document.getElementById("publishPostBtn").addEventListener("click", async () => {
    const textEl = document.getElementById("newPostText");
    const text = textEl.value.trim();
    if (!text && !pendingPostImageFile) return;

    const btn = document.getElementById("publishPostBtn");
    btn.disabled = true;

    try {
      let image_url = null;
      if (pendingPostImageFile) {
        const path = `${ME.id}/${Date.now()}.jpg`;
        const { error: upErr } = await sb.storage.from("posts").upload(path, pendingPostImageFile, { contentType: "image/jpeg" });
        if (upErr) throw upErr;
        const { data: pub } = sb.storage.from("posts").getPublicUrl(path);
        image_url = pub.publicUrl;
      }

      const { error } = await sb.from("posts").insert({
        user_id: ME.id,
        content: text || null,
        image_url,
      });
      if (error) throw error;

      textEl.value = "";
      pendingPostImageFile = null;
      if (pendingPostImagePreviewUrl) { URL.revokeObjectURL(pendingPostImagePreviewUrl); pendingPostImagePreviewUrl = null; }
      previewBox.classList.remove("show");
      input.value = "";

      await renderStats();
      await loadPosts();
    } catch (err) {
      toast(err.message || "Could not publish post.");
    } finally {
      btn.disabled = false;
    }
  });
}

async function loadPosts() {
  const listEl = document.getElementById("postsList");
  const lockedEl = document.getElementById("lockedPosts");
  listEl.innerHTML = "";

  if (!canSeePosts()) {
    lockedEl.style.display = "block";
    return;
  }
  lockedEl.style.display = "none";

  const { data, error } = await sb
    .from("posts")
    .select("*")
    .eq("user_id", viewedUser.id)
    .eq("deleted", false)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  const postIds = (data || []).map(p => p.id);
  const [likeCounts, myLikes, commentCounts] = await Promise.all([
    fetchLikeCounts(postIds),
    fetchMyLikes(postIds),
    fetchCommentCounts(postIds),
  ]);

  for (const post of data || []) {
    listEl.appendChild(buildPostCard(
      post,
      likeCounts[post.id] || 0,
      myLikes.has(post.id),
      commentCounts[post.id] || 0
    ));
  }
}

async function fetchLikeCounts(postIds) {
  if (!postIds.length) return {};
  const { data } = await sb.from("post_likes").select("post_id").in("post_id", postIds);
  const counts = {};
  (data || []).forEach(r => { counts[r.post_id] = (counts[r.post_id] || 0) + 1; });
  return counts;
}

async function fetchMyLikes(postIds) {
  if (!postIds.length) return new Set();
  const { data } = await sb.from("post_likes").select("post_id").eq("user_id", ME.id).in("post_id", postIds);
  return new Set((data || []).map(r => r.post_id));
}

async function fetchCommentCounts(postIds) {
  if (!postIds.length) return {};
  const { data } = await sb.from("post_comments").select("post_id").eq("deleted", false).in("post_id", postIds);
  const counts = {};
  (data || []).forEach(r => { counts[r.post_id] = (counts[r.post_id] || 0) + 1; });
  return counts;
}

function buildPostCard(post, likeCount, likedByMe, commentCount) {
  const card = document.createElement("div");
  card.className = "post-card";

  if (post.user_id === ME.id) {
    const del = document.createElement("button");
    del.className = "post-delete";
    del.innerHTML = svgIcon("trash", 13);
    del.addEventListener("click", async () => {
      if (!confirm("Delete this post?")) return;
      const { error } = await sb.from("posts").update({ deleted: true }).eq("id", post.id).eq("user_id", ME.id);
      if (error) { toast(error.message || "Could not delete post."); return; }
      card.remove();
      renderStats();
    });
    card.appendChild(del);
  }

  const time = document.createElement("div");
  time.className = "post-time";
  time.textContent = new Date(post.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  card.appendChild(time);

  if (post.content) {
    const text = document.createElement("div");
    text.className = "post-text";
    text.textContent = post.content;
    card.appendChild(text);
  }

  if (post.image_url) {
    const img = document.createElement("img");
    img.src = post.image_url;
    img.loading = "lazy";
    img.addEventListener("click", () => window.open(post.image_url, "_blank"));
    card.appendChild(img);
  }

  const engageRow = document.createElement("div");
  engageRow.className = "post-engage-row";

  const likeBtn = document.createElement("button");
  likeBtn.className = `like-btn ${likedByMe ? "liked" : ""}`;
  likeBtn.innerHTML = `${svgIcon("heart", 15)} <span class="like-count">${likeCount}</span>`;
  likeBtn.addEventListener("click", () => toggleLike(post.id, likeBtn));
  engageRow.appendChild(likeBtn);

  const commentBtn = document.createElement("button");
  commentBtn.className = "comment-toggle-btn";
  commentBtn.innerHTML = `${svgIcon("comment", 14)} ${commentCount}`;
  commentBtn.addEventListener("click", () => toggleComments(post.id, card));
  engageRow.appendChild(commentBtn);

  card.appendChild(engageRow);

  const commentsSection = document.createElement("div");
  commentsSection.className = "comments-section";
  commentsSection.style.display = "none";
  card.appendChild(commentsSection);

  return card;
}

async function toggleLike(postId, btn) {
  const wasLiked = btn.classList.contains("liked");
  if (wasLiked) {
    const { error } = await sb.from("post_likes").delete().eq("post_id", postId).eq("user_id", ME.id);
    if (error) { toast(error.message || "Could not unlike."); return; }
  } else {
    const { error } = await sb.from("post_likes").insert({ post_id: postId, user_id: ME.id });
    if (error) { toast(error.message || "Could not like."); return; }
  }
  const current = parseInt(btn.querySelector(".like-count").textContent, 10) || 0;
  const newCount = wasLiked ? current - 1 : current + 1;
  btn.classList.toggle("liked", !wasLiked);
  btn.innerHTML = `${svgIcon("heart", 15)} <span class="like-count">${newCount}</span>`;
}

async function toggleComments(postId, card) {
  const section = card.querySelector(".comments-section");
  const isOpen = section.style.display !== "none";
  if (isOpen) { section.style.display = "none"; return; }
  section.style.display = "block";
  await loadCommentsInto(postId, section, card);
}

async function loadCommentsInto(postId, section, card) {
  section.innerHTML = `<div class="search-hint">Loading…</div>`;

  const { data, error } = await sb
    .from("post_comments").select("*")
    .eq("post_id", postId).eq("deleted", false)
    .order("created_at", { ascending: true });

  if (error) { section.innerHTML = `<div class="search-hint">Could not load comments.</div>`; return; }

  const authorIds = [...new Set((data || []).map(c => c.user_id))];
  await Promise.all(authorIds.map(getProfile));

  section.innerHTML = "";
  for (const c of data || []) {
    const author = await getProfile(c.user_id);
    const row = document.createElement("div");
    row.className = "comment-row";
    row.innerHTML = `<b>${escapeHTML(author?.display_name || "Unknown")}</b> ${escapeHTML(c.content)}`;
    section.appendChild(row);
  }

  const inputRow = document.createElement("div");
  inputRow.className = "comment-input-row";
  inputRow.innerHTML = `<input type="text" placeholder="Add a comment…" maxlength="300" /><button>Post</button>`;
  section.appendChild(inputRow);

  const input = inputRow.querySelector("input");
  const sendBtn = inputRow.querySelector("button");
  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    const { error: cErr } = await sb.from("post_comments").insert({ post_id: postId, user_id: ME.id, content: text });
    sendBtn.disabled = false;
    if (cErr) { toast(cErr.message || "Could not post comment."); return; }
    input.value = "";
    await loadCommentsInto(postId, section, card);
    const countBtn = card.querySelector(".comment-toggle-btn");
    const current = parseInt(countBtn.textContent.replace(/\D/g, ""), 10) || 0;
    countBtn.innerHTML = `${svgIcon("comment", 14)} ${current + 1}`;
  };
  sendBtn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

function wireFollowListModal() {
  document.getElementById("statFollowers").addEventListener("click", () => openFollowList("followers"));
  document.getElementById("statFollowing").addEventListener("click", () => openFollowList("following"));
  document.getElementById("closeFollowList").addEventListener("click", () => {
    document.getElementById("followListModal").classList.remove("show");
  });
  document.getElementById("followListModal").addEventListener("click", (e) => {
    if (e.target.id === "followListModal") e.currentTarget.classList.remove("show");
  });
}

async function openFollowList(type) {
  if (!canSeePosts()) { toast("This account is private."); return; }

  document.getElementById("followListTitle").textContent = type === "followers" ? "Followers" : "Following";
  const body = document.getElementById("followListBody");
  body.innerHTML = `<div class="search-hint">Loading…</div>`;
  document.getElementById("followListModal").classList.add("show");

  const column = type === "followers" ? "following_id" : "follower_id";
  const otherColumn = type === "followers" ? "follower_id" : "following_id";

  const { data: rows, error } = await sb
    .from("follows").select(otherColumn)
    .eq(column, viewedUser.id).eq("status", "accepted");

  if (error || !rows || !rows.length) {
    body.innerHTML = `<div class="search-hint">Nobody here yet.</div>`;
    return;
  }

  const ids = rows.map(r => r[otherColumn]);
  const { data: people } = await sb.from("profiles").select("*").in("id", ids);

  body.innerHTML = "";
  for (const p of people || []) {
    const row = document.createElement("a");
    row.className = "follow-list-row";
    row.href = `profile.html?u=${encodeURIComponent(p.username)}`;

    const av = document.createElement("span");
    av.className = "avatar";
    av.style.width = "34px"; av.style.height = "34px"; av.style.fontSize = "12px";
    if (p.pfp_url) { av.style.backgroundImage = `url("${p.pfp_url}")`; av.style.backgroundSize = "cover"; }
    else { av.style.background = colorFromName(p.display_name); av.textContent = initials(p.display_name); }
    row.appendChild(av);

    const info = document.createElement("div");
    info.innerHTML = `<div class="follow-list-name">${escapeHTML(p.display_name)}</div><div class="follow-list-username">@${escapeHTML(p.username)}</div>`;
    row.appendChild(info);

    body.appendChild(row);
  }
}

setTimeout(() => {
  document.getElementById("loadingOverlay")?.classList.add("hide");
}, 8000);

init();
