
let ME = null;
let followingPeople = [];
const selectedMembers = new Set();

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
  wireNewGroup();

  await loadInbox();
  subscribeInbox();

  document.getElementById("loadingOverlay").classList.add("hide");
}

async function loadInbox() {
  const { data, error } = await sb.rpc("my_conversations");
  const list = document.getElementById("threadList");

  if (error) { list.innerHTML = `<div class="inbox-empty">Could not load your chats.</div>`; return; }
  if (!data.length) {
    list.innerHTML = `<div class="inbox-empty">No chats yet.<br>Open someone's profile and tap Message, or create a group.</div>`;
    return;
  }

  await Promise.all(data.filter(c => c.other_user_id).map(c => getProfile(c.other_user_id)));

  list.innerHTML = "";
  for (const convo of data) {
    const other = convo.other_user_id ? profileCache.get(convo.other_user_id) : null;
    const title = convo.kind === "dm" ? (other?.display_name || "Unknown") : (convo.name || "Group");

    const row = document.createElement("a");
    row.className = `thread-row ${convo.unread > 0 ? "has-unread" : ""}`;
    row.href = `room.html?c=${convo.id}`;

    const av = document.createElement("span");
    av.className = "avatar thread-avatar";
    if (convo.kind === "group") {
      if (convo.pfp_url) {
        av.style.backgroundImage = `url("${convo.pfp_url}")`;
        av.style.backgroundSize = "cover";
        av.style.backgroundPosition = "center";
      } else {
        av.style.background = colorFromName(title);
        av.textContent = initials(title);
      }
    } else {
      setAvatarContent(av, other);
    }
    row.appendChild(av);

    const text = document.createElement("div");
    text.className = "thread-text";
    text.innerHTML = `<b>${escapeHTML(title)}</b><span>${escapeHTML(convo.last_message || "No messages yet")}</span>`;
    row.appendChild(text);

    const meta = document.createElement("div");
    meta.className = "thread-meta";
    meta.innerHTML = `${convo.last_at ? `<span class="thread-time">${timeAgo(convo.last_at)}</span>` : ""}
                      ${convo.unread > 0 ? `<span class="thread-unread">${convo.unread > 9 ? "9+" : convo.unread}</span>` : ""}`;
    row.appendChild(meta);

    list.appendChild(row);
  }
}

function subscribeInbox() {
  sb.channel("inbox:messages")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
      if (payload.new.conversation_id) loadInbox();
    })
    .subscribe();
}

/* ---------- New group ---------- */

function wireNewGroup() {
  const sheet = document.getElementById("newGroupSheet");

  document.getElementById("newGroupBtn").addEventListener("click", async () => {
    selectedMembers.clear();
    document.getElementById("groupNameInput").value = "";
    document.getElementById("groupError").textContent = "";
    sheet.classList.add("show");
    AppNav.enterFullscreen(() => sheet.classList.remove("show"));
    await loadFollowingForGroup();
  });

  sheet.addEventListener("click", (e) => { if (e.target === sheet) AppNav.exitFullscreen(); });

  document.getElementById("groupMemberSearch").addEventListener("input", (e) => {
    renderGroupMembers(e.target.value.trim().toLowerCase());
  });

  document.getElementById("createGroupBtn").addEventListener("click", createGroup);
}

async function loadFollowingForGroup() {
  const { data } = await sb.from("follows").select("following_id")
    .eq("follower_id", ME.id).eq("status", "accepted");
  const ids = (data || []).map(f => f.following_id);
  if (ids.length) await Promise.all(ids.map(getProfile));
  followingPeople = ids.map(id => profileCache.get(id)).filter(Boolean);
  renderGroupMembers();
}

function renderGroupMembers(filterText = "") {
  const list = document.getElementById("groupMemberList");
  const people = filterText
    ? followingPeople.filter(p => p.display_name.toLowerCase().includes(filterText) || p.username.toLowerCase().includes(filterText))
    : followingPeople;

  if (!people.length) {
    list.innerHTML = `<div class="settings-empty">Follow people first to add them to a group.</div>`;
    return;
  }

  list.innerHTML = "";
  for (const p of people) {
    const row = document.createElement("div");
    row.className = `settings-list-row group-member-row ${selectedMembers.has(p.id) ? "selected" : ""}`;

    const av = document.createElement("span");
    av.className = "avatar";
    setAvatarContent(av, p);
    row.appendChild(av);

    const name = document.createElement("div");
    name.className = "settings-list-name";
    name.innerHTML = `${escapeHTML(p.display_name)}<span class="settings-list-sub">@${escapeHTML(p.username)}</span>`;
    row.appendChild(name);

    const check = document.createElement("span");
    check.className = "group-member-check";
    check.innerHTML = selectedMembers.has(p.id) ? svgIcon("check", 13) : "";
    row.appendChild(check);

    row.addEventListener("click", () => {
      if (selectedMembers.has(p.id)) {
        selectedMembers.delete(p.id);
        row.classList.remove("selected");
        check.innerHTML = "";
      } else {
        selectedMembers.add(p.id);
        row.classList.add("selected");
        check.innerHTML = svgIcon("check", 13);
      }
    });

    list.appendChild(row);
  }
}

async function createGroup() {
  const errEl = document.getElementById("groupError");
  const btn = document.getElementById("createGroupBtn");
  const name = document.getElementById("groupNameInput").value.trim();
  errEl.textContent = "";

  if (!name) { errEl.textContent = "Give the group a name."; return; }
  if (!selectedMembers.size) { errEl.textContent = "Pick at least one person."; return; }

  btn.disabled = true;
  btn.textContent = "Creating…";

  const { data, error } = await sb.rpc("create_group", { p_name: name, p_members: [...selectedMembers] });

  btn.disabled = false;
  btn.textContent = "Create group";

  if (error) { errEl.textContent = error.message || "Could not create group."; return; }
  window.location.href = `room.html?c=${data}`;
}

setTimeout(() => document.getElementById("loadingOverlay")?.classList.add("hide"), 8000);

init();
