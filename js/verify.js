let selectedFile = null;
let previewUrl = null;
let pollTimer = null;

const uploadState = document.getElementById("uploadState");
const pendingState = document.getElementById("pendingState");
const rejectedState = document.getElementById("rejectedState");
const approvedState = document.getElementById("approvedState");

function showState(el) {
  [uploadState, pendingState, rejectedState, approvedState].forEach((s) => (s.style.display = "none"));
  el.style.display = "block";
}

async function init() {
  const session = await requireSession("index.html");
  if (!session) return;
  const profile = await getMyProfile();
  if (!profile) { toast("Could not load your profile. Check your connection."); return; }
  if (profile.banned) {
    toast("This account has been banned.");
    await logoutUser();
    return;
  }
  if (profile.is_verified) { location.replace("home.html"); return; }

  const { data: reqs } = await sb.from("verification_requests").select("*")
    .eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(1);
  const latest = reqs && reqs[0];
  if (latest && latest.status === "pending") { showState(pendingState); watch(session.user.id); }
  else if (latest && latest.status === "rejected") showState(rejectedState);
  else showState(uploadState);
}

function approved() {
  clearInterval(pollTimer);
  showState(approvedState);
  setTimeout(() => location.replace("home.html"), 1200);
}

// The moment an admin approves, the profile row changes and we hear about
// it live; the slow poll is only a backup for a dropped connection.
function watch(userId) {
  sb.channel(`verify:${userId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` }, ({ new: p }) => {
      if (p && p.is_verified) approved();
    })
    .subscribe();

  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (document.hidden) return;
    const profile = await getMyProfile();
    if (profile && profile.is_verified) { approved(); return; }
    const { data: reqs } = await sb.from("verification_requests").select("status")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
    if (reqs && reqs[0] && reqs[0].status === "rejected") { clearInterval(pollTimer); showState(rejectedState); }
  }, 10000);
}

document.getElementById("idCardInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  selectedFile = file;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  const img = document.getElementById("previewImg");
  img.src = previewUrl;
  img.style.display = "block";
  document.getElementById("submitBtn").disabled = false;
});

document.getElementById("submitBtn").addEventListener("click", async () => {
  const btn = document.getElementById("submitBtn");
  const errEl = document.getElementById("uploadError");
  errEl.textContent = "";
  if (!selectedFile) return;

  btn.disabled = true;
  btn.textContent = "Uploading...";
  try {
    const { data: sess } = await sb.auth.getSession();
    const userId = sess.session.user.id;
    // A resized JPEG uploads in a second on mobile data and is still sharp
    // enough to read; HEIC photos from iPhones become readable too.
    let blob = selectedFile, ext = (selectedFile.name.split(".").pop() || "jpg").toLowerCase();
    try { blob = await compressImageFile(selectedFile, 2000); ext = "jpg"; } catch {}
    const path = `${userId}/${Date.now()}.${ext}`;

    const { error: upErr } = await sb.storage.from("id-cards").upload(path, blob, { cacheControl: "3600", upsert: false, contentType: ext === "jpg" ? "image/jpeg" : selectedFile.type });
    if (upErr) throw upErr;
    const { error: reqErr } = await sb.from("verification_requests").insert({ user_id: userId, id_card_url: path, status: "pending" });
    if (reqErr) throw reqErr;
    await sb.from("profiles").update({ id_card_url: path }).eq("id", userId);

    showState(pendingState);
    watch(userId);
  } catch (e) {
    errEl.textContent = e.message || "Upload failed. Try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit for Verification";
  }
});

document.getElementById("retryBtn").addEventListener("click", () => {
  selectedFile = null;
  document.getElementById("previewImg").style.display = "none";
  document.getElementById("submitBtn").disabled = true;
  showState(uploadState);
});

document.getElementById("logoutFromPending").addEventListener("click", () => logoutUser());

init();
