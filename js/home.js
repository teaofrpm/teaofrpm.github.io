let ME = null;

const FEED_PAGE = 12;
const STORY_MS = 5000;

const feed = { mode: "following", cursor: null, done: false, loading: false, observer: null, dividerDone: false };
let storyGroups = [];            // [{ user, stories: [...] }]
let seenStoryIds = new Set();

async function init() {
  wireStoryUpload();
  wireStoryViewer();
  Skeleton.show("feed", "feedList", 3);

  ME = await App.boot();
  renderComposeBar();
  renderStoryRail();             // "Your story" bubble straight away
  wirePullToRefresh();
  await Promise.all([loadStories(), initFeed(), Notifs.init(ME)]);
}

/* ======================= COMPOSE BAR ======================= */

function renderComposeBar() {
  const bar = document.createElement("button");
  bar.type = "button";
  bar.className = "home-compose";
  bar.innerHTML = `<span class="avatar"></span><span class="home-compose-text">Share something with RPM…</span><span class="home-compose-ic">${svgIcon("image", 18)}</span>`;
  setAvatarContent(bar.querySelector(".avatar"), ME);
  bar.addEventListener("click", () => Social.openComposer({
    onPosted: async (post) => {
      document.querySelector("#feedList .feed-empty")?.remove();
      const card = buildFeedCard(post, 0, false, 0, false);
      document.getElementById("feedList").prepend(card);
      document.getElementById("feed").scrollTo({ top: 0, behavior: "smooth" });
    },
  }));
  const list = document.getElementById("feedList");
  list.parentNode.insertBefore(bar, document.getElementById("feedLabel"));
}

/* ======================= PULL TO REFRESH ======================= */

function wirePullToRefresh() {
  const scroller = document.getElementById("feed");
  const ind = document.createElement("div");
  ind.className = "ptr-indicator";
  ind.innerHTML = svgIcon("refresh", 18);
  scroller.prepend(ind);

  let startY = 0, pulling = false, dist = 0, busy = false;
  scroller.addEventListener("touchstart", (e) => {
    if (scroller.scrollTop > 0 || busy) return;
    startY = e.touches[0].clientY; pulling = true; dist = 0;
  }, { passive: true });
  scroller.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    dist = Math.max(0, e.touches[0].clientY - startY);
    if (scroller.scrollTop > 0) { pulling = false; dist = 0; }
    ind.style.transform = `translateY(${Math.min(dist, 90) - 40}px) rotate(${dist * 3}deg)`;
    ind.style.opacity = String(Math.min(1, dist / 50));
    ind.classList.toggle("armed", dist > 70);
  }, { passive: true });
  scroller.addEventListener("touchend", async () => {
    if (!pulling) return;
    pulling = false;
    if (dist > 70) {
      busy = true;
      ind.classList.add("spin");
      buzz(10);
      await refreshAll();
      ind.classList.remove("spin");
      busy = false;
    }
    ind.style.transform = "";
    ind.style.opacity = "";
    ind.classList.remove("armed");
  });
}

async function refreshAll() {
  if (feed.loading) return;
  Object.assign(feed, { mode: "following", cursor: null, done: false, dividerDone: false });
  document.getElementById("feedEnd").style.display = "none";
  document.getElementById("feedLabel").style.display = "none";
  document.getElementById("feedList").replaceChildren();
  await Promise.all([loadStories(), loadMoreFeed()]);
}

/* ======================= STORIES ======================= */

async function loadStories() {
  // stories + authors + "have I seen it" in one request (privacy rules applied by the database)
  const { data: rows, error } = await sb.rpc("story_feed");
  if (error) { console.error(error); return; }

  const byUser = new Map();
  seenStoryIds = new Set();
  for (const r of rows || []) {
    const s = r.story;
    rememberProfile(r.author);
    if (r.seen) seenStoryIds.add(s.id);
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id).push(s);
  }

  const others = [...byUser.entries()]
    .filter(([uid]) => uid !== ME.id)
    .map(([uid, list]) => ({ user: profileCache.get(uid), stories: list }))
    .filter((g) => g.user);

  const allSeen = (g) => g.stories.every((s) => seenStoryIds.has(s.id));
  const latest = (g) => new Date(g.stories[g.stories.length - 1].created_at).getTime();
  others.sort((a, b) => (allSeen(a) - allSeen(b)) || (latest(b) - latest(a)));

  storyGroups = [{ user: ME, stories: byUser.get(ME.id) || [] }, ...others];
  renderStoryRail();
}

function renderStoryRail() {
  const rail = document.getElementById("storyRail");
  if (!storyGroups.length) storyGroups = [{ user: ME, stories: [] }];
  const frag = document.createDocumentFragment();

  storyGroups.forEach((group, index) => {
    const isMe = group.user.id === ME.id;
    const hasStories = group.stories.length > 0;
    const unseen = hasStories && !isMe && group.stories.some((s) => !seenStoryIds.has(s.id));
    const closeOnly = hasStories && group.stories.some((st) => st.audience === "close_friends");

    const item = document.createElement("button");
    item.type = "button";
    item.className = `story-item ${unseen || (isMe && hasStories) ? "unseen" : ""} ${closeOnly ? "close-friends" : ""}`;
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
      badge.addEventListener("click", (e) => { e.stopPropagation(); document.getElementById("storyInput").click(); });
      item.appendChild(badge);
    }
    frag.appendChild(item);
  });
  rail.replaceChildren(frag);
}

function wireStoryUpload() {
  const input = document.getElementById("storyInput");
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    let blob;
    try {
      blob = await editAndCompress(file, { title: "Your story", doneLabel: "Next", aspects: ["9:16", "original", "4:5", "1:1"] }, 1920);
    } catch (err) { toast(err.message || "Could not process this photo."); return; }
    if (!blob) return;
    const audience = await askStoryAudience();
    if (!audience) return;

    toast("Uploading story…", 10000);
    try {
      const url = await uploadPublic("stories", `${ME.id}/${Date.now()}.jpg`, blob);
      const { error } = await sb.from("stories").insert({ user_id: ME.id, image_url: url, audience });
      if (error) throw error;
      toast(audience === "close_friends" ? "Shared with close friends" : "Story added");
      await loadStories();
    } catch (err) {
      toast(friendlyError(err, "Could not upload story."));
    }
  });
}

function askStoryAudience() {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (v) => { if (!answered) { answered = true; resolve(v); } };
    actionSheet("Share story with", [
      { icon: "globe", label: "Everyone", onClick: () => finish("everyone") },
      { icon: "star", label: "Close friends only", onClick: () => finish("close_friends") },
    ]).onClose = function () { setTimeout(() => finish(null), 120); setTimeout(() => this.el?.remove(), 300); };
  });
}

/* ---------- Story viewer ---------- */

const viewer = { group: 0, story: 0, startedAt: 0, elapsed: 0, paused: false, waitingForImage: false, raf: null, pressAt: 0, open: false, token: 0, bar: null };

function openStoryViewer(groupIndex) {
  const group = storyGroups[groupIndex];
  const firstUnseen = group.stories.findIndex((s) => !seenStoryIds.has(s.id));
  viewer.group = groupIndex;
  viewer.story = firstUnseen === -1 || group.user.id === ME.id ? 0 : firstUnseen;
  viewer.open = true;
  document.getElementById("storyViewer").classList.add("show");
  AppNav.enterFullscreen(closeStoryViewer);
  showCurrentStory();
}

function closeStoryViewer() {
  viewer.open = false;
  cancelAnimationFrame(viewer.raf);
  document.getElementById("storyViewer").classList.remove("show");
  document.getElementById("storyInsights").classList.remove("show");
  document.querySelector(".story-share-tag")?.remove();
  renderStoryRail();
}

function showCurrentStory() {
  cancelAnimationFrame(viewer.raf);
  const token = ++viewer.token;
  const group = storyGroups[viewer.group];
  const story = group.stories[viewer.story];
  const isMe = group.user.id === ME.id;

  const progress = document.getElementById("storyProgress");
  progress.innerHTML = group.stories.map((_, i) => `<span><i style="width:${i < viewer.story ? 100 : 0}%"></i></span>`).join("");
  viewer.bar = progress.querySelectorAll("i")[viewer.story];

  const userEl = document.getElementById("storyUser");
  userEl.href = `profile.html?u=${encodeURIComponent(group.user.username)}`;
  userEl.innerHTML = `<span class="avatar"></span>${escapeHTML(isMe ? "Your story" : group.user.display_name)} <small>${timeAgo(story.created_at)}</small>`;
  setAvatarContent(userEl.querySelector(".avatar"), group.user);

  renderStoryFooter(story, isMe, token);
  renderStoryShareTag(story, token);

  const img = document.getElementById("storyImg");
  viewer.elapsed = 0;
  viewer.paused = true;
  viewer.waitingForImage = true;
  const start = () => {
    if (token !== viewer.token) return;
    viewer.waitingForImage = false;
    viewer.paused = false;
    viewer.startedAt = performance.now();
    tickStory();
  };
  img.onload = start;
  img.onerror = start;               // a broken image must not freeze the viewer
  if (story.image_url) img.src = story.image_url;
  else { img.removeAttribute("src"); start(); }

  const next = group.stories[viewer.story + 1] || storyGroups[viewer.group + 1]?.stories[0];
  if (next?.image_url) new Image().src = next.image_url;

  markStoryViewed(story);
}

function tickStory() {
  if (!viewer.paused) {
    const p = Math.min((viewer.elapsed + performance.now() - viewer.startedAt) / STORY_MS, 1);
    if (viewer.bar) viewer.bar.style.width = `${p * 100}%`;
    if (p >= 1) { nextStory(); return; }
  }
  viewer.raf = requestAnimationFrame(tickStory);
}

function pauseStory() {
  if (viewer.paused) return;
  viewer.elapsed += performance.now() - viewer.startedAt;
  viewer.paused = true;
}

function resumeStory() {
  if (!viewer.open || !viewer.paused || viewer.waitingForImage) return;
  if (document.getElementById("storyInsights").classList.contains("show")) return;
  if (document.activeElement?.id === "storyReplyInput") return;
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
  const prev = storyGroups[viewer.group - 1];
  if (prev && prev.stories.length) {
    viewer.group--;
    viewer.story = prev.stories.length - 1;
  }
  showCurrentStory();
}

function wireStoryViewer() {
  wireStoryInsights();
  document.getElementById("storyClose").addEventListener("click", () => AppNav.exitFullscreen());

  // Short tap navigates, press-and-hold pauses
  [["storyTapLeft", prevStory], ["storyTapRight", nextStory]].forEach(([id, action]) => {
    const el = document.getElementById(id);
    el.addEventListener("pointerdown", () => { viewer.pressAt = Date.now(); pauseStory(); });
    el.addEventListener("pointerup", () => {
      if (Date.now() - viewer.pressAt < 250) action();
      else resumeStory();
    });
    el.addEventListener("pointercancel", resumeStory);
  });

  document.addEventListener("keydown", (e) => {
    if (!viewer.open || document.activeElement?.tagName === "INPUT") return;
    if (e.key === "ArrowRight") nextStory();
    if (e.key === "ArrowLeft") prevStory();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pauseStory(); else resumeStory(); });
}

async function renderStoryShareTag(story, token) {
  document.querySelector(".story-share-tag")?.remove();
  if (!story.shared_post_id) return;
  const { data: post } = await sb.from("posts").select("user_id").eq("id", story.shared_post_id).maybeSingle();
  if (!post || token !== viewer.token) return;
  const author = await getProfile(post.user_id);
  if (!author || token !== viewer.token) return;

  const tag = document.createElement("a");
  tag.className = "story-share-tag";
  tag.href = `profile.html?u=${encodeURIComponent(author.username)}&post=${story.shared_post_id}`;
  tag.textContent = `Post by @${author.username}`;
  document.getElementById("storyViewer").appendChild(tag);
}

async function renderStoryFooter(story, isMe, token) {
  const footer = document.getElementById("storyFooter");
  footer.innerHTML = "";

  if (isMe) {
    const stats = document.createElement("button");
    stats.className = "story-stats-btn";
    stats.innerHTML = `${svgIcon("eye", 14)} <span id="storySeenCount">…</span>`;
    stats.addEventListener("click", () => openStoryInsights(story));
    footer.appendChild(stats);

    if (story.image_url) {
      const hl = document.createElement("button");
      hl.innerHTML = `${svgIcon("star", 14)} Highlight`;
      hl.title = "Add to a highlight on your profile";
      hl.addEventListener("click", () => { pauseStory(); Social.Highlights.addImageTo(story.image_url); });
      footer.appendChild(hl);
    }

    const del = document.createElement("button");
    del.innerHTML = `${svgIcon("trash", 14)} Delete`;
    del.addEventListener("click", async () => {
      pauseStory();
      if (!confirm("Delete this story?")) { resumeStory(); return; }
      const { error } = await sb.from("stories").delete().eq("id", story.id);
      if (error) { toast(friendlyError(error, "Could not delete story.")); resumeStory(); return; }
      AppNav.exitFullscreen();
      await loadStories();
    });
    footer.appendChild(del);

    const { data: s } = await sb.rpc("story_insights", { p_story: story.id });   // 3 counts, 1 request
    if (token !== viewer.token) return;
    const parts = [`${s?.views || 0} seen`];
    if (s?.likes) parts.push(`${s.likes} liked`);
    if (s?.comments) parts.push(`${s.comments} replied`);
    const el = document.getElementById("storySeenCount");
    if (el) el.textContent = parts.join(" · ");
    return;
  }

  const likeBtn = document.createElement("button");
  likeBtn.className = "story-like-btn";
  likeBtn.innerHTML = svgIcon("heart", 18);
  likeBtn.addEventListener("click", async () => {
    const liked = likeBtn.classList.contains("liked");
    likeBtn.classList.toggle("liked", !liked);
    const { error } = liked
      ? await sb.from("story_likes").delete().eq("story_id", story.id).eq("user_id", ME.id)
      : await sb.from("story_likes").insert({ story_id: story.id, user_id: ME.id });
    if (error) { likeBtn.classList.toggle("liked", liked); toast("Could not update."); }
  });

  const replyWrap = document.createElement("div");
  replyWrap.className = "story-reply-wrap";
  replyWrap.innerHTML = `<div class="story-quick">${["😂", "😍", "🔥", "👏", "😮", "😢"].map((e) => `<button type="button" data-e="${e}">${e}</button>`).join("")}</div>
    <input type="text" id="storyReplyInput" maxlength="300" placeholder="Send message…" enterkeyhint="send" />
    <button type="button" class="story-reply-send" aria-label="Send">${svgIcon("send", 17)}</button>`;
  const input = replyWrap.querySelector("input");
  // Reply lands in your DM with them, with the story attached (like Instagram)
  const send = async (text) => {
    text = String(text || "").trim();
    if (!text) return;
    input.value = "";
    replyWrap.classList.remove("typing");
    input.blur();
    toast("Sending…", 1200);
    try {
      const { data: cid, error } = await sb.rpc("get_or_create_dm", { other_user: story.user_id });
      if (error) throw error;
      const { error: e2 } = await sb.from("messages").insert({ user_id: ME.id, conversation_id: cid, content: text, story_id: story.id, story_url: story.image_url || null });
      if (e2) throw e2;
      sb.from("story_comments").insert({ story_id: story.id, user_id: ME.id, content: text }).then(() => {});
      buzz(10);
      const who = profileCache.get(story.user_id);
      toast(`Sent to @${who?.username || "them"} in Messages`);
    } catch (err) { toast(friendlyError(err, "Reply failed.")); }
  };
  input.addEventListener("focus", () => { pauseStory(); replyWrap.classList.add("typing"); });
  input.addEventListener("blur", () => setTimeout(() => { if (!input.value.trim()) replyWrap.classList.remove("typing"); resumeStory(); }, 120));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(input.value); });
  replyWrap.querySelector(".story-reply-send").addEventListener("pointerdown", (e) => { e.preventDefault(); send(input.value); });
  replyWrap.querySelector(".story-quick").addEventListener("pointerdown", (e) => {
    const b = e.target.closest("[data-e]"); if (!b) return;
    e.preventDefault();
    b.animate([{ transform: "scale(1)" }, { transform: "scale(1.5)" }, { transform: "scale(1)" }], { duration: 380, easing: "cubic-bezier(.16,1,.3,1)" });
    send(b.dataset.e);
  });

  footer.append(replyWrap, likeBtn);

  const { data: myLike } = await sb.from("story_likes").select("story_id").eq("story_id", story.id).eq("user_id", ME.id).maybeSingle();
  if (token === viewer.token && myLike) likeBtn.classList.add("liked");
}

/* ---------- Story insights: who watched, liked and replied ---------- */

let insightsStory = null;

function openStoryInsights(story) {
  insightsStory = story;
  pauseStory();
  document.getElementById("storyInsights").classList.add("show");
  document.querySelectorAll(".insights-tab").forEach((t, i) => t.classList.toggle("active", i === 0));
  loadInsightsTab("views");
}

function closeStoryInsights() {
  document.getElementById("storyInsights").classList.remove("show");
  resumeStory();
}

function wireStoryInsights() {
  document.getElementById("insightsClose").addEventListener("click", closeStoryInsights);
  document.querySelectorAll(".insights-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".insights-tab").forEach((t) => t.classList.toggle("active", t === tab));
      loadInsightsTab(tab.dataset.tab);
    });
  });
}

async function loadInsightsTab(tab) {
  const list = document.getElementById("insightsList");
  list.innerHTML = `<div class="settings-empty">Loading…</div>`;
  if (!insightsStory) return;
  const table = { views: "story_views", likes: "story_likes", comments: "story_comments" }[tab];
  const userCol = tab === "views" ? "viewer_id" : "user_id";
  const { data, error } = await sb.from(table).select("*").eq("story_id", insightsStory.id)
    .order(tab === "views" ? "viewed_at" : "created_at", { ascending: false });
  if (error) { list.innerHTML = `<div class="settings-empty">Could not load.</div>`; return; }
  const empty = { views: "No one has seen this yet.", likes: "No likes yet.", comments: "No replies yet." }[tab];
  if (!data.length) { list.innerHTML = `<div class="settings-empty">${empty}</div>`; return; }

  await getProfiles(data.map((r) => r[userCol]));
  const frag = document.createDocumentFragment();
  for (const r of data) {
    const p = profileCache.get(r[userCol]);
    if (!p) continue;
    const row = document.createElement("a");
    row.className = "follow-list-row";
    row.href = `profile.html?u=${encodeURIComponent(p.username)}`;
    row.innerHTML = `<span class="avatar" style="width:38px;height:38px;font-size:13px;"></span><div><div class="follow-list-name">${escapeHTML(p.display_name)}</div>${tab === "comments"
      ? `<div class="follow-list-username insight-comment">${escapeHTML(r.content)}</div>`
      : `<div class="follow-list-username">@${escapeHTML(p.username)}</div>`}</div>`;
    setAvatarContent(row.querySelector(".avatar"), p);
    frag.appendChild(row);
  }
  list.replaceChildren(frag);
}

async function markStoryViewed(story) {
  if (story.user_id === ME.id || seenStoryIds.has(story.id)) return;
  seenStoryIds.add(story.id);
  await sb.from("story_views").upsert({ story_id: story.id, viewer_id: ME.id }, { onConflict: "story_id,viewer_id", ignoreDuplicates: true });
}

/* ======================= FEED ======================= */

async function initFeed() {
  await loadMoreFeed();
  feed.observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMoreFeed();
  }, { root: document.getElementById("feed"), rootMargin: "600px" });
  feed.observer.observe(document.getElementById("feedSentinel"));
}

// Posts from you + people you follow first; once those run out, public
// posts from everyone else under "Suggested for you". The database builds
// each page — counts, likes, saves, tags and authors in ONE request — and
// never repeats a post between the two parts.
async function loadMoreFeed() {
  if (feed.loading || feed.done) return;
  feed.loading = true;
  const list = document.getElementById("feedList");
  try {
    for (let guard = 0; guard < 3 && !feed.done; guard++) {
      const { data, error } = await sb.rpc("feed_page", { p_mode: feed.mode, p_before: feed.cursor, p_limit: FEED_PAGE });
      if (error) {
        console.error(error);
        Skeleton.clear(list);
        if (!list.querySelector(".feed-card")) list.innerHTML = `<div class="feed-empty">Couldn't load the feed. Pull down to try again.</div>`;
        return;
      }
      const cards = Social.fromCards(data);

      if (feed.mode === "following") {
        if (cards.length) { feed.cursor = cards[cards.length - 1].post.created_at; renderCards(cards, list); }
        if (cards.length === FEED_PAGE) return;            // more following posts to come
        feed.mode = "discover";
        feed.cursor = null;
        feed.dividerDone = false;
        if (cards.length) return;                          // next scroll continues with suggestions
        continue;
      }

      if (!cards.length) { feed.done = true; break; }
      feed.cursor = cards[cards.length - 1].post.created_at;
      if (cards.length < FEED_PAGE) feed.done = true;

      if (!feed.dividerDone) {
        feed.dividerDone = true;
        const hasCards = list.querySelector(".feed-card");
        const label = document.getElementById("feedLabel");
        if (hasCards) {
          const div = document.createElement("div");
          div.className = "feed-label";
          div.textContent = "Suggested for you";
          list.appendChild(div);
        } else {
          label.textContent = "Suggested for you";
          label.style.display = "block";
        }
      }
      renderCards(cards, list);
      return;
    }
  } finally {
    feed.loading = false;
    if (!feed.done) {
      // the observer only fires on a change; if the end of the list is
      // still on screen after this page, keep filling
      requestAnimationFrame(() => {
        const s = document.getElementById("feedSentinel").getBoundingClientRect();
        if (s.top < window.innerHeight + 600) loadMoreFeed();
      });
    }
    if (feed.done) {
      Skeleton.clear(list);
      if (!list.querySelector(".feed-card")) {
        document.getElementById("feedLabel").style.display = "none";
        list.innerHTML = `<div class="feed-empty">No posts yet. Tap "Share something" above to post the first one.</div>`;
      } else {
        document.getElementById("feedEnd").style.display = "block";
      }
    }
  }
}

function renderCards(cards, list) {
  Skeleton.clear(list);
  if (!cards.length) return;
  const frag = document.createDocumentFragment();
  for (const c of cards) {
    if (list.querySelector(`[data-post-id="${c.post.id}"]`)) continue;   // e.g. just posted it yourself
    frag.appendChild(buildFeedCard(c.post, c.likes, c.liked, c.comments, c.saved));
  }
  list.appendChild(frag);
}

function buildFeedCard(post, likeCount, likedByMe, commentCount, savedByMe) {
  const author = profileCache.get(post.user_id);
  const profileHref = author ? `profile.html?u=${encodeURIComponent(author.username)}` : "#";

  const card = document.createElement("article");
  card.className = "feed-card";
  card.dataset.postId = post.id;
  card.innerHTML = `
    <div class="feed-card-head">
      <a class="avatar" href="${profileHref}"></a>
      <a class="feed-card-who" href="${profileHref}">
        <span class="feed-card-name">${escapeHTML(author?.display_name || "Unknown")}${post.pinned_at && post.user_id === ME.id ? ` <span class="pinned-chip">${svgIcon("pin", 11)} Pinned</span>` : ""}</span>
        <span class="feed-card-meta">@${escapeHTML(author?.username || "")} · <span data-ts="${post.created_at}">${timeAgo(post.created_at)}</span></span>
      </a>
    </div>`;
  setAvatarContent(card.querySelector(".avatar"), author);

  const likeBtn = document.createElement("button");
  likeBtn.className = `like-btn ${likedByMe ? "liked" : ""}${likeCount == null ? " hide-count" : ""}`;
  likeBtn.setAttribute("aria-label", "Like");
  likeBtn.innerHTML = `${svgIcon("heart", 20)} <span>${likeCount ?? ""}</span>`;
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
        clearTimeout(tapTimer); tapTimer = null;
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
    text.innerHTML = linkifyMentions(escapeHTML(post.content));
    card.appendChild(text);
  }

  const actions = document.createElement("div");
  actions.className = "feed-card-actions";
  actions.appendChild(likeBtn);

  const commentBtn = document.createElement("button");
  commentBtn.setAttribute("aria-label", "Comments");
  commentBtn.innerHTML = `${svgIcon("comment", 19)} <span>${commentCount}</span>`;
  const bump = (d) => { const s = commentBtn.querySelector("span"); s.textContent = String(Math.max(0, (parseInt(s.textContent, 10) || 0) + d)); };
  commentBtn.addEventListener("click", () => openCommentsSheet({
    table: "post_comments", column: "post_id", id: post.id, myId: ME.id,
    onAdded: () => bump(1), onRemoved: () => bump(-1),
  }));
  actions.appendChild(commentBtn);

  const saveBtn = document.createElement("button");
  saveBtn.className = `save-btn ${savedByMe ? "saved" : ""}`;
  saveBtn.setAttribute("aria-label", "Save");
  saveBtn.style.marginLeft = "auto";
  saveBtn.innerHTML = svgIcon("bookmark", 19);
  saveBtn.addEventListener("click", () => toggleSave("post", post.id, saveBtn));
  actions.appendChild(saveBtn);

  card.appendChild(actions);
  Social.attachPostExtras(card, post, actions);
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
  if (btn.dataset.busy) return;
  btn.dataset.busy = "1";
  const wasLiked = btn.classList.contains("liked");
  const countEl = btn.querySelector("span");
  const count = parseInt(countEl.textContent, 10) || 0;
  btn.classList.toggle("liked", !wasLiked);
  countEl.textContent = String(wasLiked ? count - 1 : count + 1);

  const { error } = wasLiked
    ? await sb.from("post_likes").delete().eq("post_id", postId).eq("user_id", ME.id)
    : await sb.from("post_likes").insert({ post_id: postId, user_id: ME.id });
  delete btn.dataset.busy;
  if (error) {
    btn.classList.toggle("liked", wasLiked);
    countEl.textContent = String(count);
    toast(friendlyError(error, "Could not update like."));
  }
}

init();
