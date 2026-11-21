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

let newsToken = 0;
let searchToken = 0;

async function init() {
  Skeleton.show("rows", "newsList", 5);
  ME = await App.boot();
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

  const tag = new URLSearchParams(location.search).get("tag");
  if (tag) { await showTagPage(tag); loadCategory("top"); return; }
  await Promise.all([loadCategory("top"), loadSuggestions(), loadTrending(), loadExplore()]);
}

/* ---------- Trending hashtags + Explore grid (ranked by the database) ---------- */

async function loadTrending() {
  const row = document.getElementById("trendRow");
  const { data } = await sb.rpc("trending_hashtags", { p_limit: 12 });
  if (!data?.length) { row.hidden = true; return; }
  row.innerHTML = `<span class="trend-title">${svgIcon("flame", 14)} Trending</span>` + data.map((t) =>
    `<a class="trend-chip" href="discover.html?tag=${encodeURIComponent(t.tag)}">#${escapeHTML(t.tag)}<small>${t.people > 1 ? `${t.people} people` : `${t.uses} post${t.uses > 1 ? "s" : ""}`}</small></a>`).join("");
}

const explore = { shown: [], loading: false };
async function loadExplore() {
  if (explore.loading) return;
  explore.loading = true;
  const grid = document.getElementById("exploreGrid");
  const more = document.getElementById("exploreMore");
  if (!explore.shown.length) grid.innerHTML = Array.from({ length: 9 }, () => `<div class="ig-tile ig-skel"></div>`).join("");
  const { data, error } = await sb.rpc("explore_posts", { p_exclude: explore.shown, p_limit: 18 });
  explore.loading = false;
  if (!explore.shown.length) grid.innerHTML = "";
  if (error || !data?.length) {
    if (!explore.shown.length) { document.querySelector(".explore-label").hidden = true; grid.hidden = true; }
    more.hidden = true;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const r of data) {
    explore.shown.push(r.post.id);
    rememberProfile(r.author);
    frag.appendChild(exploreTile(r));
  }
  grid.appendChild(frag);
  more.hidden = data.length < 18;
  if (!more.dataset.wired) { more.dataset.wired = "1"; more.addEventListener("click", loadExplore); }
}

function exploreTile(r) {
  const p = r.post;
  const a = document.createElement("a");
  a.className = "ig-tile";
  a.href = `profile.html?u=${encodeURIComponent(r.author?.username || "")}&post=${p.id}`;
  a.innerHTML = (p.image_url
    ? `<img src="${escapeHTML(p.image_url)}" alt="" loading="lazy" decoding="async" />`
    : `<div class="ig-tile-text">${escapeHTML((p.content || "").slice(0, 160))}</div>`)
    + `<span class="ig-tile-stats">${r.like_count == null ? "" : `${svgIcon("heart", 13)} ${r.like_count}<i></i>`}${svgIcon("comment", 13)} ${r.comment_count || 0}</span>`;
  return a;
}

// discover.html?tag=xyz — every post and reel with that hashtag
async function showTagPage(tag) {
  tag = tag.replace(/^#/, "").toLowerCase();
  document.title = `#${tag} — 𝓉𝑒𝒶𝑜𝒻𝓇𝓅𝓂`;
  ["exploreWrap", "newsTabs", "newsList", "discoverLabel"].forEach((id) => { document.getElementById(id).hidden = true; });
  document.querySelector(".discover-search-box").hidden = true;
  document.querySelector(".profile-topbar h2").textContent = `#${tag}`;
  const page = document.getElementById("tagPage");
  page.hidden = false;
  page.innerHTML = `<div class="tag-head"><div class="tag-badge">#</div><div><b>#${escapeHTML(tag)}</b><span id="tagCounts">…</span></div></div>
    <div class="profile-tabs ig-tabs tag-tabs"><button type="button" class="active" data-t="posts" data-icon="grid" data-icon-size="20" aria-label="Posts"></button><button type="button" data-t="reels" data-icon="reel" data-icon-size="20" aria-label="Reels"></button></div>
    <div class="ig-grid" id="tagPosts"></div><div class="ig-grid reels-grid" id="tagReels" hidden></div>`;
  applyIconAttributes(page);
  const postsEl = page.querySelector("#tagPosts"), reelsEl = page.querySelector("#tagReels");
  postsEl.innerHTML = Array.from({ length: 9 }, () => `<div class="ig-tile ig-skel"></div>`).join("");

  const [sum, posts, uses] = await Promise.all([
    sb.rpc("hashtag_summary", { p_tag: tag }),
    sb.rpc("hashtag_posts", { p_tag: tag, p_limit: 90 }),
    sb.from("hashtag_uses").select("reel_id").eq("tag", tag).not("reel_id", "is", null).order("created_at", { ascending: false }).limit(60),
  ]);
  const s = sum.data || {};
  page.querySelector("#tagCounts").textContent = `${s.posts || 0} posts · ${s.reels || 0} reels · ${s.people || 0} people`;
  postsEl.innerHTML = "";
  (posts.data || []).forEach((r) => { rememberProfile(r.author); postsEl.appendChild(exploreTile(r)); });
  if (!postsEl.children.length) postsEl.innerHTML = `<div class="ig-empty">${svgIcon("grid", 32)}<div>No posts with #${escapeHTML(tag)} yet.<br><small>Use it in a post and you'll be the first.</small></div></div>`;

  let reelsLoaded = false;
  page.querySelectorAll(".tag-tabs button").forEach((b) => b.addEventListener("click", async () => {
    page.querySelectorAll(".tag-tabs button").forEach((x) => x.classList.toggle("active", x === b));
    const reels = b.dataset.t === "reels";
    postsEl.hidden = reels; reelsEl.hidden = !reels;
    if (!reels || reelsLoaded) return;
    reelsLoaded = true;
    const ids = (uses.data || []).map((u) => u.reel_id);
    const { data } = ids.length ? await sb.rpc("reel_cards", { p_ids: ids }) : { data: [] };
    reelsEl.innerHTML = "";
    for (const r of data || []) {
      const t = document.createElement("a");
      t.className = "ig-tile ig-reel-tile";
      t.href = `reels.html?r=${r.reel.id}`;
      t.innerHTML = (r.reel.yt_id ? `<img src="https://i.ytimg.com/vi/${r.reel.yt_id}/hqdefault.jpg" alt="" loading="lazy" />`
        : `<video src="${escapeHTML(r.reel.video_url)}#t=0.5" muted playsinline preload="metadata"></video>`)
        + `<span class="ig-tile-kind">${svgIcon(r.reel.yt_id ? "youtube" : "reel", 15)}</span><span class="ig-tile-stats">${svgIcon("play", 12)} ${r.views || 0}</span>`;
      reelsEl.appendChild(t);
    }
    if (!reelsEl.children.length) reelsEl.innerHTML = `<div class="ig-empty">${svgIcon("reel", 32)}<div>No reels with #${escapeHTML(tag)} yet.</div></div>`;
  }));
}

/* ---------- People you may know ---------- */

async function loadSuggestions() {
  // Ranked by the database: people who follow you, mutual friends, shared
  // groups, then popular/new accounts — each with the real reason why.
  const { data, error } = await sb.rpc("suggest_people", { p_limit: 12 });
  if (error || !data?.length) return;
  document.getElementById("suggestWrap")?.remove();

  const wrap = document.createElement("div");
  wrap.className = "suggest-wrap";
  wrap.id = "suggestWrap";
  wrap.innerHTML = `<div class="discover-section-label">People you may know</div><div class="suggest-row"></div>`;
  const row = wrap.querySelector(".suggest-row");
  for (const s of data) {
    const p = s.profile;
    rememberProfile(p);
    const card = document.createElement("div");
    card.className = "suggest-card";
    card.innerHTML = `<a href="profile.html?u=${encodeURIComponent(p.username)}" class="suggest-link"><span class="avatar"></span><b>${escapeHTML(p.display_name)}</b><small>@${escapeHTML(p.username)}</small><em class="suggest-reason">${escapeHTML(s.reason || "")}</em></a><button type="button" class="follow-btn">${s.follows_me ? "Follow back" : p.is_private ? "Request" : "Follow"}</button>`;
    setAvatarContent(card.querySelector(".avatar"), p);
    const btn = card.querySelector("button");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const { error } = await sb.from("follows").insert({ follower_id: ME.id, following_id: p.id });
      if (error) { btn.disabled = false; toast(friendlyError(error, "Could not follow.")); return; }
      btn.textContent = p.is_private ? "Requested" : "Following";
      btn.classList.add("following");
      buzz(10);
    });
    row.appendChild(card);
  }
  const scroll = document.getElementById("discoverScroll");
  scroll.insertBefore(wrap, scroll.firstChild);
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

  const token = ++newsToken;
  news.loading = false;
  const rows = await fetchNews(token);
  if (token !== newsToken) return;           // another tab was picked meanwhile
  list.innerHTML = "";
  if (!rows.length) {
    list.innerHTML = `<div class="settings-empty">No stories here yet. They refresh every half hour.</div>`;
    return;
  }
  rows.forEach(item => list.appendChild(buildNewsCard(item)));
}

async function loadMoreNews() {
  if (news.loading || news.done || !news.cursor) return;
  const token = newsToken;
  const rows = await fetchNews(token);
  if (token !== newsToken) return;
  const list = document.getElementById("newsList");
  rows.forEach(item => list.appendChild(buildNewsCard(item)));
}

async function fetchNews(token) {
  news.loading = true;

  let query = sb.from("news_items")
    .select("id,title,summary,url,source,category,published_at")
    .eq("category", news.category)
    .order("published_at", { ascending: false })
    .limit(NEWS_PAGE);

  if (news.cursor) query = query.lt("published_at", news.cursor);

  const { data, error } = await query;
  if (token !== newsToken) return [];
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

/* ---------- Article reader ----------
   The stored links are Google News redirects, and news sites send
   X-Frame-Options / frame-ancestors headers that forbid being shown inside
   another page. No amount of frontend code defeats that — it is enforced by
   the browser. So the panel shows the headline properly and hands the reader
   to the publisher, which is also what keeps this fair to them. */

function wireReader() {
  document.getElementById("readerClose").addEventListener("click", () => AppNav.exitFullscreen());
}

function openReader(item) {
  const layer = document.getElementById("readerLayer");

  document.getElementById("readerTitle").textContent = item.source || "Article";
  document.getElementById("readerSource").textContent =
    `${item.source || "News"} · ${timeAgo(item.published_at)}`;
  document.getElementById("fallbackTitle").textContent = item.title;

  const summary = document.getElementById("readerSummary");
  summary.textContent = item.summary || "";
  summary.style.display = item.summary ? "block" : "none";

  document.getElementById("readerOpen").href = item.url;
  document.getElementById("fallbackOpen").href = item.url;

  layer.classList.add("show");
  AppNav.enterFullscreen(() => layer.classList.remove("show"));
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
  // "#something" + Enter opens that hashtag
  input.addEventListener("keydown", (e) => {
    const t = input.value.trim();
    if (e.key === "Enter" && /^#[\p{L}\p{N}_]{2,40}$/u.test(t)) location.href = `discover.html?tag=${encodeURIComponent(t.slice(1).toLowerCase())}`;
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
  searchToken++;
  const sw = document.getElementById("suggestWrap");
  if (sw) sw.hidden = false;
  document.getElementById("newsTabs").hidden = false;
  document.getElementById("newsList").hidden = false;
  document.getElementById("exploreWrap").hidden = false;
  document.getElementById("discoverList").hidden = true;
  const label = CATEGORIES.find(c => c.key === news.category)?.label || "News";
  document.getElementById("discoverLabel").textContent = news.category === "top" ? "Top stories" : `${label} news`;
}

async function runSearch(term) {
  searchMode = true;
  document.getElementById("newsTabs").hidden = true;
  document.getElementById("newsList").hidden = true;
  document.getElementById("exploreWrap").hidden = true;

  const list = document.getElementById("discoverList");
  list.hidden = false;
  document.getElementById("discoverLabel").textContent = `People matching "${term}"`;
  const sw = document.getElementById("suggestWrap");
  if (sw) sw.hidden = true;
  Skeleton.show("rows", list, 4);

  // Search the people list we already have — instant, and no risk of a
  // slow older request overwriting a newer one.
  const token = ++searchToken;
  if (term.startsWith("#")) {
    // hashtag search: matching tags straight from the database
    const q = term.slice(1).toLowerCase();
    document.getElementById("discoverLabel").textContent = `Hashtags matching "${term}"`;
    const { data } = await sb.from("hashtag_uses").select("tag").ilike("tag", `${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`).limit(200);
    if (token !== searchToken) return;
    const counts = new Map();
    (data || []).forEach((r) => counts.set(r.tag, (counts.get(r.tag) || 0) + 1));
    if (q.length >= 2 && !counts.has(q)) counts.set(q, 0);
    const tags = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 30);
    list.innerHTML = tags.length ? tags.map(([t, n]) => `<a class="follow-list-row discover-row" href="discover.html?tag=${encodeURIComponent(t)}"><span class="avatar tag-avatar">#</span><div><div class="follow-list-name">#${escapeHTML(t)}</div><div class="follow-list-username">${n ? `${n} post${n > 1 ? "s" : ""}` : "Be the first to use it"}</div></div></a>`).join("")
      : `<div class="settings-empty">Type a hashtag, like #annualday</div>`;
    return;
  }
  const q = term.toLowerCase();
  const people = (await loadAllPeople()).filter((p) => p.id !== ME.id &&
    ((p.display_name || "").toLowerCase().includes(q) || p.username.includes(q)));
  if (token !== searchToken) return;
  people.sort((a, b) => (b.username.startsWith(q) - a.username.startsWith(q)));
  renderPeople(people.slice(0, 50), null);
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
