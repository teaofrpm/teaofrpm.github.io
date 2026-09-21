(function () {
  const cfg = window.TEAOFRPM_CONFIG;
  if (!cfg || cfg.SUPABASE_URL.includes("YOUR-PROJECT-ID")) {
    console.warn(
      "[teaofrpm] Supabase is not configured yet "
    );
  }
  window.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "teaofrpm-auth",
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });
})();



function toast(msg, ms = 2600) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), ms);
}

function escapeHTML(str) {
  if (str == null) return "";
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Deterministic gold/red/aqua-family avatar color from a name string,
// so the same person always gets the same avatar color.
function colorFromName(name) {
  const palette = ["#d8a53d", "#b52a3a", "#1fb6ad", "#c8863c", "#8f1e2b", "#3fa79d"];
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

async function requireSession(redirectTo = "index.html") {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.href = redirectTo;
    return null;
  }
  return data.session;
}

async function getMyProfile() {
  const { data: sess } = await sb.auth.getSession();
  if (!sess.session) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .eq("id", sess.session.user.id)
    .single();
  if (error) {
    console.error(error);
    return null;
  }
  return data;
}

const MAX_IMAGE_DIMENSION = 1600; // longest side, in px
const JPEG_QUALITY = 0.82;

// Re-encodes any photo the user picks (HEIC from iPhones, huge raw camera
// files, etc.) into a resized JPEG, using the browser's own decoder.
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        if (width >= height) {
          height = Math.round(height * (MAX_IMAGE_DIMENSION / width));
          width = MAX_IMAGE_DIMENSION;
        } else {
          width = Math.round(width * (MAX_IMAGE_DIMENSION / height));
          height = MAX_IMAGE_DIMENSION;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Could not process this image."));
          resolve(blob);
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This photo's format isn't supported by your browser."));
    };

    img.src = objectUrl;
  });
}

async function getProfileByUsername(username) {
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (error) {
    console.error(error);
    return null;
  }
  return data;
}

const profileCache = new Map(); // user_id -> profile (avoids refetching per message)

async function getProfile(userId) {
  if (profileCache.has(userId)) return profileCache.get(userId);
  const { data } = await sb.from("profiles").select("*").eq("id", userId).single();
  if (data) profileCache.set(userId, data);
  return data;
}

const ICON_PATHS = {
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
  heart: '<path d="M12 20s-7-4.4-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 5c-2.5 4.6-9.5 9-9.5 9z"/>',
  comment: '<path d="M4 4h16v12H9l-5 4z"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  check: '<path d="M5 12l5 5L20 6"/>',
  loadMore: '<path d="M12 5v10"/><path d="M7 11l5 5 5-5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
};

function svgIcon(name, size = 18) {
  const inner = ICON_PATHS[name] || "";
  return `<svg class="icon-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

function applyIconAttributes(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const size = el.dataset.iconSize || 18;
    el.innerHTML = svgIcon(el.dataset.icon, size);
  });
}

function setAvatarContent(el, person) {
  if (person && person.pfp_url) {
    el.style.backgroundImage = `url("${person.pfp_url}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.textContent = "";
  } else {
    el.style.backgroundImage = "";
    el.style.background = colorFromName(person ? person.display_name : "?");
    el.textContent = initials(person ? person.display_name : "?");
  }
}
