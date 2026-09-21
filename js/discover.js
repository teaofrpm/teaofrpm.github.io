let ME = null;
let searchDebounceTimer = null;

async function init() {
  const session = await requireSession("index.html");
  if (!session) return;

  ME = await getMyProfile();
  if (!ME) return;

  applyIconAttributes();

  if (ME.banned) {
    toast("This account has been banned.");
    await sb.auth.signOut();
    window.location.href = "index.html";
    return;
  }
  if (!ME.is_verified) {
    window.location.href = "verify.html";
    return;
  }

  wireSearch();
  await loadDefaultPeople();

  document.getElementById("loadingOverlay").classList.add("hide");
}

function wireSearch() {
  const input = document.getElementById("discoverInput");
  input.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    const term = input.value.trim();
    if (!term) {
      document.getElementById("discoverLabel").textContent = "People";
      loadDefaultPeople();
      return;
    }
    searchDebounceTimer = setTimeout(() => runSearch(term), 300);
  });
}

async function loadDefaultPeople() {
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .eq("is_verified", true)
    .neq("id", ME.id)
    .order("display_name", { ascending: true })
    .limit(50);

  renderPeople(data || [], error);
}

async function runSearch(term) {
  document.getElementById("discoverLabel").textContent = `Results for "${term}"`;
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .eq("is_verified", true)
    .neq("id", ME.id)
    .or(`display_name.ilike.%${term}%,username.ilike.%${term}%`)
    .limit(50);

  renderPeople(data || [], error);
}

function renderPeople(people, error) {
  const list = document.getElementById("discoverList");
  if (error) {
    list.innerHTML = `<div class="search-hint">Could not load people.</div>`;
    return;
  }
  if (!people.length) {
    list.innerHTML = `<div class="search-hint">No one found.</div>`;
    return;
  }

  list.innerHTML = "";
  for (const p of people) {
    const row = document.createElement("a");
    row.className = "follow-list-row discover-row";
    row.href = `profile.html?u=${encodeURIComponent(p.username)}`;

    const av = document.createElement("span");
    av.className = "avatar";
    av.style.width = "40px"; av.style.height = "40px"; av.style.fontSize = "14px";
    if (p.pfp_url) { av.style.backgroundImage = `url("${p.pfp_url}")`; av.style.backgroundSize = "cover"; }
    else { av.style.background = colorFromName(p.display_name); av.textContent = initials(p.display_name); }
    row.appendChild(av);

    const info = document.createElement("div");
    info.innerHTML = `
      <div class="follow-list-name">${escapeHTML(p.display_name)}${p.is_private ? ` ${svgIcon("lock", 11)}` : ""}</div>
      <div class="follow-list-username">@${escapeHTML(p.username)}</div>
    `;
    row.appendChild(info);

    list.appendChild(row);
  }
}

setTimeout(() => {
  document.getElementById("loadingOverlay")?.classList.add("hide");
}, 8000);

init();
