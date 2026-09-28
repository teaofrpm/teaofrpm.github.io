/* ============================================================
   extras2.js — batch 2 of the add-on layer. Same rules as extras.js:
   nothing here edits an existing function, everything attaches from the
   outside, and one failing feature cannot take another down. Delete this
   one script tag and the app is exactly as it was before this batch.
   ============================================================ */

(function () {
  "use strict";

  const on = (ev, sel, fn) => document.addEventListener(ev, (e) => {
    const el = e.target.closest?.(sel);
    if (el) fn(e, el);
  });
  const say = (m) => (typeof toast === "function" ? toast(m) : console.log(m));
  function feature(name, fn) {
    try { fn(); } catch (err) { console.error(`[extras2] ${name} failed:`, err); }
  }

  const page = location.pathname.split("/").pop() || "index.html";
  const isChat = page === "chat.html" || page === "room.html";
  const isInbox = page === "messages.html";

  let ready = false;
  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();

  async function boot() {
    if (ready) return;
    ready = true;

    // These features need `sb` (the Supabase client) and, on a chat page,
    // the page's own `ME` / `convo`. Those are set a little after DOMContentLoaded
    // by chat.js / room.js, so we poll briefly rather than guessing a delay.
    await waitFor(() => typeof sb !== "undefined");

    feature("star message", starMessage);
    feature("starred panel", starredPanel);
    feature("pin message", pinMessage);
    feature("mute conversation", muteConversation);
    feature("report", reportFeature);
    feature("seen receipt", seenReceipt);
    feature("multi-select delete", multiSelectDelete);
    feature("forward message", forwardMessage);
    feature("global message search", globalMessageSearch);
    feature("unread count in tab title", unreadTabTitle);
    feature("tap toggles action bar", tapToggleActions);
  }

  function waitFor(cond, timeoutMs = 4000) {
    return new Promise((resolve) => {
      if (cond()) return resolve(true);
      const t0 = Date.now();
      const id = setInterval(() => {
        if (cond() || Date.now() - t0 > timeoutMs) { clearInterval(id); resolve(cond()); }
      }, 80);
    });
  }

  function currentConvoId() {
    return new URLSearchParams(location.search).get("c");
  }

  // A small menu is added to every message's action bar, next to the
  // existing reply/react/copy buttons, without touching the code that
  // builds those buttons.
  function addToActionBar(row, cls, build) {
    const bar = row.querySelector(".msg-actions");
    if (!bar || bar.querySelector("." + cls)) return;   // this feature's own button, not a shared flag
    build(bar, row);
  }

  function watchMessages(fn) {
    const msgs = document.getElementById("messages");
    if (!msgs) return;
    let t;
    const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(fn, 100); });
    mo.observe(msgs, { childList: true, subtree: true });
    fn();
    return mo;
  }

  /* ---------- 1 & 2. Star / save a message, and a panel to view them ---------- */

  // One ⋯ button per message now opens Save / Pin / Forward / Copy link /
  // Report. They used to be five separate icons, which pushed the action bar
  // wider than the bubble on a phone.
  function starMessage() {
    if (!isChat) return;
    watchMessages(() => {
      document.querySelectorAll("[data-msg-id]").forEach((row) => {
        if (row.classList.contains("bot-msg-row") || row.classList.contains("system-msg-row")) return;
        addToActionBar(row, "more-msg-btn", (bar) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "more-msg-btn";
          b.title = "More";
          b.innerHTML = svgIcon("more", 15);
          bar.appendChild(b);
          b.addEventListener("click", (e) => { e.stopPropagation(); openMoreMenu(row, b); });
          if (!starredIds.has(row.dataset.msgId)) pendingStarChecks.add(row.dataset.msgId);
        });
      });
      flushStarChecks();
    });
  }

  // Which of the messages on screen you've saved — learnt in one batched
  // query per render, never one query per message.
  const starredIds = new Set();
  const pendingStarChecks = new Set();
  async function flushStarChecks() {
    if (!pendingStarChecks.size || typeof ME === "undefined" || !ME) return;
    const batch = [...pendingStarChecks];
    pendingStarChecks.clear();
    const { data } = await sb.from("message_stars").select("message_id")
      .eq("user_id", ME.id).in("message_id", batch);
    (data || []).forEach((r) => starredIds.add(r.message_id));
  }

  async function toggleStar(messageId) {
    const starred = starredIds.has(messageId);
    if (starred) starredIds.delete(messageId); else starredIds.add(messageId);   // flip first, feels instant

    const { error } = starred
      ? await sb.from("message_stars").delete().eq("message_id", messageId).eq("user_id", ME.id)
      : await sb.from("message_stars").insert({ message_id: messageId, user_id: ME.id });

    if (error) {
      if (starred) starredIds.add(messageId); else starredIds.delete(messageId);  // undo on failure
      say("Could not update.");
    } else {
      say(starred ? "Removed from saved" : "Saved");
    }
  }

  /* ---------- the ⋯ menu itself ---------- */

  let moreMenu = null;
  function closeMoreMenu() {
    if (!moreMenu) return;
    moreMenu.classList.remove("show");
    const m = moreMenu; moreMenu = null;
    setTimeout(() => m.remove(), 160);
  }
  document.addEventListener("click", (e) => { if (moreMenu && !moreMenu.contains(e.target)) closeMoreMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMoreMenu(); });
  document.addEventListener("scroll", closeMoreMenu, true);

  function openMoreMenu(row, anchor) {
    const wasOpenHere = moreMenu && moreMenu.dataset.for === row.dataset.msgId;
    closeMoreMenu();
    if (wasOpenHere) return;

    const id = row.dataset.msgId;
    const own = row.classList.contains("own");
    const saved = starredIds.has(id);
    const items = [
      ["star", saved ? "Unsave" : "Save", () => toggleStar(id), saved ? "is-on" : ""],
      ["pin", "Pin", () => pinThisMessage(id)],
      ["forward", "Forward", () => openForwardSheetRef && openForwardSheetRef(id)],
      ["link", "Copy link", () => copyMessageLink(id)],
      ...(own ? [] : [["flag", "Report", () => submitReport("message", id), "is-danger"]]),
    ];

    const menu = document.createElement("div");
    menu.className = "x2-more";
    menu.dataset.for = id;
    menu.innerHTML = items.map(([icon, label, , cls], i) => `
      <button type="button" class="x2-more-item x2-ic-${icon} ${cls || ""}" data-i="${i}" style="--i:${i}">
        ${svgIcon(icon, 17)}<span>${label}</span>
      </button>`).join("");
    document.body.appendChild(menu);

    // place it next to the ⋯ button, flipped/clamped so it never leaves the screen
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth || 180, h = menu.offsetHeight || 220;
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    const below = r.bottom + 6 + h < window.innerHeight - 8;
    menu.style.left = `${left}px`;
    menu.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
    menu.style.transformOrigin = below ? "top right" : "bottom right";

    menu.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      e.stopPropagation();
      closeMoreMenu();
      items[Number(b.dataset.i)][2]();
    });

    moreMenu = menu;
    requestAnimationFrame(() => menu.classList.add("show"));
  }

  async function copyMessageLink(id) {
    const url = `${location.origin}${location.pathname}${location.search}#m=${id}`;
    try { await navigator.clipboard.writeText(url); say("Link copied"); }
    catch { say("Could not copy"); }
  }

  function starredPanel() {
    if (!isInbox) return;
    const nav = document.getElementById("appNav") || document.querySelector(".profile-topbar");
    if (!nav) return;

    const btn = document.createElement("button");
    btn.className = "header-icon-btn extras2-starred-entry x2-ic-star";
    btn.title = "Saved messages";
    btn.innerHTML = svgIcon("star", 18);
    document.querySelector(".profile-topbar")?.appendChild(btn);

    const sheet = document.createElement("div");
    sheet.className = "app-sheet-backdrop";
    sheet.innerHTML = `
      <div class="app-sheet">
        <div class="app-sheet-handle"></div>
        <div class="app-sheet-title">Saved messages</div>
        <div class="settings-list" id="extras2-starred-list"></div>
      </div>`;
    document.body.appendChild(sheet);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.classList.remove("show"); });

    btn.addEventListener("click", async () => {
      sheet.classList.add("show");
      const list = document.getElementById("extras2-starred-list");
      list.innerHTML = `<div class="settings-empty">Loading…</div>`;

      const { data, error } = await sb.from("message_stars")
        .select("message_id, created_at, messages(id, content, sticker_url, image_url, user_id, conversation_id, created_at)")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error || !data?.length) {
        list.innerHTML = `<div class="settings-empty">Nothing saved yet — tap ⋯ → Save on any message.</div>`;
        return;
      }

      const ids = data.map(r => r.messages?.user_id).filter(Boolean);
      await getProfiles(ids);
      list.innerHTML = "";

      for (const r of data) {
        const m = r.messages;
        if (!m) continue;
        const author = profileCache.get(m.user_id);
        const row = document.createElement("a");
        row.className = "settings-list-row";
        row.href = m.conversation_id ? `room.html?c=${m.conversation_id}` : "chat.html";
        row.innerHTML = `
          <div style="flex:1; min-width:0;">
            <div class="settings-list-name">${escapeHTML(author?.display_name || "Someone")}</div>
            <div class="settings-list-sub" style="white-space:normal;">${escapeHTML(
              m.content || (m.image_url ? "Photo" : m.sticker_url ? "Sticker" : "message")
            ).slice(0, 140)}</div>
          </div>`;
        list.appendChild(row);
      }
    });
  }

  /* ---------- 3. Pin a message to the top of a group/DM ---------- */

  function pinMessage() {
    if (!isChat) return;   // public room and groups get the same feature
    renderPinnedBanner();

    // keep the banner in step with anyone else pinning/unpinning
    const convo = currentConvoId();   // null on the public room
    const channel = convo
      ? sb.channel(`extras2-pin:${convo}`).on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${convo}`,
        }, (payload) => { if ("pinned_message_id" in (payload.new || {})) renderPinnedBanner(); })
      : sb.channel("extras2-pin:room").on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "bot_room_settings", filter: "id=eq.1",
        }, (payload) => { if ("pinned_message_id" in (payload.new || {})) renderPinnedBanner(); });
    channel.subscribe();
  }

  async function pinThisMessage(messageId) {
    const convo = currentConvoId();     // null on the public room — that's a valid target, not "no chat open"
    const { error } = await sb.rpc("set_pinned_message", { p_conversation: convo || null, p_message: messageId });
    if (error) { say(error.message || "Could not pin."); return; }
    say("Pinned");
    renderPinnedBanner();
  }

  async function renderPinnedBanner() {
    const convo = currentConvoId();
    document.querySelector(".extras2-pin-banner")?.remove();

    let pinnedId;
    if (convo) {
      const { data: c } = await sb.from("conversations").select("pinned_message_id").eq("id", convo).maybeSingle();
      pinnedId = c?.pinned_message_id;
    } else {
      const { data: s } = await sb.from("bot_room_settings").select("pinned_message_id").eq("id", 1).maybeSingle();
      pinnedId = s?.pinned_message_id;
    }
    if (!pinnedId) return;

    const { data: m } = await sb.from("messages").select("content,user_id")
      .eq("id", pinnedId).maybeSingle();
    if (!m) return;

    const author = await getProfile(m.user_id);
    const banner = document.createElement("div");
    banner.className = "extras2-pin-banner";
    banner.innerHTML = `
      <span class="pin-icon">${svgIcon("pin", 15)}</span>
      <div class="pin-text"><b>${escapeHTML(author?.display_name || "Someone")}</b>: ${escapeHTML((m.content || "media").slice(0, 80))}</div>
      <button class="pin-goto x2-ic-arrowDown" title="Jump to message">${svgIcon("arrowDown", 15)}</button>
      <button class="pin-clear x2-ic-close" title="Unpin">${svgIcon("close", 14)}</button>`;

    banner.querySelector(".pin-goto").addEventListener("click", () => {
      document.querySelector(`[data-msg-id="${pinnedId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    banner.querySelector(".pin-clear").addEventListener("click", async () => {
      await sb.rpc("set_pinned_message", { p_conversation: convo || null, p_message: null });
      banner.remove();
    });

    const host = document.querySelector(".chat-header, .profile-topbar");
    host?.insertAdjacentElement("afterend", banner);
  }

  /* ---------- 4. Mute a conversation's notifications ---------- */

  function muteConversation() {
    if (page !== "room.html") return;
    const infoActions = document.querySelector(".room-info-actions, .app-sheet");
    if (!infoActions) return;

    const convo = currentConvoId();
    if (!convo) return;

    const btn = document.createElement("button");
    btn.className = "btn-outline btn btn-small extras2-mute-btn";
    btn.textContent = "Mute notifications";
    btn.style.width = "100%";
    btn.style.marginTop = "10px";

    // dropped into whichever sheet holds the group/DM details, wherever it is
    const target = document.querySelector("#roomInfoSheet .app-sheet, .details-sheet .app-sheet") || infoActions;
    target.appendChild(btn);

    (async () => {
      if (typeof ME === "undefined" || !ME) return;
      const { data } = await sb.from("conversation_members").select("muted")
        .eq("conversation_id", convo).eq("user_id", ME.id).maybeSingle();
      setMuteLabel(btn, data?.muted);
    })();

    btn.addEventListener("click", async () => {
      const nowMuted = btn.dataset.muted === "1";
      const { error } = await sb.from("conversation_members")
        .update({ muted: !nowMuted }).eq("conversation_id", convo).eq("user_id", ME.id);
      if (error) { say("Could not update."); return; }
      setMuteLabel(btn, !nowMuted);
      say(!nowMuted ? "Muted" : "Unmuted");
    });
  }

  function setMuteLabel(btn, muted) {
    btn.dataset.muted = muted ? "1" : "0";
    btn.textContent = muted ? "Unmute notifications" : "Mute notifications";
  }

  /* ---------- 5. Report a message or a person ---------- */

  function reportFeature() {
    if (page === "profile.html") {
      const header = document.querySelector(".profile-topbar");
      if (!header || header.querySelector(".extras2-report-user")) return;
      const btn = document.createElement("button");
      btn.className = "header-icon-btn extras2-report-user x2-ic-flag";
      btn.title = "Report this account";
      btn.innerHTML = svgIcon("flag", 17);
      header.appendChild(btn);
      btn.addEventListener("click", () => {
        const uid = (typeof viewedUser !== "undefined" && viewedUser) ? viewedUser.id : null;
        if (!uid || (typeof ME !== "undefined" && uid === ME.id)) { say("Nothing to report here."); return; }
        submitReport("user", uid);
      });
    }
  }

  async function submitReport(type, id) {
    const reason = prompt(type === "user" ? "Why are you reporting this account?" : "Why are you reporting this message?");
    if (reason === null) return;
    const { error } = await sb.from("reports").insert({
      reporter_id: ME.id, target_type: type, target_id: id, reason: reason || null,
    });
    say(error ? (error.message || "Could not send the report.") : "Reported. Thanks for flagging it.");
  }

  /* ---------- 6. "Seen" receipt in a DM ---------- */

  // The old version stamped each message with the moment it was DRAWN on
  // screen, then compared that with when the other person last read the
  // chat — so "Seen" was essentially random. This uses the message's real
  // send time, in one query, and says "Seen by N" in a group.
  function seenReceipt() {
    if (page !== "room.html") return;
    const convo = currentConvoId();
    if (!convo) return;
    let lastPaintedFor = null;

    async function paint() {
      if (typeof ME === "undefined" || !ME) return;
      const mine = [...document.querySelectorAll(".msg-row.own[data-msg-id]")];
      const lastOwn = mine[mine.length - 1];
      document.querySelectorAll(".extras2-seen").forEach((el) => {
        if (!lastOwn || !lastOwn.contains(el)) el.remove();
      });
      if (!lastOwn) return;

      const [{ data: msg }, { data: members }] = await Promise.all([
        sb.from("messages").select("created_at").eq("id", lastOwn.dataset.msgId).maybeSingle(),
        sb.from("conversation_members").select("user_id,last_read_at").eq("conversation_id", convo),
      ]);
      if (!msg || !members) return;

      const others = members.filter((m) => m.user_id !== ME.id);
      const seenBy = others.filter((m) => m.last_read_at && m.last_read_at >= msg.created_at).length;

      let tag = lastOwn.querySelector(".extras2-seen");
      if (!seenBy) { tag?.remove(); return; }
      const text = others.length === 1 ? "Seen" : `Seen by ${seenBy}`;
      if (tag && tag.textContent === text) return;
      if (!tag) {
        tag = document.createElement("div");
        tag.className = "extras2-seen";
        // under the bubble, not beside it: the row is a left-to-right flexbox,
        // the bubble's own wrapper is the column it belongs in
        (lastOwn.querySelector(".bubble")?.parentElement || lastOwn).appendChild(tag);
      }
      tag.textContent = text;
      lastPaintedFor = lastOwn.dataset.msgId;
    }

    watchMessages(() => {
      const mine = document.querySelectorAll(".msg-row.own[data-msg-id]");
      const lastId = mine[mine.length - 1]?.dataset.msgId;
      if (lastId !== lastPaintedFor) paint();
    });

    // conversation_members is now in the realtime publication, so this fires
    sb.channel(`extras2-seen:${convo}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${convo}`,
      }, paint)
      .subscribe();
  }

  /* ---------- 7. Select several messages and delete them together ---------- */

  function multiSelectDelete() {
    if (!isChat) return;
    let selecting = false;
    const selected = new Set();

    const bar = document.createElement("div");
    bar.className = "extras2-selectbar";
    bar.innerHTML = `<span id="extras2-selcount">0 selected</span>
      <button id="extras2-seldelete">Delete</button>
      <button id="extras2-selcancel">Cancel</button>`;
    document.body.appendChild(bar);

    bar.querySelector("#extras2-selcancel").addEventListener("click", stopSelecting);
    bar.querySelector("#extras2-seldelete").addEventListener("click", async () => {
      if (!selected.size) return;
      if (!confirm(`Delete ${selected.size} message(s)? This can't be undone.`)) return;
      const ids = [...selected];
      const { error } = await sb.from("messages").update({ deleted: true })
        .in("id", ids).eq("user_id", ME.id);
      if (error) { say(error.message || "Some messages could not be deleted."); }
      ids.forEach(id => document.querySelector(`[data-msg-id="${id}"]`)?.remove());
      stopSelecting();
    });

    let pressTimer;
    document.addEventListener("touchstart", (e) => {
      const row = e.target.closest?.("[data-msg-id]");
      if (!row || row.classList.contains("bot-msg-row") || row.classList.contains("system-msg-row")) return;
      if (!row.classList.contains("own")) return;   // only your own messages can be bulk-deleted
      pressTimer = setTimeout(() => startSelecting(row), 480);
    }, { passive: true });
    ["touchend", "touchmove"].forEach(ev =>
      document.addEventListener(ev, () => clearTimeout(pressTimer), { passive: true }));

    let startedAt = 0;
    on("click", "[data-msg-id]", (e, row) => {
      if (!selecting) return;
      if (!row.classList.contains("own")) return;
      // lifting the finger after a long-press sends one click; without this
      // it immediately un-selected the message the long-press just selected
      if (Date.now() - startedAt < 700) return;
      e.stopPropagation();
      toggleSelect(row);
    });

    function startSelecting(row) {
      startedAt = Date.now();
      selecting = true;
      document.body.classList.add("extras2-selecting");
      bar.classList.add("show");
      toggleSelect(row);
    }
    function toggleSelect(row) {
      const id = row.dataset.msgId;
      if (selected.has(id)) { selected.delete(id); row.classList.remove("extras2-selected"); }
      else { selected.add(id); row.classList.add("extras2-selected"); }
      document.getElementById("extras2-selcount").textContent = `${selected.size} selected`;
    }
    function stopSelecting() {
      selecting = false;
      selected.clear();
      document.body.classList.remove("extras2-selecting");
      document.querySelectorAll(".extras2-selected").forEach(r => r.classList.remove("extras2-selected"));
      bar.classList.remove("show");
    }
  }

  /* ---------- 8. Forward a message to another chat ---------- */

  let openForwardSheetRef = null;
  function forwardMessage() {
    if (!isChat) return;
    openForwardSheetRef = (id) => openForwardSheet(id);

    const sheet = document.createElement("div");
    sheet.className = "app-sheet-backdrop";
    sheet.innerHTML = `
      <div class="app-sheet">
        <div class="app-sheet-handle"></div>
        <div class="app-sheet-title">Forward to…</div>
        <div class="settings-list" id="extras2-forward-list"></div>
      </div>`;
    document.body.appendChild(sheet);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.classList.remove("show"); });

    async function openForwardSheet(messageId) {
      sheet.classList.add("show");
      const list = document.getElementById("extras2-forward-list");
      list.innerHTML = `<div class="settings-empty">Loading your chats…</div>`;

      const { data, error } = await sb.rpc("my_conversations");
      if (error || !data?.length) {
        list.innerHTML = `<div class="settings-empty">No chats to forward to yet.</div>`;
        return;
      }

      const otherIds = data.map(c => c.other_user_id).filter(Boolean);
      if (otherIds.length) await getProfiles(otherIds);
      list.innerHTML = "";

      for (const c of data) {
        const label = c.kind === "group" ? (c.name || "Group") : (profileCache.get(c.other_user_id)?.display_name || "Chat");
        const row = document.createElement("button");
        row.className = "settings-list-row";
        row.textContent = label;
        row.addEventListener("click", async () => {
          const { data: original } = await sb.from("messages").select("content").eq("id", messageId).maybeSingle();
          if (!original) { say("That message is gone."); return; }
          const { error: sendErr } = await sb.from("messages").insert({
            user_id: ME.id, conversation_id: c.id, content: original.content,
          });
          sheet.classList.remove("show");
          say(sendErr ? (sendErr.message || "Could not forward.") : `Forwarded to ${label}`);
        });
        list.appendChild(row);
      }
    }
  }

  /* ---------- 9. Search across every conversation, not just one ---------- */

  function globalMessageSearch() {
    if (!isInbox) return;
    const header = document.querySelector(".profile-topbar");
    if (!header) return;

    const btn = document.createElement("button");
    btn.className = "header-icon-btn x2-ic-search";
    btn.title = "Search all messages";
    btn.innerHTML = svgIcon("search", 17);
    header.appendChild(btn);

    const sheet = document.createElement("div");
    sheet.className = "app-sheet-backdrop";
    sheet.innerHTML = `
      <div class="app-sheet">
        <div class="app-sheet-handle"></div>
        <input type="text" id="extras2-globalsearch" placeholder="Search all your chats…" autocomplete="off"
               style="width:100%; padding:10px 13px; border:1px solid var(--border-soft); border-radius:10px; font-size:15px; margin-bottom:10px;" />
        <div class="settings-list" id="extras2-globalresults"></div>
      </div>`;
    document.body.appendChild(sheet);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.classList.remove("show"); });

    btn.addEventListener("click", () => {
      sheet.classList.add("show");
      setTimeout(() => document.getElementById("extras2-globalsearch").focus(), 150);
    });

    let t;
    document.getElementById("extras2-globalsearch").addEventListener("input", (e) => {
      clearTimeout(t);
      const q = e.target.value.trim();
      if (!q) { document.getElementById("extras2-globalresults").innerHTML = ""; return; }
      t = setTimeout(() => runGlobalSearch(q), 300);
    });

    async function runGlobalSearch(q) {
      const results = document.getElementById("extras2-globalresults");
      results.innerHTML = `<div class="settings-empty">Searching…</div>`;
      const safe = q.replace(/[%_]/g, m => `\\${m}`);

      const { data, error } = await sb.from("messages")
        .select("id,content,user_id,conversation_id,created_at")
        .eq("deleted", false).eq("is_bot", false)
        .ilike("content", `%${safe}%`)
        .order("created_at", { ascending: false })
        .limit(40);

      if (error || !data?.length) { results.innerHTML = `<div class="settings-empty">Nothing found.</div>`; return; }
      await getProfiles(data.map(m => m.user_id));
      results.innerHTML = "";

      for (const m of data) {
        const author = profileCache.get(m.user_id);
        const row = document.createElement("a");
        row.className = "settings-list-row";
        row.href = m.conversation_id ? `room.html?c=${m.conversation_id}` : "chat.html";
        row.innerHTML = `<div style="flex:1;min-width:0;">
          <div class="settings-list-name">${escapeHTML(author?.display_name || "Someone")}</div>
          <div class="settings-list-sub" style="white-space:normal;">${escapeHTML(m.content).slice(0, 140)}</div>
        </div>`;
        results.appendChild(row);
      }
    }
  }

  /* ---------- 12. Deliberate tap-to-reveal for the action bar on touch ----------
     style.css now only shows .msg-actions on a real :hover (a mouse). On a
     phone the buttons are unreachable unless something opens them on purpose
     — this is that something: tap a bubble to reveal its icons, tap anywhere
     else to close whichever one is open. Only one is ever open at a time. */
  /* ONE owner for every tap on a message bubble.

     Before, three features listened to the same tap independently: the
     action bar, a double-tap heart, and a timestamp toggle. A double tap
     opened the action bar on the first tap and shut it on the second, so it
     flashed — tested and seen in a real browser. Now:
       single tap  → opens that message's actions (after a 260ms pause, so it
                     can tell a single tap from the start of a double tap)
       double tap  → ❤️ react, through the page's own toggleReaction()
       after a swipe-to-reply, or in select mode → the tap is ignored          */
  function tapToggleActions() {
    if (!isChat) return;
    const DOUBLE_MS = 280;
    let pending = null, lastRow = null, lastAt = 0;

    const closeAll = () => document.querySelectorAll(".show-actions").forEach((r) => r.classList.remove("show-actions"));

    on("click", ".bubble", (e, bubble) => {
      if (e.target.closest("button, a, textarea, input, audio, video, img, label, .reaction-chip, .emoji-picker, .x3-poll, .x3-cd")) return;
      if (document.body.classList.contains("extras2-selecting")) return;
      if (Date.now() - Number(document.documentElement.dataset.xSwipeAt || 0) < 450) return;

      const row = bubble.closest("[data-msg-id]");
      if (!row || row.classList.contains("bot-msg-row") || row.classList.contains("system-msg-row")) return;

      const now = Date.now();
      if (row === lastRow && now - lastAt < DOUBLE_MS) {
        clearTimeout(pending); pending = null; lastRow = null; lastAt = 0;
        heartReact(row, bubble);
        return;
      }
      lastRow = row; lastAt = now;
      clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        const wasOpen = row.classList.contains("show-actions");
        closeAll();
        if (!wasOpen) row.classList.add("show-actions");
      }, DOUBLE_MS);
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest(".bubble, .x2-more")) return;
      closeAll();
    });
  }

  async function heartReact(row, bubble) {
    const id = row.dataset.msgId;
    const mine = [...row.querySelectorAll(".reaction-chip.mine")].some((c) => c.textContent.includes("❤️"));
    const burst = document.createElement("span");
    burst.className = "x2-heart";
    burst.textContent = "❤️";
    bubble.appendChild(burst);
    setTimeout(() => burst.remove(), 750);
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
    // the page's own reaction function: same database write, same chip refresh
    if (typeof toggleReaction === "function") await toggleReaction(id, "❤️", mine);
  }

  /* ---------- 11. Unread count shows in the browser tab title ---------- */

  function unreadTabTitle() {
    const baseTitle = document.title;
    // my_conversations() already returns an unread count for every chat, so
    // this is one request every 30s — it used to be one request PER CHAT.
    setInterval(async () => {
      if (typeof ME === "undefined" || !ME || document.visibilityState === "visible") {
        document.title = baseTitle;
        return;
      }
      const { data } = await sb.rpc("my_conversations");
      const unread = (data || []).reduce((n, c) => n + (c.unread || 0), 0);
      document.title = unread ? `(${unread}) ${baseTitle}` : baseTitle;
    }, 30000);
  }
})();
