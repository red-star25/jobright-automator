// Auth helpers for Cloud AI (Supabase session stored in chrome.storage.local).

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function storageSet(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, resolve);
  });
}

function storageRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

async function getAuthSession() {
  const data = await storageGet(["authSession"]);
  return data.authSession || null;
}

async function saveAuthSession(session) {
  await storageSet({
    authSession: session,
    aiProvider: "cloud",
    cloudUsage: null,
  });
}

async function clearAuthSession() {
  await storageRemove(["authSession", "cloudUsage"]);
}

async function refreshAuthSessionIfNeeded() {
  const session = await getAuthSession();
  if (!session || !session.refresh_token) return session;

  const expiresAt = Number(session.expires_at || 0);
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt - now > 300) return session;

  const apiBase = typeof getApiBase === "function" ? getApiBase() : "";
  const response = await fetch(`${apiBase}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const json = await response.json();
  if (!json.ok) {
    await clearAuthSession();
    return null;
  }

  const nextSession = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: json.expires_at,
    email: json.email || session.email || "",
  };
  await saveAuthSession(nextSession);
  return nextSession;
}

async function fetchCloudMe() {
  const session = await refreshAuthSessionIfNeeded();
  if (!session?.access_token) return null;

  const apiBase = typeof getApiBase === "function" ? getApiBase() : "";
  const response = await fetch(`${apiBase}/api/me`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const json = await response.json();
  if (!json.ok) return null;
  await storageSet({ cloudUsage: json });
  return json;
}

function parseAuthHash(url) {
  const hash = url.includes("#") ? url.split("#")[1] : "";
  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const expiresAt = params.get("expires_at");
  if (!accessToken || !refreshToken) return null;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Number(expiresAt || Math.floor(Date.now() / 1000) + 3600),
    email: "",
  };
}

async function signInWithCloudAi() {
  return new Promise((resolve, reject) => {
    const apiBase = typeof getApiBase === "function" ? getApiBase() : "";
    const redirectUrl = chrome.identity.getRedirectURL("auth");
    const startUrl = `${apiBase}/auth/extension-start?redirect=${encodeURIComponent(redirectUrl)}`;

    chrome.identity.launchWebAuthFlow({ url: startUrl, interactive: true }, async (callbackUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!callbackUrl) {
        reject(new Error("Sign in was canceled."));
        return;
      }

      const parsed = parseAuthHash(callbackUrl);
      if (!parsed) {
        reject(new Error("Could not read sign-in tokens."));
        return;
      }

      await saveAuthSession(parsed);
      const me = await fetchCloudMe();
      if (me?.email) {
        parsed.email = me.email;
        await saveAuthSession(parsed);
      }
      resolve(parsed);
    });
  });
}

async function signOutCloudAi() {
  await clearAuthSession();
}

async function getValidAccessToken() {
  const session = await refreshAuthSessionIfNeeded();
  return session?.access_token || null;
}
