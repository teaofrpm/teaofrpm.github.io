/* Notifications: on Home only the bell badge; the list itself lives on its own
   page (notifications.html) with filters and Today / This week / Earlier groups. */
const Notifs = (() => {
  let me = null;
  let items = [];
  let filter = "all";
  let pageMode = false;

  const TEXT = {
    follow_request: "requested to follow you",
    follow: "started following you",
    follow_accepted: "accepted your follow request",
    like: "liked your post",
    comment: "commented on your post",
    reel_like: "liked your reel",
    reel_comment: "commented on your reel",
    tag: "tagged you in a post",
    reshare: "shared your post",
    missed_call: "tried to call you",
  };
  const KIND = {
    follows: ["follow_request", "follow", "follow_accepted"],
    likes: ["like", "reel_like"],
    comments: ["comment", "reel_comment", "tag", "reshare"],
  };

  // A notification points at the thing it is about, not at a generic tab.
  function linkFor(n, actor) {
    if (n.type === "reel_like" || n.type === "reel_comment") return n.reel_id ? `reels.html?r=${n.reel_id}` : "reels.html";
    if (["like", "comment", "tag", "reshare"].includes(n.type)) return n.post_id ? `profile.html?post=${n.post_id}` : "profile.html";
    if (n.type === "follow_request") return "profile.html?panel=requests";
    if (n.type === "missed_call") return "messages.html";
    return actor ? `profile.html?u=${encodeURIComponent(actor.username)}` : "#";
  }

  function paintBadge() {
    const unread = items.filter((n) => !n.read).length;
    const badge = document.getElementById("notifBadge");
    if (badge) {
      badge.textContent = unread > 9 ? "9+" : String(unread);
      badge.style.display = unread ? "flex" : "none";
    }
  }

  function rowFor(n) {
    const actors = n.actors || [];
    const actor = actors[0] || null;
    const row = document.createElement("a");
    row.className = `notif-row ${n.read ? "" : "unread"}`;
    row.href = linkFor(n, actor);
    row.dataset.id = n.id || "";
    const av = document.createElement("span");
    av.className = "avatar notif-av";
    setAvatarContent(av, actor);
    row.appendChild(av);
    const names = actors.slice(0, 2).map((a) => `<b>${escapeHTML(a.display_name || a.username)}</b>`);
    const others = (n.actor_count || actors.length) - names.length;
    let who = names.length ? names.join(names.length === 2 && others <= 0 ? " and " : ", ") : "<b>Someone</b>";
    if (others > 0) who += ` and ${others} other${others > 1 ? "s" : ""}`;
    const info = document.createElement("div");
    info.className = "notif-text";
    info.innerHTML = `${who} ${TEXT[n.type] || "sent an update"} <span class="notif-time">${timeAgo(n.created_at)}</span>`;
    row.appendChild(info);
    if (n.thumb) {
      const img = document.createElement("img");
      img.className = "notif-thumb"; img.loading = "lazy"; img.alt = ""; img.src = n.thumb;
      row.appendChild(img);
    } else if (n.type === "follow_request") {
      const b = document.createElement("span");
      b.className = "notif-cta"; b.textContent = "Review";
      row.appendChild(b);
    }
    return row;
  }

  function render() {
    paintBadge();
    const list = document.getElementById("notifResults");
    if (!list) return;
    const shown = filter === "all" ? items : items.filter((n) => (KIND[filter] || []).includes(n.type));
    if (!shown.length) {
      list.innerHTML = `<div class="notif-empty">${svgIcon("bell", 34)}<b>${items.length ? "Nothing here" : "No notifications yet"}</b><span>Likes, comments and follows show up here.</span></div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    const now = Date.now();
    let last = "";
    for (const n of shown) {
      const age = now - new Date(n.created_at).getTime();
      const grp = !pageMode ? "" : age < 864e5 ? "Today" : age < 7 * 864e5 ? "This week" : age < 30 * 864e5 ? "This month" : "Earlier";
      if (grp && grp !== last) {
        const h = document.createElement("div");
        h.className = "notif-group";
        h.textContent = grp;
        frag.appendChild(h);
        last = grp;
      }
      frag.appendChild(rowFor(n));
    }
    list.replaceChildren(frag);
  }

  // grouped + actor profiles + post thumbnail, built by the database in one request
  async function load() {
    const { data, error } = await sb.rpc("my_notifications", { p_limit: pageMode ? 100 : 40 });
    if (error) { console.error(error); return; }
    items = data || [];
    items.forEach((n) => (n.actors || []).forEach(rememberProfile));
    render();
  }

  async function markAllRead() {
    if (!items.some((n) => !n.read)) return;
    await sb.from("notifications").update({ read: true }).eq("user_id", me.id).eq("read", false);
    items.forEach((n) => { n.read = true; });
    paintBadge();
  }

  function subscribe() {
    sb.channel(`notifications:${me.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${me.id}` },
        async ({ new: n }) => {
          const actor = n.actor_id ? await getProfile(n.actor_id) : null;
          items.unshift({ ...n, actors: actor ? [actor] : [], actor_count: actor ? 1 : 0 });
          render();
          if (pageMode && !document.hidden) setTimeout(markAllRead, 1500);
        })
      .subscribe();
  }

  function wire() {
    // Home: the bell opens the notifications page (the old drop-down panel is gone)
    const toggle = document.getElementById("notifToggle");
    if (toggle && !pageMode) toggle.addEventListener("click", (e) => { e.stopPropagation(); location.href = "notifications.html"; });
    const chips = document.getElementById("notifFilters");
    chips?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-f]"); if (!b) return;
      filter = b.dataset.f;
      chips.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b));
      render();
    });
  }

  async function init(myProfile, opts = {}) {
    me = myProfile;
    pageMode = !!opts.page;
    wire();
    await load();
    subscribe();
    // on the page, they count as seen once you've had a moment to look (unread dots stay visible)
    if (pageMode) setTimeout(markAllRead, 1200);
  }

  return { init };
})();
