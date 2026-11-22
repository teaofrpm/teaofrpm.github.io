const Notifs = (() => {
  let me = null;
  let items = [];

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

  // A notification points at the thing it is about, not at a generic tab:
  // a like on your reel opens that reel, a like on your post opens that post.
  function linkFor(n, actor) {
    if (n.type === "reel_like" || n.type === "reel_comment") {
      return n.reel_id ? `reels.html?r=${n.reel_id}` : "reels.html";
    }
    if (["like", "comment", "tag", "reshare"].includes(n.type)) {
      return n.post_id ? `profile.html?post=${n.post_id}` : "profile.html";
    }
    if (n.type === "follow_request") return "profile.html?panel=requests";
    if (n.type === "missed_call") return "messages.html";
    return actor ? `profile.html?u=${encodeURIComponent(actor.username)}` : "#";
  }

  function render() {
    const unread = items.filter(n => !n.read).length;
    const badge = document.getElementById("notifBadge");
    badge.textContent = unread > 9 ? "9+" : String(unread);
    badge.style.display = unread ? "flex" : "none";

    const list = document.getElementById("notifResults");
    if (!items.length) { list.innerHTML = `<div class="search-hint">No notifications yet.</div>`; return; }
    list.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const n of items) {
      const actors = n.actors || [];
      const actor = actors[0] || null;
      const row = document.createElement("a");
      row.className = `notif-row ${n.read ? "" : "unread"}`;
      row.href = linkFor(n, actor);

      const av = document.createElement("span");
      av.className = "avatar";
      av.style.width = "32px"; av.style.height = "32px"; av.style.fontSize = "11px";
      setAvatarContent(av, actor);
      row.appendChild(av);

      // "Riya, Aman and 3 others liked your post"
      const names = actors.slice(0, 2).map((a) => `<b>${escapeHTML(a.display_name || a.username)}</b>`);
      const others = (n.actor_count || actors.length) - names.length;
      let who = names.length ? names.join(names.length === 2 && others <= 0 ? " and " : ", ") : "<b>Someone</b>";
      if (others > 0) who += ` and ${others} other${others > 1 ? "s" : ""}`;
      const info = document.createElement("div");
      info.className = "notif-text";
      info.innerHTML = `${who} ${TEXT[n.type] || "sent an update"}<div class="notif-time">${timeAgo(n.created_at)}</div>`;
      row.appendChild(info);

      if (n.thumb) {
        const img = document.createElement("img");
        img.className = "notif-thumb"; img.loading = "lazy"; img.alt = ""; img.src = n.thumb;
        row.appendChild(img);
      }
      frag.appendChild(row);
    }
    list.replaceChildren(frag);
  }

  // grouped + actor profiles + post thumbnail, built by the database in one request
  async function load() {
    const { data, error } = await sb.rpc("my_notifications", { p_limit: 40 });
    if (error) { console.error(error); return; }
    items = data || [];
    items.forEach((n) => (n.actors || []).forEach(rememberProfile));
    render();
  }

  async function markAllRead() {
    if (!items.some(n => !n.read)) return;
    items.forEach(n => { n.read = true; });
    render();
    await sb.from("notifications").update({ read: true }).eq("user_id", me.id).eq("read", false);
  }

  function subscribe() {
    sb.channel(`notifications:${me.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${me.id}` },
        async ({ new: n }) => {
          const actor = n.actor_id ? await getProfile(n.actor_id) : null;
          items.unshift({ ...n, actors: actor ? [actor] : [], actor_count: actor ? 1 : 0 });
          render();
        })
      .subscribe();
  }

  function wire() {
    const toggle = document.getElementById("notifToggle");
    const panel = document.getElementById("notifPanel");
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (panel.classList.toggle("show")) markAllRead();
    });
    document.addEventListener("click", (e) => {
      if (!panel.contains(e.target)) panel.classList.remove("show");
    });
  }

  async function init(myProfile) {
    me = myProfile;
    wire();
    await load();
    subscribe();
  }

  return { init };
})();
