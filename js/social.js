/* ============================================================
   social.js — post extras, tags, the post composer and highlights.
   Used by home.html and profile.html. (This replaces the old
   social-extras.js, which the pages referenced but which was missing,
   so highlights and the post ⋯ menu never appeared.)
   ============================================================ */

const Social = (() => {
  const me = () => App.me;

  /* ---------------- Tags ---------------- */

  const tagsByPost = new Map();     // post id -> [profile]

  async function loadTags(postIds) {
    const ids = postIds.filter((id) => !tagsByPost.has(id));
    if (!ids.length) return;
    ids.forEach((id) => tagsByPost.set(id, []));
    const { data } = await sb.from("post_tags").select("post_id,tagged_user_id").in("post_id", ids);
    if (!data?.length) return;
    await getProfiles(data.map((t) => t.tagged_user_id));
    for (const t of data) {
      const p = profileCache.get(t.tagged_user_id);
      if (p) tagsByPost.get(t.post_id).push(p);
    }
  }

  // Rows from the post_cards / feed_page / profile_posts RPCs: one request
  // already carries counts, my like/save, author and tags.
  function fromCards(rows) {
    return (rows || []).map((r) => {
      if (r.author) rememberProfile(r.author);
      const tagged = (r.tags || []).filter(Boolean);
      tagged.forEach(rememberProfile);
      tagsByPost.set(r.post.id, tagged);
      // like_count is null when the author chose "Hide like counts"
      return { post: r.post, likes: r.like_count == null ? null : r.like_count, comments: r.comment_count || 0, liked: !!r.liked, saved: !!r.saved };
    });
  }

  function tagLine(postId) {
    const people = tagsByPost.get(postId) || [];
    if (!people.length) return null;
    const el = document.createElement("div");
    el.className = "post-tag-line";
    el.innerHTML = `${svgIcon("tag", 12)} with ` + people.map((p) =>
      `<a href="profile.html?u=${encodeURIComponent(p.username)}">@${escapeHTML(p.username)}</a>`).join(", ");
    return el;
  }

  async function saveTags(postId, people) {
    const ids = people.map((p) => p.id).filter((id) => id !== me().id);
    await sb.from("post_tags").delete().eq("post_id", postId);
    if (ids.length) {
      const { error } = await sb.from("post_tags").insert(ids.map((id) => ({ post_id: postId, tagged_user_id: id, tagger_id: me().id })));
      if (error) { toast(friendlyError(error, "Could not tag everyone.")); }
    }
    tagsByPost.set(postId, people.filter((p) => p.id !== me().id));
  }

  /* ---------------- The ⋯ menu on every post ---------------- */

  // card: the post element; actionsRow: where the ⋯ button goes;
  // opts.onRemoved: called after archive/delete.
  function attachPostExtras(card, post, actionsRow, opts = {}) {
    const line = tagLine(post.id);
    if (line) actionsRow.insertAdjacentElement("beforebegin", line);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "post-more-btn";
    btn.title = "More";
    btn.innerHTML = svgIcon("more", 20);
    btn.addEventListener("click", () => openPostMenu(card, post, opts));
    actionsRow.appendChild(btn);
  }

  function postLink(post) {
    const author = profileCache.get(post.user_id);
    return `profile.html?u=${encodeURIComponent(author?.username || "")}&post=${post.id}`;
  }

  function openPostMenu(card, post, opts) {
    const own = post.user_id === me().id;
    const items = [
      { icon: "send", label: "Send in a chat", onClick: () => sendPostToChat(post) },
      { icon: "plus", label: "Add to your story", onClick: () => postToStory(post) },
      { icon: "link", label: "Copy link", onClick: () => copyText(new URL(postLink(post), location.href).href, "Link copied") },
      { icon: "share", label: "Share…", onClick: () => shareLink(postLink(post), "A post on teaofrpm") },
    ];
    if (own) {
      items.push({ icon: "tag", label: "Tag people", onClick: async () => {
        const picked = await pickPeople({ title: "Tag people", exclude: [me().id], selected: tagsByPost.get(post.id) || [], cta: "Save tags" });
        if (!picked) return;
        await saveTags(post.id, picked);
        card.querySelector(".post-tag-line")?.remove();
        const line = tagLine(post.id);
        const row = card.querySelector(".feed-card-actions, .post-engage-row");
        if (line && row) row.insertAdjacentElement("beforebegin", line);
        toast(picked.length ? "Tags saved" : "Tags removed");
      } });
      items.push({ icon: "edit", label: "Edit caption", onClick: () => editCaption(card, post) });
      items.push({ icon: "pin", label: post.pinned_at ? "Unpin from profile" : "Pin to profile", onClick: async () => {
        const { data, error } = await sb.rpc("toggle_pin_post", { p_post: post.id });
        if (error) { toast(friendlyError(error, "Could not pin.")); return; }
        post.pinned_at = data ? new Date().toISOString() : null;
        toast(data ? "Pinned — it shows first on your profile" : "Unpinned");
      } });
      items.push({ icon: "archive", label: post.archived ? "Unarchive" : "Archive", onClick: async () => {
        const next = !post.archived;
        const { error } = await sb.from("posts").update({ archived: next }).eq("id", post.id).eq("user_id", me().id);
        if (error) { toast(friendlyError(error, "Could not update.")); return; }
        post.archived = next;
        toast(next ? "Post archived — find it in Settings → Archive" : "Post unarchived");
        if (next) { card.remove(); opts.onRemoved && opts.onRemoved(); }
      } });
      items.push({ icon: "trash", label: "Delete", danger: true, onClick: async () => {
        if (!confirm("Delete this post? This can't be undone.")) return;
        const { error } = await sb.from("posts").update({ deleted: true }).eq("id", post.id).eq("user_id", me().id);
        if (error) { toast(friendlyError(error, "Could not delete post.")); return; }
        card.remove();
        opts.onRemoved && opts.onRemoved();
        toast("Post deleted");
      } });
    } else {
      const who = profileCache.get(post.user_id);
      items.push({ icon: "bellOff", label: `Mute @${who?.username || "this account"}`, onClick: async () => {
        const { error } = await sb.from("user_mutes").upsert({ muter_id: me().id, muted_id: post.user_id, posts: true, stories: true });
        if (error) { toast(friendlyError(error, "Could not mute.")); return; }
        document.querySelectorAll(`.feed-card[data-post-id]`).forEach((c) => {
          const p = c.dataset.postId && c.querySelector(".feed-card-who")?.getAttribute("href");
          if (p && who && p.includes(`u=${encodeURIComponent(who.username)}`)) c.remove();
        });
        toast(`Muted. You won't see @${who?.username || "their"} posts or stories — they won't know.`);
      } });
      items.push({ icon: "flag", label: "Report", danger: true, onClick: () => reportSheet("post", post.id) });
    }
    actionSheet("Post", items);
  }

  function editCaption(card, post) {
    const s = makeSheet({ title: "Edit caption", html: `
      <textarea class="x3-input" rows="4" maxlength="2000" placeholder="Write a caption…">${escapeHTML(post.content || "")}</textarea>
      <button type="button" class="btn" style="width:100%;margin-top:10px;">Save</button>` });
    s.onClose = () => setTimeout(() => s.el.remove(), 300);
    s.body.querySelector("button").addEventListener("click", async (e) => {
      const text = s.body.querySelector("textarea").value.trim();
      if (!text && !post.image_url) { toast("A post without a photo needs some text."); return; }
      e.target.disabled = true;
      const { error } = await sb.from("posts").update({ content: text || null }).eq("id", post.id).eq("user_id", me().id);
      e.target.disabled = false;
      if (error) { toast(friendlyError(error, "Could not save.")); return; }
      post.content = text || null;
      let el = card.querySelector(".feed-card-text, .post-text");
      if (!el && text) {
        el = document.createElement("div");
        el.className = card.classList.contains("feed-card") ? "feed-card-text" : "post-text";
        const anchor = card.querySelector(".post-tag-line, .feed-card-actions, .post-engage-row");
        anchor.insertAdjacentElement("beforebegin", el);
      }
      if (el) { if (text) el.innerHTML = linkifyMentions(escapeHTML(text)); else el.remove(); }
      s.close();
      toast("Caption updated");
    });
    s.open();
  }

  async function sendPostToChat(post) {
    const s = makeSheet({ title: "Send to…", html: `<div class="settings-list"><div class="settings-empty">Loading your chats…</div></div>` });
    s.onClose = () => setTimeout(() => s.el.remove(), 300);
    s.open();
    const { data, error } = await sb.rpc("my_conversations");
    const list = s.body.querySelector(".settings-list");
    if (error) { list.innerHTML = `<div class="settings-empty">Could not load your chats.</div>`; return; }
    const chats = [{ id: PUBLIC_ROOM_ID, kind: "group", name: "RPM Public Room" }, ...(data || [])];
    await getProfiles(chats.map((c) => c.other_user_id));
    list.innerHTML = "";
    for (const c of chats) {
      const other = c.other_user_id ? profileCache.get(c.other_user_id) : null;
      const label = c.kind === "dm" ? (other?.display_name || "Chat") : (c.name || "Group");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "settings-list-row";
      row.innerHTML = `<span class="avatar"></span><div class="settings-list-name">${escapeHTML(label)}</div><span class="send-to-btn">Send</span>`;
      if (c.kind === "dm") setAvatarContent(row.querySelector(".avatar"), other); else setGroupAvatar(row.querySelector(".avatar"), c);
      row.addEventListener("click", async () => {
        row.disabled = true;
        const author = profileCache.get(post.user_id);
        const { error: e } = await sb.from("messages").insert({
          user_id: me().id, conversation_id: c.id, shared_post_id: post.id,
          image_url: post.image_url || null,
          content: post.content ? post.content.slice(0, 500) : `Post by @${author?.username || "someone"}`,
        });
        if (e) { row.disabled = false; toast(friendlyError(e, "Could not send.")); return; }
        row.querySelector(".send-to-btn").textContent = "Sent";
        buzz(10);
      });
      list.appendChild(row);
    }
  }

  // Text-only posts become a branded image card, so a story always has a picture.
  function textCardBlob(text, author) {
    return new Promise((resolve) => {
      const c = document.createElement("canvas");
      c.width = 1080; c.height = 1920;
      const ctx = c.getContext("2d");
      const g = ctx.createLinearGradient(0, 0, 1080, 1920);
      g.addColorStop(0, "#6A1B9A"); g.addColorStop(1, "#8B0000");
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1920);
      ctx.fillStyle = "rgba(255,255,255,.96)";
      const pad = 90, w = 1080 - pad * 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(pad, 560, w, 800, 48) : ctx.rect(pad, 560, w, 800); ctx.fill();
      ctx.fillStyle = "#1A1A1A";
      ctx.font = "600 54px Inter, Segoe UI, sans-serif";
      const words = String(text).split(/\s+/), lines = [];
      let line = "";
      for (const wd of words) {
        const test = line ? line + " " + wd : wd;
        if (ctx.measureText(test).width > w - 120) { lines.push(line); line = wd; } else line = test;
        if (lines.length >= 9) break;
      }
      if (line && lines.length < 10) lines.push(line);
      lines.forEach((l, i) => ctx.fillText(l, pad + 60, 680 + i * 70));
      ctx.fillStyle = "#8B0000";
      ctx.font = "700 40px Inter, Segoe UI, sans-serif";
      ctx.fillText(`@${author?.username || ""}`, pad + 60, 1300);
      c.toBlob((b) => resolve(b), "image/jpeg", 0.88);
    });
  }

  async function postToStory(post) {
    toast("Adding to your story…");
    try {
      let image_url = post.image_url;
      if (!image_url) {
        const blob = await textCardBlob(post.content || "", profileCache.get(post.user_id));
        image_url = await uploadPublic("stories", `${me().id}/${Date.now()}-post.jpg`, blob);
      }
      const { error } = await sb.from("stories").insert({ user_id: me().id, image_url, shared_post_id: post.id, audience: "everyone" });
      if (error) throw error;
      toast("Added to your story");
      if (typeof loadStories === "function") loadStories();
    } catch (err) {
      toast(friendlyError(err, "Could not add to story."));
    }
  }

  /* ---------------- Composer (sheet) ---------------- */

  // Used by the Home page's "Share something" bar.
  function openComposer({ onPosted } = {}) {
    let file = null, previewUrl = null, tagged = [];
    const s = makeSheet({ title: "New post", html: `
      <textarea class="x3-input composer-text" rows="4" maxlength="2000" placeholder="Share something with RPM…"></textarea>
      <div class="composer-preview" hidden><img alt="" /><button type="button" class="composer-preview-x" aria-label="Remove photo">${svgIcon("close", 14)}</button></div>
      <div class="composer-tags x3-hint" hidden></div>
      <div class="composer-tools">
        <label class="extras-action composer-tool">${svgIcon("image", 17)} Photo<input type="file" accept="image/*" hidden /></label>
        <button type="button" class="extras-action composer-tool composer-tag">${svgIcon("tag", 17)} Tag people</button>
      </div>
      <button type="button" class="btn composer-go" style="width:100%;">Post</button>` });
    s.onClose = () => { if (previewUrl) URL.revokeObjectURL(previewUrl); setTimeout(() => s.el.remove(), 300); };
    const $ = (sel) => s.body.querySelector(sel);
    const prev = $(".composer-preview");

    $("input[type=file]").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      try {
        const edited = await editAndCompress(f, { title: "New post", doneLabel: "Next", aspects: ["original", "1:1", "4:5", "16:9"] });
        if (!edited) return;
        file = edited;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        prev.querySelector("img").src = previewUrl;
        prev.hidden = false;
      } catch (err) { toast(err.message); }
    });
    $(".composer-preview-x").addEventListener("click", () => { file = null; prev.hidden = true; });
    $(".composer-tag").addEventListener("click", async () => {
      const picked = await pickPeople({ title: "Tag people", exclude: [me().id], selected: tagged, cta: "Done" });
      if (!picked) return;
      tagged = picked;
      const t = $(".composer-tags");
      t.hidden = !tagged.length;
      t.textContent = tagged.length ? `With ${tagged.map((p) => "@" + p.username).join(", ")}` : "";
    });
    $(".composer-go").addEventListener("click", async (e) => {
      const text = $(".composer-text").value.trim();
      if (!text && !file) { toast("Write something or add a photo."); return; }
      e.target.disabled = true; e.target.textContent = "Posting…";
      try {
        const post = await publishPost(text, file, tagged);
        s.close();
        toast("Posted");
        onPosted && onPosted(post);
      } catch (err) {
        toast(friendlyError(err, "Could not publish post."));
      } finally { e.target.disabled = false; e.target.textContent = "Post"; }
    });
    s.open();
    setTimeout(() => $(".composer-text").focus(), 150);
  }

  async function publishPost(text, imageBlob, tagged = []) {
    let image_url = null;
    if (imageBlob) image_url = await uploadPublic("posts", `${me().id}/${Date.now()}.jpg`, imageBlob);
    const { data: post, error } = await sb.from("posts").insert({ user_id: me().id, content: text || null, image_url }).select().single();
    if (error) throw error;
    if (tagged.length) await saveTags(post.id, tagged);
    return post;
  }

  /* ---------------- Highlights ---------------- */

  const Highlights = (() => {
    let rail, owner, isOwn, items = [];

    async function render(railEl, user, own) {
      rail = railEl; owner = user; isOwn = own;
      if (!rail) return;
      const { data, error } = await sb.from("highlights")
        .select("id,title,cover_url,created_at,highlight_items(id,image_url,created_at)")
        .eq("user_id", user.id).order("created_at", { ascending: true });
      items = error ? [] : (data || []);
      items.forEach((h) => h.highlight_items.sort((a, b) => a.created_at.localeCompare(b.created_at)));
      paint();
    }

    function paint() {
      rail.innerHTML = "";
      if (!items.length && !isOwn) { rail.style.display = "none"; return; }
      rail.style.display = "";
      if (isOwn) {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "highlight-item";
        add.innerHTML = `<span class="highlight-cover highlight-new">${svgIcon("plus", 22)}</span><span class="highlight-title">New</span>`;
        add.addEventListener("click", () => openCreator());
        rail.appendChild(add);
      }
      items.forEach((h, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "highlight-item";
        const cover = h.cover_url || h.highlight_items[0]?.image_url;
        b.innerHTML = `<span class="highlight-cover"></span><span class="highlight-title">${escapeHTML(h.title)}</span>`;
        const c = b.querySelector(".highlight-cover");
        if (cover) c.style.backgroundImage = `url("${cover}")`;
        else { c.style.background = colorFromName(h.title); c.textContent = initials(h.title); }
        b.addEventListener("click", () => h.highlight_items.length ? openViewer(i) : (isOwn ? openCreator(h) : null));
        rail.appendChild(b);
      });
    }

    // Create a new highlight, or add more photos to an existing one.
    async function openCreator(existing = null) {
      const picked = new Map();     // key -> {url} or {file}
      const s = makeSheet({ title: existing ? `Add to "${existing.title}"` : "New highlight", html: `
        ${existing ? "" : `<input class="x3-input hl-title" maxlength="20" placeholder="Name it, e.g. Annual day" autocomplete="off" />`}
        <div class="x3-subhead">From your stories (last 24 hours)</div>
        <div class="highlight-preview-grid hl-stories"><span class="x3-hint">Loading…</span></div>
        <label class="extras-action">${svgIcon("image", 17)} Add photos from your phone<input type="file" accept="image/*" multiple hidden /></label>
        <div class="highlight-preview-grid hl-uploads"></div>
        <button type="button" class="btn hl-go" style="width:100%;">${existing ? "Add" : "Create highlight"}</button>` });
      s.onClose = () => setTimeout(() => s.el.remove(), 300);
      s.open();

      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: stories } = await sb.from("stories").select("id,image_url,created_at")
        .eq("user_id", me().id).gt("created_at", since).not("image_url", "is", null).order("created_at", { ascending: false });
      const grid = s.body.querySelector(".hl-stories");
      grid.innerHTML = stories?.length ? "" : `<span class="x3-hint">No active stories — add photos below instead.</span>`;
      (stories || []).forEach((st) => {
        const img = document.createElement("img");
        img.src = st.image_url; img.alt = ""; img.className = "hl-pick";
        img.addEventListener("click", () => {
          if (picked.has(st.id)) picked.delete(st.id); else picked.set(st.id, { url: st.image_url });
          img.classList.toggle("on", picked.has(st.id));
        });
        grid.appendChild(img);
      });

      s.body.querySelector("input[type=file]").addEventListener("change", (e) => {
        const up = s.body.querySelector(".hl-uploads");
        [...e.target.files].slice(0, 10).forEach((f) => {
          const key = "f" + Math.random();
          const img = document.createElement("img");
          img.src = URL.createObjectURL(f); img.className = "hl-pick on"; img.alt = "";
          img.addEventListener("click", () => { picked.delete(key); img.remove(); });
          picked.set(key, { file: f });
          up.appendChild(img);
        });
        e.target.value = "";
      });

      s.body.querySelector(".hl-go").addEventListener("click", async (e) => {
        const title = existing ? existing.title : s.body.querySelector(".hl-title").value.trim();
        if (!title) { toast("Give the highlight a name."); return; }
        if (!picked.size) { toast("Pick at least one photo."); return; }
        e.target.disabled = true; e.target.textContent = "Saving…";
        try {
          const urls = [];
          for (const v of picked.values()) {
            if (v.url) urls.push(v.url);
            else urls.push(await uploadPublic("highlights", `${me().id}/${Date.now()}-${urls.length}.jpg`, await compressImageFile(v.file)));
          }
          let h = existing;
          if (!h) {
            const { data, error } = await sb.from("highlights").insert({ user_id: me().id, title, cover_url: urls[0] }).select().single();
            if (error) throw error;
            h = data;
          }
          const { error: iErr } = await sb.from("highlight_items").insert(urls.map((u) => ({ highlight_id: h.id, image_url: u })));
          if (iErr) throw iErr;
          s.close();
          toast(existing ? "Added to highlight" : "Highlight created");
          render(rail, owner, isOwn);
        } catch (err) {
          toast(friendlyError(err, "Could not save the highlight."));
          e.target.disabled = false; e.target.textContent = existing ? "Add" : "Create highlight";
        }
      });
    }

    // Lets the story viewer on Home save the current story into a highlight.
    async function addImageTo(imageUrl) {
      const { data } = await sb.from("highlights").select("id,title").eq("user_id", me().id).order("created_at");
      const save = async (h) => {
        const { error } = await sb.from("highlight_items").insert({ highlight_id: h.id, image_url: imageUrl });
        toast(error ? friendlyError(error, "Could not add.") : `Added to "${h.title}"`);
      };
      actionSheet("Add to highlight", [
        ...(data || []).map((h) => ({ icon: "star", label: h.title, onClick: () => save(h) })),
        { icon: "plus", label: "New highlight…", onClick: async () => {
          const title = (prompt("Name the new highlight") || "").trim().slice(0, 20);
          if (!title) return;
          const { data: h, error } = await sb.from("highlights").insert({ user_id: me().id, title, cover_url: imageUrl }).select().single();
          if (error) { toast(friendlyError(error)); return; }
          save(h);
        } },
      ]);
    }

    /* viewer */
    let viewerEl = null, cur = { h: 0, i: 0 }, timer = null, startedAt = 0, elapsed = 0, paused = false;
    const MS = 5000;

    function buildViewer() {
      viewerEl = document.createElement("div");
      viewerEl.className = "hl-viewer";
      viewerEl.innerHTML = `
        <div class="hl-progress"></div>
        <div class="hl-top"><b class="hl-name"></b><span class="hl-actions"></span><button type="button" class="hl-x" aria-label="Close">${svgIcon("close", 22)}</button></div>
        <img class="hl-img" alt="" />
        <div class="hl-tap left"></div><div class="hl-tap right"></div>`;
      document.body.appendChild(viewerEl);
      viewerEl.querySelector(".hl-x").addEventListener("click", () => AppNav.exitFullscreen());
      const tap = (dir) => (e) => { e.stopPropagation(); dir > 0 ? next() : prev(); };
      viewerEl.querySelector(".hl-tap.left").addEventListener("click", tap(-1));
      viewerEl.querySelector(".hl-tap.right").addEventListener("click", tap(1));
      ["pointerdown"].forEach((ev) => viewerEl.addEventListener(ev, () => { pause(); }));
      ["pointerup", "pointercancel"].forEach((ev) => viewerEl.addEventListener(ev, () => { resume(); }));
      document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); else resume(); });
    }

    function openViewer(hIndex) {
      if (!viewerEl) buildViewer();
      cur = { h: hIndex, i: 0 };
      viewerEl.classList.add("show");
      AppNav.enterFullscreen(() => { cancelAnimationFrame(timer); viewerEl.classList.remove("show"); });
      show();
    }

    function show() {
      const h = items[cur.h];
      const it = h.highlight_items[cur.i];
      viewerEl.querySelector(".hl-name").textContent = h.title;
      viewerEl.querySelector(".hl-progress").innerHTML = h.highlight_items.map((_, i) => `<span><i style="width:${i < cur.i ? 100 : 0}%"></i></span>`).join("");
      const acts = viewerEl.querySelector(".hl-actions");
      acts.innerHTML = "";
      if (isOwn) {
        const mk = (icon, title, fn) => {
          const b = document.createElement("button");
          b.type = "button"; b.title = title; b.innerHTML = svgIcon(icon, 18);
          b.addEventListener("click", (e) => { e.stopPropagation(); pause(); fn(); });
          acts.appendChild(b);
        };
        mk("plus", "Add photos", () => { AppNav.exitFullscreen(); setTimeout(() => openCreator(h), 300); });
        mk("star", "Use as cover", async () => {
          const { error } = await sb.from("highlights").update({ cover_url: it.image_url }).eq("id", h.id);
          if (!error) { h.cover_url = it.image_url; paint(); toast("Cover updated"); }
          resume();
        });
        mk("trash", "Remove this photo", async () => {
          const last = h.highlight_items.length === 1;
          if (!confirm(last ? `Remove the last photo and delete "${h.title}"?` : "Remove this photo from the highlight?")) { resume(); return; }
          const { error } = last
            ? await sb.from("highlights").delete().eq("id", h.id)
            : await sb.from("highlight_items").delete().eq("id", it.id);
          if (error) { toast(friendlyError(error)); resume(); return; }
          if (last) { items.splice(cur.h, 1); paint(); AppNav.exitFullscreen(); return; }
          h.highlight_items.splice(cur.i, 1);
          if (cur.i >= h.highlight_items.length) cur.i = h.highlight_items.length - 1;
          paint(); show();
        });
      }
      const img = viewerEl.querySelector(".hl-img");
      paused = true; elapsed = 0;
      img.onload = () => { paused = false; startedAt = performance.now(); tick(); };
      img.onerror = img.onload;
      img.src = it.image_url;
    }

    function tick() {
      cancelAnimationFrame(timer);
      const loop = () => {
        if (!paused) {
          const p = Math.min((elapsed + performance.now() - startedAt) / MS, 1);
          const bar = viewerEl.querySelectorAll(".hl-progress i")[cur.i];
          if (bar) bar.style.width = `${p * 100}%`;
          if (p >= 1) { next(); return; }
        }
        timer = requestAnimationFrame(loop);
      };
      timer = requestAnimationFrame(loop);
    }
    function pause() { if (!paused) { elapsed += performance.now() - startedAt; paused = true; } }
    function resume() { if (paused && viewerEl?.classList.contains("show")) { startedAt = performance.now(); paused = false; } }
    function next() {
      const h = items[cur.h];
      if (cur.i < h.highlight_items.length - 1) { cur.i++; show(); }
      else AppNav.exitFullscreen();
    }
    function prev() { if (cur.i > 0) { cur.i--; show(); } else show(); }

    return { render, addImageTo };
  })();

  return { loadTags, fromCards, tagLine, attachPostExtras, openComposer, publishPost, saveTags, postToStory, Highlights };
})();

// Old call sites used these globals.
const Highlights = Social.Highlights;
function attachPostExtras(card, post, actionsRow, opts) { Social.attachPostExtras(card, post, actionsRow, opts); }
