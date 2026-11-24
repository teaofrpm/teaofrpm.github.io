// Group calls (groups + the public room): everyone in the call connects directly to everyone else
// (a WebRTC "mesh"), so it needs no media server. Supabase Realtime carries the rest:
//   presence  on `gcall:<chat>` = who is in the call right now (also drives the "Join" banner)
//   broadcast on the same channel = offers / answers / ICE, each addressed to one person.
// A mesh is great up to ~8 people, so the call is capped there.

const GroupCall = (() => {
  const MAX = 8;
  const ICE = (typeof CALL_ICE_SERVERS !== "undefined" && CALL_ICE_SERVERS) || [{ urls: "stun:stun.l.google.com:19302" }];
  let convo = null, me = null, ch = null, subscribed = null;
  let joined = false, local = null, camOn = false, muted = false, facing = "user";
  const peers = new Map();          // id -> { pc, stream, tile, ice: [], info }
  let roster = new Map();           // id -> presence info (everyone in the call, incl. me)
  let el = null, banner = null, layerOn = false, closingLayer = false, timerT = 0, startedAt = 0;
  let audioCtx = null, meters = new Map(), meterRaf = 0;
  const listeners = new Set();

  /* ---------------- channel ---------------- */
  function watch(c, user) {
    if (!c || c.kind === "dm" || c.kind === "bot" || ch) return;
    convo = c; me = user;
    ch = sb.channel(`gcall:${c.id}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    ch.on("presence", { event: "sync" }, onRoster)
      .on("broadcast", { event: "gsig" }, ({ payload }) => onSignal(payload));
    subscribed = new Promise((res) => ch.subscribe((s) => { if (s === "SUBSCRIBED") res(); }));
  }

  function onRoster() {
    const state = ch.presenceState();
    roster = new Map();
    for (const [id, metas] of Object.entries(state)) if (metas && metas[0]) roster.set(id, metas[0]);
    paintBanner();
    listeners.forEach((fn) => { try { fn(roster.size); } catch {} });
    if (!joined) return;
    // connect to newcomers: the lower id makes the offer, so each pair negotiates exactly once
    for (const [id, info] of roster) {
      if (id === me.id) continue;
      const p = peers.get(id);
      if (p) { p.info = info; paintTile(id); continue; }
      const np = makePeer(id, info);
      if (me.id < id) offer(id, np);
    }
    for (const id of [...peers.keys()]) if (!roster.has(id)) dropPeer(id);
    layout();
  }

  function send(to, data) { ch?.send({ type: "broadcast", event: "gsig", payload: { ...data, from: me.id, to } }); }

  /* ---------------- peers ---------------- */
  function makePeer(id, info) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const p = { pc, stream: new MediaStream(), ice: [], info, tile: null };
    peers.set(id, p);
    pc.onicecandidate = (e) => { if (e.candidate) send(id, { t: "ice", c: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track);
      const v = p.tile?.querySelector("video"), a = p.tile?.querySelector("audio");
      if (v && v.srcObject !== p.stream) v.srcObject = p.stream;
      if (a && a.srcObject !== p.stream) { a.srcObject = p.stream; a.play().catch(() => {}); }
      if (e.track.kind === "audio") meter(id, p.stream);
    };
    pc.onconnectionstatechange = () => {
      p.tile?.classList.toggle("connecting", !/connected|completed/.test(pc.connectionState));
      if (pc.connectionState === "failed") { try { pc.restartIce(); } catch {} if (me.id < id) offer(id, p, true); }
    };
    mkTile(id);
    return p;
  }

  function addLocalTracks(p) {
    // one audio + one video slot on every connection, so the camera can come and go with replaceTrack
    const a = local.getAudioTracks()[0] || null, v = (camOn && local.getVideoTracks()[0]) || null;
    const ts = p.pc.getTransceivers();
    const ta = ts.find((t) => t.receiver.track?.kind === "audio") || p.pc.addTransceiver("audio", { direction: "sendrecv" });
    const tv = ts.find((t) => t.receiver.track?.kind === "video") || p.pc.addTransceiver("video", { direction: "sendrecv" });
    ta.direction = tv.direction = "sendrecv";
    ta.sender.replaceTrack(a); tv.sender.replaceTrack(v);
  }

  async function offer(id, p, restart = false) {
    try {
      if (!p.pc.getTransceivers().length) addLocalTracks(p);
      await p.pc.setLocalDescription(await p.pc.createOffer(restart ? { iceRestart: true } : undefined));
      send(id, { t: "offer", sdp: p.pc.localDescription.sdp });
    } catch (e) { console.warn("[gcall] offer", e); }
  }

  async function onSignal(s) {
    if (!joined || !s || s.to !== me.id || s.from === me.id) return;
    let p = peers.get(s.from);
    try {
      if (s.t === "offer") {
        if (!p) p = makePeer(s.from, roster.get(s.from) || {});
        await p.pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
        addLocalTracks(p);
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        send(s.from, { t: "answer", sdp: p.pc.localDescription.sdp });
        flushIce(p);
        layout();
      } else if (s.t === "answer" && p) {
        if (p.pc.signalingState === "have-local-offer") await p.pc.setRemoteDescription({ type: "answer", sdp: s.sdp });
        flushIce(p);
      } else if (s.t === "ice" && p) {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(s.c).catch(() => {});
        else p.ice.push(s.c);
      }
    } catch (e) { console.warn("[gcall] signal", s.t, e); }
  }
  function flushIce(p) { const q = p.ice.splice(0); q.forEach((c) => p.pc.addIceCandidate(c).catch(() => {})); }

  function dropPeer(id) {
    const p = peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch {}
    p.tile?.remove();
    meters.delete(id);
    peers.delete(id);
    layout();
  }

  /* ---------------- join / leave ---------------- */
  async function join(withVideo = false) {
    if (joined) { expand(); return; }
    if (!ch) return;
    if (window.CallManager?.isBusy?.()) { toast("Finish your other call first."); return; }
    await subscribed;
    const others = [...roster.keys()].filter((k) => k !== me.id).length;
    if (others >= MAX) { toast(`This call is full (${MAX} people).`); return; }
    try {
      local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: withVideo ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
    } catch { toast("Allow the microphone to join the call."); return; }
    camOn = withVideo; muted = false; joined = true; startedAt = Date.now();
    buildUI();
    if (!others) sb.rpc("start_group_call", { p_convo: convo.id }).then(() => {}, () => {});
    await ch.track(info());
    meter(me.id, local);
    wake(true);
    tick();
  }

  function info() {
    return { id: me.id, name: me.display_name || me.username || "Someone", username: me.username || "", pfp: me.pfp_url || "", video: camOn, muted, at: startedAt };
  }

  async function leave() {
    if (!joined) return;
    joined = false;
    try { await ch.untrack(); } catch {}
    for (const id of [...peers.keys()]) dropPeer(id);
    local?.getTracks().forEach((t) => t.stop()); local = null;
    clearInterval(timerT); cancelAnimationFrame(meterRaf); meters.clear();
    try { audioCtx?.close(); } catch {} audioCtx = null;
    wake(false);
    dropLayer();
    el?.remove(); el = null;
    AppNav.show?.();
    paintBanner();
  }

  /* ---------------- controls ---------------- */
  function setMute(on) {
    muted = on;
    local?.getAudioTracks().forEach((t) => { t.enabled = !on; });
    ch?.track(info());
    paintControls();
    paintTile(me.id);
  }
  async function setCam(on) {
    if (on && !local.getVideoTracks()[0]) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } } });
        local.addTrack(s.getVideoTracks()[0]);
      } catch { toast("Allow the camera to turn video on."); return; }
    }
    const v = local.getVideoTracks()[0];
    if (!on && v) { v.stop(); local.removeTrack(v); }
    camOn = on;
    for (const p of peers.values()) {
      const tv = p.pc.getTransceivers().find((t) => t.receiver.track?.kind === "video");
      tv?.sender.replaceTrack(on ? local.getVideoTracks()[0] : null);
    }
    ch?.track(info());
    paintTile(me.id); paintControls(); layout();
  }
  async function flip() {
    if (!camOn) return;
    facing = facing === "user" ? "environment" : "user";
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
      const nv = s.getVideoTracks()[0], old = local.getVideoTracks()[0];
      if (old) { old.stop(); local.removeTrack(old); }
      local.addTrack(nv);
      for (const p of peers.values()) p.pc.getTransceivers().find((t) => t.receiver.track?.kind === "video")?.sender.replaceTrack(nv);
      paintTile(me.id);
    } catch { facing = facing === "user" ? "environment" : "user"; }
  }

  /* ---------------- UI ---------------- */
  function buildUI() {
    el?.remove();
    el = document.createElement("div");
    el.className = "gc-overlay show";
    el.innerHTML = `
      <div class="gc-top">
        <button type="button" class="gc-min" aria-label="Minimise">${svgIcon("chevronDown", 24)}</button>
        <div class="gc-title"><b></b><small><i class="gc-live"></i><span class="gc-count"></span> · <span class="gc-time">0:00</span></small></div>
        <span class="gc-spacer"></span>
      </div>
      <div class="gc-grid"></div>
      <div class="gc-controls"></div>
      <div class="gc-mini-face"></div>`;
    el.querySelector(".gc-title b").textContent = convo.name || (convo.is_public ? "Public room" : "Group call");
    el.querySelector(".gc-min").addEventListener("click", (e) => { e.stopPropagation(); minimise(); });
    el.addEventListener("click", () => { if (el.classList.contains("mini")) expand(); });
    document.body.appendChild(el);
    mkTile(me.id);
    paintControls();
    layout();
    pushLayer();
  }

  function mkTile(id) {
    if (!el) return;
    const grid = el.querySelector(".gc-grid");
    let t = grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!t) {
      t = document.createElement("div");
      t.className = "gc-tile" + (id === me.id ? " me" : " connecting");
      t.dataset.id = id;
      t.innerHTML = `<video autoplay playsinline ${id === me.id ? "muted" : ""}></video>${id === me.id ? "" : `<audio autoplay></audio>`}
        <div class="gc-face"><span class="gc-ring"></span><span class="avatar gc-av"></span></div>
        <div class="gc-name"><span class="gc-mic">${svgIcon("micOff", 13)}</span><b></b></div>`;
      if (id === me.id) grid.prepend(t); else grid.appendChild(t);
      const p = peers.get(id);
      if (p) {
        p.tile = t;
        if (p.stream.getTracks().length) { t.querySelector("video").srcObject = p.stream; const a = t.querySelector("audio"); a.srcObject = p.stream; a.play().catch(() => {}); }
      }
    }
    paintTile(id);
    return t;
  }

  function paintTile(id) {
    if (!el) return;
    const t = el.querySelector(`.gc-tile[data-id="${CSS.escape(id)}"]`);
    if (!t) return;
    const inf = id === me.id ? info() : (peers.get(id)?.info || roster.get(id) || {});
    t.querySelector(".gc-name b").textContent = id === me.id ? "You" : (inf.name || "Someone").split(" ")[0];
    const av = t.querySelector(".gc-av");
    if (av.dataset.k !== (inf.pfp || inf.name || "")) {
      av.dataset.k = inf.pfp || inf.name || "";
      try { setAvatarContent(av, { id, display_name: inf.name, username: inf.username, pfp_url: inf.pfp }); } catch { av.textContent = (inf.name || "?")[0]; }
    }
    t.classList.toggle("muted", !!inf.muted);
    t.classList.toggle("has-video", !!inf.video);
    const v = t.querySelector("video");
    if (id === me.id) { v.srcObject = camOn ? local : null; v.classList.toggle("mirrored", facing === "user"); }
  }

  function layout() {
    if (!el) return;
    const n = el.querySelectorAll(".gc-tile").length;
    el.querySelector(".gc-grid").dataset.n = String(Math.min(n, 8));
    el.querySelector(".gc-count").textContent = `${n} in call`;
    const face = el.querySelector(".gc-mini-face");
    const first = [...peers.values()][0];
    face.textContent = String(n);
    el.classList.toggle("alone", n === 1);
    if (first && !face.dataset.set) face.dataset.set = "1";
  }

  function paintControls() {
    if (!el) return;
    const box = el.querySelector(".gc-controls");
    box.innerHTML = "";
    const add = (cls, icon, label, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = `call-btn ${cls}`; b.innerHTML = svgIcon(icon, 24); b.setAttribute("aria-label", label); b.title = label;
      b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
      box.appendChild(b);
    };
    add(muted ? "off" : "", muted ? "micOff" : "mic", muted ? "Unmute" : "Mute", () => setMute(!muted));
    add(camOn ? "" : "off", camOn ? "video" : "videoOff", camOn ? "Camera off" : "Camera on", () => setCam(!camOn));
    if (camOn) add("", "flip", "Switch camera", flip);
    add("decline", "phoneOff", "Leave call", leave);
  }

  function tick() {
    clearInterval(timerT);
    const paint = () => {
      if (!el) return;
      const s = Math.floor((Date.now() - startedAt) / 1000);
      el.querySelector(".gc-time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };
    paint(); timerT = setInterval(paint, 1000);
  }

  /* who's talking: a soft ring pulses around their face */
  function meter(id, stream) {
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (!stream.getAudioTracks().length) return;
      const src = audioCtx.createMediaStreamSource(stream), an = audioCtx.createAnalyser();
      an.fftSize = 256; src.connect(an);
      meters.set(id, { an, buf: new Uint8Array(an.frequencyBinCount), lvl: 0 });
      if (!meterRaf) loopMeters();
    } catch {}
  }
  function loopMeters() {
    let last = 0;
    const step = (ts) => {
      meterRaf = requestAnimationFrame(step);
      if (ts - last < 90 || !el) return;
      last = ts;
      for (const [id, m] of meters) {
        m.an.getByteFrequencyData(m.buf);
        let sum = 0; for (let i = 2; i < 40; i++) sum += m.buf[i];
        const lvl = Math.min(1, sum / 38 / 120);
        m.lvl = m.lvl * 0.6 + lvl * 0.4;
        const t = el.querySelector(`.gc-tile[data-id="${CSS.escape(id)}"]`);
        if (t) { t.style.setProperty("--lvl", m.lvl.toFixed(2)); t.classList.toggle("speaking", m.lvl > 0.12 && !(id === me.id && muted)); }
      }
    };
    meterRaf = requestAnimationFrame(step);
  }

  /* back button = minimise, like 1:1 calls */
  function pushLayer() {
    if (layerOn) return;
    layerOn = true;
    AppNav.enterFullscreen?.(() => {
      layerOn = false;
      if (closingLayer) { closingLayer = false; return; }
      if (el) setMini(true);
    });
    AppNav.hide?.();
  }
  function dropLayer() { if (!layerOn) return; closingLayer = true; AppNav.exitFullscreen?.(); }
  function minimise() { if (layerOn) AppNav.exitFullscreen(); else setMini(true); }
  function setMini(on) { if (!el) return; el.classList.toggle("mini", on); if (on) AppNav.show?.(); else pushLayer(); }
  function expand() { if (el?.classList.contains("mini")) setMini(false); }

  let wakeLock = null;
  async function wake(on) {
    try { if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); else { await wakeLock?.release(); wakeLock = null; } } catch {}
  }

  /* ---------------- the banner in the chat ---------------- */
  function mountBanner(host) { banner = host; host.classList.add("gc-banner"); paintBanner(); }
  function paintBanner() {
    if (!banner) return;
    const ids = [...roster.keys()];
    if (!ids.length || joined) { banner.classList.remove("show"); return; }
    const faces = ids.slice(0, 3).map((id) => {
      const i = roster.get(id) || {};
      return `<span class="avatar gc-bf" data-id="${escapeHTML(id)}"></span>`;
    }).join("");
    banner.innerHTML = `<span class="gc-bfaces">${faces}</span><span class="gc-btxt"><b>Group call</b><small>${ids.length} in call${ids.length >= MAX ? " · full" : ""}</small></span>
      <button type="button" class="gc-bjoin" ${ids.length >= MAX ? "disabled" : ""}>${svgIcon("phone", 15)} Join</button>`;
    banner.querySelectorAll(".gc-bf").forEach((a) => {
      const i = roster.get(a.dataset.id) || {};
      try { setAvatarContent(a, { id: a.dataset.id, display_name: i.name, username: i.username, pfp_url: i.pfp }); } catch {}
    });
    banner.querySelector(".gc-bjoin").onclick = () => join(false);
    banner.classList.add("show");
  }

  // leaving the page would cut the call: ask first (same as 1:1 calls)
  document.addEventListener("click", (e) => {
    if (!joined) return;
    const a = e.target.closest?.("a[href]");
    if (!a || a.target === "_blank" || e.ctrlKey || e.metaKey) return;
    let url; try { url = new URL(a.href); } catch { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    const here = new URL(document.baseURI);
    if (url.origin !== here.origin || (url.pathname === here.pathname && url.search === here.search)) return;
    e.preventDefault(); e.stopPropagation();
    actionSheet("You're in a group call", [
      { icon: "phoneOff", label: "Leave call and open", danger: true, onClick: () => { leave(); setTimeout(() => { location.href = url.href; }, 400); } },
      { icon: "phone", label: "Stay in the call", onClick: () => {} },
    ]);
  }, true);
  addEventListener("beforeunload", (e) => { if (joined) { e.preventDefault(); e.returnValue = ""; } });
  addEventListener("pagehide", () => { if (joined) leave(); });

  return {
    watch, join, leave, mountBanner,
    isOn: () => joined,
    count: () => roster.size,
    onCount: (fn) => listeners.add(fn),
    _peers: peers,
  };
})();
window.GroupCall = GroupCall;
