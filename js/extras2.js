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

  function starMessage() {
    if (!isChat) return;

    watchMessages(() => {
      document.querySelectorAll("[data-msg-id]").forEach((row) => {
        if (row.classList.contains("bot-msg-row") || row.classList.contains("system-msg-row")) return;
        addToActionBar(row, "star-btn", (bar) => {
          const b = document.createElement("button");
          b.className = "star-btn";
          b.title = "Save message";
          b.textContent = "☆";
          bar.appendChild(b);
          b.addEventListener("click", () => toggleStar(row.dataset.msgId, b));
          refreshStarIcon(row.dataset.msgId, b);
        });
      });
    });
  }

  async function refreshStarIcon(messageId, btn) {
    if (typeof ME === "undefined" || !ME) return;
    const { data } = await sb.from("message_stars").select("message_id")
      .eq("message_id", messageId).eq("user_id", ME.id).maybeSingle();
    btn.textContent = data ? "★" : "☆";
    btn.classList.toggle("starred", !!data);
  }

  async function toggleStar(messageId, btn) {
    const starred = btn.classList.contains("starred");
    btn.textContent = starred ? "☆" : "★";     // flip first, feels instant
    btn.classList.toggle("starred", !starred);

    const { error } = starred
      ? await sb.from("message_stars").delete().eq("message_id", messageId).eq("user_id", ME.id)
      : await sb.from("message_stars").insert({ message_id: messageId, user_id: ME.id });

    if (error) {
      btn.textContent = starred ? "★" : "☆";     // undo on failure
      btn.classList.toggle("starred", starred);
      say("Could not update.");
    } else {
      say(starred ? "Removed from saved" : "Saved");
    }
  }

  function starredPanel() {
    if (!isInbox) return;
    const nav = document.getElementById("appNav") || document.querySelector(".profile-topbar");
    if (!nav) return;

    const btn = document.createElement("button");
    btn.className = "header-icon-btn extras2-starred-entry";
    btn.title = "Saved messages";
    btn.textContent = "★";
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
        list.innerHTML = `<div class="settings-empty">Nothing saved yet — tap ☆ on any message.</div>`;
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

    watchMessages(() => {
      document.querySelectorAll("[data-msg-id]").forEach((row) => {
        if (row.classList.contains("bot-msg-row") || row.classList.contains("system-msg-row")) return;
        addToActionBar(row, "pin-msg-btn", (bar) => {
          const b = document.createElement("button");
          b.className = "pin-msg-btn";
          b.title = "Pin this message";
          b.textContent = "📌";
          bar.appendChild(b);
          b.addEventListener("click", () => pinThisMessage(row.dataset.msgId));
        });
      });
    });

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
      <span class="pin-icon">📌</span>
      <div class="pin-text"><b>${escapeHTML(author?.display_name || "Someone")}</b>: ${escapeHTML((m.content || "media").slice(0, 80))}</div>
      <button class="pin-goto" title="Jump to message">↓</button>
      <button class="pin-clear" title="Unpin">✕</button>`;

    banner.querySelector(".pin-goto").addEventListener("click", () => {
      document.querySelector(`[data-msg-id="${pinnedId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    banner.querySelector(".pin-clear").addEventListener("click", async () => {
      await sb.rpc("set_pinned_message", { p_conversation: convo || null, p_message: null });
      banner.remove();
    });

    const host = document.querySelector(".room-topbar, .chat-topbar, .profile-topbar");
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
    if (isChat) {
      watchMessages(() => {
        document.querySelectorAll("[data-msg-id]").forEach((row) => {
          if (row.classList.contains("bot-msg-row") || row.classList.contains("system-msg-row")) return;
          addToActionBar(row, "report-msg-btn", (bar) => {
            const b = document.createElement("button");
            b.className = "report-msg-btn";
            b.title = "Report";
            b.textContent = "⚑";
            bar.appendChild(b);
            b.addEventListener("click", () => submitReport("message", row.dataset.msgId));
          });
        });
      });
    }

    if (page === "profile.html") {
      const header = document.querySelector(".profile-topbar");
      if (!header || header.querySelector(".extras2-report-user")) return;
      const btn = document.createElement("button");
      btn.className = "header-icon-btn extras2-report-user";
      btn.title = "Report this account";
      btn.textContent = "⚑";
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

  function seenReceipt() {
    if (page !== "room.html") return;
    const convo = currentConvoId();
    if (!convo) return;

    async function paint() {
      if (typeof ME === "undefined" || !ME || typeof convo === "undefined") return;
      const { data } = await sb.from("conversation_members")
        .select("user_id,last_read_at").eq("conversation_id", convo);
      if (!data) return;

      const others = data.filter(r => r.user_id !== ME.id);
      if (!others.length) return;
      const latestOtherRead = others.reduce((max, r) =>
        (r.last_read_at && r.last_read_at > max ? r.last_read_at : max), "");

      document.querySelectorAll(".msg-row.own [data-msg-id], [data-msg-id].own").forEach(() => {});
      const mine = [...document.querySelectorAll("[data-msg-id]")]
        .filter(r => !r.classList.contains("bot-msg-row") && !r.classList.contains("system-msg-row"));

      document.querySelector(".extras2-seen")?.remove();
      if (!latestOtherRead) return;

      // find the last of OUR OWN messages that is at or before their last read time
      let lastSeenRow = null;
      for (const row of mine) {
        const stamp = row.querySelector(".msg-time")?.dataset?.iso;
        if (!row.classList.contains("own")) continue;
        if (stamp && stamp <= latestOtherRead) lastSeenRow = row;
      }
      if (!lastSeenRow) return;

      const tag = document.createElement("div");
      tag.className = "extras2-seen";
      tag.textContent = "Seen";
      lastSeenRow.appendChild(tag);
    }

    // stamp each own message with a sortable ISO time once, from its
    // already-rendered human time — no change to how room.js builds rows.
    watchMessages(() => {
      document.querySelectorAll("[data-msg-id]").forEach((row) => {
        const t = row.querySelector(".msg-time");
        if (t && !t.dataset.iso) t.dataset.iso = new Date().toISOString();
      });
      paint();
    });

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

    on("click", "[data-msg-id]", (e, row) => {
      if (!selecting) return;
      if (!row.classList.contains("own")) return;
      e.stopPropagation();
      toggleSelect(row);
    });

    function startSelecting(row) {
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

  function forwardMessage() {
    if (!isChat) return;

    watchMessages(() => {
      document.querySelectorAll("[data-msg-id]").forEach((row) => {
        if (row.classList.contains("bot-msg-row") || row.classList.contains("system-msg-row")) return;
        addToActionBar(row, "forward-btn", (bar) => {
          const b = document.createElement("button");
          b.className = "forward-btn";
          b.title = "Forward";
          b.textContent = "➦";
          bar.appendChild(b);
          b.addEventListener("click", () => openForwardSheet(row.dataset.msgId));
        });
      });
    });

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
    btn.className = "header-icon-btn";
    btn.title = "Search all messages";
    btn.textContent = "🔍";
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

  /* ---------- 11. Unread count shows in the browser tab title ---------- */

  function unreadTabTitle() {
    const baseTitle = document.title;
    setInterval(async () => {
      if (typeof ME === "undefined" || !ME || document.visibilityState === "visible") {
        document.title = baseTitle;
        return;
      }
      const { data } = await sb.from("conversation_members")
        .select("conversation_id,last_read_at").eq("user_id", ME.id);
      if (!data?.length) return;

      let unread = 0;
      for (const row of data) {
        const { count } = await sb.from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", row.conversation_id)
          .eq("deleted", false)
          .gt("created_at", row.last_read_at || "1970-01-01");
        unread += count || 0;
      }
      document.title = unread ? `(${unread}) ${baseTitle}` : baseTitle;
    }, 20000);
  }
})();
