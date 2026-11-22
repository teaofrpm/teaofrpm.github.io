let ME = null;

const REELS_PAGE = 6;
const MAX_REEL_BYTES = 50 * 1024 * 1024;   // Supabase free-plan upload ceiling
const MAX_REEL_SECONDS = 180;

const reelsState = { done: false, loading: false, muted: true, immersive: false, first: null, shown: [], round: 0,
  yt: [], steered: new Set(), steerAt: 0, friendsDone: false };
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
      if (entry.isIntersecting) { current = reel; reel._seenAt = performance.now(); playReel(reel); }
      else { flushView(reel); pauseReel(reel); }
    }
  }, { root: feedEl, threshold: 0.65 });
  // the algorithm learns from how long you actually watched
  addEventListener("pagehide", () => current && flushView(current));

  const moreObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMoreReels();
  }, { root: feedEl, rootMargin: "300% 0px" });   // fetch the next batch ~3 reels early so it's ready

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (current) flushView(current); document.querySelectorAll(".reel").forEach(pauseReel); }
    else if (current) { current._seenAt = performance.now(); playReel(current); }
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

function flushView(reel) {
  if (!reel?._seenAt || !reel.dataset.id) return;
  const ms = Math.round(performance.now() - reel._seenAt);
  reel._seenAt = 0;
  if (ms > 1200) sb.rpc("log_reel_view", { p_reel: reel.dataset.id, p_ms: ms }).then(() => {}, () => {});
  if (reel.dataset.yt) {
    // quick swipe = "not for me", watched through = "more of this"
    reelSignal(reel.dataset.id, "view", ms);
    if (ms >= 12000) steer(reel);
  }
}

/* ---------- live For You engine (edge function reels-live) ---------- */
// Every page is fetched live from YouTube for this person: their taste (built from watch time,
// skips, likes, saves, comments, shares), what they just loved, plus a little discovery.
async function liveReels(n, seeds = []) {
  try {
    const { data, error } = await sb.functions.invoke("reels-live", { body: { n, seeds, exclude: reelsState.yt.slice(-300) } });
    if (error || !Array.isArray(data?.rows)) throw error || new Error("bad response");
    return data.rows;
  } catch (e) {
    console.warn("[reels] live feed unavailable:", e?.message || e);
    return null;
  }
}

function reelSignal(id, kind, ms = 0) {
  if (id) sb.rpc("reel_signal", { p_reel: id, p_kind: kind, p_ms: ms }).then(() => {}, () => {});
}

// The moment you show you love a reel, more like it are queued right after the one that's up next
// (never directly under your finger), the way Instagram adapts mid-session.
function steer(el) {
  const yt = el?.dataset.yt;
  if (!yt || reelsState.steered.has(yt) || Date.now() - reelsState.steerAt < 8000) return;
  reelsState.steered.add(yt);
  reelsState.steerAt = Date.now();
  liveReels(3, [yt]).then((rows) => {
    if (!rows?.length) return;
    let anchor = (current || el).nextElementSibling;
    if (anchor?.classList.contains("reel")) anchor = anchor.nextElementSibling;
    renderReels(rows, anchor && anchor.parentElement === document.getElementById("reelsFeed") ? anchor : null);
  });
}

async function showDeepLinked(id) {
  const { data } = await sb.rpc("reel_cards", { p_ids: [id] });
  if (!data?.length) { toast("That reel isn't available anymore."); return; }
  reelsState.first = id;
  renderReels(data);
}

// "For You": each page = Shorts fetched live from YouTube for this person (reels-live engine)
// + up to two reels from people on the app (reels_for_you ranks those), mixed together.
async function loadMoreReels() {
  if (reelsState.loading || reelsState.done) return;
  reelsState.loading = true;
  try {
    const livePromise = liveReels(REELS_PAGE);
    const friendsPromise = reelsState.friendsDone ? Promise.resolve({ data: [] }) : sb.rpc("reels_for_you", { p_exclude: reelsState.shown.slice(-300), p_limit: 2 });
    // first open: if YouTube is slow, show Shorts we already have instantly and let the live ones follow
    if (!document.querySelector("#reelsFeed .reel")) {
      const quick = await Promise.race([livePromise, new Promise((r) => setTimeout(() => r("slow"), 1200))]);
      if (quick === "slow") {
        const { data: fb } = await sb.rpc("reels_yt_fallback", { p_exclude: reelsState.shown.slice(-300), p_limit: 2 });
        renderReels(fb || []);
      }
    }
    const [live, friends] = await Promise.all([livePromise, friendsPromise]);
    if (friends.error) console.error(friends.error);
    const mine = friends.data || [];
    if (mine.length < 2) reelsState.friendsDone = true;
    let yt = live;
    if (!yt) {   // YouTube unreachable: rank Shorts we already have by this person's taste
      const fb = await sb.rpc("reels_yt_fallback", { p_exclude: reelsState.shown.slice(-300), p_limit: REELS_PAGE });
      yt = fb.data || [];
    }
    // people you know slot in at positions 2 and 5
    const rows = [...yt];
    mine.forEach((r, i) => rows.splice(Math.min(rows.length, 1 + i * 3), 0, r));

    const feedEl = document.getElementById("reelsFeed");
    Skeleton.clear(feedEl);
    if (!renderReels(rows)) reelsState.done = true;

    if (reelsState.done) {
      if (!feedEl.querySelector(".reel")) {
        const empty = document.createElement("div");
        empty.className = "reels-empty";
        empty.innerHTML = `${svgIcon("reel", 44)}<div>No reels yet.<br>Tap + to share one or add a YouTube Short.</div>`;
        feedEl.insertBefore(empty, document.getElementById("reelsSentinel"));
      } else if (reelsState.shown.length) {
        // endless feed: start a fresh round (already-watched ones rank lower, new imports keep arriving)
        reelsState.shown = []; reelsState.done = false; reelsState.friendsDone = false; reelsState.round++;
        setTimeout(loadMoreReels, 0);
      } else showCaughtUp();
    }
  } finally {
    reelsState.loading = false;
  }
}

// End of the feed: offer a fresh shuffle instead of a dead end.
function showCaughtUp() {
  const feedEl = document.getElementById("reelsFeed");
  feedEl.querySelector(".reels-end")?.remove();
  const end = document.createElement("section");
  end.className = "reels-empty reels-end";
  end.innerHTML = `${svgIcon("check", 40)}<div><b>You're all caught up</b><br>You've seen every reel for now.</div>
    <button type="button" class="reels-again">${svgIcon("shuffle", 16)} Shuffle &amp; watch again</button>`;
  end.querySelector("button").addEventListener("click", () => {
    end.remove();
    reelsState.shown = [];
    reelsState.done = false;
    reelsState.friendsDone = false;
    reelsState.round++;
    loadMoreReels().then(() => {
      const next = [...feedEl.querySelectorAll(".reel")].find((r) => Number(r.dataset.round) === reelsState.round);
      next?.scrollIntoView({ behavior: "smooth" });
    });
  });
  feedEl.insertBefore(end, document.getElementById("reelsSentinel"));
}

// rows come from reels-live / reels_for_you / reel_cards; `before` lets steering insert mid-feed.
// Returns how many reels were added.
function renderReels(rows, before = null) {
  if (!rows?.length) return 0;
  const feedEl = document.getElementById("reelsFeed");
  Skeleton.clear(feedEl);
  feedEl.querySelector(".reels-empty:not(.reels-end)")?.remove();
  const sentinel = before || document.getElementById("reelsSentinel");
  let added = 0;
  for (const r of rows) {
    if (!r?.reel?.id) continue;
    if (r.author) rememberProfile(r.author);
    if (reelsState.shown.includes(r.reel.id)) continue;
    reelsState.shown.push(r.reel.id);
    if (r.reel.yt_id) reelsState.yt.push(r.reel.yt_id);
    added++;
    const el = buildReel(r.reel, r.like_count || 0, !!r.liked, r.comment_count || 0, !!r.saved, r.views || 0);
    el.dataset.round = reelsState.round;
    feedEl.insertBefore(el, sentinel);
    playObserver.observe(el);
  }
  return added;
}

const fmtCount = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n);

function buildReel(reel, likeCount, likedByMe, commentCount, savedByMe, views = 0) {
  const author = profileCache.get(reel.user_id);
  // auto-imported Shorts belong to their YouTube channel, not to whoever ran the import
  const ch = reel.imported ? { name: reel.yt_channel || "YouTube", href: /^https:\/\/www\.youtube\.com\//.test(reel.yt_channel_id || "") ? `${reel.yt_channel_id}/shorts` : reel.yt_channel_id ? `https://www.youtube.com/channel/${encodeURIComponent(reel.yt_channel_id)}/shorts` : `https://www.youtube.com/shorts/${reel.yt_id}` } : null;
  const profileHref = ch ? ch.href : author ? `profile.html?u=${encodeURIComponent(author.username)}` : "#";
  const isYT = !!reel.yt_id;

  const el = document.createElement("section");
  el.className = `reel${isYT ? " yt-reel" : ""}`;
  el.dataset.id = reel.id;

  let video = null;
  if (isYT) {
    // same reel UI as uploads; the YouTube player only loads once it's on screen
    el.dataset.type = "yt";
    el.dataset.yt = reel.yt_id;
    el.insertAdjacentHTML("beforeend", `<div class="yt-wrap"><img class="yt-thumb" src="https://i.ytimg.com/vi/${reel.yt_id}/hqdefault.jpg" alt="" loading="lazy" /></div>`);
  } else {
    video = document.createElement("video");
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
  }

  // one transparent layer catches taps for both kinds (an iframe would swallow them)
  const tap = document.createElement("div");
  tap.className = "reel-tap";
  el.appendChild(tap);

  const state = document.createElement("div");
  state.className = "reel-state";
  state.innerHTML = svgIcon("pause", 30);
  el.appendChild(state);

  const info = document.createElement("div");
  info.className = "reel-info";
  info.innerHTML = `
    <a class="reel-author" href="${profileHref}"${ch ? ` target="_blank" rel="noopener"` : ""}><span class="avatar${ch ? " reel-ch-av" : ""}"></span>${escapeHTML(ch ? ch.name : author?.display_name || "Unknown")}${isYT ? `<span class="reel-yt-badge">${svgIcon("youtube", 13)} Short</span>` : ""}</a>
    ${reel.caption ? `<div class="reel-caption">${linkifyMentions(escapeHTML(reel.caption))}</div>` : ""}
    ${views ? `<div class="reel-views">${svgIcon("play", 11)} ${fmtCount(views)} views</div>` : ""}`;
  if (ch) info.querySelector(".avatar").textContent = [...ch.name.trim()][0]?.toUpperCase() || "Y";
  else setAvatarContent(info.querySelector(".avatar"), author);
  el.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "reel-actions";

  const likeBtn = document.createElement("button");
  likeBtn.className = `like-btn ${likedByMe ? "liked" : ""}${likeCount == null ? " hide-count" : ""}`;
  likeBtn.setAttribute("aria-label", "Like");
  likeBtn.innerHTML = `${svgIcon("heart", 30)}<span>${likeCount ?? ""}</span>`;
  likeBtn.addEventListener("click", () => toggleReelLike(reel.id, likeBtn));
  actions.appendChild(likeBtn);

  const commentBtn = document.createElement("button");
  commentBtn.setAttribute("aria-label", "Comments");
  commentBtn.innerHTML = `${svgIcon("comment", 28)}<span>${commentCount}</span>`;
  const bump = (d) => { const s = commentBtn.querySelector("span"); s.textContent = String(Math.max(0, (parseInt(s.textContent, 10) || 0) + d)); };
  commentBtn.addEventListener("click", () => {
    setPaused(el, true);
    openCommentsSheet({ table: "reel_comments", column: "reel_id", id: reel.id, myId: ME.id, onAdded: () => { bump(1); if (isYT) { reelSignal(reel.id, "comment"); steer(el); } }, onRemoved: () => bump(-1) });
  });
  actions.appendChild(commentBtn);

  const shareBtn = document.createElement("button");
  shareBtn.setAttribute("aria-label", "Share");
  shareBtn.innerHTML = svgIcon("share", 25);
  shareBtn.addEventListener("click", () => { if (isYT) { reelSignal(reel.id, "share"); steer(el); } shareLink(`reels.html?r=${reel.id}`, "A reel on teaofrpm"); });
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
  saveBtn.addEventListener("click", () => {
    const was = saveBtn.classList.contains("saved");
    Promise.resolve(toggleSave("reel", reel.id, saveBtn)).then(() => {
      if (isYT && !was && saveBtn.classList.contains("saved")) { reelSignal(reel.id, "save"); steer(el); }
    });
  });
  actions.appendChild(saveBtn);

  const moreBtn = document.createElement("button");
  moreBtn.setAttribute("aria-label", "More");
  moreBtn.innerHTML = svgIcon("more", 26);
  moreBtn.addEventListener("click", () => {
    const own = reel.user_id === ME.id && !reel.imported;
    const items = [
      { icon: "share", label: "Share…", onClick: () => shareLink(`reels.html?r=${reel.id}`, "A reel on teaofrpm") },
      { icon: "link", label: "Copy link", onClick: () => copyText(new URL(`reels.html?r=${reel.id}`, location.href).href, "Link copied") },
    ];
    if (reel.yt_id) items.push({ icon: "youtube", label: "Open on YouTube", onClick: () => window.open(`https://www.youtube.com/shorts/${reel.yt_id}`, "_blank", "noopener") });
    if (own || (reel.imported && reel.user_id === ME.id)) items.push({ icon: "trash", label: "Delete", danger: true, onClick: () => deleteReel(reel.id, el) });
    else {
      // tells the algorithm: fewer reels like this / from this creator
      items.unshift({ icon: "eye", label: "Not interested", onClick: () => notInterested(reel.id, el) });
      items.push({ icon: "flag", label: "Report", danger: true, onClick: () => reportSheet("reel", reel.id) });
    }
    actionSheet("Reel", items);
  });
  actions.appendChild(moreBtn);
  el.appendChild(actions);

  // First tap goes immersive; after that taps pause/resume. Double tap likes.
  // Works the same on uploads and YouTube shorts.
  let tapTimer = null;
  tap.addEventListener("click", () => {
    if (tapTimer) {
      clearTimeout(tapTimer); tapTimer = null;
      burstReelHeart(el);
      buzz(12);
      if (!likeBtn.classList.contains("liked")) toggleReelLike(reel.id, likeBtn);
      return;
    }
    tapTimer = setTimeout(() => {
      tapTimer = null;
      if (!reelsState.immersive) { enterImmersive(); return; }
      setPaused(el, el.dataset.paused !== "1");
    }, 260);
  });
  return el;
}

function setPaused(el, paused) {
  el.dataset.paused = paused ? "1" : "";
  el.classList.toggle("paused", paused);
  if (paused) pauseReel(el);
  else {
    const v = el.querySelector("video");
    if (v) v.play().catch(() => {});
    else ytPlay(el, true);
  }
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
    return;
  }
  const el = btn.closest(".reel");
  if (el?.dataset.yt) { reelSignal(reelId, wasLiked ? "unlike" : "like"); if (!wasLiked) steer(el); }
}

async function notInterested(reelId, el) {
  const { error } = await sb.rpc("reel_not_interested_toggle", { p_reel: reelId });
  if (error) { toast(friendlyError(error, "Could not update.")); return; }
  if (el.dataset.yt) reelSignal(reelId, "not_interested");
  toast("Got it — you'll see fewer reels like this");
  const next = el.nextElementSibling;
  if (next?.classList.contains("reel")) next.scrollIntoView({ behavior: "smooth" });
  setTimeout(() => { playObserver.unobserve(el); el.querySelector("video")?.removeAttribute("src"); el.remove(); }, 450);
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

/* ---------- YouTube shorts (stored as normal reels) ---------- */

const YT_RE = /(?:youtube\.com\/(?:shorts|embed|live)\/|youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=))([A-Za-z0-9_-]{11})/;

// A real YouTube video has a 320px-wide thumbnail; a made-up id gets a 120px placeholder.
function ytExists(id) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 120);
    img.onerror = () => resolve(false);
    img.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
    setTimeout(() => resolve(true), 6000);       // slow network: let the database decide
  });
}

function openAddShort() {
  const s = makeSheet({ title: "Add a YouTube Short", html: `
    <p class="yt-add-hint">Paste a YouTube Shorts link. It joins everyone's Reels feed, with likes, comments and saves like any other reel.</p>
    <input type="url" class="settings-search yt-add-url" placeholder="https://youtube.com/shorts/…" autocomplete="off" autocapitalize="off" spellcheck="false" />
    <div class="yt-add-preview"></div>
    <textarea class="yt-add-caption" rows="2" maxlength="300" placeholder="Say something about it (optional)"></textarea>
    <p class="error-text yt-add-error"></p>
    <button type="button" class="btn yt-add-btn" style="width:100%;" disabled>Add to Reels</button>` });
  s.onClose = () => setTimeout(() => s.el.remove(), 300);
  const url = s.body.querySelector(".yt-add-url");
  const prev = s.body.querySelector(".yt-add-preview");
  const err = s.body.querySelector(".yt-add-error");
  const btn = s.body.querySelector(".yt-add-btn");
  let id = null;
  url.addEventListener("input", () => {
    id = url.value.trim().match(YT_RE)?.[1] || null;
    err.textContent = "";
    btn.disabled = !id;
    prev.innerHTML = id ? `<img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" />` : "";
    if (url.value.trim() && !id) err.textContent = "That doesn't look like a YouTube link.";
  });
  btn.addEventListener("click", async () => {
    if (!id) return;
    btn.disabled = true; btn.textContent = "Checking…";
    if (!(await ytExists(id))) { err.textContent = "Couldn't find that video on YouTube."; btn.disabled = false; btn.textContent = "Add to Reels"; return; }
    const caption = s.body.querySelector(".yt-add-caption").value.trim() || null;
    const { data: reel, error } = await sb.from("reels").insert({ user_id: ME.id, video_url: `https://www.youtube.com/shorts/${id}`, yt_id: id, caption }).select().single();
    if (error) {
      err.textContent = error.code === "23505" ? "That Short is already in Reels." : friendlyError(error, "Couldn't add it. Try again.");
      btn.disabled = false; btn.textContent = "Add to Reels";
      return;
    }
    s.close();
    const feedEl = document.getElementById("reelsFeed");
    feedEl.querySelector(".reels-empty:not(.reels-end)")?.remove();
    reelsState.shown.push(reel.id);
    const el = buildReel(reel, 0, false, 0, false);
    feedEl.insertBefore(el, feedEl.querySelector(".reel") || document.getElementById("reelsSentinel"));
    playObserver.observe(el);
    el.scrollIntoView({ behavior: "smooth" });
    toast("Short added to Reels");
  });
  s.open();
  setTimeout(() => url.focus(), 250);
}

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
  if (play) ytCommand(f, reelsState.muted ? "mute" : "unMute");
  ytCommand(f, play ? "playVideo" : "pauseVideo");
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
  document.getElementById("reelUploadBtn").addEventListener("click", () => actionSheet("New reel", [
    { icon: "video", label: "Upload a video", onClick: () => input.click() },
    { icon: "youtube", label: "Add a YouTube Short", onClick: openAddShort },
  ]));
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
    reelsState.shown.push(reel.id);
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
