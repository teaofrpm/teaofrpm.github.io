
// 1-on-1 voice and video calls over WebRTC.
// Supabase only carries signalling: the `calls` row tracks ringing/answered/ended,
// and a broadcast channel per call carries the SDP offer/answer and ICE candidates.
// The actual audio and video travel directly between the two devices.

const CALL_RING_TIMEOUT_MS = 35000;
const CALL_RECONNECT_GRACE_MS = 8000;

// STUN finds your public address; TURN relays media when two phones can't
// reach each other directly (common on mobile data). The free public relay
// below is fine for testing. For dependable calls, create free TURN
// credentials (e.g. at metered.ca) and set ICE_SERVERS in js/config.js.
const CALL_ICE_SERVERS = (window.TEAOFRPM_CONFIG && window.TEAOFRPM_CONFIG.ICE_SERVERS) || [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

const CallManager = (() => {
  let myId = null;
  let active = null;     // the call this device is in
  let incoming = null;   // a call ringing on this device, not yet answered
  let tone = null;
  let el = null;         // overlay element

  /* ================= Setup ================= */

  async function init() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return;
    myId = data.session.user.id;

    sb.channel(`calls-for:${myId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls", filter: `callee_id=eq.${myId}` },
        ({ new: call }) => onIncoming(call))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls", filter: `callee_id=eq.${myId}` },
        ({ new: call }) => onCallUpdated(call))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls", filter: `caller_id=eq.${myId}` },
        ({ new: call }) => onCallUpdated(call))
      .subscribe();

    // A call that started ringing moments before this page loaded
    // (e.g. the person was switching tabs) should still ring here.
    const since = new Date(Date.now() - CALL_RING_TIMEOUT_MS).toISOString();
    const { data: ringing } = await sb.from("calls").select("*")
      .eq("callee_id", myId).eq("status", "ringing").gt("created_at", since)
      .order("created_at", { ascending: false }).limit(1);
    if (ringing && ringing[0]) onIncoming(ringing[0]);

    window.addEventListener("beforeunload", (e) => {
      if (active) { e.preventDefault(); e.returnValue = ""; }
    });
    window.addEventListener("pagehide", () => { if (active) hangUp(); });
  }

  function isBusy() { return !!(active || incoming); }

  /* ================= Outgoing ================= */

  async function start(conversationId, callee, kind) {
    if (!myId) { toast("Still connecting, try again in a moment."); return; }
    if (isBusy()) { toast("You're already in a call."); return; }
    if (!window.RTCPeerConnection || !navigator.mediaDevices) {
      toast("Calls aren't supported in this browser.");
      return;
    }

    let local;
    try {
      local = await getMedia(kind);
    } catch {
      toast(kind === "video" ? "Allow camera and microphone to make a video call." : "Allow the microphone to make a call.");
      return;
    }

    const { data: call, error } = await sb.from("calls")
      .insert({ conversation_id: conversationId, caller_id: myId, callee_id: callee.id, kind })
      .select().single();
    if (error) {
      stopStream(local);
      toast(error.message || "Could not start the call.");
      return;
    }

    active = { call, role: "caller", peer: callee, local, pendingIce: [] };
    showUI("outgoing");
    playTone("ringback");
    openSignalChannel();

    active.ringTimeout = setTimeout(() => {
      if (active && active.call.id === call.id && !active.connectedAt) {
        setStatus("No answer");
        finish("missed", 1200);
      }
    }, CALL_RING_TIMEOUT_MS);
  }

  /* ================= Incoming ================= */

  async function onIncoming(call) {
    if (call.status !== "ringing") return;
    if (incoming && incoming.id === call.id) return;

    if (isBusy()) {
      await sb.from("calls").update({ status: "declined" }).eq("id", call.id);
      return;
    }

    incoming = { ...call };
    const peer = await getProfile(call.caller_id);
    if (!incoming || incoming.id !== call.id) return; // caller hung up while we looked them up
    incoming.peer = peer;

    showUI("incoming");
    playTone("ringtone");
    if (navigator.vibrate) navigator.vibrate([400, 300, 400, 300, 400]);

    const elapsed = Date.now() - new Date(call.created_at).getTime();
    incoming.timeout = setTimeout(async () => {
      if (!incoming || incoming.id !== call.id) return;
      const id = incoming.id;
      dismissIncoming();
      await sb.from("calls").update({ status: "missed" }).eq("id", id).eq("status", "ringing");
    }, Math.max(1000, CALL_RING_TIMEOUT_MS - elapsed));
  }

  async function accept() {
    if (!incoming) return;
    const call = incoming;
    stopTone();
    clearTimeout(call.timeout);
    setStatus("Connecting…");
    setControlsDisabled(true);

    let local;
    try {
      local = await getMedia(call.kind);
    } catch {
      toast(call.kind === "video" ? "Camera and microphone access is needed to answer." : "Microphone access is needed to answer.");
      decline();
      return;
    }

    const { error } = await sb.from("calls").update({ status: "accepted" }).eq("id", call.id);
    if (error) {
      stopStream(local);
      incoming = null;
      hideUI();
      toast("This call is no longer available.");
      return;
    }

    incoming = null;
    active = { call: { ...call, status: "accepted" }, role: "callee", peer: call.peer, local, pendingIce: [] };
    showUI("connecting");
    openSignalChannel();
  }

  async function decline() {
    if (!incoming) return;
    const id = incoming.id;
    dismissIncoming();
    await sb.from("calls").update({ status: "declined" }).eq("id", id).eq("status", "ringing");
  }

  function dismissIncoming() {
    if (incoming) clearTimeout(incoming.timeout);
    incoming = null;
    stopTone();
    if (navigator.vibrate) navigator.vibrate(0);
    if (!active) hideUI();
  }

  /* ================= Status changes from the database ================= */

  function onCallUpdated(call) {
    // Ringing here, but the caller hung up or it was answered on another tab/device
    if (incoming && incoming.id === call.id && call.status !== "ringing") {
      const answeredElsewhere = call.status === "accepted";
      dismissIncoming();
      if (answeredElsewhere) toast("Answered on another device");
      return;
    }

    if (!active || active.call.id !== call.id) return;
    active.call = call;

    if (active.role === "caller" && call.status === "accepted") {
      clearTimeout(active.ringTimeout);
      stopTone();
      setStatus("Connecting…");
    }
    if (active.role === "caller" && call.status === "declined") {
      stopTone();
      setStatus("Call declined");
      finish(null, 1400);
    }
    if (["ended", "missed", "cancelled", "failed"].includes(call.status)) {
      finish(null);
    }
  }

  /* ================= Signalling ================= */

  function openSignalChannel() {
    const channel = sb.channel(`call:${active.call.id}`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "signal" }, ({ payload }) => onSignal(payload));
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED" || !active || active.role !== "callee") return;
      // Tell the caller we're listening; repeat a few times in case the first is lost
      send({ type: "ready" });
      let tries = 0;
      const retry = setInterval(() => {
        if (!active || active.gotOffer || ++tries > 5) { clearInterval(retry); return; }
        send({ type: "ready" });
      }, 2500);
      active.readyRetry = retry;
    });
    active.channel = channel;
  }

  function send(payload) {
    if (active && active.channel) {
      active.channel.send({ type: "broadcast", event: "signal", payload });
    }
  }

  async function onSignal(p) {
    if (!active) return;
    try {
      if (p.type === "ready" && active.role === "caller" && !active.pc) {
        createPeer();
        const offer = await active.pc.createOffer();
        await active.pc.setLocalDescription(offer);
        send({ type: "offer", sdp: active.pc.localDescription.toJSON() });
      } else if (p.type === "offer" && active.role === "callee" && !active.gotOffer) {
        active.gotOffer = true;
        clearInterval(active.readyRetry);
        if (!active.pc) createPeer();
        await active.pc.setRemoteDescription(p.sdp);
        await flushPendingIce();
        const answer = await active.pc.createAnswer();
        await active.pc.setLocalDescription(answer);
        send({ type: "answer", sdp: active.pc.localDescription.toJSON() });
      } else if (p.type === "answer" && active.role === "caller" && active.pc && !active.pc.remoteDescription) {
        await active.pc.setRemoteDescription(p.sdp);
        await flushPendingIce();
      } else if (p.type === "ice") {
        if (active.pc && active.pc.remoteDescription) {
          await active.pc.addIceCandidate(p.candidate).catch(() => {});
        } else {
          active.pendingIce.push(p.candidate);
        }
      } else if (p.type === "hangup") {
        setStatus("Call ended");
        finish(null, 900, true);
      }
    } catch (err) {
      console.error("call signalling", err);
    }
  }

  async function flushPendingIce() {
    const queued = active.pendingIce.splice(0);
    for (const c of queued) await active.pc.addIceCandidate(c).catch(() => {});
  }

  function createPeer() {
    const pc = new RTCPeerConnection({ iceServers: CALL_ICE_SERVERS });
    active.local.getTracks().forEach((t) => pc.addTrack(t, active.local));

    pc.onicecandidate = (e) => { if (e.candidate) send({ type: "ice", candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => attachRemote(e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (!active || active.pc !== pc) return;
      const state = pc.connectionState;
      if (state === "connected") {
        clearTimeout(active.dropTimer);
        onConnected();
      } else if (state === "disconnected") {
        setStatus("Reconnecting…");
        clearTimeout(active.dropTimer);
        active.dropTimer = setTimeout(() => {
          if (active && active.pc === pc && pc.connectionState !== "connected") {
            setStatus("Connection lost");
            finish("ended", 1200);
          }
        }, CALL_RECONNECT_GRACE_MS);
      } else if (state === "failed") {
        setStatus(active.connectedAt ? "Connection lost" : "Couldn't connect");
        finish(active.connectedAt ? "ended" : "failed", 1500);
      }
    };
    active.pc = pc;
  }

  function onConnected() {
    if (active.connectedAt) { renderTimer(); return; }
    active.connectedAt = Date.now();
    stopTone();
    showUI("connected");
    renderTimer();
    active.durationTimer = setInterval(renderTimer, 1000);
  }

  function renderTimer() {
    if (!active || !active.connectedAt) return;
    const secs = Math.floor((Date.now() - active.connectedAt) / 1000);
    setStatus(`${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`);
  }

  /* ================= Ending ================= */

  function hangUp() {
    if (!active) return;
    const stillRinging = active.role === "caller" && !active.connectedAt && active.call.status === "ringing";
    finish(stillRinging ? "cancelled" : "ended");
  }

  // status: what to record in the database (null = the other side already did)
  // delay: keep the overlay up briefly so "Call declined" etc. can be read
  async function finish(status, delay = 0, fromRemote = false) {
    if (!active || active.finishing) return;
    const a = active;
    a.finishing = true;

    if (!fromRemote) send({ type: "hangup" });
    if (status) {
      sb.from("calls").update({ status }).eq("id", a.call.id).then(() => {});
    }

    clearTimeout(a.ringTimeout);
    clearTimeout(a.dropTimer);
    clearInterval(a.durationTimer);
    clearInterval(a.readyRetry);
    stopTone();
    if (a.pc) a.pc.close();
    stopStream(a.local);
    setControlsDisabled(true);

    setTimeout(() => {
      if (a.channel) sb.removeChannel(a.channel);
      if (active === a) active = null;
      hideUI();
    }, delay);
  }

  /* ================= Media ================= */

  function getMedia(kind) {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: kind === "video" ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  }

  function stopStream(stream) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }

  function attachRemote(stream) {
    if (!el || !active) return;
    if (active.call.kind === "video") {
      const v = el.querySelector(".call-remote-video");
      v.srcObject = stream;
      v.play().catch(() => {});
    } else {
      const a = el.querySelector(".call-remote-audio");
      a.srcObject = stream;
      a.play().catch(() => {});
    }
  }

  function toggleMute(btn) {
    const track = active && active.local.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    btn.classList.toggle("off", !track.enabled);
    btn.innerHTML = svgIcon(track.enabled ? "mic" : "micOff", 22);
    btn.setAttribute("aria-label", track.enabled ? "Mute" : "Unmute");
  }

  function toggleCamera(btn) {
    const track = active && active.local.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    btn.classList.toggle("off", !track.enabled);
    btn.innerHTML = svgIcon(track.enabled ? "video" : "videoOff", 22);
    el.querySelector(".call-local-video").style.visibility = track.enabled ? "visible" : "hidden";
  }

  async function flipCamera() {
    if (!active) return;
    const oldTrack = active.local.getVideoTracks()[0];
    if (!oldTrack) return;
    active.facing = active.facing === "environment" ? "user" : "environment";
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: active.facing } });
      const newTrack = fresh.getVideoTracks()[0];
      const sender = active.pc && active.pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) await sender.replaceTrack(newTrack);
      active.local.removeTrack(oldTrack);
      oldTrack.stop();
      active.local.addTrack(newTrack);
      const preview = el.querySelector(".call-local-video");
      preview.srcObject = active.local;
      preview.classList.toggle("mirrored", active.facing !== "environment");
    } catch {
      toast("Couldn't switch camera.");
    }
  }

  /* ================= Tones ================= */

  function playTone(kind) {
    stopTone();
    let ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    ctx.resume().catch(() => {});

    const beep = (freq, start, dur, vol) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    };

    const cycle = kind === "ringtone"
      ? () => { beep(880, 0, 0.35, 0.18); beep(660, 0.4, 0.35, 0.18); beep(880, 0.8, 0.35, 0.18); }
      : () => { beep(440, 0, 1.0, 0.06); };

    cycle();
    tone = { ctx, interval: setInterval(cycle, kind === "ringtone" ? 2400 : 3000) };
  }

  function stopTone() {
    if (!tone) return;
    clearInterval(tone.interval);
    tone.ctx.close().catch(() => {});
    tone = null;
  }

  /* ================= UI ================= */

  function buildUI() {
    el = document.createElement("div");
    el.className = "call-overlay";
    el.innerHTML = `
      <video class="call-remote-video" autoplay playsinline></video>
      <audio class="call-remote-audio" autoplay></audio>
      <div class="call-center">
        <span class="avatar call-avatar"></span>
        <div class="call-name"></div>
        <div class="call-status"></div>
      </div>
      <video class="call-local-video mirrored" autoplay playsinline muted></video>
      <div class="call-controls"></div>`;
    document.body.appendChild(el);
  }

  function showUI(mode) {
    if (!el) buildUI();
    const call = mode === "incoming" ? incoming : active.call;
    const peer = mode === "incoming" ? incoming.peer : active.peer;
    const isVideo = call.kind === "video";

    el.className = `call-overlay show ${isVideo ? "is-video" : "is-audio"} mode-${mode}`;
    setAvatarContent(el.querySelector(".call-avatar"), peer);
    el.querySelector(".call-name").textContent = peer?.display_name || "Unknown";

    const localVideo = el.querySelector(".call-local-video");
    if (mode !== "incoming" && isVideo && active) {
      localVideo.srcObject = active.local;
      localVideo.style.visibility = "visible";
    } else {
      localVideo.srcObject = null;
    }

    const statusText = {
      incoming: isVideo ? "Incoming video call" : "Incoming voice call",
      outgoing: "Calling…",
      connecting: "Connecting…",
    }[mode];
    if (statusText) setStatus(statusText);

    renderControls(mode, isVideo);
    AppNav.hide();
  }

  function renderControls(mode, isVideo) {
    const box = el.querySelector(".call-controls");
    box.innerHTML = "";
    const add = (cls, icon, label, handler) => {
      const b = document.createElement("button");
      b.className = `call-btn ${cls}`;
      b.innerHTML = svgIcon(icon, 24);
      b.setAttribute("aria-label", label);
      b.addEventListener("click", () => handler(b));
      box.appendChild(b);
      return b;
    };

    if (mode === "incoming") {
      add("decline", "phoneOff", "Decline", decline);
      add("accept", isVideo ? "video" : "phone", "Answer", accept);
      return;
    }

    add("", "mic", "Mute", toggleMute);
    if (isVideo) {
      add("", "video", "Turn camera off", toggleCamera);
      add("", "flip", "Switch camera", flipCamera);
    }
    add("decline", "phoneOff", "End call", hangUp);
  }

  function setControlsDisabled(disabled) {
    if (!el) return;
    el.querySelectorAll(".call-btn").forEach((b) => { b.disabled = disabled; });
  }

  function setStatus(text) {
    if (el) el.querySelector(".call-status").textContent = text;
  }

  function hideUI() {
    if (!el) return;
    el.classList.remove("show");
    el.querySelector(".call-remote-video").srcObject = null;
    el.querySelector(".call-remote-audio").srcObject = null;
    el.querySelector(".call-local-video").srcObject = null;
    AppNav.show();
  }

  init();
  return { start, isBusy };
})();
