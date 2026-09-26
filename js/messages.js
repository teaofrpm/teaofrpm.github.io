let ME = null;
let allPeople = [];            // every verified member, loaded once and reused
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
  wireNewChat();

  Skeleton.show("rows", "threadList", 6);
  await loadInbox();
  subscribeInbox();

}

async function loadInbox() {
  const { data, error } = await sb.rpc("my_conversations");
  const list = document.getElementById("threadList");

  if (error || !data) { list.innerHTML = `<div class="inbox-empty">Could not load your chats.</div>`; return; }
  if (!data.length) {
    list.innerHTML = `<div class="inbox-empty">No chats yet.<br>Open someone's profile and tap Message, or create a group.</div>`;
    return;
  }

  await getProfiles(data.map(c => c.other_user_id));

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

/* ---------- New chat: DM anyone, or make a group ---------- */

// Loaded once per page visit and shared by both pickers.
async function loadAllPeople() {
  if (allPeople.length) return allPeople;
  const { data, error } = await sb.from("profiles")
    .select("id,username,display_name,pfp_url,is_private")
    .eq("is_verified", true)
    .neq("id", ME.id)
    .order("display_name", { ascending: true })
    .limit(500);
  if (error) { toast("Could not load people."); return []; }
  (data || []).forEach(p => profileCache.set(p.id, p));
  allPeople = data || [];
  return allPeople;
}

function matchPeople(people, filterText) {
  if (!filterText) return people;
  const q = filterText.toLowerCase();
  return people.filter(p =>
    (p.display_name || "").toLowerCase().includes(q) ||
    (p.username || "").toLowerCase().includes(q));
}

function wireNewChat() {
  const menu = document.getElementById("newChatMenu");
  const btn = document.getElementById("newChatBtn");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("show");
  });
  document.addEventListener("click", () => menu.classList.remove("show"));

  menu.addEventListener("click", (e) => {
    const choice = e.target.closest("[data-new]");
    if (!choice) return;
    menu.classList.remove("show");
    if (choice.dataset.new === "dm") openDmPicker();
    else openGroupSheet();
  });

  document.getElementById("newDmSheet").addEventListener("click", (e) => {
    if (e.target.id === "newDmSheet") AppNav.exitFullscreen();
  });
  document.getElementById("newGroupSheet").addEventListener("click", (e) => {
    if (e.target.id === "newGroupSheet") AppNav.exitFullscreen();
  });

  document.getElementById("dmPeopleSearch").addEventListener("input", (e) => {
    renderDmPeople(e.target.value.trim());
  });
  document.getElementById("groupMemberSearch").addEventListener("input", (e) => {
    renderGroupMembers(e.target.value.trim());
  });
  document.getElementById("createGroupBtn").addEventListener("click", createGroup);
}

/* ---- Direct message: anyone on the app, followed or not ---- */

async function openDmPicker() {
  const sheet = document.getElementById("newDmSheet");
  document.getElementById("dmPeopleSearch").value = "";
  Skeleton.show("rows", "dmPeopleList", 5);
  sheet.classList.add("show");
  AppNav.enterFullscreen(() => sheet.classList.remove("show"));

  await loadAllPeople();
  renderDmPeople("");
}

function renderDmPeople(filterText) {
  const list = document.getElementById("dmPeopleList");
  const people = matchPeople(allPeople, filterText);

  if (!people.length) {
    list.innerHTML = `<div class="settings-empty">No one found.</div>`;
    return;
  }

  list.innerHTML = "";
  for (const p of people) {
    const row = document.createElement("button");
    row.className = "settings-list-row people-pick-row";

    const av = document.createElement("span");
    av.className = "avatar";
    setAvatarContent(av, p);
    row.appendChild(av);

    const name = document.createElement("div");
    name.className = "settings-list-name";
    name.innerHTML = `${escapeHTML(p.display_name)}<span class="settings-list-sub">@${escapeHTML(p.username)}</span>`;
    row.appendChild(name);

    row.addEventListener("click", () => startDm(p, row));
    list.appendChild(row);
  }
}

async function startDm(person, row) {
  row.disabled = true;
  row.classList.add("busy");

  // The RPC is the only thing allowed to create a DM: it reuses an existing
  // thread if there is one and refuses if either side has blocked the other.
  const { data, error } = await sb.rpc("get_or_create_dm", { other_user: person.id });

  if (error) {
    row.disabled = false;
    row.classList.remove("busy");
    toast(error.message || "Could not open that chat.");
    return;
  }
  window.location.href = `room.html?c=${data}`;
}

/* ---- Group ---- */

async function openGroupSheet() {
  const sheet = document.getElementById("newGroupSheet");
  selectedMembers.clear();
  document.getElementById("groupNameInput").value = "";
  document.getElementById("groupMemberSearch").value = "";
  document.getElementById("groupError").textContent = "";
  Skeleton.show("rows", "groupMemberList", 5);
  sheet.classList.add("show");
  AppNav.enterFullscreen(() => sheet.classList.remove("show"));

  await loadAllPeople();
  renderGroupMembers("");
}

function renderGroupMembers(filterText = "") {
  const list = document.getElementById("groupMemberList");
  const people = matchPeople(allPeople, filterText);

  if (!people.length) {
    list.innerHTML = `<div class="settings-empty">No one found.</div>`;
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
      const on = selectedMembers.has(p.id);
      if (on) selectedMembers.delete(p.id); else selectedMembers.add(p.id);
      row.classList.toggle("selected", !on);
      check.innerHTML = on ? "" : svgIcon("check", 13);
      updateGroupCount();
    });

    list.appendChild(row);
  }
  updateGroupCount();
}

function updateGroupCount() {
  const btn = document.getElementById("createGroupBtn");
  btn.textContent = selectedMembers.size
    ? `Create group · ${selectedMembers.size} selected`
    : "Create group";
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

init();
