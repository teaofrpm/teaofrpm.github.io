let ME = null;
let viewedUser = null;
let isOwnProfile = false;
let followState = "none";        // none | pending | accepted
let blockedByMe = false;
let pendingPostImageFile = null;
let pendingPostImagePreviewUrl = null;
let pendingTags = [];

async function init() {
  Skeleton.show("feed", "postsList", 2);
  ME = await App.boot();

  const params = new URLSearchParams(location.search);
  const targetUsername = (params.get("u") || ME.username).toLowerCase();

  viewedUser = targetUsername === ME.username ? ME : await getProfileByUsername(targetUsername);
  if (!viewedUser) {
    document.getElementById("profileScroll").innerHTML = `<div class="locked-posts">User not found.</div>`;
    return;
  }

  isOwnProfile = viewedUser.id === ME.id;
  document.getElementById("profileTopTitle").textContent = isOwnProfile ? "Your profile" : `@${viewedUser.username}`;
  document.title = `${viewedUser.display_name} (@${viewedUser.username}) — 𝓉𝑒𝒶𝑜𝒻𝓇𝓅𝓂`;
  renderProfileHeader();
  wireTopbar();

  await Promise.all([loadFollowState(), loadBlockState()]);
  renderActions();
  wireEditProfile();
  wireNewPost();
  wirePfpUpload();
  wireFollowListModal();
  wireProfileTabs();

  await Promise.all([
    renderStats(),
    loadPosts(),
    loadFollowRequests(),
    Social.Highlights.render(document.getElementById("highlightRail"), viewedUser, isOwnProfile),
  ]);
  handleDeepLink(params);
}

/* ---------- top bar: share / ⋯ ---------- */

function wireTopbar() {
  const bar = document.querySelector(".profile-topbar");
  const url = `profile.html?u=${encodeURIComponent(viewedUser.username)}`;

  const share = document.createElement("button");
  share.className = "header-icon-btn x2-ic-share";
  share.title = "Share profile";
  share.innerHTML = svgIcon("share", 17);
  share.addEventListener("click", () => shareLink(url, `${viewedUser.display_name} on teaofrpm`));

  const settings = document.getElementById("settingsLink");
  if (isOwnProfile) {
    settings.style.display = "flex";
    settings.before(share);
    return;
  }
  settings.remove();
  const more = document.createElement("button");
  more.className = "header-icon-btn";
  more.title = "More";
  more.innerHTML = svgIcon("more", 18);
  more.addEventListener("click", () => actionSheet(`@${viewedUser.username}`, [
    { icon: "link", label: "Copy profile link", onClick: () => copyText(new URL(url, location.href).href, "Link copied") },
    { icon: "block", label: blockedByMe ? "Unblock" : "Block", danger: !blockedByMe, onClick: toggleBlock },
    { icon: "flag", label: "Report account", danger: true, onClick: () => reportSheet("user", viewedUser.id) },
  ]));
  bar.append(share, more);
}

async function loadBlockState() {
  if (isOwnProfile) return;
  const { data } = await sb.from("blocks").select("blocker_id").eq("blocker_id", ME.id).eq("blocked_id", viewedUser.id).maybeSingle();
  blockedByMe = !!data;
}

async function toggleBlock() {
  if (!blockedByMe && !confirm(`Block @${viewedUser.username}? They won't be able to message you or see your content, and any follows between you are removed.`)) return;
  const { error } = blockedByMe
    ? await sb.from("blocks").delete().eq("blocker_id", ME.id).eq("blocked_id", viewedUser.id)
    : await sb.from("blocks").insert({ blocker_id: ME.id, blocked_id: viewedUser.id });
  if (error) { toast(friendlyError(error, "Could not update.")); return; }
  blockedByMe = !blockedByMe;
  toast(blockedByMe ? "Blocked" : "Unblocked");
  await loadFollowState();
  renderActions();
  renderStats();
  loadPosts();
}

/* ---------- deep links ---------- */

// Notifications point at the exact thing: ?post=<id> or ?panel=requests.
async function handleDeepLink(params) {
  const postId = params.get("post");
  const panel = params.get("panel");
  const focus = (el) => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("deep-link-flash");
    setTimeout(() => el.classList.remove("deep-link-flash"), 1800);
  };

  if (panel === "requests") {
    const el = document.getElementById("requestsPanel");
    if (el && el.style.display !== "none") focus(el);
    return;
  }
  if (!postId) return;
  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (card) { focus(card); return; }

  // Not on this profile (e.g. someone tagged you in their post) — open it on its own.
  const { data: post } = await sb.from("posts").select("*").eq("id", postId).eq("deleted", false).maybeSingle();
  if (!post) { toast("That post isn't available anymore."); return; }
  const [counts] = await Promise.all([postCounts([post.id]), getProfiles([post.user_id]), Social.loadTags([post.id])]);
  const s = makeSheet({ title: `Post by @${profileCache.get(post.user_id)?.username || ""}` });
  s.onClose = () => setTimeout(() => s.el.remove(), 300);
  s.body.appendChild(buildPostCard(post, counts.likes[post.id] || 0, counts.mine.has(post.id), counts.comments[post.id] || 0, true));
  s.open();
}

/* ---------- follow requests ---------- */

async function loadFollowRequests() {
  if (!isOwnProfile) return;
  const { data, error } = await sb.from("follows").select("*")
    .eq("following_id", ME.id).eq("status", "pending").order("created_at", { ascending: false });
  if (error || !data?.length) return;

  const panel = document.getElementById("requestsPanel");
  const list = document.getElementById("requestsList");
  await getProfiles(data.map((r) => r.follower_id));
  panel.style.display = "block";
  list.innerHTML = "";

  for (const req of data) {
    const p = profileCache.get(req.follower_id);
    const row = document.createElement("div");
    row.className = "request-row";
    row.innerHTML = `<a class="avatar" style="width:34px;height:34px;font-size:12px;" href="profile.html?u=${encodeURIComponent(p?.username || "")}"></a>
      <div class="request-info"><div class="follow-list-name">${escapeHTML(p?.display_name || "Unknown")}</div><div class="follow-list-username">@${escapeHTML(p?.username || "")}</div></div>
      <div class="request-actions"><button class="request-accept">Accept</button><button class="request-decline">Decline</button></div>`;
    setAvatarContent(row.querySelector(".avatar"), p);
    const done = () => { row.remove(); if (!list.children.length) panel.style.display = "none"; };
    row.querySelector(".request-accept").addEventListener("click", async () => {
      const { error: e } = await sb.from("follows").update({ status: "accepted" }).eq("id", req.id);
      if (e) { toast(friendlyError(e, "Could not accept.")); return; }
      done(); renderStats();
    });
    row.querySelector(".request-decline").addEventListener("click", async () => {
      const { error: e } = await sb.from("follows").delete().eq("id", req.id);
      if (e) { toast(friendlyError(e, "Could not decline.")); return; }
      done();
    });
    list.appendChild(row);
  }
}

/* ---------- header ---------- */

function renderProfileHeader() {
  const pfp = document.getElementById("pfpCircle");
  setAvatarContent(pfp, viewedUser);
  if (viewedUser.pfp_url) {
    pfp.style.cursor = "zoom-in";
    pfp.onclick = () => openMediaViewer(viewedUser.pfp_url);
  } else { pfp.onclick = null; pfp.style.cursor = ""; }

  const nameEl = document.getElementById("profileDisplayName");
  nameEl.textContent = viewedUser.display_name;
  if (viewedUser.role === "owner") nameEl.insertAdjacentHTML("beforeend", ` <span class="owner-badge">Owner</span>`);
  document.getElementById("profileUsername").textContent = `@${viewedUser.username}`;
  const bio = document.getElementById("profileBio");
  if (viewedUser.bio) bio.innerHTML = linkifyMentions(escapeHTML(viewedUser.bio));
  else bio.textContent = isOwnProfile ? "Add a bio…" : "";
  document.getElementById("privateBadge").style.display = viewedUser.is_private ? "inline-block" : "none";

  const website = document.getElementById("profileWebsite");
  if (viewedUser.website_url && /^https?:\/\//i.test(viewedUser.website_url)) {
    website.href = viewedUser.website_url;
    website.innerHTML = `${svgIcon("link", 13)} ${escapeHTML(viewedUser.website_url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}`;
    website.style.display = "inline-flex";
  } else website.style.display = "none";

  const song = document.getElementById("profileSong");
  if (viewedUser.profile_song_url) { song.src = viewedUser.profile_song_url; song.style.display = "block"; }
  else { song.style.display = "none"; song.removeAttribute("src"); }

  if (isOwnProfile) document.getElementById("pfpEditBtn").style.display = "flex";

  // Online now?
  if (!isOwnProfile) {
    Presence.onChange((online) => {
      let dot = document.querySelector(".profile-online");
      if (online.has(viewedUser.id)) {
        if (!dot) {
          dot = document.createElement("span");
          dot.className = "profile-online";
          dot.textContent = "Active now";
          document.getElementById("profileUsername").after(dot);
        }
      } else dot?.remove();
    });
  }
}

function canSeePosts() {
  return isOwnProfile || ((!viewedUser.is_private || followState === "accepted") && !blockedByMe);
}

async function renderStats() {
  const [posts, followers, following] = await Promise.all([
    sb.from("posts").select("id", { count: "exact", head: true }).eq("user_id", viewedUser.id).eq("deleted", false).eq("archived", false),
    sb.from("follows").select("id", { count: "exact", head: true }).eq("following_id", viewedUser.id).eq("status", "accepted"),
    sb.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", viewedUser.id).eq("status", "accepted"),
  ]);
  document.getElementById("postsCount").textContent = posts.count || 0;
  document.getElementById("followersCount").textContent = followers.count || 0;
  document.getElementById("followingCount").textContent = following.count || 0;
}

async function loadFollowState() {
  if (isOwnProfile) { followState = "none"; return; }
  const { data } = await sb.from("follows").select("status").eq("follower_id", ME.id).eq("following_id", viewedUser.id).maybeSingle();
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
        document.getElementById("editWebsite").value = viewedUser.website_url || "";
        document.getElementById("bioCount").textContent = (viewedUser.bio || "").length;
        document.getElementById("removePfpBtn").style.display = viewedUser.pfp_url ? "block" : "none";
        document.getElementById("editPrivate").checked = !!viewedUser.is_private;
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    actions.appendChild(btn);
    document.getElementById("newPostBox").style.display = "block";
    return;
  }

  if (blockedByMe) {
    const b = document.createElement("button");
    b.className = "follow-btn following";
    b.textContent = "Unblock";
    b.addEventListener("click", toggleBlock);
    actions.appendChild(b);
    return;
  }

  const btn = document.createElement("button");
  btn.className = "follow-btn";
  if (followState === "accepted") { btn.textContent = "Following"; btn.classList.add("following"); }
  else if (followState === "pending") { btn.textContent = "Requested"; btn.classList.add("pending"); }
  else btn.textContent = viewedUser.is_private ? "Request to follow" : "Follow";
  btn.addEventListener("click", () => toggleFollow(btn));
  actions.appendChild(btn);

  const msgBtn = document.createElement("button");
  msgBtn.className = "follow-btn following";
  msgBtn.textContent = "Message";
  msgBtn.addEventListener("click", async () => {
    msgBtn.disabled = true;
    const { data, error } = await sb.rpc("get_or_create_dm", { other_user: viewedUser.id });
    msgBtn.disabled = false;
    if (error) { toast(friendlyError(error, "Could not open chat.")); return; }
    location.href = `room.html?c=${data}`;
  });
  actions.appendChild(msgBtn);
}

async function toggleFollow(btn) {
  if (followState === "accepted" && !confirm(`Unfollow @${viewedUser.username}?`)) return;
  btn.disabled = true;
  const { error } = followState === "none"
    ? await sb.from("follows").insert({ follower_id: ME.id, following_id: viewedUser.id })
    : await sb.from("follows").delete().eq("follower_id", ME.id).eq("following_id", viewedUser.id);
  btn.disabled = false;
  if (error) { toast(friendlyError(error, "Could not update follow status.")); return; }
  const before = followState;
  await loadFollowState();
  renderActions();
  renderStats();
  if (before === "accepted" || followState === "accepted") loadPosts();
}

/* ---------- edit profile ---------- */

function wireEditProfile() {
  if (!isOwnProfile) return;
  document.getElementById("editBio").addEventListener("input", (e) => {
    document.getElementById("bioCount").textContent = e.target.value.length;
  });
  document.getElementById("removePfpBtn").addEventListener("click", async () => {
    if (!confirm("Remove your profile photo?")) return;
    const { error } = await sb.from("profiles").update({ pfp_url: null }).eq("id", ME.id);
    if (error) { toast(friendlyError(error, "Could not remove.")); return; }
    ME.pfp_url = null;
    App.saveMe(ME);
    document.getElementById("removePfpBtn").style.display = "none";
    renderProfileHeader();
    toast("Photo removed");
  });
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
    if (!/^[a-z0-9_]{3,20}$/.test(newUsername)) { errEl.textContent = "Username must be 3–20 characters: letters, numbers, underscore only."; return; }

    let website = document.getElementById("editWebsite").value.trim();
    if (website) {
      if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
      try { new URL(website); } catch { errEl.textContent = "That website address doesn't look right."; return; }
    }

    const saveBtn = document.getElementById("saveEditBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      if (newUsername !== ME.username) {
        const { error: rpcErr } = await sb.rpc("change_own_username", { new_username: newUsername });
        if (rpcErr) {
          errEl.textContent = rpcErr.message.includes("taken") ? "That username is already taken." : (rpcErr.message || "Could not change username.");
          return;
        }
      }
      const patch = { display_name: newDisplayName, bio: newBio || null, is_private: newPrivate, website_url: website || null };
      const { error } = await sb.from("profiles").update(patch).eq("id", ME.id);
      if (error) { errEl.textContent = error.message || "Could not save changes."; return; }

      Object.assign(ME, patch, { username: newUsername });
      App.saveMe(ME);
      document.getElementById("editPanel").style.display = "none";
      renderProfileHeader();
      history.replaceState(null, "", `profile.html?u=${encodeURIComponent(newUsername)}`);
      toast("Profile updated");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });
}

function wirePfpUpload() {
  const input = document.getElementById("pfpInput");
  if (!input || !isOwnProfile) return;
  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const pfp = document.getElementById("pfpCircle");
    pfp.classList.add("uploading");
    try {
      const compressed = await compressImageFile(file, 600);     // avatars never show bigger than this
      const url = await uploadPublic("avatars", `${ME.id}/${Date.now()}.jpg`, compressed);
      const { error } = await sb.from("profiles").update({ pfp_url: url }).eq("id", ME.id);
      if (error) throw error;
      ME.pfp_url = url;
      App.saveMe(ME);
      renderProfileHeader();
      toast("Profile photo updated");
    } catch (err) {
      toast(friendlyError(err, "Could not update photo."));
    } finally { pfp.classList.remove("uploading"); }
  });
}

/* ---------- new post (inline box on your own profile) ---------- */

function wireNewPost() {
  if (!isOwnProfile) return;
  const input = document.getElementById("postImageInput");
  const previewBox = document.getElementById("postAttachPreview");
  const previewImg = document.getElementById("postAttachImg");
  document.getElementById("postImageBtn").innerHTML = svgIcon("image", 19);

  // tag button + tag line
  const row = document.querySelector(".new-post-row");
  const tagBtn = document.createElement("button");
  tagBtn.type = "button";
  tagBtn.className = "icon-btn";
  tagBtn.title = "Tag people";
  tagBtn.innerHTML = svgIcon("tag", 18);
  row.insertBefore(tagBtn, document.getElementById("publishPostBtn"));
  const tagInfo = document.createElement("div");
  tagInfo.className = "x3-hint";
  tagInfo.style.margin = "6px 2px 0";
  row.after(tagInfo);
  const paintTags = () => { tagInfo.textContent = pendingTags.length ? `With ${pendingTags.map((p) => "@" + p.username).join(", ")}` : ""; };
  tagBtn.addEventListener("click", async () => {
    const picked = await pickPeople({ title: "Tag people", exclude: [ME.id], selected: pendingTags });
    if (picked) { pendingTags = picked; paintTags(); }
  });

  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      pendingPostImageFile = await compressImageFile(file);
      if (pendingPostImagePreviewUrl) URL.revokeObjectURL(pendingPostImagePreviewUrl);
      pendingPostImagePreviewUrl = URL.createObjectURL(pendingPostImageFile);
      previewImg.src = pendingPostImagePreviewUrl;
      previewBox.classList.add("show");
    } catch (err) { toast(err.message || "Could not process this photo."); }
  });

  const clearAttach = () => {
    pendingPostImageFile = null;
    if (pendingPostImagePreviewUrl) { URL.revokeObjectURL(pendingPostImagePreviewUrl); pendingPostImagePreviewUrl = null; }
    previewBox.classList.remove("show");
    input.value = "";
  };
  document.getElementById("removePostAttach").addEventListener("click", clearAttach);

  document.getElementById("publishPostBtn").addEventListener("click", async () => {
    const textEl = document.getElementById("newPostText");
    const text = textEl.value.trim();
    if (!text && !pendingPostImageFile) { toast("Write something or add a photo."); return; }
    const btn = document.getElementById("publishPostBtn");
    btn.disabled = true; btn.textContent = "Posting…";
    try {
      const post = await Social.publishPost(text, pendingPostImageFile, pendingTags);
      textEl.value = "";
      clearAttach();
      pendingTags = []; paintTags();
      const list = document.getElementById("postsList");
      list.querySelector(".settings-empty")?.remove();
      list.prepend(buildPostCard(post, 0, false, 0, false));
      const c = document.getElementById("postsCount");
      c.textContent = String((parseInt(c.textContent, 10) || 0) + 1);
      toast("Posted");
    } catch (err) {
      toast(friendlyError(err, "Could not publish post."));
    } finally { btn.disabled = false; btn.textContent = "Post"; }
  });
}

/* ---------- posts ---------- */

function wireProfileTabs() {
  document.querySelectorAll("#profileTabs button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll("#profileTabs button").forEach((b) => b.classList.toggle("active", b === btn));
      const tagged = btn.dataset.tab === "tagged";
      document.getElementById("postsList").style.display = tagged ? "none" : "flex";
      document.getElementById("taggedList").style.display = tagged ? "flex" : "none";
      if (tagged) await loadTaggedPosts();
    });
  });
}

async function postCounts(postIds) {
  if (!postIds.length) return { likes: {}, mine: new Set(), comments: {}, saved: new Set() };
  const [likes, mine, comments, saves] = await Promise.all([
    sb.from("post_likes").select("post_id").in("post_id", postIds),
    sb.from("post_likes").select("post_id").eq("user_id", ME.id).in("post_id", postIds),
    sb.from("post_comments").select("post_id").eq("deleted", false).in("post_id", postIds),
    sb.from("saves").select("post_id").eq("user_id", ME.id).in("post_id", postIds),
  ]);
  const count = (r) => (r.data || []).reduce((a, x) => ((a[x.post_id] = (a[x.post_id] || 0) + 1), a), {});
  return {
    likes: count(likes), comments: count(comments),
    mine: new Set((mine.data || []).map((r) => r.post_id)),
    saved: new Set((saves.data || []).map((r) => r.post_id)),
  };
}

let taggedLoaded = false;
async function loadTaggedPosts() {
  if (taggedLoaded) return;
  taggedLoaded = true;
  const listEl = document.getElementById("taggedList");
  Skeleton.show("feed", listEl, 1);
  if (!canSeePosts()) { listEl.innerHTML = `<div class="locked-posts">This account is private.</div>`; return; }

  const { data: tags } = await sb.from("post_tags").select("post_id").eq("tagged_user_id", viewedUser.id).order("created_at", { ascending: false });
  if (!tags?.length) { listEl.innerHTML = `<div class="settings-empty">No tagged posts yet.</div>`; return; }
  const { data: posts } = await sb.from("posts").select("*").in("id", tags.map((t) => t.post_id))
    .eq("deleted", false).eq("archived", false).order("created_at", { ascending: false });
  if (!posts?.length) { listEl.innerHTML = `<div class="settings-empty">No tagged posts yet.</div>`; return; }

  const ids = posts.map((p) => p.id);
  const [c] = await Promise.all([postCounts(ids), getProfiles(posts.map((p) => p.user_id)), Social.loadTags(ids)]);
  const frag = document.createDocumentFragment();
  posts.forEach((post) => frag.appendChild(buildPostCard(post, c.likes[post.id] || 0, c.mine.has(post.id), c.comments[post.id] || 0, c.saved.has(post.id), true)));
  listEl.replaceChildren(frag);
}

async function loadPosts() {
  const listEl = document.getElementById("postsList");
  const lockedEl = document.getElementById("lockedPosts");

  if (!canSeePosts()) {
    listEl.innerHTML = "";
    lockedEl.innerHTML = blockedByMe
      ? `${svgIcon("block", 14)} You blocked this account.`
      : `${svgIcon("lock", 14)} This account is private. Follow to see their posts.`;
    lockedEl.style.display = "block";
    return;
  }
  lockedEl.style.display = "none";

  const { data, error } = await sb.from("posts").select("*")
    .eq("user_id", viewedUser.id).eq("deleted", false).eq("archived", false)
    .order("created_at", { ascending: false });
  if (error) { console.error(error); listEl.innerHTML = `<div class="settings-empty">Could not load posts.</div>`; return; }
  if (!data.length) {
    listEl.innerHTML = `<div class="settings-empty">${isOwnProfile ? "You haven't posted yet." : "No posts yet."}</div>`;
    return;
  }

  const ids = data.map((p) => p.id);
  const [c] = await Promise.all([postCounts(ids), Social.loadTags(ids)]);
  const frag = document.createDocumentFragment();
  data.forEach((post) => frag.appendChild(buildPostCard(post, c.likes[post.id] || 0, c.mine.has(post.id), c.comments[post.id] || 0, c.saved.has(post.id))));
  listEl.replaceChildren(frag);
}

function buildPostCard(post, likeCount, likedByMe, commentCount, savedByMe, showAuthor = false) {
  const card = document.createElement("div");
  card.className = "post-card";
  card.dataset.postId = post.id;

  const time = document.createElement("div");
  time.className = "post-time";
  const author = profileCache.get(post.user_id);
  time.innerHTML = (showAuthor && author ? `<a class="post-author" href="profile.html?u=${encodeURIComponent(author.username)}">@${escapeHTML(author.username)}</a> · ` : "")
    + escapeHTML(new Date(post.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));
  card.appendChild(time);

  if (post.content) {
    const text = document.createElement("div");
    text.className = "post-text";
    text.innerHTML = linkifyMentions(escapeHTML(post.content));
    card.appendChild(text);
  }

  const likeBtn = document.createElement("button");
  likeBtn.className = `like-btn ${likedByMe ? "liked" : ""}`;
  likeBtn.innerHTML = `${svgIcon("heart", 15)} <span class="like-count">${likeCount}</span>`;
  likeBtn.addEventListener("click", () => toggleLike(post.id, likeBtn));

  if (post.image_url) {
    const img = document.createElement("img");
    img.src = post.image_url;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "";
    let tapTimer = null;
    img.addEventListener("click", () => {
      if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; if (!likeBtn.classList.contains("liked")) toggleLike(post.id, likeBtn); return; }
      tapTimer = setTimeout(() => { tapTimer = null; openMediaViewer(post.image_url); }, 260);
    });
    card.appendChild(img);
  }

  const engageRow = document.createElement("div");
  engageRow.className = "post-engage-row";
  engageRow.appendChild(likeBtn);

  const commentBtn = document.createElement("button");
  commentBtn.className = "comment-toggle-btn";
  commentBtn.innerHTML = `${svgIcon("comment", 14)} <span>${commentCount}</span>`;
  const bump = (d) => { const s = commentBtn.querySelector("span"); s.textContent = String(Math.max(0, (parseInt(s.textContent, 10) || 0) + d)); };
  commentBtn.addEventListener("click", () => openCommentsSheet({
    table: "post_comments", column: "post_id", id: post.id, myId: ME.id,
    onAdded: () => bump(1), onRemoved: () => bump(-1),
  }));
  engageRow.appendChild(commentBtn);

  const saveBtn = document.createElement("button");
  saveBtn.className = `save-btn ${savedByMe ? "saved" : ""}`;
  saveBtn.style.marginLeft = "auto";
  saveBtn.innerHTML = svgIcon("bookmark", 16);
  saveBtn.addEventListener("click", () => toggleSave("post", post.id, saveBtn));
  engageRow.appendChild(saveBtn);

  card.appendChild(engageRow);
  Social.attachPostExtras(card, post, engageRow, {
    onRemoved: () => {
      const c = document.getElementById("postsCount");
      if (post.user_id === viewedUser.id) c.textContent = String(Math.max(0, (parseInt(c.textContent, 10) || 0) - 1));
    },
  });
  return card;
}

async function toggleLike(postId, btn) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = "1";
  const wasLiked = btn.classList.contains("liked");
  const countEl = btn.querySelector(".like-count");
  const current = parseInt(countEl.textContent, 10) || 0;
  btn.classList.toggle("liked", !wasLiked);
  countEl.textContent = String(wasLiked ? current - 1 : current + 1);
  const { error } = wasLiked
    ? await sb.from("post_likes").delete().eq("post_id", postId).eq("user_id", ME.id)
    : await sb.from("post_likes").insert({ post_id: postId, user_id: ME.id });
  delete btn.dataset.busy;
  if (error) {
    btn.classList.toggle("liked", wasLiked);
    countEl.textContent = String(current);
    toast(friendlyError(error, "Could not update like."));
  }
}

/* ---------- followers / following ---------- */

function wireFollowListModal() {
  const modal = document.getElementById("followListModal");
  document.getElementById("statFollowers").addEventListener("click", () => openFollowList("followers"));
  document.getElementById("statFollowing").addEventListener("click", () => openFollowList("following"));
  document.getElementById("statPosts").addEventListener("click", () => document.getElementById("profileTabs").scrollIntoView({ behavior: "smooth" }));
  document.getElementById("closeFollowList").addEventListener("click", () => AppNav.exitFullscreen());
  modal.addEventListener("click", (e) => { if (e.target === modal) AppNav.exitFullscreen(); });
}

async function openFollowList(type) {
  if (!canSeePosts()) { toast("This account is private."); return; }
  const modal = document.getElementById("followListModal");
  document.getElementById("followListTitle").textContent = type === "followers" ? "Followers" : "Following";
  const body = document.getElementById("followListBody");
  Skeleton.show("rows", body, 4);
  modal.classList.add("show");
  AppNav.enterFullscreen(() => modal.classList.remove("show"));

  const column = type === "followers" ? "following_id" : "follower_id";
  const other = type === "followers" ? "follower_id" : "following_id";
  const { data: rows, error } = await sb.from("follows").select(other).eq(column, viewedUser.id).eq("status", "accepted");
  if (error || !rows?.length) { body.innerHTML = `<div class="search-hint">Nobody here yet.</div>`; return; }

  const people = await getProfiles(rows.map((r) => r[other]));
  const frag = document.createDocumentFragment();
  for (const p of people) {
    const row = document.createElement("a");
    row.className = "follow-list-row";
    row.href = `profile.html?u=${encodeURIComponent(p.username)}`;
    row.innerHTML = `<span class="avatar" style="width:34px;height:34px;font-size:12px;"></span><div><div class="follow-list-name">${escapeHTML(p.display_name)}</div><div class="follow-list-username">@${escapeHTML(p.username)}</div></div>`;
    setAvatarContent(row.querySelector(".avatar"), p);
    frag.appendChild(row);
  }
  body.replaceChildren(frag);
}

init();
