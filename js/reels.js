let ME = null;

const REELS_PAGE = 6;
const MAX_REEL_BYTES = 50 * 1024 * 1024;   // Supabase free-plan upload ceiling
const MAX_REEL_SECONDS = 180;

const reelsState = { cursor: null, done: false, loading: false, muted: true, immersive: false };
const shownReelIds = new Set(); // a deep-linked reel must not appear twice in the feed
let pendingReelFile = null;
let pendingReelPreviewUrl = null;
let playObserver = null;

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
  wireUpload();

  const feedEl = document.getElementById("reelsFeed");
  Skeleton.show("reel", feedEl, 1);

  // Whichever reel is mostly on screen plays; everything else pauses
  playObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const reel = entry.target;
      const video = reel.querySelector("video");
      if (entry.isIntersecting) {
        video.muted = reelsState.muted;
        video.play().catch(() => {});
        reel.classList.remove("paused");
        const next = reel.nextElementSibling?.querySelector("video");
        if (next) next.preload = "auto";
      } else {
        video.pause();
      }
    }
  }, { root: feedEl, threshold: 0.65 });

  const moreObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMoreReels();
  }, { root: feedEl, rootMargin: "200% 0px" });
  moreObserver.observe(document.getElementById("reelsSentinel"));

  // Placeholder inserted before the sentinel (not via innerHTML) so the
  // sentinel the observer is watching survives.
  const placeholder = document.createElement("div");
  placeholder.className = "sk-wrap reel-skeleton";
  placeholder.innerHTML = `<div class="skeleton sk-reel"></div>`;
  feedEl.insertBefore(placeholder, document.getElementById("reelsSentinel"));

  // ?r=<id> — opened from a notification. Show that reel at the top first,
  // then fill the rest of the feed underneath it.
  const targetId = new URLSearchParams(location.search).get("r");
  if (targetId) await showTargetReel(targetId);

  await loadMoreReels();
  setTimeout(clearReelSkeleton, 6000);
}

function clearReelSkeleton() {
  const feedEl = document.getElementById("reelsFeed");
  Skeleton.clear(feedEl);
  feedEl.querySelector(".sk-wrap")?.remove();
}

async function showTargetReel(id) {
  const { data: reel } = await sb.from("reels").select("*")
    .eq("id", id).eq("deleted", false).maybeSingle();

  clearReelSkeleton();
  if (!reel) { toast("That reel isn't available anymore."); return; }

  await renderReels([reel]);
  document.getElementById("reelsFeed").scrollTop = 0;
}

async function loadMoreReels() {
  if (reelsState.loading || reelsState.done) return;
  reelsState.loading = true;

  let query = sb.from("reels").select("*").eq("deleted", false)
    .order("created_at", { ascending: false }).limit(REELS_PAGE);
  if (reelsState.cursor) query = query.lt("created_at", reelsState.cursor);

  const { data: reels, error } = await query;
  reelsState.loading = false;
  clearReelSkeleton();
  if (error) { console.error(error); toast("Could not load reels."); return; }

  const feedEl = document.getElementById("reelsFeed");
  const sentinel = document.getElementById("reelsSentinel");

  if (!reels.length) {
    reelsState.done = true;
    feedEl.querySelector(".reel-skeleton")?.remove();
    if (!feedEl.querySelector(".reel")) {
      const empty = document.createElement("div");
      empty.className = "reels-empty";
      empty.innerHTML = `${svgIcon("reel", 44)}<div>No reels yet.<br>Tap + to share the first one.</div>`;
      feedEl.insertBefore(empty, sentinel);
    }
    return;
  }

  reelsState.cursor = reels[reels.length - 1].created_at;
  if (reels.length < REELS_PAGE) reelsState.done = true;

  await renderReels(reels);
}

async function renderReels(rows) {
  const reels = rows.filter(r => !shownReelIds.has(r.id));
  if (!reels.length) return;
  reels.forEach(r => shownReelIds.add(r.id));

  const feedEl = document.getElementById("reelsFeed");
  const sentinel = document.getElementById("reelsSentinel");
  const ids = reels.map(r => r.id);
  const [likeRows, myLikeRows, commentRows, saveRows] = await Promise.all([
    sb.from("reel_likes").select("reel_id").in("reel_id", ids),
    sb.from("reel_likes").select("reel_id").eq("user_id", ME.id).in("reel_id", ids),
    sb.from("reel_comments").select("reel_id").eq("deleted", false).in("reel_id", ids),
    sb.from("saves").select("reel_id").eq("user_id", ME.id).in("reel_id", ids),
    getProfiles(reels.map(r => r.user_id)),
  ]);

  const countBy = res => (res.data || []).reduce((acc, r) => ((acc[r.reel_id] = (acc[r.reel_id] || 0) + 1), acc), {});
  const likes = countBy(likeRows);
  const comments = countBy(commentRows);
  const mine = new Set((myLikeRows.data || []).map(r => r.reel_id));
  const saved = new Set((saveRows.data || []).map(r => r.reel_id));

  clearReelSkeleton();
  feedEl.querySelector(".reels-empty")?.remove();
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

  // A phone-shaped video fills the screen; anything squarer or wider is
  // letterboxed instead of being blown up and cropped.
  video.addEventListener("loadedmetadata", () => {
    if (!video.videoWidth || !video.videoHeight) return;
    const videoAspect = video.videoWidth / video.videoHeight;
    const boxAspect = (el.clientWidth || window.innerWidth) / (el.clientHeight || window.innerHeight);
    const closeEnough = Math.abs(videoAspect - boxAspect) / boxAspect < 0.18;
    video.style.objectFit = closeEnough ? "cover" : "contain";
    el.classList.toggle("letterboxed", !closeEnough);
  }, { once: true });
  video.playsInline = true;
  video.loop = true;
  video.muted = reelsState.muted;
  video.preload = "metadata";
  el.appendChild(video);

  const state = document.createElement("div");
  state.className = "reel-state";
  state.innerHTML = svgIcon("pause", 30);
  el.appendChild(state);

  const info = document.createElement("div");
  info.className = "reel-info";
  info.innerHTML = `
    <a class="reel-author" href="${profileHref}"><span class="avatar"></span>${escapeHTML(author?.display_name || "Unknown")}</a>
    ${reel.caption ? `<div class="reel-caption">${escapeHTML(reel.caption)}</div>` : ""}`;
  setAvatarContent(info.querySelector(".avatar"), author);
  el.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "reel-actions";

  const likeBtn = document.createElement("button");
  likeBtn.className = `like-btn ${likedByMe ? "liked" : ""}`;
  likeBtn.innerHTML = `${svgIcon("heart", 30)}<span>${likeCount}</span>`;
  likeBtn.addEventListener("click", () => toggleReelLike(reel.id, likeBtn));
  actions.appendChild(likeBtn);

  const commentBtn = document.createElement("button");
  commentBtn.innerHTML = `${svgIcon("comment", 28)}<span>${commentCount}</span>`;
  commentBtn.addEventListener("click", () => {
    video.pause();
    el.classList.add("paused");
    openCommentsSheet({
      table: "reel_comments", column: "reel_id", id: reel.id, myId: ME.id,
      onAdded: () => {
        const span = commentBtn.querySelector("span");
        span.textContent = String((parseInt(span.textContent, 10) || 0) + 1);
      },
    });
  });
  actions.appendChild(commentBtn);

  const muteBtn = document.createElement("button");
  muteBtn.className = "reel-mute-btn";
  muteBtn.innerHTML = svgIcon(reelsState.muted ? "mute" : "unmute", 26);
  muteBtn.addEventListener("click", toggleMute);
  actions.appendChild(muteBtn);

  const saveBtn = document.createElement("button");
  saveBtn.className = `save-btn ${savedByMe ? "saved" : ""}`;
  saveBtn.innerHTML = svgIcon("bookmark", 26);
  saveBtn.addEventListener("click", () => toggleSave("reel", reel.id, saveBtn));
  actions.appendChild(saveBtn);

  if (reel.user_id === ME.id) {
    const delBtn = document.createElement("button");
    delBtn.innerHTML = svgIcon("trash", 24);
    delBtn.addEventListener("click", () => deleteReel(reel.id, el));
    actions.appendChild(delBtn);
  }
  el.appendChild(actions);

  // First tap goes immersive (nav + overlays slide away, back button restores);
  // after that taps pause/resume. Double tap likes.
  let tapTimer = null;
  video.addEventListener("click", () => {
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = null;
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
  document.querySelectorAll(".reel video").forEach(v => { v.muted = reelsState.muted; });
  document.querySelectorAll(".reel-mute-btn").forEach(b => { b.innerHTML = svgIcon(reelsState.muted ? "mute" : "unmute", 26); });
}

function burstReelHeart(container) {
  const heart = document.createElement("div");
  heart.className = "double-tap-heart";
  heart.innerHTML = svgIcon("heart", 110);
  container.appendChild(heart);
  setTimeout(() => heart.remove(), 800);
}

async function toggleReelLike(reelId, btn) {
  const wasLiked = btn.classList.contains("liked");
  const countEl = btn.querySelector("span");
  const count = parseInt(countEl.textContent, 10) || 0;

  btn.classList.toggle("liked", !wasLiked);
  countEl.textContent = String(wasLiked ? count - 1 : count + 1);

  const { error } = wasLiked
    ? await sb.from("reel_likes").delete().eq("reel_id", reelId).eq("user_id", ME.id)
    : await sb.from("reel_likes").insert({ reel_id: reelId, user_id: ME.id });

  if (error) {
    btn.classList.toggle("liked", wasLiked);
    countEl.textContent = String(count);
    toast(error.message || "Could not update like.");
  }
}

async function deleteReel(reelId, el) {
  if (!confirm("Delete this reel?")) return;
  const { error } = await sb.from("reels").update({ deleted: true }).eq("id", reelId).eq("user_id", ME.id);
  if (error) { toast(error.message || "Could not delete reel."); return; }
  playObserver.unobserve(el);
  el.remove();
  toast("Reel deleted");
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

    if (file.size > MAX_REEL_BYTES) {
      toast(`Video is too large (max ${MAX_REEL_BYTES / 1024 / 1024} MB).`);
      return;
    }

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
    document.querySelectorAll(".reel video").forEach(v => v.pause());
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
    const path = `${ME.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from("reels").upload(path, pendingReelFile, {
      contentType: pendingReelFile.type || "video/mp4",
    });
    if (upErr) throw upErr;
    const { data: pub } = sb.storage.from("reels").getPublicUrl(path);

    const caption = document.getElementById("reelCaption").value.trim();
    const { data: reel, error } = await sb.from("reels")
      .insert({ user_id: ME.id, video_url: pub.publicUrl, caption: caption || null })
      .select().single();
    if (error) throw error;

    AppNav.exitFullscreen();

    const feedEl = document.getElementById("reelsFeed");
    shownReelIds.add(reel.id);
    feedEl.querySelector(".reel-skeleton")?.remove();
    Skeleton.clear(feedEl);
  feedEl.querySelector(".reels-empty")?.remove();
    const el = buildReel(reel, 0, false, 0, false);
    feedEl.insertBefore(el, feedEl.firstChild);
    playObserver.observe(el);
    feedEl.scrollTo({ top: 0, behavior: "smooth" });
    toast("Reel shared");
  } catch (err) {
    errEl.textContent = err.message || "Upload failed. Try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Share reel";
  }
}

init();
