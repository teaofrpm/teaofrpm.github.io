// Shared app chrome used by every logged-in page.
// Nav config lives on the placeholder element, e.g.
// <nav id="appNav" data-active="home" data-scroll-el="feed" data-hide-on-focus="msgInput"></nav>

function timeAgo(ts) {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
}

async function toggleSave(kind, id, btn) {
  const column = kind === "post" ? "post_id" : "reel_id";
  const wasSaved = btn.classList.contains("saved");
  btn.classList.toggle("saved", !wasSaved);

  const { error } = wasSaved
    ? await sb.from("saves").delete().eq("user_id", ME.id).eq(column, id)
    : await sb.from("saves").insert({ user_id: ME.id, [column]: id });

  if (error) {
    btn.classList.toggle("saved", wasSaved);
    toast(error.message || "Could not update.");
  } else {
    toast(wasSaved ? "Removed" : "Saved");
  }
}

const AppNav = (() => {
  const ITEMS = [
    { key: "home", href: "home.html", icon: "home", label: "Home" },
    { key: "reels", href: "reels.html", icon: "reel", label: "Reels" },
    { key: "messages", href: "messages.html", icon: "chat", label: "Messages" },
    { key: "discover", href: "discover.html", icon: "globe", label: "Discover" },
    { key: "profile", href: "profile.html", icon: "person", label: "Profile" },
  ];

  // Each open fullscreen layer registers a close callback. The phone/browser
  // back button pops the top layer instead of leaving the page.
  const fullscreenLayers = [];

  function hide() { document.body.classList.add("nav-hidden"); }
  function show() { document.body.classList.remove("nav-hidden"); }

  function bindScroll(el) {
    let lastY = el.scrollTop;
    el.addEventListener("scroll", () => {
      if (fullscreenLayers.length) return;
      const y = el.scrollTop;
      if (y > lastY + 8 && y > 60) hide();
      else if (y < lastY - 8) show();
      lastY = y;
    }, { passive: true });
  }

  function hideWhileFocused(el) {
    el.addEventListener("focus", hide);
    el.addEventListener("blur", () => { if (!fullscreenLayers.length) show(); });
  }

  function enterFullscreen(onExit) {
    fullscreenLayers.push(onExit);
    hide();
    history.pushState({ appLayer: fullscreenLayers.length }, "");
  }

  function exitFullscreen() {
    if (fullscreenLayers.length) history.back();
  }

  window.addEventListener("popstate", () => {
    const onExit = fullscreenLayers.pop();
    if (onExit) onExit();
    if (!fullscreenLayers.length) show();
  });

  function render() {
    const nav = document.getElementById("appNav");
    if (!nav) return;
    const active = nav.dataset.active;
    nav.classList.add("app-nav");
    nav.innerHTML = ITEMS.map(i => `
      <a href="${i.href}" class="${i.key === active ? "active" : ""}" aria-label="${i.label}">
        ${svgIcon(i.icon, 22)}<span>${i.label}</span>
      </a>`).join("");
    document.body.classList.add("has-app-nav");

    const scrollEl = nav.dataset.scrollEl && document.getElementById(nav.dataset.scrollEl);
    if (scrollEl) bindScroll(scrollEl);
    const focusEl = nav.dataset.hideOnFocus && document.getElementById(nav.dataset.hideOnFocus);
    if (focusEl) hideWhileFocused(focusEl);
  }

  render();
  return { hide, show, bindScroll, enterFullscreen, exitFullscreen };
})();

function openMediaViewer(src) {
  let viewer = document.getElementById("appMediaViewer");
  if (!viewer) {
    viewer = document.createElement("div");
    viewer.id = "appMediaViewer";
    viewer.className = "app-media-viewer";
    viewer.innerHTML = `<img alt="" />`;
    viewer.addEventListener("click", () => AppNav.exitFullscreen());
    document.body.appendChild(viewer);
  }
  viewer.querySelector("img").src = src;
  viewer.classList.add("show");
  AppNav.enterFullscreen(() => viewer.classList.remove("show"));
}

// Bottom sheet for comments. Works for both post_comments (post_id) and
// reel_comments (reel_id) since the two tables share the same shape.
async function openCommentsSheet({ table, column, id, myId, onAdded }) {
  let sheet = document.getElementById("appCommentsSheet");
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "appCommentsSheet";
    sheet.className = "app-sheet-backdrop";
    sheet.innerHTML = `
      <div class="app-sheet">
        <div class="app-sheet-handle"></div>
        <div class="app-sheet-title">Comments</div>
        <div class="app-sheet-body"></div>
        <div class="app-sheet-input">
          <input type="text" maxlength="300" placeholder="Add a comment…" />
          <button class="app-sheet-send" aria-label="Post">${svgIcon("send", 18)}</button>
        </div>
      </div>`;
    sheet.addEventListener("click", (e) => { if (e.target === sheet) AppNav.exitFullscreen(); });
    document.body.appendChild(sheet);
  }

  const body = sheet.querySelector(".app-sheet-body");
  const input = sheet.querySelector("input");
  const sendBtn = sheet.querySelector(".app-sheet-send");

  sheet.classList.add("show");
  AppNav.enterFullscreen(() => sheet.classList.remove("show"));

  async function load() {
    body.innerHTML = `<div class="search-hint">Loading…</div>`;
    const { data, error } = await sb.from(table).select("*")
      .eq(column, id).eq("deleted", false)
      .order("created_at", { ascending: true });
    if (error) { body.innerHTML = `<div class="search-hint">Could not load comments.</div>`; return; }
    await Promise.all([...new Set((data || []).map(c => c.user_id))].map(getProfile));

    if (!data.length) { body.innerHTML = `<div class="search-hint">No comments yet. Be the first.</div>`; return; }
    body.innerHTML = "";
    for (const c of data) {
      const author = profileCache.get(c.user_id);
      const row = document.createElement("div");
      row.className = "app-comment";
      const av = document.createElement("a");
      av.className = "avatar";
      av.href = author ? `profile.html?u=${encodeURIComponent(author.username)}` : "#";
      setAvatarContent(av, author);
      row.appendChild(av);
      const text = document.createElement("div");
      text.innerHTML = `<b>${escapeHTML(author?.display_name || "Unknown")}</b> <span class="app-comment-time">${timeAgo(c.created_at)}</span><div>${escapeHTML(c.content)}</div>`;
      row.appendChild(text);
      body.appendChild(row);
    }
    body.scrollTop = body.scrollHeight;
  }

  sendBtn.onclick = async () => {
    const content = input.value.trim();
    if (!content) return;
    sendBtn.disabled = true;
    const { error } = await sb.from(table).insert({ [column]: id, user_id: myId, content });
    sendBtn.disabled = false;
    if (error) { toast(error.message || "Could not post comment."); return; }
    input.value = "";
    if (onAdded) onAdded();
    await load();
  };
  input.onkeydown = (e) => { if (e.key === "Enter") sendBtn.onclick(); };

  await load();
}
