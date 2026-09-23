
let ME = null;

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

  applyIconAttributes();
  wireNav();
  wirePrivacy();
  wireAppearance();
  wireNotifications();
  wireWellbeing();
  wireProfileExtras();
  wireArchiveTab();
  wireSavedTabs();
  wireCloseFriends();
  wireBlocked();

  document.getElementById("logoutRow").addEventListener("click", logoutUser);

  document.getElementById("loadingOverlay").classList.add("hide");
}

/* ---------- Panel navigation ---------- */

const PANEL_TITLES = {
  root: "Settings", archive: "Archive", saved: "Saved", liked: "Likes",
  activity: "Your activity", privacy: "Account privacy", closeFriends: "Close friends",
  blocked: "Blocked", notifications: "Notifications", appearance: "Appearance",
  wellbeing: "Time management", profileExtras: "Bio link and audio",
};

const loadedPanels = new Set();

function wireNav() {
  document.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => openPanel(btn.dataset.open));
  });

  window.addEventListener("popstate", (e) => {
    showPanel((e.state && e.state.panel) || "root");
  });
}

function openPanel(name) {
  history.pushState({ panel: name }, "");
  showPanel(name);
}

function showPanel(name) {
  document.querySelectorAll(".settings-panel").forEach((p) => {
    p.classList.toggle("show", p.dataset.panel === name);
  });
  document.getElementById("settingsTitle").textContent = PANEL_TITLES[name] || "Settings";
  document.getElementById("settingsScroll").scrollTop = 0;

  if (!loadedPanels.has(name)) {
    loadedPanels.add(name);
    const loader = { archive: loadArchive, saved: loadSaved, liked: loadLiked, activity: loadActivity, closeFriends: loadCloseFriends, blocked: loadBlocked }[name];
    if (loader) loader();
  }
}

/* ---------- Account privacy ---------- */

function wirePrivacy() {
  const toggle = document.getElementById("privacyToggle");
  toggle.checked = !!ME.is_private;
  toggle.addEventListener("change", async () => {
    const { error } = await sb.from("profiles").update({ is_private: toggle.checked }).eq("id", ME.id);
    if (error) { toast(error.message || "Could not update."); toggle.checked = !toggle.checked; return; }
    ME.is_private = toggle.checked;
    toast(toggle.checked ? "Account is now private" : "Account is now public");
  });
}

/* ---------- Appearance (dark theme, font) ---------- */

function wireAppearance() {
  const themeRow = document.getElementById("themeChoice");
  const fontRow = document.getElementById("fontChoice");
  const savedTheme = localStorage.getItem("teaofrpm_theme") || ME.theme_pref || "light";
  const savedFont = localStorage.getItem("teaofrpm_font") || ME.font_pref || "default";

  setActiveChoice(themeRow, savedTheme);
  setActiveChoice(fontRow, savedFont);

  themeRow.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    applyTheme(btn.dataset.value);
    setActiveChoice(themeRow, btn.dataset.value);
    savePref({ theme_pref: btn.dataset.value });
  });

  fontRow.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    applyFont(btn.dataset.value);
    setActiveChoice(fontRow, btn.dataset.value);
    savePref({ font_pref: btn.dataset.value });
  });
}

function setActiveChoice(row, value) {
  row.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.value === value));
}

function applyTheme(value) {
  localStorage.setItem("teaofrpm_theme", value);
  if (value === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
}

function applyFont(value) {
  localStorage.setItem("teaofrpm_font", value);
  if (value !== "default") document.documentElement.setAttribute("data-font", value);
  else document.documentElement.removeAttribute("data-font");
}

async function savePref(patch) {
  await sb.from("profiles").update(patch).eq("id", ME.id);
  Object.assign(ME, patch);
}

/* ---------- Notification preferences ---------- */

async function wireNotifications() {
  const { data } = await sb.from("notification_prefs").select("*").eq("user_id", ME.id).maybeSingle();
  const prefs = data || { likes: true, comments: true, follows: true };

  document.getElementById("notifLikes").checked = prefs.likes;
  document.getElementById("notifComments").checked = prefs.comments;
  document.getElementById("notifFollows").checked = prefs.follows;

  ["notifLikes", "notifComments", "notifFollows"].forEach((id, i) => {
    const key = ["likes", "comments", "follows"][i];
    document.getElementById(id).addEventListener("change", async (e) => {
      const { error } = await sb.from("notification_prefs")
        .upsert({ user_id: ME.id, ...prefs, [key]: e.target.checked }, { onConflict: "user_id" });
      if (error) { toast(error.message || "Could not save."); e.target.checked = !e.target.checked; return; }
      prefs[key] = e.target.checked;
    });
  });
}

/* ---------- Time management (client-side, honest best-effort) ---------- */

function wireWellbeing() {
  const KEY = "teaofrpm_screentime";
  const today = new Date().toDateString();
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  if (store.day !== today) store = { day: today, seconds: 0 };

  const statEl = document.getElementById("wellbeingToday");
  const renderStat = () => {
    const mins = Math.floor(store.seconds / 60);
    statEl.textContent = mins < 1 ? "<1m" : `${mins}m`;
  };
  renderStat();

  const limitSelect = document.getElementById("wellbeingLimit");
  limitSelect.value = localStorage.getItem("teaofrpm_limit") || "0";
  limitSelect.addEventListener("change", () => localStorage.setItem("teaofrpm_limit", limitSelect.value));

  let notified = false;
  setInterval(() => {
    if (document.hidden) return;
    store.seconds += 5;
    localStorage.setItem(KEY, JSON.stringify(store));
    renderStat();

    const limit = parseInt(limitSelect.value, 10);
    if (limit && !notified && store.seconds >= limit * 60) {
      notified = true;
      toast(`You've spent ${limit} minutes here today`);
    }
  }, 5000);
}

setTimeout(() => document.getElementById("loadingOverlay")?.classList.add("hide"), 8000);

init();

/* ---------- Bio link + profile audio ---------- */

let pendingSongFile = null;
let pendingSongPreviewUrl = null;

function wireProfileExtras() {
  document.getElementById("websiteInput").value = ME.website_url || "";

  const preview = document.getElementById("songPreview");
  const removeBtn = document.getElementById("removeSongBtn");
  if (ME.profile_song_url) {
    preview.src = ME.profile_song_url;
    preview.style.display = "block";
    removeBtn.style.display = "inline-flex";
  }

  document.getElementById("songInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingSongFile = file;
    if (pendingSongPreviewUrl) URL.revokeObjectURL(pendingSongPreviewUrl);
    pendingSongPreviewUrl = URL.createObjectURL(file);
    preview.src = pendingSongPreviewUrl;
    preview.style.display = "block";
    removeBtn.style.display = "inline-flex";
  });

  removeBtn.addEventListener("click", () => {
    pendingSongFile = "remove";
    if (pendingSongPreviewUrl) { URL.revokeObjectURL(pendingSongPreviewUrl); pendingSongPreviewUrl = null; }
    preview.style.display = "none";
    preview.removeAttribute("src");
    removeBtn.style.display = "none";
  });

  document.getElementById("saveExtrasBtn").addEventListener("click", saveProfileExtras);
}

async function saveProfileExtras() {
  const errEl = document.getElementById("extrasError");
  const btn = document.getElementById("saveExtrasBtn");
  errEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const patch = { website_url: document.getElementById("websiteInput").value.trim() || null };

    if (pendingSongFile === "remove") {
      patch.profile_song_url = null;
    } else if (pendingSongFile) {
      const path = `${ME.id}/${Date.now()}.webm`;
      const { error: upErr } = await sb.storage.from("profile-audio").upload(path, pendingSongFile, {
        contentType: pendingSongFile.type || "audio/webm",
      });
      if (upErr) throw upErr;
      const { data: pub } = sb.storage.from("profile-audio").getPublicUrl(path);
      patch.profile_song_url = pub.publicUrl;
    }

    const { error } = await sb.from("profiles").update(patch).eq("id", ME.id);
    if (error) throw error;
    Object.assign(ME, patch);
    pendingSongFile = null;
    toast("Saved");
  } catch (err) {
    errEl.textContent = err.message || "Could not save.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

/* ---------- Archive ---------- */

async function loadArchive() {
  const list = document.getElementById("archiveList");
  const { data, error } = await sb.from("posts").select("*")
    .eq("user_id", ME.id).eq("archived", true).eq("deleted", false)
    .order("created_at", { ascending: false });

  if (error || !data.length) { list.innerHTML = `<div class="settings-empty">Nothing archived.</div>`; return; }

  list.innerHTML = "";
  for (const post of data) {
    const row = document.createElement("div");
    row.className = "settings-list-row";
    row.innerHTML = `
      ${post.image_url ? `<img class="settings-thumb" src="${post.image_url}" />` : `<span class="avatar" style="width:44px;height:44px;">📝</span>`}
      <div class="settings-list-name">${escapeHTML(post.content || "Photo post")}<span class="settings-list-sub">${timeAgoOrDate(post.created_at)}</span></div>
      <button data-id="${post.id}">Unarchive</button>`;
    row.querySelector("button").addEventListener("click", async () => {
      const { error: uErr } = await sb.from("posts").update({ archived: false }).eq("id", post.id).eq("user_id", ME.id);
      if (uErr) { toast(uErr.message || "Could not unarchive."); return; }
      row.remove();
      if (!list.children.length) list.innerHTML = `<div class="settings-empty">Nothing archived.</div>`;
    });
    list.appendChild(row);
  }
}

function wireArchiveTab() {} // loaded lazily via loadArchive()

function timeAgoOrDate(ts) {
  return typeof timeAgo === "function" ? timeAgo(ts) : new Date(ts).toLocaleDateString();
}

/* ---------- Saved ---------- */

function wireSavedTabs() {
  document.querySelectorAll("[data-saved-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-saved-tab]").forEach((b) => b.classList.toggle("active", b === btn));
      loadSaved(btn.dataset.savedTab);
    });
  });
}

async function loadSaved(kind = "posts") {
  const list = document.getElementById("savedList");
  list.innerHTML = `<div class="search-hint">Loading…</div>`;

  const column = kind === "posts" ? "post_id" : "reel_id";
  const table = kind === "posts" ? "posts" : "reels";
  const { data: saves, error } = await sb.from("saves").select("*")
    .eq("user_id", ME.id).not(column, "is", null)
    .order("created_at", { ascending: false });

  if (error || !saves.length) { list.innerHTML = `<div class="settings-empty">No saved ${kind} yet.</div>`; return; }

  const ids = saves.map((s) => s[column]);
  const { data: items } = await sb.from(table).select("*").in("id", ids).eq("deleted", false);
  const byId = new Map((items || []).map((i) => [i.id, i]));

  list.innerHTML = "";
  for (const s of saves) {
    const item = byId.get(s[column]);
    if (!item) continue;
    const thumb = kind === "posts" ? item.image_url : null;
    const row = document.createElement("div");
    row.className = "settings-list-row";
    row.innerHTML = `
      ${thumb ? `<img class="settings-thumb" src="${thumb}" />` : `<span class="avatar" style="width:44px;height:44px;">${kind === "reels" ? "🎬" : "📝"}</span>`}
      <div class="settings-list-name">${escapeHTML(item.content || item.caption || (kind === "reels" ? "Reel" : "Photo post"))}<span class="settings-list-sub">${timeAgoOrDate(item.created_at)}</span></div>
      <button>Unsave</button>`;
    row.querySelector("button").addEventListener("click", async () => {
      await sb.from("saves").delete().eq("id", s.id);
      row.remove();
      if (!list.children.length) list.innerHTML = `<div class="settings-empty">No saved ${kind} yet.</div>`;
    });
    list.appendChild(row);
  }
}

/* ---------- Liked reels ---------- */

async function loadLiked() {
  const list = document.getElementById("likedList");
  const { data: likeRows, error } = await sb.from("reel_likes").select("reel_id")
    .eq("user_id", ME.id).order("created_at", { ascending: false });

  if (error || !likeRows.length) { list.innerHTML = `<div class="settings-empty">You haven't liked any reels yet.</div>`; return; }

  const ids = likeRows.map((r) => r.reel_id);
  const { data: reels } = await sb.from("reels").select("*").in("id", ids).eq("deleted", false);
  const byId = new Map((reels || []).map((r) => [r.id, r]));

  list.innerHTML = "";
  for (const r of likeRows) {
    const reel = byId.get(r.reel_id);
    if (!reel) continue;
    const row = document.createElement("a");
    row.className = "settings-list-row";
    row.href = "reels.html";
    row.style.textDecoration = "none";
    row.innerHTML = `
      <span class="avatar" style="width:44px;height:44px;">🎬</span>
      <div class="settings-list-name">${escapeHTML(reel.caption || "Reel")}<span class="settings-list-sub">${timeAgoOrDate(reel.created_at)}</span></div>`;
    list.appendChild(row);
  }
  if (!list.children.length) list.innerHTML = `<div class="settings-empty">You haven't liked any reels yet.</div>`;
}

/* ---------- Your activity ---------- */

async function loadActivity() {
  const list = document.getElementById("activityList");
  list.innerHTML = `<div class="search-hint">Loading…</div>`;

  const [likes, comments, follows] = await Promise.all([
    sb.from("post_likes").select("post_id, created_at").eq("user_id", ME.id).order("created_at", { ascending: false }).limit(20),
    sb.from("post_comments").select("post_id, content, created_at").eq("user_id", ME.id).order("created_at", { ascending: false }).limit(20),
    sb.from("follows").select("following_id, created_at").eq("follower_id", ME.id).eq("status", "accepted").order("created_at", { ascending: false }).limit(20),
  ]);

  const entries = [
    ...(likes.data || []).map((l) => ({ type: "like", at: l.created_at, text: "You liked a post" })),
    ...(comments.data || []).map((c) => ({ type: "comment", at: c.created_at, text: `You commented: "${c.content.slice(0, 40)}"` })),
    ...(follows.data || []).map((f) => ({ type: "follow", at: f.created_at, uid: f.following_id })),
  ];

  await Promise.all(entries.filter((e) => e.uid).map((e) => getProfile(e.uid)));
  entries.forEach((e) => { if (e.uid) e.text = `You followed ${profileCache.get(e.uid)?.display_name || "someone"}`; });
  entries.sort((a, b) => new Date(b.at) - new Date(a.at));

  if (!entries.length) { list.innerHTML = `<div class="settings-empty">No activity yet.</div>`; return; }

  list.innerHTML = "";
  for (const e of entries.slice(0, 40)) {
    const row = document.createElement("div");
    row.className = "settings-list-row";
    row.innerHTML = `<div class="settings-list-name">${escapeHTML(e.text)}<span class="settings-list-sub">${timeAgoOrDate(e.at)}</span></div>`;
    list.appendChild(row);
  }
}

/* ---------- Close friends ---------- */

let closeFriendsPeople = [];
let closeFriendsSet = new Set();

async function loadCloseFriends() {
  const { data: following } = await sb.from("follows").select("following_id")
    .eq("follower_id", ME.id).eq("status", "accepted");
  const ids = (following || []).map((f) => f.following_id);
  if (ids.length) await Promise.all(ids.map(getProfile));

  const { data: current } = await sb.from("close_friends").select("friend_id").eq("owner_id", ME.id);
  closeFriendsSet = new Set((current || []).map((c) => c.friend_id));
  closeFriendsPeople = ids.map((id) => profileCache.get(id)).filter(Boolean);

  renderCloseFriends(closeFriendsPeople, closeFriendsSet);
}

function renderCloseFriends(people, closeSet, filterText = "") {
  const list = document.getElementById("closeFriendsList");
  const filtered = filterText
    ? people.filter((p) => p.display_name.toLowerCase().includes(filterText) || p.username.toLowerCase().includes(filterText))
    : people;

  if (!filtered.length) { list.innerHTML = `<div class="settings-empty">Follow people to add them here.</div>`; return; }

  list.innerHTML = "";
  for (const p of filtered) {
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
    const isClose = closeSet.has(p.id);
    btn.textContent = isClose ? "Remove" : "Add";
    btn.addEventListener("click", async () => {
      if (btn.textContent === "Add") {
        const { error } = await sb.from("close_friends").insert({ owner_id: ME.id, friend_id: p.id });
        if (error) { toast(error.message || "Could not add."); return; }
        closeSet.add(p.id);
        btn.textContent = "Remove";
      } else {
        await sb.from("close_friends").delete().eq("owner_id", ME.id).eq("friend_id", p.id);
        closeSet.delete(p.id);
        btn.textContent = "Add";
      }
    });
    row.appendChild(btn);
    list.appendChild(row);
  }
}

function wireCloseFriends() {
  document.getElementById("closeFriendsSearch").addEventListener("input", (e) => {
    renderCloseFriends(closeFriendsPeople, closeFriendsSet, e.target.value.trim().toLowerCase());
  });
}

/* ---------- Blocked ---------- */

async function loadBlocked() {
  const list = document.getElementById("blockedList");
  const { data, error } = await sb.from("blocks").select("blocked_id, created_at")
    .eq("blocker_id", ME.id).order("created_at", { ascending: false });

  if (error || !data.length) { list.innerHTML = `<div class="settings-empty">You haven't blocked anyone.</div>`; return; }

  await Promise.all(data.map((b) => getProfile(b.blocked_id)));
  list.innerHTML = "";
  for (const b of data) {
    const p = profileCache.get(b.blocked_id);
    if (!p) continue;
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
    btn.textContent = "Unblock";
    btn.addEventListener("click", async () => {
      await sb.from("blocks").delete().eq("blocker_id", ME.id).eq("blocked_id", p.id);
      row.remove();
      if (!list.children.length) list.innerHTML = `<div class="settings-empty">You haven't blocked anyone.</div>`;
    });
    row.appendChild(btn);
    list.appendChild(row);
  }
}

function wireBlocked() {} // loaded lazily via loadBlocked()
