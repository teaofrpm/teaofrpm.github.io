let ME = null;

const CATEGORIES = [
  { key: "top", label: "Top" },
  { key: "india", label: "India" },
  { key: "world", label: "World" },
  { key: "tech", label: "Tech" },
  { key: "business", label: "Business" },
  { key: "sports", label: "Sports" },
  { key: "entertainment", label: "Entertainment" },
  { key: "science", label: "Science" },
  { key: "health", label: "Health" },
];

const NEWS_PAGE = 20;
const news = { category: "top", cursor: null, done: false, loading: false };
let searchDebounceTimer = null;
let searchMode = false;
let moreObserver = null;

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

  renderTabs();
  wireSearch();
  wireReader();

  document.getElementById("refreshNewsBtn").addEventListener("click", () => {
    if (searchMode) return;
    loadCategory(news.category);
  });

  moreObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !searchMode) loadMoreNews();
  }, { root: document.getElementById("discoverScroll"), rootMargin: "300px" });
  moreObserver.observe(document.getElementById("newsSentinel"));

  await loadCategory("top");
}

/* ---------- Category tabs ---------- */

function renderTabs() {
  const tabs = document.getElementById("newsTabs");
  tabs.innerHTML = CATEGORIES
    .map(c => `<button class="news-tab ${c.key === news.category ? "active" : ""}" data-cat="${c.key}">${c.label}</button>`)
    .join("");

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".news-tab");
    if (!btn || btn.dataset.cat === news.category) return;
    tabs.querySelectorAll(".news-tab").forEach(b => b.classList.toggle("active", b === btn));
    btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    loadCategory(btn.dataset.cat);
  });
}

/* ---------- News ---------- */

async function loadCategory(category) {
  news.category = category;
  news.cursor = null;
  news.done = false;

  const label = CATEGORIES.find(c => c.key === category)?.label || "News";
  document.getElementById("discoverLabel").textContent = category === "top" ? "Top stories" : `${label} news`;

  const list = document.getElementById("newsList");
  Skeleton.show("rows", list, 5);
  document.getElementById("discoverScroll").scrollTop = 0;

  const rows = await fetchNews();
  list.innerHTML = "";
  if (!rows.length) {
    list.innerHTML = `<div class="settings-empty">No stories here yet. They refresh every half hour.</div>`;
    return;
  }
  rows.forEach(item => list.appendChild(buildNewsCard(item)));
}

async function loadMoreNews() {
  if (news.loading || news.done) return;
  const rows = await fetchNews();
  const list = document.getElementById("newsList");
  rows.forEach(item => list.appendChild(buildNewsCard(item)));
}

async function fetchNews() {
  news.loading = true;

  let query = sb.from("news_items")
    .select("id,title,summary,url,source,category,published_at")
    .eq("category", news.category)
    .order("published_at", { ascending: false })
    .limit(NEWS_PAGE);

  if (news.cursor) query = query.lt("published_at", news.cursor);

  const { data, error } = await query;
  news.loading = false;

  if (error) { console.error(error); news.done = true; return []; }
  if (!data.length) { news.done = true; return []; }

  news.cursor = data[data.length - 1].published_at;
  if (data.length < NEWS_PAGE) news.done = true;
  return data;
}

function buildNewsCard(item) {
  const card = document.createElement("button");
  card.className = "news-card";
  card.innerHTML = `
    <div class="news-card-body">
      <div class="news-card-title">${escapeHTML(item.title)}</div>
      ${item.summary ? `<div class="news-card-summary">${escapeHTML(item.summary)}</div>` : ""}
      <div class="news-card-meta">
        <span class="news-source">${escapeHTML(item.source || "News")}</span>
        <span class="news-dot">·</span>
        <span>${timeAgo(item.published_at)}</span>
      </div>
    </div>
    <span class="news-card-arrow">${svgIcon("chevron", 15)}</span>`;

  card.addEventListener("click", () => openReader(item));
  return card;
}

/* ---------- In-app reader ----------
   Most news sites send X-Frame-Options / frame-ancestors headers that forbid
   being embedded. There is no way around that from the browser, so we try the
   frame, and if nothing loads within a couple of seconds we show a card that
   opens the publisher's own page instead. */

function wireReader() {
  const layer = document.getElementById("readerLayer");
  document.getElementById("readerClose").addEventListener("click", () => AppNav.exitFullscreen());

  document.getElementById("readerFrame").addEventListener("load", () => {
    clearTimeout(layer._frameTimer);
    layer.classList.remove("blocked");
  });
}

function openReader(item) {
  const layer = document.getElementById("readerLayer");
  const frame = document.getElementById("readerFrame");

  document.getElementById("readerTitle").textContent = item.source || "Article";
  document.getElementById("fallbackTitle").textContent = item.title;
  document.getElementById("readerOpen").href = item.url;
  document.getElementById("fallbackOpen").href = item.url;

  layer.classList.add("blocked"); // assume blocked until the frame proves otherwise
  layer.classList.add("show");
  frame.src = item.url;

  clearTimeout(layer._frameTimer);
  layer._frameTimer = setTimeout(() => layer.classList.add("blocked"), 2500);

  AppNav.enterFullscreen(() => {
    layer.classList.remove("show");
    clearTimeout(layer._frameTimer);
    frame.src = "about:blank";
  });
}

/* ---------- People search ---------- */

function wireSearch() {
  const input = document.getElementById("discoverInput");
  const clearBtn = document.getElementById("discoverClear");

  input.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    const term = input.value.trim();
    clearBtn.classList.toggle("show", !!term);

    if (!term) { exitSearch(); return; }
    searchDebounceTimer = setTimeout(() => runSearch(term), 260);
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.classList.remove("show");
    exitSearch();
    input.focus();
  });
}

function exitSearch() {
  searchMode = false;
  document.getElementById("newsTabs").hidden = false;
  document.getElementById("newsList").hidden = false;
  document.getElementById("discoverList").hidden = true;
  const label = CATEGORIES.find(c => c.key === news.category)?.label || "News";
  document.getElementById("discoverLabel").textContent = news.category === "top" ? "Top stories" : `${label} news`;
}

async function runSearch(term) {
  searchMode = true;
  document.getElementById("newsTabs").hidden = true;
  document.getElementById("newsList").hidden = true;

  const list = document.getElementById("discoverList");
  list.hidden = false;
  document.getElementById("discoverLabel").textContent = `People matching "${term}"`;
  Skeleton.show("rows", list, 4);

  // % and _ are wildcards in ilike, so a literal search for them must escape
  const safe = term.replace(/[%_]/g, m => `\\${m}`);
  const { data, error } = await sb
    .from("profiles")
    .select("id,username,display_name,pfp_url,is_private")
    .eq("is_verified", true)
    .neq("id", ME.id)
    .or(`display_name.ilike.%${safe}%,username.ilike.%${safe}%`)
    .limit(50);

  renderPeople(data || [], error);
}

function renderPeople(people, error) {
  const list = document.getElementById("discoverList");
  if (error) { list.innerHTML = `<div class="settings-empty">Could not search right now.</div>`; return; }
  if (!people.length) { list.innerHTML = `<div class="settings-empty">No one found.</div>`; return; }

  list.innerHTML = "";
  for (const p of people) {
    const row = document.createElement("a");
    row.className = "follow-list-row discover-row";
    row.href = `profile.html?u=${encodeURIComponent(p.username)}`;

    const av = document.createElement("span");
    av.className = "avatar";
    av.style.width = "40px"; av.style.height = "40px"; av.style.fontSize = "14px";
    setAvatarContent(av, p);
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

init();
