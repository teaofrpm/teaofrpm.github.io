/* ============================================================
   teaofrpm service worker.

   Design rule, because stale files have bitten this app before:
   WHEN ONLINE, YOUR OWN FILES ALWAYS COME FROM THE NETWORK.
   The cache is only a fallback for when the network fails, so an update
   pushed to GitHub is never hidden behind an old cached copy.

   - Your pages, JS, CSS  → network first; cached copy only if offline
   - Version-pinned libraries and font files → cache first (they never change)
   - Supabase (database, realtime, storage) → never touched, always live

   Emergency off-switch: if this ever misbehaves, replace this whole file
   with just `self.registration.unregister();` and push. Every phone drops
   the worker on its next visit.
   ============================================================ */

const VERSION = "v1";
const PAGES = `teaofrpm-pages-${VERSION}`;
const LIBS = `teaofrpm-libs-${VERSION}`;
const MAX_PAGE_ENTRIES = 80;

// Only URLs that can never change may be served straight from cache.
const IMMUTABLE = [
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@\d+\.\d+\.\d+\//,  // pinned exact version
  /^https:\/\/fonts\.gstatic\.com\//,                                           // font files are content-addressed
];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([PAGES, LIBS]);
    for (const name of await caches.keys()) {
      if (!keep.has(name)) await caches.delete(name);   // drop caches from older versions
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                       // writes go straight to the network
  const url = new URL(req.url);

  if (url.hostname.endsWith(".supabase.co")) return;       // live data is never cached here
  if (req.headers.has("range")) return;                   // audio/video byte ranges: leave to the browser

  if (IMMUTABLE.some((re) => re.test(req.url))) {
    event.respondWith(cacheFirst(req));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(LIBS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok) {
      cache.put(req, res.clone()).then(() => trim(cache));
    }
    return res;
  } catch (err) {
    // offline: the exact file if we have it, then (for a page) any cached page
    const hit = await cache.match(req, { ignoreSearch: false }) || await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") {
      const fallback = await cache.match("messages.html") || await cache.match("home.html");
      if (fallback) return fallback;
      return new Response(
        `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
         <title>Offline — teaofrpm</title>
         <body style="font-family:system-ui;background:#141110;color:#eee;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
         <div><h2>You're offline</h2><p>Reconnect and this page will load.</p>
         <button onclick="location.reload()" style="padding:10px 18px;border-radius:999px;border:0;background:#d8a53d;font-weight:700">Try again</button></div>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }
    throw err;
  }
}

// Keep the fallback cache from growing without limit as versions change.
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_PAGE_ENTRIES; i++) await cache.delete(keys[i]);
}
