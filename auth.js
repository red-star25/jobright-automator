// Auth helpers for Cloud AI (InsiderReach JWT + Supabase sign-in).

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
    cloudUsage: null,
    irSession: null,
  });
}

async function clearAuthSession() {
  await storageRemove(["authSession", "cloudUsage", "irSession"]);
}

async function refreshAuthSessionIfNeeded() {
  const session = await getAuthSession();
  if (!session?.refresh_token) return session;

  const expiresAt = Number(session.expires_at || 0);
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt - now > 300) return session;

  const response = await fetch(`${getWebAppBase()}/api/auth/refresh`, {
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

function normalizeCloudMeResponse(json) {
  if (!json || typeof json !== "object") return null;
  return {
    ok: true,
    email: json.email || "",
    plan: json.plan || "free",
    usage: {
      rewrite: json.usage?.rewrite ?? 0,
      pro: json.usage?.rewritePro ?? json.usage?.pro ?? 0,
    },
    limits: {
      rewrite: json.limits?.rewrite ?? 0,
      pro: json.limits?.rewritePro ?? json.limits?.pro ?? 0,
    },
    periodStart: json.periodStart,
  };
}

function isProPlan(plan) {
  return String(plan || "").toLowerCase() === "pro";
}

async function getRawCloudCredential() {
  const session = await refreshAuthSessionIfNeeded();
  return session?.access_token || null;
}

async function exchangeIrSessionIfNeeded() {
  const raw = await getRawCloudCredential();
  if (!raw) return null;

  const data = await storageGet(["irSession"]);
  const now = Math.floor(Date.now() / 1000);
  if (data.irSession?.access_token && Number(data.irSession.expires_at || 0) - now > 300) {
    return data.irSession.access_token;
  }

  try {
    const response = await fetch(`${getApiBase()}/v1/auth/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${raw}` },
    });
    if (!response.ok) return raw;

    const json = await response.json();
    if (!json.access_token) return raw;

    const normalized = normalizeCloudMeResponse(json);
    await storageSet({
      irSession: {
        access_token: json.access_token,
        expires_at: json.expires_at,
        email: json.email || "",
      },
      cloudUsage: normalized || data.cloudUsage || null,
    });
    return json.access_token;
  } catch (_) {
    return raw;
  }
}

async function getCloudAuthToken() {
  return exchangeIrSessionIfNeeded();
}

async function fetchCloudMe() {
  const token = await getCloudAuthToken();
  if (!token) return null;

  const response = await fetch(`${getApiBase()}/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;

  const json = await response.json();
  const normalized = normalizeCloudMeResponse(json);
  if (!normalized) return null;
  await storageSet({ cloudUsage: normalized });
  return normalized;
}

async function openStripeCheckout() {
  const token = await getCloudAuthToken();
  if (!token) throw new Error("Sign in first to upgrade.");

  const response = await fetch(`${getApiBase()}/v1/stripe/checkout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await response.json();
  if (json.url) {
    chrome.tabs.create({ url: json.url });
    return;
  }
  throw new Error(json.error || "Could not start checkout.");
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
    const redirectUrl = chrome.identity.getRedirectURL("auth");
    const startUrl = `${getWebAppBase()}/auth/extension-start?redirect=${encodeURIComponent(redirectUrl)}`;

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
      await exchangeIrSessionIfNeeded();
      const me = await fetchCloudMe();
      if (me?.email) {
        parsed.email = me.email;
        await storageSet({ authSession: parsed });
      }
      resolve(parsed);
    });
  });
}

async function signOutCloudAi() {
  await clearAuthSession();
}

async function getValidAccessToken() {
  return getCloudAuthToken();
}

async function logCloudUsageEvent(payload) {
  const token = await getCloudAuthToken();
  if (!token) return;

  const mode = payload.mode === "pro" || payload.mode === "rewritePro" ? "rewritePro" : "rewrite";
  try {
    await fetch(`${getApiBase()}/v1/usage/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        eventType: payload.eventType,
        mode,
        channel: payload.channel,
        extensionVersion: chrome.runtime.getManifest().version,
        metadata: payload.metadata || {},
      }),
    });
  } catch (_) {
    // Non-blocking telemetry.
  }
}
