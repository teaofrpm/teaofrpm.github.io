let ME = null;

const FEED_PAGE = 12;
const STORY_MS = 5000;

const feed = { authorIds: [], mode: "following", cursor: null, done: false, loading: false };
let storyGroups = [];            // [{ user, stories: [...] }]
let seenStoryIds = new Set();

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
  wireStoryUpload();
  wireStoryViewer();

  await Promise.all([loadStories(), initFeed(), Notifs.init(ME)]);
  document.getElementById("loadingOverlay").classList.add("hide");
}

/* ======================= STORIES ======================= */

async function loadStories() {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: stories, error } = await sb.from("stories").select("*")
    .gt("created_at", since).order("created_at", { ascending: true });
  if (error) { console.error(error); return; }

  const ids = stories.map(s => s.id);
  if (ids.length) {
    const { data: views } = await sb.from("story_views").select("story_id")
      .eq("viewer_id", ME.id).in("story_id", ids);
    seenStoryIds = new Set((views || []).map(v => v.story_id));
  }

  const byUser = new Map();
  for (const s of stories) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id).push(s);
  }
  await Promise.all([...byUser.keys()].map(getProfile));

  const others = [...byUser.entries()]
    .filter(([uid]) => uid !== ME.id)
    .map(([uid, list]) => ({ user: profileCache.get(uid), stories: list }))
    .filter(g => g.user);

  const allSeen = g => g.stories.every(s => seenStoryIds.has(s.id));
  const latest = g => new Date(g.stories[g.stories.length - 1].created_at).getTime();
  others.sort((a, b) => (allSeen(a) - allSeen(b)) || (latest(b) - latest(a)));

  storyGroups = [{ user: ME, stories: byUser.get(ME.id) || [] }, ...others];
  renderStoryRail();
}

function renderStoryRail() {
  const rail = document.getElementById("storyRail");
  rail.innerHTML = "";

  storyGroups.forEach((group, index) => {
    const isMe = group.user.id === ME.id;
    const hasStories = group.stories.length > 0;
    const unseen = hasStories && group.stories.some(s => !seenStoryIds.has(s.id) && !isMe);

    const item = document.createElement("button");
    item.className = `story-item ${unseen || (isMe && hasStories) ? "unseen" : ""}`;
    item.innerHTML = `<div class="story-ring"><span class="avatar"></span></div><span class="story-name">${isMe ? "Your story" : escapeHTML(group.user.display_name)}</span>`;
    setAvatarContent(item.querySelector(".avatar"), group.user);

    item.addEventListener("click", () => {
      if (hasStories) openStoryViewer(index);
      else document.getElementById("storyInput").click();
    });

    if (isMe) {
      const badge = document.createElement("span");
      badge.className = "story-add-badge";
      badge.innerHTML = svgIcon("plus", 13);
      badge.title = "Add to your story";
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        document.getElementById("storyInput").click();
      });
      item.appendChild(badge);
    }
    rail.appendChild(item);
  });
}

function wireStoryUpload() {
  const input = document.getElementById("storyInput");
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    toast("Uploading story…");
    try {
      const blob = await compressImageFile(file);
      const path = `${ME.id}/${Date.now()}.jpg`;
      const { error: upErr } = await sb.storage.from("stories").upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { data: pub } = sb.storage.from("stories").getPublicUrl(path);
      const { error } = await sb.from("stories").insert({ user_id: ME.id, image_url: pub.publicUrl });
      if (error) throw error;
      toast("Story added");
      await loadStories();
    } catch (err) {
      toast(err.message || "Could not upload story.");
    }
  });
}

/* ---------- Story viewer ---------- */

const viewer = { group: 0, story: 0, startedAt: 0, elapsed: 0, paused: false, waitingForImage: false, raf: null, pressAt: 0 };

function openStoryViewer(groupIndex) {
  const group = storyGroups[groupIndex];
  const firstUnseen = group.stories.findIndex(s => !seenStoryIds.has(s.id));
  viewer.group = groupIndex;
  viewer.story = firstUnseen === -1 || group.user.id === ME.id ? 0 : firstUnseen;

  document.getElementById("storyViewer").classList.add("show");
  AppNav.enterFullscreen(closeStoryViewer);
  showCurrentStory();
}

function closeStoryViewer() {
  cancelAnimationFrame(viewer.raf);
  document.getElementById("storyViewer").classList.remove("show");
  renderStoryRail();
}

function showCurrentStory() {
  cancelAnimationFrame(viewer.raf);
  const group = storyGroups[viewer.group];
  const story = group.stories[viewer.story];
  const isMe = group.user.id === ME.id;

  const progress = document.getElementById("storyProgress");
  progress.innerHTML = group.stories.map((_, i) =>
    `<span><i style="width:${i < viewer.story ? 100 : 0}%"></i></span>`).join("");

  const userEl = document.getElementById("storyUser");
  userEl.href = `profile.html?u=${encodeURIComponent(group.user.username)}`;
  userEl.innerHTML = `<span class="avatar"></span>${escapeHTML(isMe ? "Your story" : group.user.display_name)} <small>${timeAgo(story.created_at)}</small>`;
  setAvatarContent(userEl.querySelector(".avatar"), group.user);

  renderStoryFooter(story, isMe);

  renderStoryShareTag(story);

  const img = document.getElementById("storyImg");
  viewer.elapsed = 0;
  viewer.paused = true;
  viewer.waitingForImage = true;
  img.onload = () => {
    viewer.waitingForImage = false;
    viewer.paused = false;
    viewer.startedAt = performance.now();
    tickStory();
  };
  img.src = story.image_url;

  const next = group.stories[viewer.story + 1] || storyGroups[viewer.group + 1]?.stories[0];
  if (next) new Image().src = next.image_url;

  markStoryViewed(story);
}

function tickStory() {
  if (!viewer.paused) {
    const progress = Math.min((viewer.elapsed + performance.now() - viewer.startedAt) / STORY_MS, 1);
    const bar = document.querySelectorAll("#storyProgress i")[viewer.story];
    if (bar) bar.style.width = `${progress * 100}%`;
    if (progress >= 1) { nextStory(); return; }
  }
  viewer.raf = requestAnimationFrame(tickStory);
}

function pauseStory() {
  if (viewer.paused) return;
  viewer.elapsed += performance.now() - viewer.startedAt;
  viewer.paused = true;
}

function resumeStory() {
  if (!viewer.paused || viewer.waitingForImage) return;
  viewer.startedAt = performance.now();
  viewer.paused = false;
}

function nextStory() {
  const group = storyGroups[viewer.group];
  if (viewer.story < group.stories.length - 1) { viewer.story++; showCurrentStory(); return; }
  if (viewer.group < storyGroups.length - 1 && storyGroups[viewer.group + 1].stories.length) {
    viewer.group++; viewer.story = 0; showCurrentStory(); return;
  }
  AppNav.exitFullscreen();
}

function prevStory() {
  if (viewer.story > 0) { viewer.story--; showCurrentStory(); return; }
  if (viewer.group > 1 || (viewer.group === 1 && storyGroups[0].stories.length)) {
    viewer.group--;
    viewer.story = storyGroups[viewer.group].stories.length - 1;
    showCurrentStory();
    return;
  }
  showCurrentStory();
}

function wireStoryViewer() {
  document.getElementById("storyClose").addEventListener("click", () => AppNav.exitFullscreen());

  // Short tap navigates, press-and-hold pauses (released = resume)
  [["storyTapLeft", prevStory], ["storyTapRight", nextStory]].forEach(([id, action]) => {
    const el = document.getElementById(id);
    el.addEventListener("pointerdown", () => { viewer.pressAt = Date.now(); pauseStory(); });
    el.addEventListener("pointerup", () => {
      if (Date.now() - viewer.pressAt < 250) action();
      else resumeStory();
    });
    el.addEventListener("pointerleave", resumeStory);
  });
}

async function renderStoryShareTag(story) {
  document.querySelector(".story-share-tag")?.remove();
  if (!story.shared_post_id) return;

  const { data: post } = await sb.from("posts").select("user_id").eq("id", story.shared_post_id).maybeSingle();
  if (!post) return;
  const author = await getProfile(post.user_id);
  if (!author) return;

  const tag = document.createElement("a");
  tag.className = "story-share-tag";
  tag.href = `profile.html?u=${encodeURIComponent(author.username)}`;
  tag.textContent = `Post by @${author.username}`;
  document.getElementById("storyViewer").appendChild(tag);
}

async function renderStoryFooter(story, isMe) {
  const footer = document.getElementById("storyFooter");
  footer.innerHTML = "";
  if (!isMe) return;

  const seen = document.createElement("span");
  seen.textContent = "Seen by …";
  footer.appendChild(seen);

  const del = document.createElement("button");
  del.innerHTML = `${svgIcon("trash", 14)} Delete`;
  del.addEventListener("click", async () => {
    pauseStory();
    if (!confirm("Delete this story?")) { resumeStory(); return; }
    const { error } = await sb.from("stories").delete().eq("id", story.id);
    if (error) { toast(error.message || "Could not delete story."); resumeStory(); return; }
    AppNav.exitFullscreen();
    await loadStories();
  });
  footer.appendChild(del);

  const { count } = await sb.from("story_views").select("story_id", { count: "exact", head: true }).eq("story_id", story.id);
  seen.textContent = `Seen by ${count || 0}`;
}

async function markStoryViewed(story) {
  if (story.user_id === ME.id || seenStoryIds.has(story.id)) return;
  seenStoryIds.add(story.id);
  await sb.from("story_views").upsert(
    { story_id: story.id, viewer_id: ME.id },
    { onConflict: "story_id,viewer_id", ignoreDuplicates: true }
  );
}

/* ======================= FEED ======================= */

async function initFeed() {
  const { data } = await sb.from("follows").select("following_id")
    .eq("follower_id", ME.id).eq("status", "accepted");
  feed.authorIds = [ME.id, ...(data || []).map(r => r.following_id)];

  await loadMoreFeed();

  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMoreFeed();
  }, { root: document.getElementById("feed"), rootMargin: "600px" });
  observer.observe(document.getElementById("feedSentinel"));
}

async function loadMoreFeed() {
  if (feed.loading || feed.done) return;
  feed.loading = true;

  let query = sb.from("posts").select("*").eq("deleted", false).eq("archived", false)
    .order("created_at", { ascending: false }).limit(FEED_PAGE);
  if (feed.mode === "following") query = query.in("user_id", feed.authorIds);
  if (feed.cursor) query = query.lt("created_at", feed.cursor);

  const { data: posts, error } = await query;
  feed.loading = false;
  if (error) { console.error(error); return; }

  // Nobody you follow has posted yet — fall back to everything you're allowed to see
  if (!posts.length && feed.mode === "following" && !feed.cursor) {
    feed.mode = "all";
    const label = document.getElementById("feedLabel");
    label.textContent = "Suggested for you";
    label.style.display = "block";
    return loadMoreFeed();
  }

  if (!posts.length) {
    feed.done = true;
    if (!document.getElementById("feedList").children.length) {
      document.getElementById("feedList").innerHTML = `<div class="feed-empty">No posts yet. Share the first one from your profile.</div>`;
    } else {
      document.getElementById("feedEnd").style.display = "block";
    }
    return;
  }

  feed.cursor = posts[posts.length - 1].created_at;
  if (posts.length < FEED_PAGE) feed.done = true;

  const ids = posts.map(p => p.id);
  const [likeRows, myLikeRows, commentRows, saveRows] = await Promise.all([
    sb.from("post_likes").select("post_id").in("post_id", ids),
    sb.from("post_likes").select("post_id").eq("user_id", ME.id).in("post_id", ids),
    sb.from("post_comments").select("post_id").eq("deleted", false).in("post_id", ids),
    sb.from("saves").select("post_id").eq("user_id", ME.id).in("post_id", ids),
    ...[...new Set(posts.map(p => p.user_id))].map(getProfile),
  ]);

  const countBy = rows => (rows.data || []).reduce((acc, r) => ((acc[r.post_id] = (acc[r.post_id] || 0) + 1), acc), {});
  const likes = countBy(likeRows);
  const comments = countBy(commentRows);
  const mine = new Set((myLikeRows.data || []).map(r => r.post_id));
  const saved = new Set((saveRows.data || []).map(r => r.post_id));

  const list = document.getElementById("feedList");
  for (const post of posts) {
    list.appendChild(buildFeedCard(post, likes[post.id] || 0, mine.has(post.id), comments[post.id] || 0, saved.has(post.id)));
  }
  if (feed.done && list.children.length) document.getElementById("feedEnd").style.display = "block";
}

function buildFeedCard(post, likeCount, likedByMe, commentCount, savedByMe) {
  const author = profileCache.get(post.user_id);
  const profileHref = author ? `profile.html?u=${encodeURIComponent(author.username)}` : "#";

  const card = document.createElement("article");
  card.className = "feed-card";
  card.innerHTML = `
    <div class="feed-card-head">
      <a class="avatar" href="${profileHref}"></a>
      <a class="feed-card-who" href="${profileHref}">
        <span class="feed-card-name">${escapeHTML(author?.display_name || "Unknown")}</span>
        <span class="feed-card-meta">@${escapeHTML(author?.username || "")} · ${timeAgo(post.created_at)}</span>
      </a>
    </div>`;
  setAvatarContent(card.querySelector(".avatar"), author);

  const likeBtn = document.createElement("button");
  likeBtn.className = `like-btn ${likedByMe ? "liked" : ""}`;
  likeBtn.innerHTML = `${svgIcon("heart", 20)} <span>${likeCount}</span>`;
  likeBtn.addEventListener("click", () => togglePostLike(post.id, likeBtn));

  if (post.image_url) {
    const media = document.createElement("div");
    media.style.position = "relative";
    const img = document.createElement("img");
    img.className = "feed-card-img";
    img.src = post.image_url;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "";
    media.appendChild(img);

    // Single tap opens the photo, double tap likes it
    let tapTimer = null;
    img.addEventListener("click", () => {
      if (tapTimer) {
        clearTimeout(tapTimer);
        tapTimer = null;
        burstHeart(media);
        if (!likeBtn.classList.contains("liked")) togglePostLike(post.id, likeBtn);
        return;
      }
      tapTimer = setTimeout(() => { tapTimer = null; openMediaViewer(post.image_url); }, 260);
    });
    card.appendChild(media);
  }

  if (post.content) {
    const text = document.createElement("div");
    text.className = "feed-card-text";
    text.textContent = post.content;
    card.appendChild(text);
  }

  const actions = document.createElement("div");
  actions.className = "feed-card-actions";
  actions.appendChild(likeBtn);

  const commentBtn = document.createElement("button");
  commentBtn.innerHTML = `${svgIcon("comment", 19)} <span>${commentCount}</span>`;
  commentBtn.addEventListener("click", () => openCommentsSheet({
    table: "post_comments", column: "post_id", id: post.id, myId: ME.id,
    onAdded: () => {
      const span = commentBtn.querySelector("span");
      span.textContent = String((parseInt(span.textContent, 10) || 0) + 1);
    },
  }));
  actions.appendChild(commentBtn);

  const saveBtn = document.createElement("button");
  saveBtn.className = `save-btn ${savedByMe ? "saved" : ""}`;
  saveBtn.style.marginLeft = "auto";
  saveBtn.innerHTML = svgIcon("bookmark", 19);
  saveBtn.addEventListener("click", () => toggleSave("post", post.id, saveBtn));
  actions.appendChild(saveBtn);

  attachPostExtras(card, post, actions);

  card.appendChild(actions);

  return card;
}

function burstHeart(container) {
  const heart = document.createElement("div");
  heart.className = "double-tap-heart";
  heart.innerHTML = svgIcon("heart", 90);
  container.appendChild(heart);
  setTimeout(() => heart.remove(), 800);
}

async function togglePostLike(postId, btn) {
  const wasLiked = btn.classList.contains("liked");
  const countEl = btn.querySelector("span");
  const count = parseInt(countEl.textContent, 10) || 0;

  // Optimistic update, rolled back if the request fails
  btn.classList.toggle("liked", !wasLiked);
  countEl.textContent = String(wasLiked ? count - 1 : count + 1);

  const { error } = wasLiked
    ? await sb.from("post_likes").delete().eq("post_id", postId).eq("user_id", ME.id)
    : await sb.from("post_likes").insert({ post_id: postId, user_id: ME.id });

  if (error) {
    btn.classList.toggle("liked", wasLiked);
    countEl.textContent = String(count);
    toast(error.message || "Could not update like.");
  }
}

setTimeout(() => document.getElementById("loadingOverlay")?.classList.add("hide"), 8000);

init();
