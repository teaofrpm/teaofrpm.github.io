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

  function linkFor(n, actor) {
    if (["follow_request", "like", "comment", "tag", "reshare"].includes(n.type)) return "profile.html";
    if (n.type === "reel_like" || n.type === "reel_comment") return "reels.html";
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
    for (const n of items) {
      const actor = n.actor_id ? profileCache.get(n.actor_id) : null;
      const row = document.createElement("a");
      row.className = `notif-row ${n.read ? "" : "unread"}`;
      row.href = linkFor(n, actor);

      const av = document.createElement("span");
      av.className = "avatar";
      av.style.width = "32px"; av.style.height = "32px"; av.style.fontSize = "11px";
      setAvatarContent(av, actor);
      row.appendChild(av);

      const info = document.createElement("div");
      info.innerHTML = `<b>${escapeHTML(actor?.display_name || "Someone")}</b> ${TEXT[n.type] || "sent an update"}<div class="notif-time">${timeAgo(n.created_at)}</div>`;
      row.appendChild(info);
      list.appendChild(row);
    }
  }

  async function load() {
    const { data, error } = await sb.from("notifications").select("*")
      .eq("user_id", me.id).order("created_at", { ascending: false }).limit(40);
    if (error) { console.error(error); return; }
    items = data || [];
    await Promise.all([...new Set(items.map(n => n.actor_id).filter(Boolean))].map(getProfile));
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
          if (n.actor_id) await getProfile(n.actor_id);
          items.unshift(n);
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
