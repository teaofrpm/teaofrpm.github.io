/* ============================================================
   extras.js — an add-on layer.

   Every feature here attaches itself to the page from the outside, using
   event delegation on document. Nothing in this file edits an existing
   function, so no existing feature can break because of it. If something
   in here misbehaves, delete the one <script> tag and the app is exactly
   as it was before.

   Each feature is wrapped so that one failing feature cannot stop the
   others from loading.
   ============================================================ */

(function () {
  "use strict";

  const on = (ev, sel, fn, opts) => document.addEventListener(ev, (e) => {
    const el = e.target.closest?.(sel);
    if (el) fn(e, el);
  }, opts);

  const say = (m) => (typeof toast === "function" ? toast(m) : console.log(m));

  // Runs a feature and reports it by name if it throws, instead of taking
  // the whole file down with it.
  function feature(name, fn) {
    try { fn(); } catch (err) { console.error(`[extras] ${name} failed:`, err); }
  }

  const page = location.pathname.split("/").pop() || "index.html";
  const isChat = page === "chat.html" || page === "room.html";

  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") init();

  let started = false;
  function init() {
    if (started) return;
    started = true;

    feature("haptics", haptics);
    feature("offline banner", offlineBanner);
    feature("esc closes layers", escClosesLayers);
    feature("scroll to top", scrollToTop);
    feature("read more", readMore);
    feature("tap for timestamp", tapForTimestamp);
    feature("double tap to like", doubleTapToLike);
    feature("swipe to reply", swipeToReply);
    feature("slash autocomplete", slashAutocomplete);
    feature("mention autocomplete", mentionAutocomplete);
    feature("draft saving", draftSaving);
    feature("unsent draft guard", unsentDraftGuard);
    feature("long message counter", longMessageCounter);
    feature("copy link", copyLink);
    feature("native share", nativeShare);
    feature("pinch zoom lightbox", pinchZoomLightbox);
    feature("image save hint", imageSaveHint);
    feature("relative times", relativeTimes);
    feature("link confirm", externalLinkConfirm);
    feature("new message divider", newMessageDivider);
    feature("quick scroll bottom", quickScrollBottom);
    feature("text size control", textSizeControl);
    feature("connection quality", connectionQuality);
    feature("double back to exit", doubleBackToExit);
  }

  /* 1. Haptic feedback — a short buzz on real actions, where supported. */
  function haptics() {
    if (!navigator.vibrate) return;
    const buzz = (ms) => { try { navigator.vibrate(ms); } catch {} };
    on("click", ".reaction-chip, .emoji-picker span, .like-btn, .reel-like-btn", () => buzz(12));
    on("click", "#sendBtn, .send-btn", () => buzz(8));
    on("click", ".delete-btn, .btn-red", () => buzz([14, 40, 14]));
  }

  /* 2. Offline banner — tells you the app is fine and the network is not. */
  function offlineBanner() {
    const bar = document.createElement("div");
    bar.className = "extras-netbar";
    bar.textContent = "No internet — messages will send when you're back online";
    document.body.appendChild(bar);

    // navigator.onLine is not trustworthy. On iOS, and especially behind a
    // VPN, it reports false while the connection is perfectly fine. So it is
    // only ever treated as a hint: before claiming the user is offline we make
    // a real request and see whether it actually succeeds.
    async function reallyOffline() {
      try {
        await fetch(location.pathname + "?ping=" + Date.now(), {
          method: "HEAD",
          cache: "no-store",
        });
        return false;                 // the request went through, so we're online
      } catch {
        return true;
      }
    }

    let checking = false;
    async function check() {
      if (checking) return;
      checking = true;
      const off = await reallyOffline();
      bar.classList.toggle("show", off);
      checking = false;
    }

    window.addEventListener("offline", check);
    window.addEventListener("online", () => {
      bar.classList.remove("show");
    });

    // Never show it on load from the flag alone — only verify if the flag is
    // already claiming we're offline, and even then confirm it first.
    if (!navigator.onLine) check();
  }

  /* 3. Escape closes whatever is open, innermost first. */
  function escClosesLayers() {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const open = [...document.querySelectorAll(".app-sheet-backdrop.show, .lightbox.show, .reader-layer.show, .story-insights.show, .search-panel.show, .sticker-panel.show, .emoji-picker")];
      const last = open[open.length - 1];
      if (!last) return;
      e.preventDefault();
      if (last.classList.contains("emoji-picker")) last.remove();
      else if (typeof AppNav !== "undefined" && AppNav.exitFullscreen) AppNav.exitFullscreen();
      else last.classList.remove("show");
    });
  }

  /* 4. A back-to-top button on long scrolling pages. */
  function scrollToTop() {
    const scroller = document.querySelector(".profile-scroll, .feed, .home-scroll");
    if (!scroller) return;

    const btn = document.createElement("button");
    btn.className = "extras-totop";
    btn.setAttribute("aria-label", "Back to top");
    btn.innerHTML = svgIcon("arrowUp", 18);
    document.body.appendChild(btn);

    btn.addEventListener("click", () => scroller.scrollTo({ top: 0, behavior: "smooth" }));
    scroller.addEventListener("scroll", () => {
      btn.classList.toggle("show", scroller.scrollTop > 700);
    }, { passive: true });
  }

  /* 5. Very long messages collapse with a "Read more" instead of filling
        the whole screen. */
  function readMore() {
    if (!isChat) return;
    const LIMIT = 420;

    const apply = (el) => {
      if (el.dataset.rm || (el.textContent || "").length < LIMIT) return;
      el.dataset.rm = "1";
      el.classList.add("extras-clamped");
      const more = document.createElement("button");
      more.className = "extras-readmore";
      more.textContent = "Read more";
      more.addEventListener("click", () => {
        const open = el.classList.toggle("extras-clamped");
        more.textContent = open ? "Read more" : "Show less";
      });
      el.insertAdjacentElement("afterend", more);
    };

    const scan = () => document.querySelectorAll(".msg-text").forEach(apply);
    scan();
    watchMessages(scan);
  }

  /* 6. Tap a bubble to reveal its exact time. */
  function tapForTimestamp() {
    if (!isChat) return;

    // The exact time is already rendered inside the bubble; copy it onto the
    // element so CSS can reveal it, rather than asking the chat code to change.
    const stamp = () => document.querySelectorAll(".bubble").forEach((b) => {
      if (b.dataset.exact) return;
      const t = b.querySelector(".msg-time")?.textContent?.trim();
      if (t) b.dataset.exact = t;
    });
    stamp();
    watchMessages(stamp);

    on("click", ".bubble", (e, bubble) => {
      if (e.target.closest("button, a, img, textarea, .reaction-chip")) return;
      if (!bubble.dataset.exact) return;
      bubble.classList.toggle("extras-show-time");
    });
  }

  /* 7. Double-tap a message to react with a heart — the gesture people
        already expect from other chat apps. */
  function doubleTapToLike() {
    if (!isChat) return;
    let lastTap = 0, lastEl = null;

    on("click", ".bubble", (e, bubble) => {
      if (e.target.closest("button, a, textarea")) return;
      const now = Date.now();
      if (lastEl === bubble && now - lastTap < 400) {
        const row = bubble.closest("[data-msg-id]");
        const react = row?.querySelector(".react-btn");
        if (react) {
          burstHeart(bubble);
          const messageId = row.dataset.msgId;
          quickReact(messageId);
        }
        lastTap = 0; lastEl = null;
        return;
      }
      lastTap = now; lastEl = bubble;
    });
  }

  async function quickReact(messageId) {
    if (typeof sb === "undefined" || typeof ME === "undefined" || !ME) return;
    const { data } = await sb.from("message_reactions").select("emoji")
      .eq("message_id", messageId).eq("user_id", ME.id).eq("emoji", "❤️").maybeSingle();

    if (data) {
      await sb.from("message_reactions").delete()
        .eq("message_id", messageId).eq("user_id", ME.id).eq("emoji", "❤️");
    } else {
      await sb.from("message_reactions")
        .insert({ message_id: messageId, user_id: ME.id, emoji: "❤️" });
    }
    if (typeof refreshReactionsFor === "function") refreshReactionsFor(messageId);
  }

  function burstHeart(host) {
    const h = document.createElement("span");
    h.className = "extras-heart";
    h.textContent = "❤️";
    host.appendChild(h);
    setTimeout(() => h.remove(), 700);
  }

  /* 8. Swipe a message to the right to reply to it. */
  function swipeToReply() {
    if (!isChat) return;
    let startX = 0, startY = 0, row = null, dragging = false;

    document.addEventListener("touchstart", (e) => {
      const t = e.target.closest?.("[data-msg-id]");
      if (!t || t.classList.contains("bot-msg-row")) return;
      row = t; dragging = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener("touchmove", (e) => {
      if (!row) return;
      const dx = e.touches[0].clientX - startX;
      const dy = Math.abs(e.touches[0].clientY - startY);
      // a mostly-horizontal drag, otherwise the page is being scrolled
      if (dy > 24 || dx < 0) { reset(); return; }
      if (dx > 10) {
        dragging = true;
        row.style.transform = `translateX(${Math.min(dx, 70)}px)`;
        row.classList.toggle("extras-swipe-armed", dx > 55);
      }
    }, { passive: true });

    document.addEventListener("touchend", () => {
      if (row && dragging && row.classList.contains("extras-swipe-armed")) {
        row.querySelector(".reply-btn")?.click();
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
      }
      reset();
    });

    function reset() {
      if (row) {
        row.style.transform = "";
        row.classList.remove("extras-swipe-armed");
      }
      row = null; dragging = false;
    }
  }

  /* 9. Typing "/" in a chat shows the bot's commands, so nobody has to
        memorise them. */
  function slashAutocomplete() {
    const input = document.getElementById("msgInput");
    if (!input) return;

    const CMDS = [
      ["/help", "show every command"],
      ["/poll Question | A | B", "start a poll"],
      ["/countdown Exams 2026-10-15", "live countdown card"],
      ["/top", "most active people this week"],
      ["/rules", "show the rules"],
      ["/warns @user", "how many warnings someone has"],
      ["/info @user", "their standing here"],
      ["/admins", "who the admins are"],
      ["/setrules ", "admin — set the rules"],
      ["/welcome ", "admin — set the welcome text"],
      ["/warn @user ", "admin — warn someone"],
      ["/resetwarns @user", "admin — clear warnings"],
      ["/mute @user 10m", "admin — mute for a while"],
      ["/unmute @user", "admin — let them talk"],
      ["/kick @user", "admin — remove from group"],
      ["/antilink on", "admin — block links"],
      ["/slowmode 30", "admin — gap between messages"],
    ];

    const box = makePopover("extras-cmdbox", input);

    input.addEventListener("input", () => {
      const v = input.value;
      if (!v.startsWith("/") || v.includes("\n")) { box.hide(); return; }
      const q = v.slice(1).toLowerCase();
      const hits = CMDS.filter(([c]) => c.slice(1).toLowerCase().startsWith(q)).slice(0, 6);
      if (!hits.length) { box.hide(); return; }

      box.el.innerHTML = hits
        .map(([c, d]) => `<button data-cmd="${c}"><b>${c}</b><span>${d}</span></button>`)
        .join("");
      box.show();
    });

    box.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cmd]");
      if (!b) return;
      input.value = b.dataset.cmd;
      box.hide();
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    input.addEventListener("blur", () => setTimeout(box.hide, 180));
  }

  /* 10. Typing "@" suggests people, so mentions are spelled right. */
  function mentionAutocomplete() {
    const input = document.getElementById("msgInput");
    if (!input || typeof sb === "undefined") return;

    const box = makePopover("extras-mentionbox", input);
    let people = null;

    input.addEventListener("input", async () => {
      const upto = input.value.slice(0, input.selectionStart);
      const m = upto.match(/@([a-zA-Z0-9_.]*)$/);
      if (!m) { box.hide(); return; }

      if (!people) {
        const { data } = await sb.from("profiles")
          .select("username,display_name").eq("is_verified", true).limit(300);
        people = data || [];
      }

      const q = m[1].toLowerCase();
      const hits = people.filter(p =>
        p.username.toLowerCase().startsWith(q) ||
        (p.display_name || "").toLowerCase().startsWith(q)).slice(0, 6);

      if (!hits.length) { box.hide(); return; }
      box.el.innerHTML = hits
        .map(p => `<button data-u="${p.username}"><b>@${p.username}</b><span>${p.display_name}</span></button>`)
        .join("");
      box.show();
    });

    box.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-u]");
      if (!b) return;
      const pos = input.selectionStart;
      const before = input.value.slice(0, pos).replace(/@([a-zA-Z0-9_.]*)$/, `@${b.dataset.u} `);
      input.value = before + input.value.slice(pos);
      box.hide();
      input.focus();
      input.setSelectionRange(before.length, before.length);
    });

    input.addEventListener("blur", () => setTimeout(box.hide, 180));
  }

  function makePopover(cls, anchor) {
    const el = document.createElement("div");
    el.className = cls;

    // The popover is positioned with bottom:100%, which resolves against the
    // nearest POSITIONED ancestor. .composer is static, so the box was being
    // placed against the fixed page shell and landed off-screen entirely.
    const host = anchor.closest(".composer") || document.body;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(el);
    return {
      el,
      show: () => el.classList.add("show"),
      hide: () => el.classList.remove("show"),
    };
  }

  /* 11. A row of frequent emoji above the keyboard. */
  function emojiBar() {
    const input = document.getElementById("msgInput");
    const composer = input?.closest(".composer");
    if (!composer) return;

    const bar = document.createElement("div");
    bar.className = "extras-emojibar";
    bar.innerHTML = ["😂", "❤️", "🔥", "👍", "🙏", "😭", "💯", "🎉"]
      .map(e => `<button type="button">${e}</button>`).join("");
    composer.insertBefore(bar, composer.firstChild);

    bar.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, pos) + b.textContent + input.value.slice(pos);
      input.focus();
      input.setSelectionRange(pos + b.textContent.length, pos + b.textContent.length);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // only in the way when you are actually typing
    input.addEventListener("focus", () => bar.classList.add("show"));
    input.addEventListener("blur", () => setTimeout(() => bar.classList.remove("show"), 200));
  }

  /* 12. Unsent text survives leaving the page, per conversation. */
  function draftSaving() {
    const input = document.getElementById("msgInput");
    if (!input) return;
    const key = "teaofrpm_draft_" + (new URLSearchParams(location.search).get("c") || page);

    try {
      const saved = localStorage.getItem(key);
      if (saved && !input.value) {
        input.value = saved;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch {}

    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        try {
          if (input.value.trim()) localStorage.setItem(key, input.value);
          else localStorage.removeItem(key);
        } catch {}
      }, 400);
    });

    document.getElementById("sendBtn")?.addEventListener("click", () => {
      setTimeout(() => { try { localStorage.removeItem(key); } catch {} }, 300);
    });
  }

  /* 13. Warns before you navigate away with something half-typed. */
  function unsentDraftGuard() {
    const input = document.getElementById("msgInput");
    if (!input) return;
    on("click", "a[href]", (e, a) => {
      if (!input.value.trim()) return;
      if (a.target === "_blank" || a.getAttribute("href").startsWith("#")) return;
      if (!confirm("You have an unsent message. Leave anyway?")) e.preventDefault();
    });
  }

  /* 14. A counter once a message gets long. */
  function longMessageCounter() {
    const input = document.getElementById("msgInput");
    const composer = input?.closest(".composer");
    if (!composer) return;

    const c = document.createElement("div");
    c.className = "extras-charcount";
    composer.appendChild(c);

    input.addEventListener("input", () => {
      const n = input.value.length;
      c.textContent = n > 300 ? `${n} characters` : "";
      c.classList.toggle("show", n > 300);
    });
  }

  /* 15. Copy a direct link to any message. */
  function copyLink() {
    if (!isChat) return;

    // The copy-link button itself is in the ⋯ menu now (extras2.js).
    // open at the linked message if we arrived with one
    const m = location.hash.match(/m=([\w-]+)/);
    if (m) setTimeout(() => {
      document.querySelector(`[data-msg-id="${m[1]}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 1400);
  }

  /* 16. The phone's own share sheet, where the browser offers it. */
  function nativeShare() {
    if (!navigator.share) return;
    on("click", "[data-share]", async (e, el) => {
      e.preventDefault();
      try {
        await navigator.share({
          title: el.dataset.shareTitle || "teaofrpm",
          url: el.dataset.share || location.href,
        });
      } catch {}
    });

    // give every profile page a share button
    const header = document.querySelector(".profile-topbar");
    if (page === "profile.html" && header && !header.querySelector("[data-share]")) {
      const b = document.createElement("button");
      b.className = "header-icon-btn";
      b.title = "Share profile";
      b.dataset.share = location.href;
      b.classList.add("x2-ic-share");
      b.innerHTML = svgIcon("share", 17);
      header.appendChild(b);
    }
  }

  /* 17. Pinch and drag inside the image viewer. */
  function pinchZoomLightbox() {
    const box = document.getElementById("lightbox");
    const img = document.getElementById("lightboxImg");
    if (!box || !img) return;

    let scale = 1, startDist = 0, tx = 0, ty = 0, lastX = 0, lastY = 0, panning = false;
    const paint = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
    const reset = () => { scale = 1; tx = ty = 0; paint(); };

    box.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        startDist = dist(e.touches);
      } else if (e.touches.length === 1 && scale > 1) {
        panning = true;
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      }
    }, { passive: true });

    box.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        scale = Math.min(4, Math.max(1, (dist(e.touches) / startDist)));
        paint();
      } else if (panning) {
        tx += e.touches[0].clientX - lastX;
        ty += e.touches[0].clientY - lastY;
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
        paint();
      }
    }, { passive: false });

    box.addEventListener("touchend", (e) => {
      panning = false;
      if (scale <= 1.02) reset();
      if (!e.touches.length && scale <= 1.02) tx = ty = 0;
    });

    new MutationObserver(() => { if (!box.classList.contains("show")) reset(); })
      .observe(box, { attributes: true, attributeFilter: ["class"] });

    const dist = (t) => Math.hypot(
      t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  }

  /* 18. Tells you how to save a photo, since long-press is not obvious. */
  function imageSaveHint() {
    const box = document.getElementById("lightbox");
    if (!box || localStorage.getItem("teaofrpm_savehint")) return;
    box.addEventListener("click", function once() {
      say("Press and hold the photo to save it");
      try { localStorage.setItem("teaofrpm_savehint", "1"); } catch {}
      box.removeEventListener("click", once);
    }, { once: true });
  }

  /* 19. Timestamps refresh themselves, so "2m ago" does not stay "2m ago". */
  function relativeTimes() {
    if (typeof timeAgo !== "function") return;
    setInterval(() => {
      document.querySelectorAll("[data-ts]").forEach((el) => {
        el.textContent = timeAgo(el.dataset.ts);
      });
    }, 60000);
  }

  /* 20. Warns before opening a link someone pasted. */
  function externalLinkConfirm() {
    if (!isChat) return;
    on("click", ".msg-text a[href^='http']", (e, a) => {
      let host;
      try { host = new URL(a.href).hostname; } catch { return; }
      if (host === location.hostname) return;
      if (!confirm(`Open ${host}?\n\nThis link was posted by another user.`)) e.preventDefault();
    });
  }

  /* 21. A line marking where you stopped reading. */
  function newMessageDivider() {
    if (!isChat) return;
    const key = "teaofrpm_lastmsg_" + (new URLSearchParams(location.search).get("c") || "room");
    let lastSeenId = null;
    try { lastSeenId = localStorage.getItem(key); } catch {}

    const remember = () => {
      const rows = document.querySelectorAll("[data-msg-id]");
      const last = rows[rows.length - 1];
      if (last) { try { localStorage.setItem(key, last.dataset.msgId); } catch {} }
    };

    setTimeout(() => {
      if (lastSeenId) {
        const rows = [...document.querySelectorAll("[data-msg-id]")];
        const idx = rows.findIndex(r => r.dataset.msgId === lastSeenId);
        const first = idx >= 0 ? rows[idx + 1] : null;
        if (first) {
          const d = document.createElement("div");
          d.className = "extras-newline";
          d.innerHTML = "<span>New messages</span>";
          first.parentNode.insertBefore(d, first);
        }
      }
      remember();
    }, 1500);

    window.addEventListener("beforeunload", remember);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") remember();
    });
  }

  /* 22. Long-press the header to jump to the newest message. */
  function quickScrollBottom() {
    if (!isChat) return;
    const header = document.querySelector(".chat-header");
    const msgs = document.getElementById("messages");
    if (!header || !msgs) return;

    let timer;
    header.addEventListener("touchstart", () => {
      timer = setTimeout(() => {
        msgs.scrollTo({ top: msgs.scrollHeight, behavior: "smooth" });
        say("Jumped to the latest");
      }, 550);
    }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach(ev =>
      header.addEventListener(ev, () => clearTimeout(timer), { passive: true }));
  }

  /* 23. Text size control, remembered across visits. */
  function textSizeControl() {
    let size = 100;
    try { size = parseInt(localStorage.getItem("teaofrpm_textsize") || "100", 10); } catch {}
    document.documentElement.style.fontSize = size + "%";

    window.setTextSize = (pct) => {
      size = Math.min(130, Math.max(85, pct));
      document.documentElement.style.fontSize = size + "%";
      try { localStorage.setItem("teaofrpm_textsize", String(size)); } catch {}
      say(`Text size ${size}%`);
    };

    const panel = document.querySelector('[data-panel="appearance"], [data-panel="display"]');
    if (!panel || panel.querySelector(".extras-textsize")) return;

    const wrap = document.createElement("div");
    wrap.className = "extras-textsize";
    wrap.innerHTML = `
      <label>Text size</label>
      <div class="extras-textsize-row">
        <button data-size="85">A</button>
        <button data-size="100">A</button>
        <button data-size="115">A</button>
        <button data-size="130">A</button>
      </div>`;
    panel.appendChild(wrap);
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest("[data-size]");
      if (b) window.setTextSize(parseInt(b.dataset.size, 10));
    });
  }

  /* 24. Warns on a genuinely slow connection before a big upload. */
  function connectionQuality() {
    const c = navigator.connection;
    if (!c) return;
    on("change", "#imageInput, #videoInput", () => {
      if (c.effectiveType === "2g" || c.effectiveType === "slow-2g" || c.saveData) {
        say("Your connection is slow — this upload may take a while");
      }
    });
  }

  /* 25. On a chat page, back goes to the list rather than out of the app. */
  function doubleBackToExit() {
    if (page !== "messages.html" && page !== "home.html") return;
    let armed = false;
    history.pushState({ guard: 1 }, "");
    window.addEventListener("popstate", () => {
      if (armed) return;
      armed = true;
      history.pushState({ guard: 1 }, "");
      say("Press back again to leave");
      setTimeout(() => { armed = false; }, 2000);
    });
  }

  /* Shared helper: run a callback whenever new messages are rendered. */
  function watchMessages(fn) {
    const msgs = document.getElementById("messages");
    if (!msgs) return;
    let t;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(fn, 120); })
      .observe(msgs, { childList: true, subtree: true });
  }
})();
