const cfg = window.TEAOFRPM_CONFIG;

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${cfg.AUTH_EMAIL_DOMAIN}`;
}

async function createNewAccount(displayName, username, password) {
  const email = usernameToEmail(username);

  const { data: existing } = await sb.from("profiles").select("id").eq("username", username.toLowerCase()).maybeSingle();
  if (existing) throw new Error("That username is already taken. Try another.");

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { username: username.toLowerCase(), display_name: displayName },
    },
  });

  if (error) {
    if (String(error.message).toLowerCase().includes("already registered")) {
      throw new Error("That username is already taken. Try another.");
    }
    throw error;
  }

  if (!data.session) {
    const { error: signInErr } = await sb.auth.signInWithPassword({ email, password });
    if (signInErr) throw signInErr;
  }

  return { username, displayName };
}

async function loginExisting(username, password) {
  const email = usernameToEmail(username);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function routeAfterAuth() {
  const profile = await getMyProfile();
  if (!profile) {
    toast("Could not load your profile. Try again.");
    return;
  }
  if (profile.banned) {
    toast("This account has been banned by the admin.");
    await sb.auth.signOut();
    return;
  }
  if (profile.is_verified) {
    window.location.href = "home.html";
  } else {
    window.location.href = "verify.html";
  }
}

async function logoutUser() {
  await sb.auth.signOut();
  window.location.href = "index.html";
}
