/* ============================================================
   teaofrpm service worker — v21.

   DEPLOYING AN UPDATE: change ?v=29 → ?v=29 in every .html file AND in
   SHELL below, and bump VERSION. New pages then ask for new file names,
   so they can never be paired with an old cached CSS/JS.

   Speed rules:
   - Pages (HTML): network first, but give up after 2.5s and show the
     saved copy, so a weak signal never means a white screen. When online,
     a new version pushed to GitHub shows up on the next visit.
   - CSS / JS / images: served instantly from the cache and refreshed in
     the background (stale-while-revalidate). Every <script>/<link> carries
     ?v=N, and the pages always come fresh from the network, so a deploy
     that bumps N is picked up straight away.
   - Fonts and the pinned supabase-js build: cache first (they never change).
   - Supabase itself (database, realtime, storage): never touched.

   Emergency off-switch: replace this whole file with
   `self.registration.unregister();` and push.
   ============================================================ */

const VERSION = "v29";
const PAGES = `teaofrpm-pages-${VERSION}`;
const ASSETS = `teaofrpm-assets-${VERSION}`;
const LIBS = "teaofrpm-libs-v2";
const MAX_ENTRIES = 120;

const SHELL = [
  "home.html", "messages.html", "room.html", "profile.html", "reels.html", "discover.html", "settings.html",
  "css/app.css?v=29", "css/home.css?v=29", "css/messages.css?v=29", "css/chat-polish.css?v=29", "css/bot.css?v=29",
  "css/social-extras.css?v=29", "css/reels.css?v=29", "css/discover.css?v=29", "css/settings.css?v=29",
  "js/config.js?v=29", "js/core.js?v=29", "js/editor.js?v=29", "js/calls.js?v=29", "js/social.js?v=29", "js/notifications.js?v=29",
  "js/home.js?v=29", "js/messages.js?v=29", "js/room.js?v=29", "js/profile.js?v=29",
  "images/icon-192.png", "images/icon.svg", "images/bot.png",
];

const IMMUTABLE = [
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@\d+\.\d+\.\d+\//,
  /^https:\/\/fonts\.gstatic\.com\//,
  /^https:\/\/fonts\.googleapis\.com\//,
  /^https:\/\/i\.ytimg\.com\//,
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(ASSETS);
    // best effort: one missing file must not stop the worker installing.
    // cache:"reload" skips the browser's HTTP cache — otherwise a fresh deploy
    // could get the OLD file saved here and keep serving it.
    await Promise.all(SHELL.map((u) => cache.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([PAGES, ASSETS, LIBS]);
    for (const name of await caches.keys()) if (!keep.has(name)) await caches.delete(name);
    // pages are fetched by page() below with cache:"no-cache"; a navigation
    // preload would just download every page twice
    if (self.registration.navigationPreload) await self.registration.navigationPreload.disable().catch(() => {});
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith(".supabase.co")) return;
  if (req.headers.has("range")) return;
  if (url.searchParams.has("ping")) return;

  if (IMMUTABLE.some((re) => re.test(req.url))) { event.respondWith(cacheFirst(req, LIBS)); return; }
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" || req.destination === "document") { event.respondWith(page(event)); return; }
  if (url.pathname.endsWith("reel.txt")) return;
  event.respondWith(staleWhileRevalidate(event, req));
});

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone()).then(() => trim(cache));
    return res;
  }).catch(() => null);
  if (hit) { event.waitUntil(refresh); return hit; }
  const res = await refresh;
  return res || new Response("", { status: 504 });
}

async function page(event) {
  const req = event.request;
  const cache = await caches.open(PAGES);
  const network = (async () => {
    // "no-cache" = always ask the server (a tiny 304 when nothing changed),
    // never a stale copy from the HTTP cache after a deploy
    // (built from the original request so redirects stay the browser's job)
    const res = await fetch(new Request(req, { cache: "no-cache" }));
    if (res.ok) cache.put(stripSearch(req), res.clone()).then(() => trim(cache));
    return res;
  })();
  event.waitUntil(network.catch(() => {}));

  const saved = await cache.match(stripSearch(req));
  if (!saved) {
    try { return await network; } catch { return offlinePage(); }
  }
  // fresh if it arrives quickly, otherwise the saved copy right away
  const timeout = new Promise((r) => setTimeout(() => r(null), 2500));
  try {
    const res = await Promise.race([network, timeout]);
    return res || saved;
  } catch { return saved; }
}

// room.html?c=A and room.html?c=B are the same page shell
function stripSearch(req) {
  const u = new URL(req.url);
  u.search = "";
  u.hash = "";
  return u.href;
}

function offlinePage() {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Offline — teaofrpm</title>
     <body style="font-family:system-ui;background:#141110;color:#eee;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
     <div><h2>You're offline</h2><p>Reconnect and this page will load.</p>
     <button onclick="location.reload()" style="padding:10px 18px;border-radius:999px;border:0;background:#d8a53d;font-weight:700">Try again</button></div>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) await cache.delete(keys[i]);
}
