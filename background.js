// Message hub between Jobright, Gmail, and LinkedIn tabs.
// Tracks outreach history for stats and duplicate detection.

importScripts("config.js", "auth.js");

// --- AI cache & cloud rewrite ------------------------------------------------

function cleanAiText(text) {
  return String(text || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function simpleHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildAiCacheKey({ mode, channel, tone, originalText, job, resumeText, customInstructions, userName }) {
  const normalized = {
    mode,
    channel,
    tone,
    originalText: cleanAiText(originalText),
    personName: cleanAiText(job.personName || ""),
    company: cleanAiText(job.company || ""),
    jobTitle: cleanAiText(job.jobTitle || ""),
    category: cleanAiText(job.category || ""),
    responsibilities: job.responsibilities || [],
    requiredQualifications: job.requiredQualifications || [],
    preferredQualifications: job.preferredQualifications || [],
    matchedSkills: job.matchedSkills || [],
    resumeHash: mode === "pro" ? simpleHash(cleanAiText(resumeText || "")) : "",
    customInstructions: cleanAiText(customInstructions || ""),
    userName: cleanAiText(userName || ""),
  };
  return "ai::" + simpleHash(JSON.stringify(normalized));
}

function getCachedAiResponse(cacheKey) {
  return new Promise((resolve) => {
    chrome.storage.local.get("aiResponseCache", (data) => {
      const cache = data.aiResponseCache || {};
      const hit = cache[cacheKey];
      if (hit && Date.now() - (hit.createdAt || 0) < 1000 * 60 * 60 * 24 * 14) {
        resolve(hit.response || null);
      } else {
        resolve(null);
      }
    });
  });
}

function setCachedAiResponse(cacheKey, response) {
  chrome.storage.local.get("aiResponseCache", (data) => {
    const cache = data.aiResponseCache || {};
    cache[cacheKey] = { createdAt: Date.now(), response };
    const entries = Object.entries(cache)
      .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
      .slice(0, 250);
    chrome.storage.local.set({ aiResponseCache: Object.fromEntries(entries) });
  });
}

function mapExtensionModeToCloudMode(mode) {
  return mode === "pro" ? "rewritePro" : "rewrite";
}

function buildCloudJobContext(job) {
  const ctx = {
    responsibilities: job.responsibilities || [],
    required: job.requiredQualifications || [],
    preferred: job.preferredQualifications || [],
    matchedSkills: job.matchedSkills || [],
  };
  const hasContext = Object.values(ctx).some((items) => Array.isArray(items) && items.length > 0);
  return hasContext ? ctx : undefined;
}

async function callCloudAiPersonalize(payload, settings) {
  const token = await getValidAccessToken();
  if (!token) {
    return {
      ok: false,
      error: "Sign in from Settings to use AI rewrites.",
      code: "UNAUTHORIZED",
    };
  }

  const channel = payload.channel || "email";
  const cloudMode = mapExtensionModeToCloudMode(payload.mode || "rewrite");
  const job = payload.job || {};
  const customInstructions = cleanAiText(settings.aiCustomInstructions || payload.customInstructions || "");
  const resumeText = cloudMode === "rewritePro"
    ? cleanAiText(payload.resumeText || settings.aiResumeText || "")
    : "";

  const body = {
    mode: cloudMode,
    channel,
    tone: payload.tone || settings.defaultTone || "Professional",
    originalMessage: payload.text || "",
    personName: job.personName || undefined,
    personTitle: job.personTitle || undefined,
    company: job.company || undefined,
    jobTitle: job.jobTitle || undefined,
    jobContext: buildCloudJobContext(job),
    resumeText: resumeText || undefined,
    customInstructions: customInstructions || undefined,
    maxChars: channel === "linkedin" ? 200 : undefined,
    extensionVersion: chrome.runtime.getManifest().version,
  };
  if (payload.subject) body.subject = payload.subject;

  logCloudUsageEvent({
    eventType: "rewrite_requested",
    mode: cloudMode,
    channel,
    metadata: { cached: false },
  });

  const response = await fetch(`${getApiBase()}/v1/rewrite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  let json = null;
  try {
    json = await response.json();
  } catch (_) {
    json = null;
  }

  if (!response.ok) {
    const error = json?.error || `Cloud AI request failed with status ${response.status}.`;
    const code = json?.code || (response.status === 401 ? "UNAUTHORIZED" : undefined);
    if (code === "UNAUTHORIZED") await clearAuthSession();
    return { ok: false, error, code, usage: json?.usage, limits: json?.limits };
  }

  if (!json?.text) {
    return { ok: false, error: "Cloud AI returned an empty response." };
  }

  fetchCloudMe().catch(() => {});
  return { ok: true, text: json.text, proofPoint: json.proofPoint || "", subject: json.subject };
}

async function handleAiPersonalize(message, sendResponse) {
  const data = await storageGet([
    "defaultTone",
    "userName",
    "aiResumeText",
    "aiCustomInstructions",
  ]);

  try {
    const payload = message.payload || {};
    const tone = payload.tone || data.defaultTone || "Professional";
    const channel = payload.channel || "email";
    const mode = payload.mode || "rewrite";
    const job = payload.job || {};
    const resumeText = mode === "pro" ? cleanAiText(payload.resumeText || data.aiResumeText || "") : "";
    const cacheKey = buildAiCacheKey({
      mode,
      channel,
      tone,
      originalText: payload.text || "",
      job,
      resumeText,
      customInstructions: cleanAiText(data.aiCustomInstructions || payload.customInstructions || ""),
      userName: data.userName || payload.userName || "",
    });

    const cached = await getCachedAiResponse(cacheKey);
    if (cached) {
      sendResponse({ ...cached, cached: true });
      return;
    }

    const result = await callCloudAiPersonalize(payload, data);
    if (!result.ok) {
      if (result.code === "LIMIT_EXCEEDED") {
        result.error = "Monthly limit reached. Upgrade to Pro in Settings.";
      } else if (result.code === "UNAUTHORIZED") {
        result.error = "Sign in from Settings to use AI rewrites.";
      }
      sendResponse(result);
      return;
    }

    const response = { ok: true, text: result.text, proofPoint: result.proofPoint };
    setCachedAiResponse(cacheKey, response);
    sendResponse(response);
  } catch (err) {
    sendResponse({ ok: false, error: err.message || String(err) });
  }
}

// --- Outreach log ------------------------------------------------------------

function normalizeKeyPart(value) {
  return String(value || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function outreachEntryKeys(entry) {
  const keys = [];
  if (!entry?.channel) return keys;

  if (entry.channel === "email") {
    const email = normalizeKeyPart(entry.email || entry.identifier);
    if (email) keys.push(`email::${email}`);
    const name = normalizeKeyPart(entry.name);
    const company = normalizeKeyPart(entry.company);
    if (name) keys.push(`email-name::${name}::${company}`);
  } else if (entry.channel === "linkedin") {
    const url = normalizeKeyPart(
      entry.linkedinUrl || (String(entry.identifier || "").startsWith("http") ? entry.identifier : "")
    );
    const name = normalizeKeyPart(entry.name || entry.identifier);
    const company = normalizeKeyPart(entry.company);
    const nameCompany = `${name}::${company}`;
    if (url) keys.push(`linkedin-url::${url}`);
    if (nameCompany !== "::") keys.push(`linkedin-name::${nameCompany}`);
    const first = name.split(/\s+/)[0];
    if (first && company) keys.push(`linkedin-first::${first}::${company}`);
  }
  return keys;
}

function addOutreachEntry(entry) {
  chrome.storage.local.get(["outreachLog", "outreachIndex"], (data) => {
    const log = data.outreachLog || [];
    const index = data.outreachIndex || {};
    const newKeys = outreachEntryKeys(entry);
    const alreadyLogged = newKeys.some((key) => index[key]) ||
      log.some((existing) => outreachEntryKeys(existing).some((key) => newKeys.includes(key)));
    if (alreadyLogged) return;

    const nextEntry = {
      id: Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      date: Date.now(),
      status: "sent",
      ...entry,
    };
    log.push(nextEntry);
    newKeys.forEach((key) => { index[key] = nextEntry.id; });
    chrome.storage.local.set({ outreachLog: log.slice(-3000), outreachIndex: index });
  });
}

function handleGmailSendDetected(sender) {
  chrome.storage.local.get(["jobrightTabId", "pendingGmailJob"], (data) => {
    const job = data.pendingGmailJob;
    if (job) {
      addOutreachEntry({
        name: job.personName,
        company: job.company || "",
        channel: "email",
        identifier: job.to,
        email: job.to,
      });
    }
    if (data.jobrightTabId) {
      chrome.tabs.sendMessage(data.jobrightTabId, { type: "PERSON_EMAIL_DONE" }).catch(() => {});
    }
    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
  });
}

function handleLinkedinSendDetected(sender) {
  chrome.storage.local.get(["jobrightTabId", "pendingLinkedinJob", "pendingLinkedinClaimedTabId"], (data) => {
    const job = data.pendingLinkedinJob;
    const senderTabId = sender.tab?.id;

    if (data.pendingLinkedinClaimedTabId && senderTabId && data.pendingLinkedinClaimedTabId !== senderTabId) {
      return;
    }

    if (job) {
      addOutreachEntry({
        name: job.personName,
        company: job.company || "",
        channel: "linkedin",
        identifier: job.profileUrl || job.personName,
        linkedinUrl: job.profileUrl || "",
      });
    }

    const doneRunId = job?.runId || null;
    chrome.storage.local.set({
      lastLinkedinDoneRunId: doneRunId,
      lastLinkedinDoneAt: Date.now(),
    }, () => {
      chrome.storage.local.remove(["pendingLinkedinJob", "pendingLinkedinClaimedTabId"], () => {
        if (data.jobrightTabId) {
          chrome.tabs.sendMessage(data.jobrightTabId, {
            type: "PERSON_LINKEDIN_DONE",
            runId: doneRunId,
          }).catch(() => {});
        }
        if (senderTabId) setTimeout(() => chrome.tabs.remove(senderTabId), 300);
      });
    });
  });
}

function handleGetPendingLinkedinJob(sender, sendResponse) {
  chrome.storage.local.get(["pendingLinkedinJob", "pendingLinkedinClaimedTabId"], (data) => {
    const job = data.pendingLinkedinJob || null;
    const tabId = sender.tab?.id;
    if (!job || !tabId) {
      sendResponse(null);
      return;
    }

    if (data.pendingLinkedinClaimedTabId && data.pendingLinkedinClaimedTabId !== tabId) {
      sendResponse(null);
      return;
    }

    const claimedJob = {
      ...job,
      profileUrl: job.profileUrl || sender.tab?.url || "",
    };
    chrome.storage.local.set({
      pendingLinkedinJob: claimedJob,
      pendingLinkedinClaimedTabId: tabId,
    }, () => sendResponse(claimedJob));
  });
}

// --- Message router ----------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "OPEN_GMAIL_COMPOSE": {
      chrome.storage.local.set({ pendingGmailJob: message.payload }, () => {
        const payload = message.payload;
        const url =
          "https://mail.google.com/mail/?view=cm&fs=1&tf=1" +
          "&to=" + encodeURIComponent(payload.to) +
          "&su=" + encodeURIComponent(payload.subject) +
          "&body=" + encodeURIComponent(payload.body);
        chrome.tabs.create({ url, active: true }, (tab) => {
          sendResponse({ ok: true, tabId: tab.id });
        });
      });
      return true;
    }

    case "GMAIL_SEND_DETECTED":
      handleGmailSendDetected(sender);
      return false;

    case "LINKEDIN_SEND_DETECTED":
      handleLinkedinSendDetected(sender);
      return false;

    case "LOG_CLOUD_USAGE_EVENT":
      logCloudUsageEvent(message.payload || {}).then(() => sendResponse({ ok: true }));
      return true;

    case "AI_PERSONALIZE":
      handleAiPersonalize(message, sendResponse);
      return true;

    case "GET_OUTREACH_LOG":
      chrome.storage.local.get("outreachLog", (data) => {
        sendResponse(data.outreachLog || []);
      });
      return true;

    case "OPEN_LINKEDIN_PROFILE":
      chrome.storage.local.set({
        pendingLinkedinJob: message.payload,
        pendingLinkedinClaimedTabId: null,
      }, () => {
        chrome.tabs.create({ url: message.payload.profileUrl, active: false }, (tab) => {
          sendResponse({ ok: true, tabId: tab?.id || null });
        });
      });
      return true;

    case "GET_PENDING_GMAIL_JOB":
      chrome.storage.local.get("pendingGmailJob", (data) => {
        sendResponse(data.pendingGmailJob || null);
      });
      return true;

    case "GET_PENDING_LINKEDIN_JOB":
      handleGetPendingLinkedinJob(sender, sendResponse);
      return true;

    default:
      return false;
  }
});
