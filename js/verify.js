let selectedFile = null;
let pollTimer = null;

const uploadState = document.getElementById("uploadState");
const pendingState = document.getElementById("pendingState");
const rejectedState = document.getElementById("rejectedState");
const approvedState = document.getElementById("approvedState");

function showState(el) {
  [uploadState, pendingState, rejectedState, approvedState].forEach(s => s.style.display = "none");
  el.style.display = "block";
}

async function init() {
  const session = await requireSession("index.html");
  if (!session) return;

  const profile = await getMyProfile();
  if (!profile) return;

  if (profile.banned) {
    toast("This account has been banned.");
    await sb.auth.signOut();
    window.location.href = "index.html";
    return;
  }

  if (profile.is_verified) {
    window.location.href = "home.html";
    return;
  }

  const { data: reqs } = await sb
    .from("verification_requests")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const latest = reqs && reqs[0];
  if (latest && latest.status === "pending") {
    showState(pendingState);
    startPolling(session.user.id);
  } else if (latest && latest.status === "rejected") {
    showState(rejectedState);
  } else {
    showState(uploadState);
  }
}

function startPolling(userId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const profile = await getMyProfile();
    if (profile && profile.is_verified) {
      clearInterval(pollTimer);
      showState(approvedState);
      setTimeout(() => (window.location.href = "home.html"), 1200);
      return;
    }
    const { data: reqs } = await sb
      .from("verification_requests")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (reqs && reqs[0] && reqs[0].status === "rejected") {
      clearInterval(pollTimer);
      showState(rejectedState);
    }
  }, 4000);
}

document.getElementById("idCardInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = document.getElementById("previewImg");
    img.src = ev.target.result;
    img.style.display = "block";
  };
  reader.readAsDataURL(file);
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
    const ext = selectedFile.name.split(".").pop();
    const path = `${userId}/${Date.now()}.${ext}`;

    const { error: upErr } = await sb.storage.from("id-cards").upload(path, selectedFile, {
      cacheControl: "3600",
      upsert: false,
    });
    if (upErr) throw upErr;

    const { error: reqErr } = await sb.from("verification_requests").insert({
      user_id: userId,
      id_card_url: path,
      status: "pending",
    });
    if (reqErr) throw reqErr;

    await sb.from("profiles").update({ id_card_url: path }).eq("id", userId);

    showState(pendingState);
    startPolling(userId);
  } catch (e) {
    errEl.textContent = e.message || "Upload failed. Try again.";
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

document.getElementById("logoutFromPending").addEventListener("click", logoutUser);

init();
