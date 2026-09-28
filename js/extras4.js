/* ============================================================
   extras4.js — batch 4 of the add-on layer. Same contract as the others:
   no existing function is edited, each feature is isolated, and removing
   the one <script> tag returns the app to how it was before this batch.

   1. Public room name + photo — shown everywhere, editable by the owner only
   2. Gap-fill — messages missed while the phone slept appear on return
   3. Active now — who's online, on the inbox, with a privacy switch
   4. Welcome card — /welcome and /rules finally shown to newcomers
   5. Install as an app — Android prompt, iPhone how-to
   ============================================================ */

(function () {
  "use strict";

  const say = (m) => (typeof toast === "function" ? toast(m) : console.log(m));
  const esc = (s) => (typeof escapeHTML === "function")
    ? escapeHTML(String(s ?? ""))
    : String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function feature(name, fn) {
    Promise.resolve().then(fn).catch((err) => console.error(`[extras4] ${name} failed:`, err));
  }

  const page = location.pathname.split("/").pop() || "index.html";
  const isRoomPage = page === "chat.html";
  const isGroupPage = page === "room.html";
  const isChat = isRoomPage || isGroupPage;
  const isInbox = page === "messages.html";
  const convoId = () => new URLSearchParams(location.search).get("c");
  const chatKey = () => convoId() || "room";
  const hasMe = () => typeof ME !== "undefined" && ME;

  function waitFor(cond, timeoutMs = 6000) {
    return new Promise((resolve) => {
      if (cond()) return resolve(true);
      const t0 = Date.now();
      const id = setInterval(() => {
        if (cond() || Date.now() - t0 > timeoutMs) { clearInterval(id); resolve(!!cond()); }
      }, 80);
    });
  }

  let booted = false;
  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();

  async function boot() {
    if (booted) return;
    booted = true;
    await waitFor(() => typeof sb !== "undefined");

    if (isRoomPage || isInbox) feature("public room profile", roomProfile);
    if (isChat) feature("gap-fill", gapFill);
    if (isChat) feature("welcome card", welcomeCard);
    feature("active now", activeNow);
    if (isInbox) feature("install app", installApp);
  }

  /* ============================================================
     1. Public room name + photo (owner only)
        The rule "only the owner" is enforced in the database by
        set_room_profile(); the edit button here is just convenience.
     ============================================================ */

  const DEFAULT_ROOM_NAME = "RPM Public Room";
  let roomState = { room_name: null, room_pfp_url: null };

  async function roomProfile() {
    const { data } = await sb.from("bot_room_settings")
      .select("room_name,room_pfp_url").eq("id", 1).maybeSingle();
    if (data) roomState = data;
    applyRoomProfile();

    sb.channel("x4-room-profile")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bot_room_settings", filter: "id=eq.1" },
        ({ new: row }) => {
          if (!row) return;
          roomState = { room_name: row.room_name, room_pfp_url: row.room_pfp_url };
          applyRoomProfile();
        })
      .subscribe();

    if (isRoomPage) {
      await waitFor(hasMe);
      if (ME.role === "owner") addOwnerEditor();
    }
  }

  function paintAvatar(el, url, fallbackText) {
    if (url) {
      el.style.backgroundImage = `url("${url}")`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
      el.textContent = "";
    } else {
      el.style.backgroundImage = "";
      el.textContent = fallbackText;
    }
  }

  function applyRoomProfile() {
    const name = roomState.room_name;

    if (isRoomPage) {
      const title = document.getElementById("headerRoomName");
      if (title) {
        if (!title.dataset.original) title.dataset.original = title.textContent;
        title.textContent = name || title.dataset.original;
        let av = document.querySelector(".x4-room-av");
        if (!av) {
          av = document.createElement("span");
          av.className = "avatar x4-room-av";
          title.insertAdjacentElement("beforebegin", av);
        }
        paintAvatar(av, roomState.room_pfp_url, "RPM");
      }
      document.title = `${name || DEFAULT_ROOM_NAME} — teaofrpm`;
    }

    if (isInbox) {
      const row = document.querySelector('a.thread-row.pinned[href="chat.html"]');
      if (!row) return;
      const b = row.querySelector(".thread-text b");
      if (b) {
        if (!b.dataset.original) b.dataset.original = b.textContent;
        b.textContent = name || b.dataset.original;
      }
      const av = row.querySelector(".thread-avatar");
      if (av) paintAvatar(av, roomState.room_pfp_url, "RPM");
    }
  }

  function addOwnerEditor() {
    const title = document.getElementById("headerRoomName");
    if (!title || document.querySelector(".x4-room-edit")) return;

    const btn = document.createElement("button");
    btn.className = "header-icon-btn x4-room-edit";
    btn.type = "button";
    btn.title = "Edit room name and photo (owner)";
    btn.textContent = "✎";
    title.insertAdjacentElement("afterend", btn);

    const bd = document.createElement("div");
    bd.className = "app-sheet-backdrop x4-sheet";
    bd.innerHTML = `
      <div class="app-sheet">
        <div class="app-sheet-handle"></div>
        <div class="app-sheet-title">Public room <span class="x4-owner-tag">OWNER</span></div>
        <div class="x4-edit-body">
          <div class="x4-edit-photo">
            <span class="avatar x4-edit-av"></span>
            <div class="x4-edit-photo-btns">
              <label class="btn btn-small x4-file-label">Change photo
                <input type="file" accept="image/*" id="x4RoomPhoto" hidden />
              </label>
              <button type="button" class="btn-outline btn btn-small" id="x4RoomPhotoRemove">Remove photo</button>
            </div>
          </div>
          <label class="x4-label" for="x4RoomName">Room name</label>
          <input class="x4-input" id="x4RoomName" maxlength="40" autocomplete="off" />
          <div class="x4-counter"><span id="x4RoomNameCount">0</span>/40</div>
          <button type="button" class="btn x4-full" id="x4RoomSave">Save name</button>
          <p class="x4-hint">Only you can see this. Everyone gets a note in the room when you change it.</p>
        </div>
      </div>`;
    document.body.appendChild(bd);

    const nameInput = bd.querySelector("#x4RoomName");
    const editAv = bd.querySelector(".x4-edit-av");
    const close = () => bd.classList.remove("show");
    bd.addEventListener("click", (e) => { if (e.target === bd) close(); });

    btn.addEventListener("click", () => {
      nameInput.value = roomState.room_name || "";
      nameInput.placeholder = DEFAULT_ROOM_NAME;
      bd.querySelector("#x4RoomNameCount").textContent = nameInput.value.length;
      paintAvatar(editAv, roomState.room_pfp_url, "RPM");
      bd.querySelector("#x4RoomPhotoRemove").style.display = roomState.room_pfp_url ? "" : "none";
      bd.classList.add("show");
    });

    nameInput.addEventListener("input", () => {
      bd.querySelector("#x4RoomNameCount").textContent = nameInput.value.length;
    });

    bd.querySelector("#x4RoomSave").addEventListener("click", async (e) => {
      const name = nameInput.value.replace(/\s+/g, " ").trim();
      if (!name) { say("The room needs a name."); return; }
      if (name === roomState.room_name) { close(); return; }
      e.target.disabled = true;
      const { error } = await sb.rpc("set_room_profile", { p_name: name });
      e.target.disabled = false;
      if (error) { say(error.message || "Could not rename the room."); return; }
      roomState.room_name = name;
      applyRoomProfile();
      close();
      say("Room renamed");
    });

    bd.querySelector("#x4RoomPhoto").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) { say("Pick an image."); return; }

      editAv.classList.add("uploading");
      try {
        // same squeeze every other avatar gets: small, fast, a few KB
        const blob = typeof compressImageFile === "function" ? await compressImageFile(file) : file;
        const path = `public-room/${Date.now()}.jpg`;
        const { error: upErr } = await sb.storage.from("avatars")
          .upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
        if (upErr) throw upErr;
        const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;

        const { error } = await sb.rpc("set_room_profile", { p_pfp_url: url });
        if (error) throw error;

        roomState.room_pfp_url = url;
        applyRoomProfile();
        paintAvatar(editAv, url, "RPM");
        bd.querySelector("#x4RoomPhotoRemove").style.display = "";
        say("Room photo updated");
      } catch (err) {
        say(err.message || "Could not update the photo.");
      } finally {
        editAv.classList.remove("uploading");
      }
    });

    bd.querySelector("#x4RoomPhotoRemove").addEventListener("click", async () => {
      if (!confirm("Remove the room photo?")) return;
      const { error } = await sb.rpc("set_room_profile", { p_clear_pfp: true });
      if (error) { say(error.message || "Could not remove the photo."); return; }
      roomState.room_pfp_url = null;
      applyRoomProfile();
      paintAvatar(editAv, null, "RPM");
      bd.querySelector("#x4RoomPhotoRemove").style.display = "none";
    });
  }

  /* ============================================================
     2. Gap-fill
        Phones close the live connection when the screen locks or the app
        goes to the background. Messages sent in that window never arrive
        over realtime, so the chat silently misses them until a full refresh.
        On return, this fetches anything newer than when we left and hands
        it to the page's own rendering function — the same one realtime uses.
     ============================================================ */

  function gapFill() {
    let leftAt = null;
    let offlineAt = null;

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { leftAt = Date.now(); return; }
      if (leftAt && Date.now() - leftAt > 10000) fill(leftAt - 20000);
      leftAt = null;
    });
    window.addEventListener("offline", () => { offlineAt = Date.now(); });
    window.addEventListener("online", () => {
      fill((offlineAt || Date.now() - 120000) - 20000);
      offlineAt = null;
    });

    let running = false;
    async function fill(sinceMs) {
      if (running) return;
      running = true;
      try {
        await waitFor(hasMe);
        let q = sb.from("messages").select("*")
          .eq("deleted", false)
          .gt("created_at", new Date(sinceMs).toISOString())
          .order("created_at", { ascending: true })
          .limit(100);
        q = convoId() ? q.eq("conversation_id", convoId()) : q.is("conversation_id", null);
        const { data, error } = await q;
        if (error || !data?.length) return;

        const fresh = data.filter((m) => !document.querySelector(`[data-msg-id="${m.id}"]`));
        if (!fresh.length) return;
        if (typeof getProfiles === "function") await getProfiles(fresh.map((m) => m.user_id));

        const box = document.getElementById("messages");
        const nearBottom = box && box.scrollHeight - box.scrollTop - box.clientHeight < 200;

        for (const m of fresh) {
          if (document.querySelector(`[data-msg-id="${m.id}"]`)) continue;   // realtime may have caught up meanwhile
          if (isRoomPage && typeof appendLiveMessage === "function") await appendLiveMessage(m, []);
          else if (isGroupPage && typeof appendMessage === "function") appendMessage(m, box);
        }
        if (box && nearBottom) box.scrollTop = box.scrollHeight;
        say(`${fresh.length} new message${fresh.length === 1 ? "" : "s"}`);
      } finally {
        running = false;
      }
    }
  }

  /* ============================================================
     3. Active now
        One shared presence channel. The inbox shows who's online and puts
        a green dot on their chat. Anyone can switch it off in Settings —
        and, like Instagram, switching it off also hides others from you.
     ============================================================ */

  const ACTIVE_KEY = "teaofrpm_show_active";
  const showingActive = () => localStorage.getItem(ACTIVE_KEY) !== "0";

  async function activeNow() {
    if (page === "settings.html") addActiveToggle();
    if (!showingActive()) return;

    const { data: sess } = await sb.auth.getSession();
    const myId = sess?.session?.user?.id;
    if (!myId) return;

    let online = new Set();
    const channel = sb.channel("teaofrpm-online", { config: { presence: { key: myId } } });
    channel
      .on("presence", { event: "sync" }, () => {
        online = new Set(Object.keys(channel.presenceState()));
        online.delete(myId);
        if (isInbox) renderActive(online);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ at: Date.now() });
      });
  }

  let dmPartners = null;   // conversation id -> the other person, for green dots
  async function renderActive(online) {
    let strip = document.getElementById("x4Active");
    if (!strip) {
      const scroll = document.getElementById("inboxScroll");
      if (!scroll) return;
      strip = document.createElement("div");
      strip.id = "x4Active";
      strip.className = "x4-active";
      scroll.insertBefore(strip, scroll.firstChild);
      strip.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-uid]");
        if (!b) return;
        const { data, error } = await sb.rpc("get_or_create_dm", { other_user: b.dataset.uid });
        if (error) { say(error.message || "Could not open that chat."); return; }
        location.href = `room.html?c=${data}`;
      });
    }

    const ids = [...online].slice(0, 20);
    if (!ids.length) { strip.innerHTML = ""; strip.classList.remove("show"); }
    else {
      if (typeof getProfiles === "function") await getProfiles(ids);
      const people = ids.map((id) => (typeof profileCache !== "undefined" ? profileCache.get(id) : null)).filter(Boolean);
      strip.innerHTML = `<div class="x4-active-label">Active now · ${people.length}</div>
        <div class="x4-active-row">${people.map((p) => `
          <button type="button" class="x4-active-person" data-uid="${p.id}">
            <span class="avatar x4-active-av" data-av="${p.id}"></span>
            <span class="x4-active-name">${esc((p.display_name || "").split(" ")[0])}</span>
          </button>`).join("")}</div>`;
      people.forEach((p) => {
        const av = strip.querySelector(`[data-av="${p.id}"]`);
        if (av && typeof setAvatarContent === "function") setAvatarContent(av, p);
      });
      strip.classList.add("show");
    }

    // green dots on DM rows
    if (!dmPartners) {
      const { data } = await sb.rpc("my_conversations");
      dmPartners = new Map((data || []).filter((c) => c.kind === "dm").map((c) => [c.id, c.other_user_id]));
    }
    document.querySelectorAll('a.thread-row[href*="room.html?c="]').forEach((a) => {
      const other = dmPartners.get(new URL(a.href, location.href).searchParams.get("c"));
      const av = a.querySelector(".thread-avatar");
      if (!av) return;
      av.classList.toggle("x4-online", !!other && online.has(other));
    });
  }

  function addActiveToggle() {
    const root = document.querySelector('.settings-panel[data-panel="root"]');
    if (!root || root.querySelector(".x4-active-toggle")) return;
    const group = document.createElement("div");
    group.className = "settings-group x4-active-toggle";
    group.innerHTML = `
      <div class="settings-group-title">Privacy</div>
      <label class="settings-row x4-toggle-row">
        <span class="settings-row-text"><b>Show when you're active</b>
          <span>Turn off to hide from "Active now" — you won't see others either</span></span>
        <input type="checkbox" id="x4ActiveSwitch" ${showingActive() ? "checked" : ""} />
      </label>`;
    root.insertBefore(group, root.firstChild);
    group.querySelector("#x4ActiveSwitch").addEventListener("change", (e) => {
      localStorage.setItem(ACTIVE_KEY, e.target.checked ? "1" : "0");
      say(e.target.checked ? "People can see when you're active" : "Active status hidden");
    });
  }

  /* ============================================================
     4. Welcome card
        /welcome and /setrules saved text that nothing ever showed. Now a
        newcomer — or anyone, once the text changes — gets a card with the
        welcome and the rules, dismissed with one tap.
     ============================================================ */

  async function welcomeCard() {
    let welcome = null, rules = null;
    if (isRoomPage) {
      const { data } = await sb.from("bot_room_settings").select("welcome,rules").eq("id", 1).maybeSingle();
      welcome = data?.welcome; rules = data?.rules;
    } else {
      const id = convoId();
      if (!id) return;
      const { data } = await sb.from("bot_settings").select("welcome,rules").eq("conversation_id", id).maybeSingle();
      welcome = data?.welcome; rules = data?.rules;
    }
    welcome = (welcome || "").trim(); rules = (rules || "").trim();
    if (!welcome && !rules) return;

    // remembered per chat AND per text, so an edited welcome shows once more
    const key = `teaofrpm_welcome_${chatKey()}`;
    const fingerprint = `${welcome.length}:${rules.length}:${welcome.slice(0, 40)}|${rules.slice(0, 40)}`;
    if (localStorage.getItem(key) === fingerprint) return;

    const card = document.createElement("div");
    card.className = "x4-welcome";
    card.innerHTML = `
      <img src="images/bot.png" alt="" class="x4-welcome-bot" width="30" height="30" />
      <div class="x4-welcome-body">
        ${welcome ? `<div class="x4-welcome-text">${esc(welcome)}</div>` : `<div class="x4-welcome-text">Welcome!</div>`}
        ${rules ? `<details class="x4-welcome-rules"><summary>Read the rules</summary><div>${esc(rules)}</div></details>` : ""}
        <button type="button" class="x4-welcome-ok">Got it</button>
      </div>`;
    card.querySelector(".x4-welcome-ok").addEventListener("click", () => {
      localStorage.setItem(key, fingerprint);
      card.remove();
    });

    const header = document.querySelector(".chat-header");
    const after = document.querySelector(".x3-catchup") || header;
    after?.insertAdjacentElement("afterend", card);
  }

  /* ============================================================
     5. Install as an app
        With the service worker in place, Android Chrome can install the
        site like a real app. iPhones can't be prompted by a website, so
        they get a one-time how-to instead.
     ============================================================ */

  function installApp() {
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) return;
    const snoozed = Number(localStorage.getItem("teaofrpm_install_snooze") || 0);
    if (Date.now() < snoozed) return;

    const scroll = document.getElementById("inboxScroll");
    if (!scroll) return;

    const show = (html, onGo) => {
      if (document.querySelector(".x4-install")) return;
      const bar = document.createElement("div");
      bar.className = "x4-install";
      bar.innerHTML = `<span class="x4-install-text">${html}</span>
        ${onGo ? `<button type="button" class="x4-install-go">Install</button>` : ""}
        <button type="button" class="x4-install-x" aria-label="Not now">✕</button>`;
      bar.querySelector(".x4-install-x").addEventListener("click", () => {
        localStorage.setItem("teaofrpm_install_snooze", String(Date.now() + 7 * 86400000));
        bar.remove();
      });
      if (onGo) bar.querySelector(".x4-install-go").addEventListener("click", onGo);
      scroll.insertBefore(bar, scroll.firstChild);
    };

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      show("📲 <b>Install teaofrpm</b> — opens like an app, faster", async () => {
        e.prompt();
        const { outcome } = await e.userChoice;
        document.querySelector(".x4-install")?.remove();
        if (outcome === "accepted") say("Installed");
      });
    });

    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (isIOS && !localStorage.getItem("teaofrpm_ios_hint")) {
      localStorage.setItem("teaofrpm_ios_hint", "1");
      show("📲 <b>Use it like an app:</b> tap <b>Share</b> → <b>Add to Home Screen</b>");
    }
  }
})();
