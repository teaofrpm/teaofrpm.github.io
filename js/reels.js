let ME = null;

const REELS_PAGE = 6;
const MAX_REEL_BYTES = 50 * 1024 * 1024;   // Supabase free-plan upload ceiling
const MAX_REEL_SECONDS = 180;

const reelsState = { cursor: null, done: false, loading: false, muted: true, immersive: false, externalAdded: false, first: null };
let pendingReelFile = null;
let pendingReelPreviewUrl = null;
let playObserver = null;
let current = null;              // the reel element on screen

async function init() {
  const feedEl = document.getElementById("reelsFeed");
  const holder = document.createElement("div");
  feedEl.insertBefore(holder, document.getElementById("reelsSentinel"));
  Skeleton.show("reel", holder, 1);
  wireUpload();

  ME = await App.boot();

  // Whichever reel is mostly on screen plays; everything else pauses.
  playObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const reel = entry.target;
      if (entry.isIntersecting) { current = reel; playReel(reel); }
      else pauseReel(reel);
    }
  }, { root: feedEl, threshold: 0.65 });

  const moreObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMoreReels();
  }, { root: feedEl, rootMargin: "200% 0px" });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) document.querySelectorAll(".reel").forEach(pauseReel);
    else if (current) playReel(current);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const target = e.key === "ArrowDown" ? current?.nextElementSibling : current?.previousElementSibling;
      if (target?.classList.contains("reel")) target.scrollIntoView({ behavior: "smooth" });
    }
    if (e.key === "m") toggleMute();
  });

  const deep = new URLSearchParams(location.search).get("r");
  if (deep) await showDeepLinked(deep);
  await loadMoreReels();
  moreObserver.observe(document.getElementById("reelsSentinel"));
}

function playReel(reel) {
  if (reel.dataset.paused === "1") return;
  const video = reel.querySelector("video");
  if (video) {
    video.muted = reelsState.muted;
    video.play().catch(() => {});
    reel.classList.remove("paused");
    const next = reel.nextElementSibling?.querySelector("video");
    if (next) next.preload = "auto";
    return;
  }
  if (reel.dataset.type === "yt") ytPlay(reel, true);
}

function pauseReel(reel) {
  const video = reel.querySelector("video");
  if (video) video.pause();
  else if (reel.dataset.type === "yt") ytPlay(reel, false);
}

async function showDeepLinked(id) {
  const { data: reel } = await sb.from("reels").select("*").eq("id", id).eq("deleted", false).maybeSingle();
  if (!reel) { toast("That reel isn't available anymore."); return; }
  reelsState.first = reel.id;
  await renderReels([reel]);
}

async function loadMoreReels() {
  if (reelsState.loading || reelsState.done) return;
  reelsState.loading = true;
  try {
    let query = sb.from("reels").select("*").eq("deleted", false).order("created_at", { ascending: false }).limit(REELS_PAGE);
    if (reelsState.cursor) query = query.lt("created_at", reelsState.cursor);
    const { data: reels, error } = await query;
    if (error) { console.error(error); return; }

    const feedEl = document.getElementById("reelsFeed");
    Skeleton.clear(feedEl);
    if (reels.length) reelsState.cursor = reels[reels.length - 1].created_at;
    if (reels.length < REELS_PAGE) reelsState.done = true;
    await renderReels(reels.filter((r) => r.id !== reelsState.first));

    if (reelsState.done) {
      await addExternalReels();
      if (!feedEl.querySelector(".reel")) {
        const empty = document.createElement("div");
        empty.className = "reels-empty";
        empty.innerHTML = `${svgIcon("reel", 44)}<div>No reels yet.<br>Tap + to share the first one.</div>`;
        feedEl.insertBefore(empty, document.getElementById("reelsSentinel"));
      }
    }
  } finally {
    reelsState.loading = false;
  }
}

async function renderReels(reels) {
  if (!reels.length) return;
  const ids = reels.map((r) => r.id);
  const [likeRows, myLikeRows, commentRows, saveRows] = await Promise.all([
    sb.from("reel_likes").select("reel_id").in("reel_id", ids),
    sb.from("reel_likes").select("reel_id").eq("user_id", ME.id).in("reel_id", ids),
    sb.from("reel_comments").select("reel_id").eq("deleted", false).in("reel_id", ids),
    sb.from("saves").select("reel_id").eq("user_id", ME.id).in("reel_id", ids),
    getProfiles(reels.map((r) => r.user_id)),
  ]);
  const countBy = (rows) => (rows.data || []).reduce((acc, r) => ((acc[r.reel_id] = (acc[r.reel_id] || 0) + 1), acc), {});
  const likes = countBy(likeRows), comments = countBy(commentRows);
  const mine = new Set((myLikeRows.data || []).map((r) => r.reel_id));
  const saved = new Set((saveRows.data || []).map((r) => r.reel_id));

  const feedEl = document.getElementById("reelsFeed");
  Skeleton.clear(feedEl);
  feedEl.querySelector(".reels-empty")?.remove();
  const sentinel = document.getElementById("reelsSentinel");
  for (const reel of reels) {
    const el = buildReel(reel, likes[reel.id] || 0, mine.has(reel.id), comments[reel.id] || 0, saved.has(reel.id));
    feedEl.insertBefore(el, sentinel);
    playObserver.observe(el);
  }
}

function buildReel(reel, likeCount, likedByMe, commentCount, savedByMe) {
  const author = profileCache.get(reel.user_id);
  const profileHref = author ? `profile.html?u=${encodeURIComponent(author.username)}` : "#";

  const el = document.createElement("section");
  el.className = "reel";
  el.dataset.id = reel.id;

  const video = document.createElement("video");
  video.src = reel.video_url;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.loop = true;
  video.muted = reelsState.muted;
  video.preload = "metadata";
  el.appendChild(video);

  const bar = document.createElement("div");
  bar.className = "reel-progress";
  bar.innerHTML = "<i></i>";
  el.appendChild(bar);
  video.addEventListener("timeupdate", () => {
    if (video.duration) bar.firstChild.style.width = `${(video.currentTime / video.duration) * 100}%`;
  });

  const state = document.createElement("div");
  state.className = "reel-state";
  state.innerHTML = svgIcon("pause", 30);
  el.appendChild(state);

  const info = document.createElement("div");
  info.className = "reel-info";
  info.innerHTML = `
    <a class="reel-author" href="${profileHref}"><span class="avatar"></span>${escapeHTML(author?.display_name || "Unknown")}</a>
    ${reel.caption ? `<div class="reel-caption">${linkifyMentions(escapeHTML(reel.caption))}</div>` : ""}`;
  setAvatarContent(info.querySelector(".avatar"), author);
  el.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "reel-actions";

  const likeBtn = document.createElement("button");
  likeBtn.className = `like-btn ${likedByMe ? "liked" : ""}`;
  likeBtn.setAttribute("aria-label", "Like");
  likeBtn.innerHTML = `${svgIcon("heart", 30)}<span>${likeCount}</span>`;
  likeBtn.addEventListener("click", () => toggleReelLike(reel.id, likeBtn));
  actions.appendChild(likeBtn);

  const commentBtn = document.createElement("button");
  commentBtn.setAttribute("aria-label", "Comments");
  commentBtn.innerHTML = `${svgIcon("comment", 28)}<span>${commentCount}</span>`;
  const bump = (d) => { const s = commentBtn.querySelector("span"); s.textContent = String(Math.max(0, (parseInt(s.textContent, 10) || 0) + d)); };
  commentBtn.addEventListener("click", () => {
    video.pause();
    el.classList.add("paused");
    openCommentsSheet({ table: "reel_comments", column: "reel_id", id: reel.id, myId: ME.id, onAdded: () => bump(1), onRemoved: () => bump(-1) });
  });
  actions.appendChild(commentBtn);

  const shareBtn = document.createElement("button");
  shareBtn.setAttribute("aria-label", "Share");
  shareBtn.innerHTML = svgIcon("share", 25);
  shareBtn.addEventListener("click", () => shareLink(`reels.html?r=${reel.id}`, "A reel on teaofrpm"));
  actions.appendChild(shareBtn);

  const muteBtn = document.createElement("button");
  muteBtn.className = "reel-mute-btn";
  muteBtn.setAttribute("aria-label", "Sound");
  muteBtn.innerHTML = svgIcon(reelsState.muted ? "mute" : "unmute", 26);
  muteBtn.addEventListener("click", toggleMute);
  actions.appendChild(muteBtn);

  const saveBtn = document.createElement("button");
  saveBtn.className = `save-btn ${savedByMe ? "saved" : ""}`;
  saveBtn.setAttribute("aria-label", "Save");
  saveBtn.innerHTML = svgIcon("bookmark", 26);
  saveBtn.addEventListener("click", () => toggleSave("reel", reel.id, saveBtn));
  actions.appendChild(saveBtn);

  if (reel.user_id === ME.id) {
    const delBtn = document.createElement("button");
    delBtn.setAttribute("aria-label", "Delete reel");
    delBtn.innerHTML = svgIcon("trash", 24);
    delBtn.addEventListener("click", () => deleteReel(reel.id, el));
    actions.appendChild(delBtn);
  } else {
    const rep = document.createElement("button");
    rep.setAttribute("aria-label", "Report reel");
    rep.innerHTML = svgIcon("flag", 22);
    rep.addEventListener("click", () => reportSheet("reel", reel.id));
    actions.appendChild(rep);
  }
  el.appendChild(actions);

  // First tap goes immersive; after that taps pause/resume. Double tap likes.
  let tapTimer = null;
  video.addEventListener("click", () => {
    if (tapTimer) {
      clearTimeout(tapTimer); tapTimer = null;
      burstReelHeart(el);
      if (!likeBtn.classList.contains("liked")) toggleReelLike(reel.id, likeBtn);
      return;
    }
    tapTimer = setTimeout(() => {
      tapTimer = null;
      if (!reelsState.immersive) { enterImmersive(); return; }
      if (video.paused) { video.play().catch(() => {}); el.classList.remove("paused"); }
      else { video.pause(); el.classList.add("paused"); }
    }, 260);
  });
  return el;
}

function enterImmersive() {
  reelsState.immersive = true;
  document.body.classList.add("reels-immersive");
  AppNav.enterFullscreen(() => {
    reelsState.immersive = false;
    document.body.classList.remove("reels-immersive");
  });
}

function toggleMute() {
  reelsState.muted = !reelsState.muted;
  document.querySelectorAll(".reel video").forEach((v) => { v.muted = reelsState.muted; });
  document.querySelectorAll(".reel-mute-btn").forEach((b) => { b.innerHTML = svgIcon(reelsState.muted ? "mute" : "unmute", 26); });
  document.querySelectorAll(".yt-reel iframe").forEach((f) => ytCommand(f, reelsState.muted ? "mute" : "unMute"));
}

function burstReelHeart(container) {
  const heart = document.createElement("div");
  heart.className = "double-tap-heart";
  heart.innerHTML = svgIcon("heart", 110);
  container.appendChild(heart);
  setTimeout(() => heart.remove(), 800);
}

async function toggleReelLike(reelId, btn) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = "1";
  const wasLiked = btn.classList.contains("liked");
  const countEl = btn.querySelector("span");
  const count = parseInt(countEl.textContent, 10) || 0;
  btn.classList.toggle("liked", !wasLiked);
  countEl.textContent = String(wasLiked ? count - 1 : count + 1);
  const { error } = wasLiked
    ? await sb.from("reel_likes").delete().eq("reel_id", reelId).eq("user_id", ME.id)
    : await sb.from("reel_likes").insert({ reel_id: reelId, user_id: ME.id });
  delete btn.dataset.busy;
  if (error) {
    btn.classList.toggle("liked", wasLiked);
    countEl.textContent = String(count);
    toast(friendlyError(error, "Could not update like."));
  }
}

async function deleteReel(reelId, el) {
  if (!confirm("Delete this reel?")) return;
  const { error } = await sb.from("reels").update({ deleted: true }).eq("id", reelId).eq("user_id", ME.id);
  if (error) { toast(friendlyError(error, "Could not delete reel.")); return; }
  playObserver.unobserve(el);
  el.querySelector("video")?.removeAttribute("src");
  el.remove();
  toast("Reel deleted");
}

/* ---------- YouTube shorts listed in reel.txt ---------- */

const YT_RE = /(?:youtube\.com\/(?:shorts|embed)\/|youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})/;

function ytCommand(iframe, func) {
  iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "https://www.youtube.com");
}

// The iframe is only created when the short first comes on screen, so
// four YouTube players don't all load and play at once in the background.
function ytPlay(el, play) {
  let f = el.querySelector("iframe");
  if (!f && play) {
    f = document.createElement("iframe");
    f.src = `https://www.youtube.com/embed/${el.dataset.yt}?autoplay=1&mute=${reelsState.muted ? 1 : 0}&playsinline=1&loop=1&playlist=${el.dataset.yt}&enablejsapi=1&controls=0&modestbranding=1`;
    f.allow = "autoplay; encrypted-media; picture-in-picture";
    f.allowFullscreen = true;
    f.title = "Short";
    f.loading = "lazy";
    el.querySelector(".yt-wrap").appendChild(f);
    return;
  }
  ytCommand(f, play ? "playVideo" : "pauseVideo");
}

async function addExternalReels() {
  if (reelsState.externalAdded) return;
  reelsState.externalAdded = true;
  let text = "";
  try { text = await (await fetch("reel.txt", { cache: "no-cache" })).text(); } catch { return; }
  const ids = [...new Set(text.split(/\r?\n/).map((s) => s.trim().match(YT_RE)?.[1]).filter(Boolean))];
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const feedEl = document.getElementById("reelsFeed");
  const sentinel = document.getElementById("reelsSentinel");
  for (const id of ids.slice(0, 10)) {
    const el = document.createElement("section");
    el.className = "reel ig-reel yt-reel";
    el.dataset.type = "yt";
    el.dataset.yt = id;
    el.innerHTML = `<div class="yt-wrap"></div><img class="yt-thumb" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy" />`;
    feedEl.insertBefore(el, sentinel);
    playObserver.observe(el);
  }
}

/* ---------- Upload ---------- */

function getVideoDuration(url) {
  return new Promise((resolve) => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => resolve(probe.duration);
    probe.onerror = () => resolve(NaN);
    probe.src = url;
  });
}

function closeUploadSheet() {
  document.getElementById("reelUploadSheet").classList.remove("show");
  const preview = document.getElementById("reelUploadPreview");
  preview.pause();
  preview.removeAttribute("src");
  if (pendingReelPreviewUrl) { URL.revokeObjectURL(pendingReelPreviewUrl); pendingReelPreviewUrl = null; }
  pendingReelFile = null;
}

function wireUpload() {
  const input = document.getElementById("reelInput");
  const sheet = document.getElementById("reelUploadSheet");
  document.getElementById("reelUploadBtn").addEventListener("click", () => input.click());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) AppNav.exitFullscreen(); });

  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    if (file.size > MAX_REEL_BYTES) { toast(`Video is too large (max ${MAX_REEL_BYTES / 1024 / 1024} MB).`); return; }
    pendingReelPreviewUrl = URL.createObjectURL(file);
    const duration = await getVideoDuration(pendingReelPreviewUrl);
    if (!Number.isNaN(duration) && duration > MAX_REEL_SECONDS) {
      URL.revokeObjectURL(pendingReelPreviewUrl);
      pendingReelPreviewUrl = null;
      toast(`Reels can be up to ${MAX_REEL_SECONDS / 60} minutes long.`);
      return;
    }
    pendingReelFile = file;
    const preview = document.getElementById("reelUploadPreview");
    preview.src = pendingReelPreviewUrl;
    preview.play().catch(() => {});
    document.getElementById("reelCaption").value = "";
    document.getElementById("reelUploadError").textContent = "";
    sheet.classList.add("show");
    document.querySelectorAll(".reel").forEach(pauseReel);
    AppNav.enterFullscreen(closeUploadSheet);
  });
  document.getElementById("reelPublishBtn").addEventListener("click", publishReel);
}

async function publishReel() {
  if (!pendingReelFile) return;
  const btn = document.getElementById("reelPublishBtn");
  const errEl = document.getElementById("reelUploadError");
  errEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Uploading…";
  try {
    const ext = (pendingReelFile.name.split(".").pop() || "mp4").toLowerCase();
    const url = await uploadPublic("reels", `${ME.id}/${Date.now()}.${ext}`, pendingReelFile, pendingReelFile.type || "video/mp4");
    const caption = document.getElementById("reelCaption").value.trim();
    const { data: reel, error } = await sb.from("reels").insert({ user_id: ME.id, video_url: url, caption: caption || null }).select().single();
    if (error) throw error;

    AppNav.exitFullscreen();
    const feedEl = document.getElementById("reelsFeed");
    feedEl.querySelector(".reels-empty")?.remove();
    const el = buildReel(reel, 0, false, 0, false);
    feedEl.insertBefore(el, feedEl.firstChild);
    playObserver.observe(el);
    feedEl.scrollTo({ top: 0, behavior: "smooth" });
    toast("Reel shared");
  } catch (err) {
    errEl.textContent = friendlyError(err, "Upload failed. Try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Share reel";
  }
}

init();
