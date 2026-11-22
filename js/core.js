/* ============================================================
   core.js — the one shared file every page loads (after config.js).

   It replaces supabase-client.js, auth.js, app-shell.js and the global
   half of the old extras*.js files. Page files (home.js, room.js …) only
   contain what is specific to that page.

   Speed rules this file follows:
   - Your own profile is cached on the device, so a page can render
     immediately instead of waiting for the network; it is refreshed in
     the background and the page reacts if anything important changed
     (banned / un-verified).
   - Other people's profiles are cached too (15 minutes), so names and
     photos appear instantly when moving between pages.
   - No MutationObservers, no polling loops: features are called directly
     by the code that renders things.
   ============================================================ */

/* ---------------- Supabase client ---------------- */

(function () {
  const cfg = window.TEAOFRPM_CONFIG;
  const nativeFetch = window.fetch.bind(window);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Reads (GET/HEAD) give up after 15s and retry once, which rescues most
  // dropped requests on patchy mobile data. Writes are never retried, so a
  // message can't be sent twice.
  async function resilientFetch(input, init = {}) {
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD") return nativeFetch(input, init);
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      if (init.signal) {
        if (init.signal.aborted) ctrl.abort();
        else init.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
      }
      try {
        const res = await nativeFetch(input, { ...init, signal: ctrl.signal });
        clearTimeout(timer);
        if (res.status >= 500 && attempt === 0) { await sleep(600); continue; }
        return res;
      } catch (err) {
        clearTimeout(timer);
        if (init.signal && init.signal.aborted) throw err;
        if (attempt === 1) throw err;
        await sleep(700);
      }
    }
  }

  window.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "teaofrpm-auth" },
    realtime: { params: { eventsPerSecond: 10 } },
    global: { fetch: resilientFetch },
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();

const PUBLIC_ROOM_ID = "11111111-1111-4111-8111-111111111111";
const PAGE = location.pathname.split("/").pop() || "index.html";

/* ---------------- Small helpers ---------------- */

const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
  raw(key) { try { return localStorage.getItem(key); } catch { return null; } },
  setRaw(key, v) { try { localStorage.setItem(key, v); } catch {} },
};

function toast(msg, ms = 2600) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), ms);
}

function escapeHTML(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function colorFromName(name) {
  const palette = ["#d8a53d", "#b52a3a", "#1fb6ad", "#c8863c", "#8f1e2b", "#3fa79d"];
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function initials(name) {
  if (!name || !name.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  return (Array.from(parts[0])[0] + (parts[1] ? Array.from(parts[1])[0] : "")).toUpperCase();
}

function timeAgo(ts) {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Database errors raised by triggers ("muted: …", "slowmode: …") → readable text.
function friendlyError(err, fallback = "Something went wrong.") {
  const raw = (err && err.message) || "";
  if (raw.startsWith("muted:")) return raw.replace(/^muted:\s*/, "");
  if (raw.startsWith("antilink:")) return "Links aren't allowed here right now.";
  if (raw.startsWith("slowmode:")) return "Slow mode is on — wait a few seconds.";
  if (raw.startsWith("rate_limited:")) return "Slow down a little.";
  if (/failed to fetch|network/i.test(raw)) return "No connection — try again.";
  return raw || fallback;
}

const buzz = (ms) => { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch {} } };

/* ---------------- Icons ---------------- */

const ICON_PATHS = {
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  sliders: '<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/><path d="M4 18h12"/><path d="M20 18h0"/><circle cx="18" cy="18" r="2"/>',
  type: '<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14c2.5.6 4 2.7 4 6"/>',
  swap: '<path d="M7 4L3 8l4 4"/><path d="M3 8h14"/><path d="M17 20l4-4-4-4"/><path d="M21 16H7"/>',
  userPlus: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><path d="M19 8v6"/><path d="M16 11h6"/>',
  inbox: '<path d="M3 13l3-8h12l3 8"/><path d="M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6h-6l-1.5 2h-3L9 13z"/>',
  once: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 2.2"/><path d="M11 9l2-1.5V16"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/><path d="M9 22h6"/>',
  micStop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
  edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14 6l3 3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h9a6 6 0 0 1 6 6v3"/>',
  smilePlus: '<circle cx="9" cy="12" r="7"/><path d="M6.5 13.5s1 1.5 2.5 1.5 2.5-1.5 2.5-1.5"/><path d="M7.5 9.5h.01"/><path d="M10.5 9.5h.01"/><path d="M18 6v6"/><path d="M15 9h6"/>',
  sticker: '<circle cx="12" cy="12" r="9"/><path d="M8 13.5s1.5 2 4 2 4-2 4-2"/><path d="M8.5 9.5h.01"/><path d="M15.5 9.5h.01"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/>',
  send: '<path d="M4 11l16-7-6 16-3-6.5z"/><path d="M14 13l-3.5 3.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.8-5.5 6.5-5.5s5.5 2 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.6c2.4.2 4.3 2 5 5.4"/>',
  heart: '<path d="M12 20s-7-4.4-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 5c-2.5 4.6-9.5 9-9.5 9z"/>',
  eye: '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  comment: '<path d="M4 4h16v12H9l-5 4z"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  bellOff: '<path d="M6 9a6 6 0 0 1 9.5-4.9"/><path d="M18 9c0 5 2 6 2 6H8"/><path d="M10 20a2 2 0 0 0 4 0"/><path d="M3 3l18 18"/>',
  check: '<path d="M5 12l5 5L20 6"/>',
  checks: '<path d="M2 12l5 5L17 7"/><path d="M12 16l1 1L23 7"/>',
  loadMore: '<path d="M12 5v10"/><path d="M7 11l5 5 5-5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  reel: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  pause: '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  mute: '<path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M17 8l4 8"/><path d="M21 8l-4 8"/>',
  unmute: '<path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/>',
  bookmark: '<path d="M6 3h12v18l-6-4.5L6 21V3z"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>',
  activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  star: '<path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.1 1.4-6.3-4.8-4.3 6.4-.6z"/>',
  block: '<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.3"/><circle cx="13" cy="8.5" r="1.3"/><circle cx="16" cy="11.5" r="1.3"/><path d="M12 21a2.5 2.5 0 0 1 0-9h5a3 3 0 0 0 0-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  link: '<path d="M9 15l6-6"/><path d="M10 6l1-1a4 4 0 0 1 6 6l-1 1"/><path d="M14 18l-1 1a4 4 0 0 1-6-6l1-1"/>',
  logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M15 16l4-4-4-4"/><path d="M19 12H9"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  phoneOff: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" transform="rotate(135 12 12)"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  videoOff: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/><path d="M3 3l18 18"/>',
  micOff: '<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/><path d="M3 3l18 18"/>',
  flip: '<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-.6 4"/><path d="M20 5v6h-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  forward: '<polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
  poll: '<path d="M3 3v18h18"/><path d="M8 17v-6"/><path d="M13 17V7"/><path d="M18 17v-4"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  voiceType: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><path d="M12 2v13"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><path d="M12 15V3"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  select: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M15 17.5l2 2 4-4"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  youtube: '<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10 9.2v5.6l4.8-2.8z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M3 10h18"/>',
  shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
};

function svgIcon(name, size = 18) {
  return `<svg class="icon-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
}

function applyIconAttributes(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    if (el.dataset.iconDone) return;
    el.dataset.iconDone = "1";
    el.innerHTML = svgIcon(el.dataset.icon, el.dataset.iconSize || 18);
  });
}

function setAvatarContent(el, person) {
  if (!el) return;
  if (person && person.pfp_url) {
    el.style.background = "";
    el.style.backgroundImage = `url("${String(person.pfp_url).replace(/"/g, "%22")}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.textContent = "";
  } else {
    el.style.backgroundImage = "";
    el.style.background = colorFromName(person ? person.display_name : "?");
    el.textContent = initials(person ? person.display_name : "?");
  }
}

// Group / public-room avatar: photo if it has one, else coloured initials.
function setGroupAvatar(el, conversation) {
  const name = conversation?.name || "Group";
  if (conversation?.pfp_url) {
    el.style.background = "";
    el.style.backgroundImage = `url("${String(conversation.pfp_url).replace(/"/g, "%22")}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.textContent = "";
  } else {
    el.style.backgroundImage = "";
    el.style.background = colorFromName(name);
    el.textContent = conversation?.id === PUBLIC_ROOM_ID ? "RPM" : initials(name);
  }
}

/* ---------------- Images ---------------- */

const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

// Re-encodes any picked photo (HEIC, huge camera files…) into a resized JPEG.
function compressImageFile(file, maxDim = MAX_IMAGE_DIMENSION) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const k = maxDim / Math.max(width, height);
        width = Math.round(width * k);
        height = Math.round(height * k);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";               // transparent PNGs would turn black in a JPEG
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not process this image.")), "image/jpeg", JPEG_QUALITY);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This photo's format isn't supported by your browser."));
    };
    img.src = objectUrl;
  });
}

// Opens the photo editor (crop, filters, text, draw…) when this page has it,
// then compresses. Resolves null if the person cancelled the editor.
async function editAndCompress(file, opts = {}, maxDim = MAX_IMAGE_DIMENSION) {
  let f = file;
  if (window.MediaEditor && /^image\//.test(file.type || "image/") && !/gif/i.test(file.type)) {
    f = await MediaEditor.edit(file, opts);
    if (!f) return null;
  }
  return compressImageFile(f, maxDim);
}

async function uploadPublic(bucket, path, blob, contentType = "image/jpeg") {
  const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType, cacheControl: "31536000" });
  if (error) throw error;
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/* ---------------- Profiles (cached) ---------------- */

const PROFILE_TTL = 15 * 60 * 1000;
const PROFILE_STORE = "teaofrpm_pc";
const profileCache = new Map();         // id -> profile
const profileFetchedAt = new Map();     // id -> ms
const profileInFlight = new Map();      // id -> promise

(function hydrateProfiles() {
  const saved = store.get(PROFILE_STORE, {});
  for (const [id, [at, p]] of Object.entries(saved || {})) {
    profileCache.set(id, p);
    profileFetchedAt.set(id, at);
  }
})();

const persistProfiles = debounce(() => {
  const entries = [...profileCache.entries()]
    .sort((a, b) => (profileFetchedAt.get(b[0]) || 0) - (profileFetchedAt.get(a[0]) || 0))
    .slice(0, 400);
  const out = {};
  for (const [id, p] of entries) {
    // never keep anything sensitive on the device
    const { id_card_url, ...safe } = p;
    out[id] = [profileFetchedAt.get(id) || 0, safe];
  }
  store.set(PROFILE_STORE, out);
}, 800);

function rememberProfile(p) {
  if (!p || !p.id) return;
  profileCache.set(p.id, { ...(profileCache.get(p.id) || {}), ...p });
  profileFetchedAt.set(p.id, Date.now());
  persistProfiles();
}

const isFresh = (id) => Date.now() - (profileFetchedAt.get(id) || 0) < PROFILE_TTL;

async function fetchProfiles(ids) {
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await sb.from("profiles").select("*").in("id", ids.slice(i, i + 100));
    (data || []).forEach(rememberProfile);
  }
}

async function getProfile(userId) {
  if (!userId) return null;
  if (profileCache.has(userId)) {
    if (!isFresh(userId) && !profileInFlight.has(userId)) {
      const p = fetchProfiles([userId]).finally(() => profileInFlight.delete(userId));
      profileInFlight.set(userId, p);
    }
    return profileCache.get(userId);
  }
  if (profileInFlight.has(userId)) { await profileInFlight.get(userId); return profileCache.get(userId) || null; }
  const p = fetchProfiles([userId]).finally(() => profileInFlight.delete(userId));
  profileInFlight.set(userId, p);
  await p;
  return profileCache.get(userId) || null;
}

// One request for a whole list. Cached people return instantly; stale ones
// are refreshed in the background without making the caller wait.
async function getProfiles(userIds) {
  const wanted = [...new Set((userIds || []).filter(Boolean))];
  const missing = wanted.filter((id) => !profileCache.has(id));
  const stale = wanted.filter((id) => profileCache.has(id) && !isFresh(id) && !profileInFlight.has(id));
  if (stale.length) {
    const p = fetchProfiles(stale).finally(() => stale.forEach((id) => profileInFlight.delete(id)));
    stale.forEach((id) => profileInFlight.set(id, p));
  }
  if (missing.length) await fetchProfiles(missing);
  return wanted.map((id) => profileCache.get(id)).filter(Boolean);
}

async function getProfileByUsername(username) {
  const u = String(username || "").toLowerCase();
  for (const p of profileCache.values()) {
    if (p.username === u && isFresh(p.id)) return p;
  }
  const { data, error } = await sb.from("profiles").select("*").eq("username", u).maybeSingle();
  if (error) { console.error(error); return null; }
  if (data) rememberProfile(data);
  return data;
}

// Everyone verified, loaded once per page and shared by every people picker.
let _allPeople = null;
async function loadAllPeople() {
  if (_allPeople) return _allPeople;
  const { data, error } = await sb.from("profiles")
    .select("id,username,display_name,pfp_url,is_private,role")
    .eq("is_verified", true).order("display_name", { ascending: true }).limit(1000);
  if (error) { toast("Could not load people."); return []; }
  (data || []).forEach((p) => { if (!profileCache.has(p.id)) rememberProfile(p); });
  _allPeople = data || [];
  return _allPeople;
}

/* ---------------- Auth ---------------- */

const cfg = window.TEAOFRPM_CONFIG;
const ME_STORE = "teaofrpm_me";

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${cfg.AUTH_EMAIL_DOMAIN}`;
}

async function createNewAccount(displayName, username, password) {
  const email = usernameToEmail(username);
  const { data: existing } = await sb.from("profiles").select("id").eq("username", username.toLowerCase()).maybeSingle();
  if (existing) throw new Error("That username is already taken. Try another.");

  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { username: username.toLowerCase(), display_name: displayName } },
  });
  if (error) {
    if (String(error.message).toLowerCase().includes("already registered")) throw new Error("That username is already taken. Try another.");
    throw error;
  }
  if (!data.session) {
    const { error: signInErr } = await sb.auth.signInWithPassword({ email, password });
    if (signInErr) throw signInErr;
  }
  return { username, displayName };
}

async function loginExisting(username, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error) throw error;
  return data;
}

async function requireSession(redirectTo = "index.html") {
  const { data } = await sb.auth.getSession();
  if (!data.session) { location.replace(redirectTo); return null; }
  return data.session;
}

async function fetchMyProfile(uid) {
  const { data, error } = await sb.from("profiles").select("*").eq("id", uid).single();
  if (error) { console.error(error); return null; }
  saveMe(data);
  return data;
}

function saveMe(p) {
  if (!p) return;
  rememberProfile(p);
  const { id_card_url, ...safe } = p;
  store.set(ME_STORE, safe);
}

async function getMyProfile() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  return fetchMyProfile(data.session.user.id);
}

async function routeAfterAuth() {
  const profile = await getMyProfile();
  if (!profile) { toast("Could not load your profile. Try again."); return; }
  if (profile.banned) {
    toast("This account has been banned by the admin.");
    await logoutUser(false);
    return;
  }
  location.href = profile.is_verified ? "home.html" : "verify.html";
}

/* ---------------- Multiple accounts (Instagram-style switching) ----------------
   Each signed-in account's session is kept on this device only. Switching just
   swaps which session supabase-js uses — no password needed again. */
const Accounts = {
  KEY: "teaofrpm_accounts",
  list() { return store.get(this.KEY) || []; },
  save(list) { store.set(this.KEY, list.slice(0, 5)); },
  remember(session, profile) {
    if (!session?.user) return;
    const list = this.list();
    const i = list.findIndex((a) => a.id === session.user.id);
    const prev = i >= 0 ? list[i] : {};
    const p = profile || (prev.username ? prev : store.get(ME_STORE)?.id === session.user.id ? store.get(ME_STORE) : null) || {};
    const entry = {
      id: session.user.id,
      username: p.username || prev.username || "", display_name: p.display_name || prev.display_name || "",
      pfp_url: p.pfp_url ?? prev.pfp_url ?? null, avatar_color: p.avatar_color || prev.avatar_color || null,
      access_token: session.access_token, refresh_token: session.refresh_token, at: Date.now(),
    };
    if (i >= 0) list[i] = entry; else list.push(entry);
    this.save(list);
  },
  forget(id) { this.save(this.list().filter((a) => a.id !== id)); },
  clearLocalCaches() {
    [ME_STORE, PROFILE_STORE, "teaofrpm_inbox"].forEach((k) => store.remove(k));
    try { Object.keys(localStorage).filter((k) => k.startsWith("teaofrpm_rh_") || k.startsWith("teaofrpm_draft_")).forEach((k) => localStorage.removeItem(k)); } catch {}
  },
  async switchTo(id) {
    const a = this.list().find((x) => x.id === id);
    if (!a) return;
    const { data: cur } = await sb.auth.getSession();
    if (cur.session?.user.id === id) return;
    if (cur.session) this.remember(cur.session);
    const banner = document.createElement("div");
    banner.className = "switch-banner";
    banner.textContent = `Switching to @${a.username || "account"}…`;
    document.body.appendChild(banner);
    const { data, error } = await sb.auth.setSession({ access_token: a.access_token, refresh_token: a.refresh_token });
    if (error || !data.session) {
      banner.remove();
      this.forget(id);
      toast(`@${a.username} ka session expire ho gaya — dobara log in karo.`, 3500);
      setTimeout(() => { location.href = "index.html?add=1"; }, 900);
      return;
    }
    this.remember(data.session);
    this.clearLocalCaches();
    location.href = "home.html";
  },
};
try {
  // keep the stored copy of the current account's tokens fresh as they rotate
  window.sb?.auth?.onAuthStateChange?.((event, session) => {
    if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")) Accounts.remember(session);
  });
} catch (e) { console.warn(e); }

function openAccountSwitcher() {
  const me = App.me || store.get(ME_STORE);
  const list = Accounts.list();
  const s = makeSheet({ title: "Accounts", html: `<div class="acct-list"></div>` });
  const box = s.body.querySelector(".acct-list");
  const rows = list.length ? list : (me ? [{ id: me.id, username: me.username, display_name: me.display_name, pfp_url: me.pfp_url, avatar_color: me.avatar_color }] : []);
  rows.sort((a, b) => (b.id === me?.id) - (a.id === me?.id));
  for (const a of rows) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "acct-row";
    row.innerHTML = `<span class="avatar"></span><div><b>${escapeHTML(a.display_name || a.username)}</b><small>@${escapeHTML(a.username || "")}</small></div>
      ${a.id === me?.id ? `<span class="acct-tick">${svgIcon("check", 20)}</span>` : `<span class="acct-x" role="button" title="Remove from this device">${svgIcon("close", 14)}</span>`}`;
    setAvatarContent(row.querySelector(".avatar"), a);
    row.addEventListener("click", (e) => {
      if (e.target.closest(".acct-x")) { Accounts.forget(a.id); row.remove(); toast("Removed from this device"); return; }
      if (a.id !== me?.id) { s.close(); Accounts.switchTo(a.id); }
    });
    box.appendChild(row);
  }
  if (rows.length < 5) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "acct-row acct-add";
    add.innerHTML = `<span class="avatar">${svgIcon("plus", 20)}</span><div><b>Add account</b><small>Log in to another account</small></div>`;
    add.addEventListener("click", async () => {
      const { data } = await sb.auth.getSession();
      if (data.session) Accounts.remember(data.session, App.me);
      location.href = "index.html?add=1";
    });
    box.appendChild(add);
  }
  s.onClose = () => setTimeout(() => s.el.remove(), 300);
  s.open();
}

async function logoutUser(redirect = true) {
  const { data } = await sb.auth.getSession();
  const myId = data.session?.user.id;
  Accounts.clearLocalCaches();
  if (myId) Accounts.forget(myId);
  // local scope: only this device's session ends; other saved accounts stay usable
  await sb.auth.signOut({ scope: "local" });
  const next = Accounts.list()[0];
  if (redirect && next) { await Accounts.switchTo(next.id); return; }
  if (redirect) location.href = "index.html";
}

const halt = () => new Promise(() => {});   // stops a page's init() for good

const App = {
  me: null,

  /* Every logged-in page starts with `ME = await App.boot()`.
     Resolves straight away from the cached profile when there is one. */
  async boot({ verified = true } = {}) {
    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session) { location.replace("index.html"); return halt(); }
    const uid = session.user.id;

    const cached = store.get(ME_STORE);
    const fresh = fetchMyProfile(uid);
    let me = cached && cached.id === uid ? cached : await fresh;
    if (!me) { toast("Could not load your profile. Check your connection."); return halt(); }

    const check = async (p) => {
      if (p.banned) {
        toast("This account has been banned.");
        await logoutUser(false);
        location.replace("index.html");
        return false;
      }
      if (verified && !p.is_verified) { location.replace("verify.html"); return false; }
      return true;
    };
    if (!(await check(me))) return halt();

    if (me === cached) {
      // refresh in the background; apply changes to the same object
      fresh.then(async (p) => { if (p) { Object.assign(me, p); await check(me); } });
    }
    profileCache.set(me.id, me);
    App.me = me;
    Accounts.remember(session, me);
    window.dispatchEvent(new CustomEvent("app:me", { detail: me }));
    afterBoot(me);
    return me;
  },
  saveMe,
};

/* ---------------- Navigation + fullscreen layers ---------------- */

const AppNav = (() => {
  const ITEMS = [
    { key: "home", href: "home.html", icon: "home", label: "Home" },
    { key: "reels", href: "reels.html", icon: "reel", label: "Reels" },
    { key: "messages", href: "messages.html", icon: "chat", label: "Messages" },
    { key: "discover", href: "discover.html", icon: "globe", label: "Discover" },
    { key: "profile", href: "profile.html", icon: "person", label: "Profile" },
  ];

  // Each open fullscreen layer registers a close callback; the phone's back
  // button pops the top layer instead of leaving the page.
  const layers = [];
  function hide() { document.body.classList.add("nav-hidden"); }
  function show() { document.body.classList.remove("nav-hidden"); }

  function bindScroll(el) {
    let lastY = el.scrollTop, ticking = false;
    el.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (layers.length) return;
        const y = el.scrollTop;
        if (y > lastY + 8 && y > 60) hide();
        else if (y < lastY - 8) show();
        lastY = y;
      });
    }, { passive: true });
  }

  function hideWhileFocused(el) {
    el.addEventListener("focus", hide);
    el.addEventListener("blur", () => { if (!layers.length) show(); });
  }

  function enterFullscreen(onExit) {
    layers.push(onExit);
    hide();
    history.pushState({ appLayer: layers.length }, "");
  }
  function exitFullscreen() { if (layers.length) history.back(); }
  function isOpen() { return layers.length > 0; }

  window.addEventListener("popstate", () => {
    const onExit = layers.pop();
    if (onExit) onExit();
    if (!layers.length) show();
  });

  function setBadge(key, count) {
    const a = document.querySelector(`#appNav a[data-key="${key}"]`);
    if (!a) return;
    let b = a.querySelector(".nav-badge");
    if (!count) { b?.remove(); return; }
    if (!b) { b = document.createElement("span"); b.className = "nav-badge"; a.appendChild(b); }
    b.textContent = count > 99 ? "99+" : String(count);
  }

  function render() {
    const nav = document.getElementById("appNav");
    if (!nav) return;
    const active = nav.dataset.active;
    // The bar must be a direct child of <body>: inside a page wrapper, some
    // phones measure "bottom: 0" from the wrapper and the bar floats up.
    if (nav.parentElement !== document.body) document.body.appendChild(nav);
    nav.classList.add("app-nav");
    nav.innerHTML = ITEMS.map((i) => `
      <a href="${i.href}" data-key="${i.key}" class="${i.key === active ? "active" : ""}" aria-label="${i.label}"${i.key === active ? ' aria-current="page"' : ""}>
        ${svgIcon(i.icon, 22)}<span>${i.label}</span>
      </a>`).join("");
    document.body.classList.add("has-app-nav");

    // Warm the next page the moment a tab is touched.
    const warmed = new Set();
    nav.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href");
      const warm = () => {
        if (warmed.has(href)) return;
        warmed.add(href);
        const l = document.createElement("link");
        l.rel = "prefetch"; l.href = href;
        document.head.appendChild(l);
      };
      a.addEventListener("pointerenter", warm, { passive: true });
      a.addEventListener("touchstart", warm, { passive: true });
      // tapping the tab you're already on scrolls to the top
      if (a.classList.contains("active")) {
        a.addEventListener("click", (e) => {
          const scroller = nav.dataset.scrollEl && document.getElementById(nav.dataset.scrollEl);
          if (scroller && scroller.scrollTop > 0) { e.preventDefault(); scroller.scrollTo({ top: 0, behavior: "smooth" }); }
        });
      }
    });

    // The bar no longer hides while scrolling: sliding it away resized the
    // whole page on every scroll direction change, which made it wobble.
    // (It still hides for fullscreen viewers and while typing.)
    const focusEl = nav.dataset.hideOnFocus && document.getElementById(nav.dataset.hideOnFocus);
    if (focusEl) hideWhileFocused(focusEl);

    // Typing anywhere (search, comments, captions…) tucks the bar away, so the
    // keyboard can never push it up into the middle of the screen.
    const isTyping = (el) => el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !/^(checkbox|radio|button|submit|file|range|color)$/i.test(el.type)) || el.isContentEditable);
    document.addEventListener("focusin", (e) => { if (isTyping(e.target)) hide(); });
    // In the installed app iOS leaves the page scrolled up after the keyboard
    // closes, which drags every fixed bar (the nav) up with it — snap it back.
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const unshift = () => { if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0); };
    document.addEventListener("focusout", () => setTimeout(() => {
      if (!isTyping(document.activeElement) && !layers.length) { show(); if (standalone) unshift(); }
    }, 60));
    if (standalone) {
      document.documentElement.classList.add("is-standalone");
      window.addEventListener("orientationchange", () => setTimeout(unshift, 300));
      document.addEventListener("visibilitychange", () => { if (!document.hidden) unshift(); });
    }
    // Some Android keyboards resize the page instead of overlaying it
    if (window.visualViewport) {
      const vv = window.visualViewport;
      let full = vv.height;
      vv.addEventListener("resize", () => {
        if (vv.height > full) full = vv.height;
        const kb = vv.height < full * 0.78;
        document.body.classList.toggle("kb-open", kb);
        if (!kb && standalone) unshift();
      });
    }
  }

  render();
  return { hide, show, bindScroll, enterFullscreen, exitFullscreen, isOpen, setBadge };
})();

/* ---------------- Sheets ---------------- */

// A bottom sheet that the back button closes. Returns { el, body, open, close }.
function makeSheet({ title = "", html = "", className = "" } = {}) {
  const bd = document.createElement("div");
  bd.className = `app-sheet-backdrop ${className}`;
  bd.innerHTML = `
    <div class="app-sheet extras-sheet" role="dialog" aria-label="${escapeHTML(title)}">
      <div class="app-sheet-handle"></div>
      ${title ? `<div class="app-sheet-title">${escapeHTML(title)}</div>` : ""}
      <div class="extras-sheet-body">${html}</div>
    </div>`;
  document.body.appendChild(bd);
  let isOpen = false;
  const api = {
    el: bd,
    body: bd.querySelector(".extras-sheet-body"),
    titleEl: bd.querySelector(".app-sheet-title"),
    onClose: null,
    open() {
      if (isOpen) return;
      isOpen = true;
      bd.classList.add("show");
      AppNav.enterFullscreen(() => { isOpen = false; bd.classList.remove("show"); api.onClose && api.onClose(); });
    },
    close() { if (isOpen) AppNav.exitFullscreen(); },
    get isOpen() { return isOpen; },
  };
  bd.addEventListener("click", (e) => { if (e.target === bd) api.close(); });
  return api;
}

// A one-off menu sheet: items = [{icon, label, danger, onClick}]
function actionSheet(title, items) {
  const s = makeSheet({ title, html: items.map((it, i) => `
    <button type="button" class="extras-action ${it.danger ? "is-danger" : ""}" data-i="${i}">${svgIcon(it.icon || "chevron", 17)} ${escapeHTML(it.label)}</button>`).join("") });
  s.body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    s.close();
    setTimeout(() => it.onClick && it.onClick(), 60);
  });
  s.onClose = () => setTimeout(() => s.el.remove(), 300);
  s.open();
  return s;
}

// Pick people from everyone verified. Resolves with an array of profiles (or null).
function pickPeople({ title = "Choose people", multiple = true, exclude = [], selected = [], cta = "Done" } = {}) {
  return new Promise(async (resolve) => {
    const chosen = new Map(selected.map((p) => [p.id, p]));
    const s = makeSheet({ title, html: `
      <input type="text" class="settings-search" placeholder="Search people…" autocomplete="off" />
      <div class="settings-list pick-list"><div class="settings-empty">Loading…</div></div>
      ${multiple ? `<button type="button" class="btn pick-done" style="width:100%;margin-top:10px;">${escapeHTML(cta)}</button>` : ""}` });
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    s.onClose = () => { finish(null); setTimeout(() => s.el.remove(), 300); };
    s.open();

    const people = (await loadAllPeople()).filter((p) => !exclude.includes(p.id));
    const list = s.body.querySelector(".pick-list");
    const input = s.body.querySelector("input");
    const doneBtn = s.body.querySelector(".pick-done");
    const sync = () => { if (doneBtn) doneBtn.textContent = chosen.size ? `${cta} · ${chosen.size}` : cta; };

    const render = (q = "") => {
      q = q.toLowerCase();
      const hits = q ? people.filter((p) => (p.display_name || "").toLowerCase().includes(q) || p.username.includes(q)) : people;
      if (!hits.length) { list.innerHTML = `<div class="settings-empty">No one found.</div>`; return; }
      const frag = document.createDocumentFragment();
      for (const p of hits.slice(0, 200)) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `settings-list-row group-member-row ${chosen.has(p.id) ? "selected" : ""}`;
        row.innerHTML = `<span class="avatar"></span><div class="settings-list-name">${escapeHTML(p.display_name)}<span class="settings-list-sub">@${escapeHTML(p.username)}</span></div>${multiple ? `<span class="group-member-check">${chosen.has(p.id) ? svgIcon("check", 13) : ""}</span>` : ""}`;
        setAvatarContent(row.querySelector(".avatar"), p);
        row.addEventListener("click", () => {
          if (!multiple) { finish([p]); s.close(); return; }
          if (chosen.has(p.id)) chosen.delete(p.id); else chosen.set(p.id, p);
          row.classList.toggle("selected", chosen.has(p.id));
          row.querySelector(".group-member-check").innerHTML = chosen.has(p.id) ? svgIcon("check", 13) : "";
          sync();
        });
        frag.appendChild(row);
      }
      list.innerHTML = "";
      list.appendChild(frag);
    };
    input.addEventListener("input", debounce(() => render(input.value.trim()), 120));
    doneBtn?.addEventListener("click", () => { finish([...chosen.values()]); s.close(); });
    render(); sync();
  });
}

// Report a user, message or post — a sheet instead of a bare prompt().
function reportSheet(type, id) {
  const reasons = ["Spam", "Harassment or bullying", "Hate speech", "Nudity or sexual content", "Fake account / impersonation", "Something else"];
  const s = makeSheet({ title: type === "user" ? "Report account" : `Report ${type}`, html: `
    <p class="x3-hint" style="margin:0 0 10px;">Reports go to the admins. The person isn't told who reported them.</p>
    ${reasons.map((r) => `<button type="button" class="extras-action" data-r="${escapeHTML(r)}">${svgIcon("flag", 16)} ${escapeHTML(r)}</button>`).join("")}
    <textarea class="x3-input report-extra" rows="2" maxlength="300" placeholder="Add details (optional)" style="margin-top:4px;"></textarea>` });
  s.onClose = () => setTimeout(() => s.el.remove(), 300);
  s.body.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-r]");
    if (!b || !App.me) return;
    const extra = s.body.querySelector(".report-extra").value.trim();
    b.disabled = true;
    const { error } = await sb.from("reports").insert({
      reporter_id: App.me.id, target_type: type, target_id: id,
      reason: extra ? `${b.dataset.r}: ${extra}` : b.dataset.r,
    });
    s.close();
    toast(error ? friendlyError(error, "Could not send the report.") : "Reported. Thanks for flagging it.");
  });
  s.open();
}

async function copyText(text, okMsg = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(okMsg); } catch { toast("Could not copy"); }
    ta.remove();
  }
}

async function shareLink(url, title = "teaofrpm") {
  const abs = new URL(url, location.href).href;
  if (navigator.share) {
    try { await navigator.share({ title, url: abs }); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  copyText(abs, "Link copied");
}

/* ---------------- Saves ---------------- */

async function toggleSave(kind, id, btn) {
  const column = kind === "post" ? "post_id" : "reel_id";
  const wasSaved = btn.classList.contains("saved");
  btn.classList.toggle("saved", !wasSaved);
  buzz(10);
  const { error } = wasSaved
    ? await sb.from("saves").delete().eq("user_id", App.me.id).eq(column, id)
    : await sb.from("saves").insert({ user_id: App.me.id, [column]: id });
  if (error) { btn.classList.toggle("saved", wasSaved); toast(friendlyError(error, "Could not update.")); }
  else toast(wasSaved ? "Removed from saved" : "Saved");
}

/* ---------------- Media viewer (with pinch-zoom) ---------------- */

function openMediaViewer(src) {
  let viewer = document.getElementById("appMediaViewer");
  if (!viewer) {
    viewer = document.createElement("div");
    viewer.id = "appMediaViewer";
    viewer.className = "app-media-viewer";
    viewer.innerHTML = `<img alt="" draggable="false" /><button type="button" class="viewer-close" aria-label="Close">${svgIcon("close", 20)}</button>`;
    document.body.appendChild(viewer);
    const img = viewer.querySelector("img");

    let scale = 1, tx = 0, ty = 0, startDist = 0, startScale = 1, lastX = 0, lastY = 0, panning = false, moved = false;
    const paint = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
    viewer._reset = () => { scale = 1; tx = ty = 0; paint(); };
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    viewer.addEventListener("touchstart", (e) => {
      moved = false;
      if (e.touches.length === 2) { startDist = dist(e.touches); startScale = scale; }
      else if (e.touches.length === 1 && scale > 1) { panning = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }
    }, { passive: true });
    viewer.addEventListener("touchmove", (e) => {
      moved = true;
      if (e.touches.length === 2) {
        e.preventDefault();
        scale = Math.min(5, Math.max(1, startScale * dist(e.touches) / startDist));
        paint();
      } else if (panning) {
        tx += e.touches[0].clientX - lastX; ty += e.touches[0].clientY - lastY;
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
        paint();
      }
    }, { passive: false });
    viewer.addEventListener("touchend", () => { panning = false; if (scale <= 1.02) viewer._reset(); });
    // double-tap / double-click toggles zoom
    img.addEventListener("dblclick", (e) => { e.stopPropagation(); scale = scale > 1 ? 1 : 2.5; tx = ty = 0; paint(); });
    viewer.addEventListener("click", (e) => {
      if (moved || (scale > 1 && e.target === img)) return;
      AppNav.exitFullscreen();
    });

    if (!store.raw("teaofrpm_savehint")) {
      viewer.addEventListener("click", () => { toast("Press and hold the photo to save it"); store.setRaw("teaofrpm_savehint", "1"); }, { once: true });
    }
  }
  viewer._reset();
  viewer.querySelector("img").src = src;
  viewer.classList.add("show");
  AppNav.enterFullscreen(() => viewer.classList.remove("show"));
}

/* ---------------- Comments sheet (posts + reels) ---------------- */

async function openCommentsSheet({ table, column, id, myId, onAdded, onRemoved }) {
  let sheet = document.getElementById("appCommentsSheet");
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "appCommentsSheet";
    sheet.className = "app-sheet-backdrop";
    sheet.innerHTML = `
      <div class="app-sheet">
        <div class="app-sheet-handle"></div>
        <div class="app-sheet-title">Comments</div>
        <div class="app-sheet-body"></div>
        <div class="app-sheet-input">
          <input type="text" maxlength="300" placeholder="Add a comment…" enterkeyhint="send" />
          <button class="app-sheet-send" aria-label="Post">${svgIcon("send", 18)}</button>
        </div>
      </div>`;
    sheet.addEventListener("click", (e) => { if (e.target === sheet) AppNav.exitFullscreen(); });
    document.body.appendChild(sheet);
  }
  const body = sheet.querySelector(".app-sheet-body");
  const input = sheet.querySelector("input");
  const sendBtn = sheet.querySelector(".app-sheet-send");
  sheet.classList.add("show");
  AppNav.enterFullscreen(() => sheet.classList.remove("show"));
  const token = (sheet._token = (sheet._token || 0) + 1);

  const rowFor = (c) => {
    const author = profileCache.get(c.user_id);
    const row = document.createElement("div");
    row.className = "app-comment";
    row.innerHTML = `<a class="avatar" href="${author ? `profile.html?u=${encodeURIComponent(author.username)}` : "#"}"></a>
      <div style="flex:1;min-width:0;"><b>${escapeHTML(author?.display_name || "Unknown")}</b> <span class="app-comment-time">${timeAgo(c.created_at)}</span><div>${linkifyMentions(escapeHTML(c.content))}</div></div>`;
    setAvatarContent(row.querySelector(".avatar"), author);
    if (c.user_id === myId) {
      const del = document.createElement("button");
      del.className = "app-comment-del";
      del.title = "Delete comment";
      del.innerHTML = svgIcon("trash", 14);
      del.addEventListener("click", async () => {
        if (!confirm("Delete this comment?")) return;
        const { error } = await sb.from(table).update({ deleted: true }).eq("id", c.id).eq("user_id", myId);
        if (error) { toast(friendlyError(error, "Could not delete.")); return; }
        row.remove();
        onRemoved && onRemoved();
        if (!body.querySelector(".app-comment")) body.innerHTML = `<div class="search-hint">No comments yet. Be the first.</div>`;
      });
      row.appendChild(del);
    }
    return row;
  };

  async function load() {
    body.innerHTML = `<div class="search-hint">Loading…</div>`;
    const { data, error } = await sb.from(table).select("*").eq(column, id).eq("deleted", false).order("created_at", { ascending: true });
    if (token !== sheet._token) return;
    if (error) { body.innerHTML = `<div class="search-hint">Could not load comments.</div>`; return; }
    await getProfiles((data || []).map((c) => c.user_id));
    if (!data.length) { body.innerHTML = `<div class="search-hint">No comments yet. Be the first.</div>`; return; }
    const frag = document.createDocumentFragment();
    data.forEach((c) => frag.appendChild(rowFor(c)));
    body.innerHTML = "";
    body.appendChild(frag);
    body.scrollTop = body.scrollHeight;
  }

  sendBtn.onclick = async () => {
    const content = input.value.trim();
    if (!content || sendBtn.disabled) return;
    sendBtn.disabled = true;
    const { data, error } = await sb.from(table).insert({ [column]: id, user_id: myId, content }).select().single();
    sendBtn.disabled = false;
    if (error) { toast(friendlyError(error, "Could not post comment.")); return; }
    input.value = "";
    onAdded && onAdded();
    body.querySelector(".search-hint")?.remove();
    body.appendChild(rowFor(data));
    body.scrollTop = body.scrollHeight;
  };
  input.onkeydown = (e) => { if (e.key === "Enter") sendBtn.onclick(); };
  await load();
}

/* ---------------- Text helpers ---------------- */

// Works on already-escaped text.
function linkify(safeText) {
  return safeText.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const trimmed = url.replace(/[.,!?)\]]+$/, "");
    return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer">${trimmed}</a>${url.slice(trimmed.length)}`;
  });
}
// WhatsApp-style *bold* _italic_ ~strike~ `code` — runs on already-escaped HTML
// and never touches tags or link text, so URLs/usernames with _ stay intact.
function formatChat(html) {
  let inLink = 0;
  return html.split(/(<[^>]+>)/).map((part) => {
    if (part.startsWith("<")) {
      if (/^<a[\s>]/i.test(part)) inLink++;
      else if (/^<\/a>/i.test(part)) inLink = Math.max(0, inLink - 1);
      return part;
    }
    if (inLink || !/[*_~`]/.test(part)) return part;
    const edge = "(^|[\\s(\"'])", end = "(?=$|[\\s).,!?:;\"'])";
    return part
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(new RegExp(`${edge}\\*(\\S(?:[^*\\n]*\\S)?)\\*${end}`, "g"), "$1<b>$2</b>")
      .replace(new RegExp(`${edge}_(\\S(?:[^_\\n]*\\S)?)_${end}`, "g"), "$1<i>$2</i>")
      .replace(new RegExp(`${edge}~(\\S(?:[^~\\n]*\\S)?)~${end}`, "g"), "$1<s>$2</s>");
  }).join("");
}

function linkifyMentions(safeText) {
  return linkify(safeText)
    .replace(/(^|[\s(])@([a-z0-9_]{3,20})\b/gi,
      (m, pre, u) => `${pre}<a class="mention" href="profile.html?u=${u.toLowerCase()}">@${u}</a>`)
    // #hashtags open their own page (posts + reels with that tag)
    .replace(/(^|[\s(])#([\p{L}\p{N}_]{2,40})/gu,
      (m, pre, t) => /^[\d_]+$/.test(t) ? m : `${pre}<a class="hashtag" href="discover.html?tag=${encodeURIComponent(t.toLowerCase())}">#${t}</a>`);
}

/* ---------------- Skeletons ---------------- */

const Skeleton = (() => {
  const feedCard = () => `
    <div class="sk-feed-card">
      <div class="sk-feed-head">
        <div class="skeleton sk-circle" style="width:36px;height:36px;"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:7px;">
          <div class="skeleton sk-line" style="width:40%;"></div>
          <div class="skeleton sk-line" style="width:25%;"></div>
        </div>
      </div>
      <div class="skeleton sk-feed-media"></div>
      <div class="sk-feed-foot">
        <div class="skeleton sk-line" style="width:30%;"></div>
        <div class="skeleton sk-line" style="width:80%;"></div>
      </div>
    </div>`;
  const row = () => `
    <div class="sk-row">
      <div class="skeleton sk-circle" style="width:46px;height:46px;"></div>
      <div class="sk-row-text">
        <div class="skeleton sk-line" style="width:45%;"></div>
        <div class="skeleton sk-line" style="width:70%;"></div>
      </div>
    </div>`;
  const msg = (own) => `
    <div class="sk-msg ${own ? "own" : ""}">
      <div class="skeleton sk-circle" style="width:30px;height:30px;"></div>
      <div class="skeleton sk-bubble" style="width:${own ? 45 : 60}%;"></div>
    </div>`;
  const reelCard = () => `
    <div class="sk-reel">
      <div class="skeleton sk-reel-media"></div>
      <div class="sk-reel-foot">
        <div class="skeleton sk-circle" style="width:34px;height:34px;"></div>
        <div class="skeleton sk-line" style="width:120px;"></div>
      </div>
    </div>`;
  const KINDS = {
    feed: (n = 3) => feedCard().repeat(n),
    reel: (n = 1) => reelCard().repeat(n),
    rows: (n = 6) => row().repeat(n),
    chat: (n = 6) => Array.from({ length: n }, (_, i) => msg(i % 3 === 0)).join(""),
  };
  function show(kind, target, count) {
    const el = typeof target === "string" ? document.getElementById(target) : target;
    if (!el || !KINDS[kind]) return;
    el.innerHTML = `<div class="sk-wrap">${KINDS[kind](count)}</div>`;
  }
  function clear(target) {
    const el = typeof target === "string" ? document.getElementById(target) : target;
    el && el.querySelector(".sk-wrap")?.remove();
  }
  return { show, clear };
})();

/* ============================================================
   Global features (every page)
   ============================================================ */

// Text size is applied as early as possible so the page doesn't jump.
(function applyTextSize() {
  const size = parseInt(store.raw("teaofrpm_textsize") || "100", 10);
  if (size && size !== 100) document.documentElement.style.fontSize = size + "%";
  window.setTextSize = (pct) => {
    const s = Math.min(130, Math.max(85, pct));
    document.documentElement.style.fontSize = s + "%";
    store.setRaw("teaofrpm_textsize", String(s));
    toast(`Text size ${s}%`);
  };
})();

(function globalUi() {
  const on = (ev, sel, fn) => document.addEventListener(ev, (e) => {
    const el = e.target.closest?.(sel);
    if (el) fn(e, el);
  });

  // Haptics on real actions
  on("click", ".reaction-chip, .emoji-picker span, .like-btn, .story-like-btn", () => buzz(12));
  on("click", "#sendBtn, .send-btn, .app-sheet-send", () => buzz(8));

  // [data-share] → the phone's share sheet, or copy the link
  on("click", "[data-share]", (e, el) => { e.preventDefault(); shareLink(el.dataset.share || location.href, el.dataset.shareTitle); });

  // Escape closes the innermost layer
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const picker = document.querySelector(".emoji-picker");
    if (picker) { picker.remove(); return; }
    if (AppNav.isOpen()) { e.preventDefault(); AppNav.exitFullscreen(); return; }
    document.querySelectorAll(".search-panel.show").forEach((p) => p.classList.remove("show"));
  });

  // Relative times refresh themselves
  setInterval(() => {
    if (document.hidden) return;
    document.querySelectorAll("[data-ts]").forEach((el) => { el.textContent = timeAgo(el.dataset.ts); });
  }, 60000);

  // Slow connection warning before a big upload
  document.addEventListener("change", (e) => {
    const c = navigator.connection;
    if (!c || !(e.target instanceof HTMLInputElement) || e.target.type !== "file") return;
    if (c.effectiveType === "2g" || c.effectiveType === "slow-2g" || c.saveData) toast("Your connection is slow — this upload may take a while");
  });

  // scripts sit at the end of <body>, so the page's markup is already here:
  // draw the icons now instead of waiting for DOMContentLoaded (no empty buttons)
  if (document.body) applyIconAttributes();
  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") init();
  let started = false;
  function init() {
    if (started) return;
    started = true;
    applyIconAttributes();
    offlineBanner();
    scrollToTop();
  }

  // navigator.onLine lies (iOS, VPNs), so "offline" is only shown after a
  // real request has failed.
  function offlineBanner() {
    const bar = document.createElement("div");
    bar.className = "extras-netbar";
    bar.textContent = "No internet — you're seeing saved content";
    document.body.appendChild(bar);
    const check = async () => {
      try { await fetch(location.pathname + "?ping=" + Date.now(), { method: "HEAD", cache: "no-store" }); bar.classList.remove("show"); }
      catch { bar.classList.add("show"); }
    };
    window.addEventListener("offline", check);
    window.addEventListener("online", () => bar.classList.remove("show"));
    if (!navigator.onLine) check();
  }

  function scrollToTop() {
    const scroller = document.querySelector(".profile-scroll, .feed");
    if (!scroller) return;
    const btn = document.createElement("button");
    btn.className = "extras-totop";
    btn.setAttribute("aria-label", "Back to top");
    btn.innerHTML = svgIcon("arrowUp", 18);
    document.body.appendChild(btn);
    btn.addEventListener("click", () => scroller.scrollTo({ top: 0, behavior: "smooth" }));
    let ticking = false;
    scroller.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; btn.classList.toggle("show", scroller.scrollTop > 700); });
    }, { passive: true });
  }
})();

/* ---------------- After login: presence, unread badge, screen time ---------------- */

const ACTIVE_KEY = "teaofrpm_show_active";
const Presence = {
  online: new Set(),
  listeners: new Set(),
  onChange(fn) { this.listeners.add(fn); fn(this.online); },
};

function afterBoot(me) {
  // Who's online — one shared presence channel for the whole app.
  if (store.raw(ACTIVE_KEY) !== "0") {
    const channel = sb.channel("teaofrpm-online", { config: { presence: { key: me.id } } });
    channel
      .on("presence", { event: "sync" }, () => {
        Presence.online = new Set(Object.keys(channel.presenceState()));
        Presence.online.delete(me.id);
        Presence.listeners.forEach((fn) => { try { fn(Presence.online); } catch (e) { console.error(e); } });
      })
      .subscribe(async (status) => { if (status === "SUBSCRIBED") await channel.track({ at: Date.now() }); });
  }

  // Unread chats → badge on the Messages tab and "(3)" in the tab title.
  const baseTitle = document.title;
  const refreshUnread = async () => {
    if (PAGE === "room.html") return;     // the chat page manages its own read state
    const { data } = await sb.rpc("my_conversations");
    if (!data) return;
    store.set("teaofrpm_inbox", { at: Date.now(), rows: data });
    data.forEach((c) => c.other_profile && rememberProfile(c.other_profile));
    const unread = data.reduce((n, c) => n + (c.unread > 0 && !c.muted && !c.is_request ? 1 : 0), 0);   // muted chats don't nag
    AppNav.setBadge("messages", unread);
    document.title = unread && document.hidden ? `(${unread}) ${baseTitle}` : baseTitle;
    window.dispatchEvent(new CustomEvent("app:inbox", { detail: data }));
  };
  App.refreshUnread = refreshUnread;
  const cachedInbox = store.get("teaofrpm_inbox");
  if (cachedInbox?.rows) AppNav.setBadge("messages", cachedInbox.rows.reduce((n, c) => n + (c.unread > 0 && !c.muted && !c.is_request ? 1 : 0), 0));
  if (PAGE !== "messages.html") {        // the inbox loads this itself
    (window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(refreshUnread);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { document.title = baseTitle; refreshUnread(); }
  });

  // Screen time — counted on every page, shown in Settings → Time management.
  const KEY = "teaofrpm_screentime";
  let notified = false;
  setInterval(() => {
    if (document.hidden) return;
    const today = new Date().toDateString();
    let s = store.get(KEY, {});
    if (s.day !== today) s = { day: today, seconds: 0 };
    s.seconds += 15;
    store.set(KEY, s);
    const limit = parseInt(store.raw("teaofrpm_limit") || "0", 10);
    if (limit && !notified && s.seconds >= limit * 60 && s.seconds < limit * 60 + 15) {
      notified = true;
      toast(`You've spent ${limit} minutes here today`, 4000);
    }
    window.dispatchEvent(new CustomEvent("app:screentime", { detail: s }));
  }, 15000);
}
