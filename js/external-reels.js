(function () {
  const feed = document.getElementById("reelsFeed");
  if (!feed) return;

  const BATCH = 8;
  const RESOLVER = "http://127.0.0.1:8898/api/video/";
  const IG_RE = /^https:\/\/www\.instagram\.com\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/;
  const YT_RE = /(?:youtube\.com\/(?:shorts|embed)\/|youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})/;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function parse(url) {
    const ig = url.match(IG_RE);
    if (ig) return { type: "ig", id: ig[1] };
    const yt = url.match(YT_RE);
    if (yt) return { type: "yt", id: yt[1] };
    return null;
  }

  function ytCommand(el, func) {
    const f = el.querySelector("iframe");
    if (!f || !f.contentWindow) return;
    f.contentWindow.postMessage(JSON.stringify({ event: "command", func, args: [] }), "https://www.youtube.com");
  }

  const playObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const el = e.target;
      if (el.dataset.paused === "1") continue;
      if (el.dataset.type === "ig") {
        const v = el.querySelector("video");
        if (!v) continue;
        if (e.isIntersecting) v.play().catch(() => {});
        else v.pause();
      } else if (el.dataset.type === "yt") {
        ytCommand(el, e.isIntersecting ? "playVideo" : "pauseVideo");
      }
    }
  }, { root: feed, threshold: 0.65 });

  function addControls(el, media) {
    const mute = document.createElement("button");
    mute.className = "ig-mute-btn";
    mute.textContent = "Sound off";
    mute.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = mute.textContent === "Sound on";
      document.querySelectorAll(".ig-reel video").forEach((v) => { v.muted = on; });
      document.querySelectorAll(".ig-reel iframe").forEach((f) => {
        f.contentWindow?.postMessage(JSON.stringify({ event: "command", func: on ? "mute" : "unMute", args: [] }), "https://www.youtube.com");
      });
      document.querySelectorAll(".ig-mute-btn").forEach((b) => { b.textContent = on ? "Sound off" : "Sound on"; });
    });

    const pause = document.createElement("button");
    pause.className = "ig-pause";
    pause.textContent = "Pause";
    function toggle(e) {
      if (e) e.stopPropagation();
      const paused = el.dataset.paused !== "1";
      el.dataset.paused = paused ? "1" : "0";
      pause.textContent = paused ? "Play" : "Pause";
      if (el.dataset.type === "ig") {
        const v = el.querySelector("video");
        if (!v) return;
        if (paused) v.pause();
        else v.play().catch(() => {});
      } else {
        ytCommand(el, paused ? "pauseVideo" : "playVideo");
      }
    }
    pause.addEventListener("click", toggle);
    if (media) media.addEventListener("click", toggle);
    el.append(mute, pause);
  }

  async function resolveVideo(code) {
    const res = await fetch(RESOLVER + code);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!data.url) throw new Error("no url");
    return data.url;
  }

  function igCard(src) {
    const el = document.createElement("section");
    el.className = "reel ig-reel";
    el.dataset.type = "ig";
    el.dataset.paused = "0";

    const v = document.createElement("video");
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.setAttribute("playsinline", "");

    const label = document.createElement("div");
    label.className = "ig-loading";
    label.textContent = "Loading reel…";
    const clear = () => label.remove();
    v.addEventListener("loadeddata", clear, { once: true });
    v.addEventListener("playing", clear, { once: true });

    el.append(v, label);
    addControls(el, v);
    v.addEventListener("error", () => {
      playObserver.unobserve(el);
      el.remove();
    }, { once: true });
    v.src = src;
    return el;
  }

  function ytCard(id) {
    const el = document.createElement("section");
    el.className = "reel ig-reel yt-reel";
    el.dataset.type = "yt";
    el.dataset.paused = "0";

    const wrap = document.createElement("div");
    wrap.className = "yt-wrap";
    const f = document.createElement("iframe");
    f.src = `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1&loop=1&playlist=${id}&enablejsapi=1&controls=0&modestbranding=1`;
    f.allow = "autoplay; encrypted-media; picture-in-picture";
    f.allowFullscreen = true;
    f.title = "Short";
    wrap.appendChild(f);
    el.appendChild(wrap);
    addControls(el, null);
    return el;
  }

  (async () => {
    let links = [];
    try {
      const text = await (await fetch("reel.txt")).text();
      links = shuffle(text.split(/\r?\n/).map((s) => s.trim()).map(parse).filter(Boolean));
    } catch (e) {
      return;
    }
    if (!links.length) return;

    const sentinel = document.getElementById("reelsSentinel");
    feed.querySelector(".reels-empty")?.remove();

    let added = 0;
    for (const link of links) {
      if (added >= BATCH) break;
      let el;
      if (link.type === "yt") {
        el = ytCard(link.id);
      } else {
        let src;
        try {
          src = await resolveVideo(link.id);
        } catch (e) {
          continue;
        }
        el = igCard(src);
      }
      feed.insertBefore(el, sentinel);
      playObserver.observe(el);
      added++;
    }
  })();
})();
