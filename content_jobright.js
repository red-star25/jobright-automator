// content_jobright.js
// Runs on jobright.ai job pages. Listens for START_RUN from the popup,
// then walks the Insider Connection list and processes each person.

let cachedJobContextForRun = null;
let cachedJobTitleForRun = "";
let cachedAiResumeTextForRun = "";

function log(text, data) {
  if (data !== undefined) console.log("[InsiderReach]", text, data);
  else console.log("[InsiderReach]", text);
}

// Resolved by the PERSON_EMAIL_DONE message once the Gmail tab for the
// current person detects Send and closes itself. Lets tryEmail pause the
// whole run until that happens instead of firing every email at once.
let waitingForEmailDone = null;
let waitingForLinkedinDone = null;
let waitingForLinkedinRunId = null;
let waitingForLinkedinPollTimer = null;
let linkedinDoneReason = "sent";
let stopRequested = false;
let skipRequested = false;
let retryRequested = false;
let paused = false;
let currentRunMode = "both";
let currentAiMode = "ask";
let runInProgress = false;
let activeRunKey = "";
let resumeWaiters = [];

function resolveBlockingWaits() {
  if (waitingForEmailDone) { waitingForEmailDone(); waitingForEmailDone = null; }
  if (waitingForLinkedinDone) { waitingForLinkedinDone(); waitingForLinkedinDone = null; }
  waitingForLinkedinRunId = null;
  if (waitingForLinkedinPollTimer) { clearInterval(waitingForLinkedinPollTimer); waitingForLinkedinPollTimer = null; }
  resumeWaiters.splice(0).forEach((resolve) => resolve());
}

async function honorRunControls() {
  while (paused && !stopRequested) {
    await new Promise((resolve) => resumeWaiters.push(resolve));
  }
  if (stopRequested) throw new Error("INSIDERREACH_STOP");
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PERSON_EMAIL_DONE" && waitingForEmailDone) {
    waitingForEmailDone();
    waitingForEmailDone = null;
  }
  if (message.type === "PERSON_LINKEDIN_DONE") {
    linkedinDoneReason = message.reason || "sent";
    resolveLinkedinDone(message.runId || null);
  }
  if (message.type === "STOP_RUN") {
    stopRequested = true;
    log("Stop requested. Finishing the current wait and ending the run.");
    resolveBlockingWaits();
  }
  if (message.type === "SKIP_CURRENT") {
    skipRequested = true;
    log("Skip requested for the current person.");
    resolveBlockingWaits();
  }
  if (message.type === "RETRY_CURRENT") {
    retryRequested = true;
    log("Retry requested for the current person.");
    resolveBlockingWaits();
  }
  if (message.type === "RESUME_RUN") {
    paused = false;
    log("Resume requested.");
    resolveBlockingWaits();
  }
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeRunId(prefix = "run") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getCurrentJobRunKey() {
  // Jobright is an SPA. Use the canonical visible job URL as the primary key,
  // not the detected company, because company text can be unavailable while
  // the section is closed or while the page is still rendering. A fluctuating
  // company value made completed pages look "new" and caused reruns to scan
  // the whole Insider Connection list again.
  return `${location.origin}${location.pathname}${location.search}`;
}

async function isJobPageCompleted(runKey) {
  const data = await new Promise((resolve) => {
    chrome.storage.local.get(["completedJobPages"], resolve);
  });
  const completed = data.completedJobPages || {};
  return !!completed[runKey];
}

async function markJobPageCompleted(runKey) {
  const data = await new Promise((resolve) => {
    chrome.storage.local.get(["completedJobPages"], resolve);
  });
  const completed = data.completedJobPages || {};
  completed[runKey] = {
    completedAt: new Date().toISOString(),
    url: location.href,
    company: currentCompany || "",
  };
  await new Promise((resolve) => {
    chrome.storage.local.set({ completedJobPages: completed }, resolve);
  });
}

function resolveLinkedinDone(runId) {
  if (!waitingForLinkedinDone) return;
  if (waitingForLinkedinRunId && runId && waitingForLinkedinRunId !== runId) return;
  const resolve = waitingForLinkedinDone;
  waitingForLinkedinDone = null;
  waitingForLinkedinRunId = null;
  if (waitingForLinkedinPollTimer) {
    clearInterval(waitingForLinkedinPollTimer);
    waitingForLinkedinPollTimer = null;
  }
  resolve();
}

function waitForLinkedinDone(runId) {
  return new Promise((resolve) => {
    waitingForLinkedinDone = resolve;
    waitingForLinkedinRunId = runId;
    if (waitingForLinkedinPollTimer) clearInterval(waitingForLinkedinPollTimer);

    // Backup path: service-worker messages can occasionally be missed if the
    // Jobright tab is inactive. The background worker also writes completion
    // to storage, so polling keeps the main run moving after the LinkedIn tab
    // closes.
    waitingForLinkedinPollTimer = setInterval(() => {
      chrome.storage.local.get(["lastLinkedinDoneRunId", "lastLinkedinDoneAt", "lastLinkedinDoneReason"], (data) => {
        if (!waitingForLinkedinDone) return;
        if (data.lastLinkedinDoneRunId === runId) {
          linkedinDoneReason = data.lastLinkedinDoneReason || "sent";
          resolveLinkedinDone(runId);
        }
      });
    }, 700);
  });
}

// --- InsiderReach AI rewrite panel -----------------------------------------

const AI_TONES = [
  "Professional",
  "Friendly",
  "Concise",
  "Confident",
  "Warm referral ask",
  "Student/new grad",
  "Recruiter-style",
];

function extractJobTitle() {
  if (cachedJobTitleForRun) return cachedJobTitleForRun;
  const h1 = document.querySelector("h1");
  if (h1 && visibleText(h1)) { cachedJobTitleForRun = visibleText(h1); return cachedJobTitleForRun; }
  const titleLike = Array.from(document.querySelectorAll("[class*='job-title'], [class*='position']"))
    .map(visibleText)
    .find((t) => t && t.length > 5 && t.length < 140);
  cachedJobTitleForRun = titleLike || "";
  return cachedJobTitleForRun;
}


function uniqueCleanList(items, max = 12) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const text = String(item || "")
      .replace(/\s+/g, " ")
      .replace(/^[-•]\s*/, "")
      .trim();
    if (!text || text.length < 3) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function findJobrightSectionByTitle(title) {
  const h2s = Array.from(document.querySelectorAll("h2, [title]"));
  const heading = h2s.find((el) => {
    const attr = (el.getAttribute("title") || "").trim().toLowerCase();
    const text = visibleText(el).trim().toLowerCase();
    return attr === title.toLowerCase() || text === title.toLowerCase();
  });
  return heading ? heading.closest("section") : null;
}

function listTextsIn(scope, max = 12) {
  if (!scope) return [];
  return uniqueCleanList(
    Array.from(scope.querySelectorAll("[class*='listText'], [class*='text-row'] span:last-child"))
      .map(visibleText),
    max
  );
}

function extractQualificationGroup(section, groupName) {
  if (!section) return [];
  const h4 = Array.from(section.querySelectorAll("h4")).find(
    (el) => visibleText(el).trim().toLowerCase() === groupName.toLowerCase()
  );
  if (!h4) return [];
  const group = h4.closest("[class*='flex-col']") || h4.parentElement;
  return listTextsIn(group, 10);
}

function extractMatchedSkills(section) {
  if (!section) return [];
  return uniqueCleanList(
    Array.from(section.querySelectorAll("[class*='qualification-tag'], .ant-tag"))
      .map((el) => visibleText(el).replace(/^[^A-Za-z0-9]+/, "")),
    10
  );
}

function extractJobContextForAi() {
  if (cachedJobContextForRun) return cachedJobContextForRun;
  const responsibilitiesSection = findJobrightSectionByTitle("Responsibilities");
  const qualificationSection = document.getElementById("skills-section") || findJobrightSectionByTitle("Qualification");

  const responsibilities = listTextsIn(responsibilitiesSection, 10);
  const requiredQualifications = extractQualificationGroup(qualificationSection, "Required");
  const preferredQualifications = extractQualificationGroup(qualificationSection, "Preferred");
  const matchedSkills = extractMatchedSkills(qualificationSection);

  cachedJobContextForRun = {
    responsibilities,
    requiredQualifications,
    preferredQualifications,
    matchedSkills,
  };
  return cachedJobContextForRun;
}

function setTextareaValue(textarea, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) setter.call(textarea, value);
  else textarea.value = value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function setQuillText(editor, value) {
  if (!editor) return;
  const paragraphs = value.split(/\n{2,}|\n/).map((x) => x.trim()).filter(Boolean);
  editor.innerHTML = paragraphs.map((line) => `<p>${line.replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))}</p>`).join("") || "<p><br></p>";
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
}

function sendAiRequest(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "AI_PERSONALIZE", payload }, (res) => {
      resolve(res || { ok: false, error: chrome.runtime.lastError?.message || "No response from AI service." });
    });
  });
}

async function showAiReviewPanel({ modal, channel, text, subject = "", personName = "", personTitle = "", category = "", onApply }) {
  const settings = await new Promise((resolve) => {
    chrome.storage.local.get(["defaultTone", "aiRewriteEnabled", "aiMode"], resolve);
  });

  const aiMode = currentAiMode || resolveAiMode(settings);
  if (aiMode === "off") {
    log("AI Rewrite is off. Using Jobright's original message.");
    if (onApply) onApply(text || "");
    return text || "";
  }

  const existing = document.querySelector(".insiderreach-ai-panel");
  if (existing) existing.remove();

  let currentText = text || "";

  const panel = document.createElement("div");
  panel.className = "insiderreach-ai-panel";
  panel.style.cssText = [
    "position:fixed",
    "right:24px",
    "top:84px",
    "width:min(430px,calc(100vw - 48px))",
    "max-height:calc(100vh - 120px)",
    "overflow:auto",
    "border:1px solid #bfead7",
    "background:#f7fffb",
    "border-radius:14px",
    "box-shadow:0 16px 50px rgba(0,0,0,.22)",
    "padding:14px",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "font-size:13px",
    "line-height:1.35",
    "color:#1a1a1a",
    "z-index:2147483647",
    "box-sizing:border-box",
  ].join(";");

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px;">
      <div>
        <strong style="font-size:15px;">InsiderReach AI</strong>
        <div style="font-size:11px;color:#667;margin-top:2px;">${channel === "linkedin" ? "LinkedIn note - keep under 200 chars" : "Email rewrite"}</div>
      </div>
      <button class="ir-close" title="Close AI panel and skip this action" style="border:0;background:transparent;font-size:20px;line-height:1;cursor:pointer;padding:2px 6px;color:#555;">×</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
      <select class="ir-tone" style="min-width:0;padding:8px;border:1px solid #ccc;border-radius:8px;background:white;font:inherit;">
        ${AI_TONES.map((t) => `<option${t === (settings.defaultTone || "Professional") ? " selected" : ""}>${t}</option>`).join("")}
      </select>
      <button class="ir-use-original" style="padding:8px 10px;border:1px solid #ccc;border-radius:8px;background:white;cursor:pointer;font:inherit;white-space:nowrap;">Use original</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <button class="ir-rewrite" style="padding:9px 10px;border:1px solid #ccc;border-radius:8px;background:white;cursor:pointer;font:inherit;font-weight:600;">Rewrite</button>
      <button class="ir-pro" style="padding:9px 10px;border:0;border-radius:8px;background:#2fa86f;color:white;cursor:pointer;font:inherit;font-weight:700;">Rewrite Pro</button>
    </div>
    <textarea class="ir-preview" style="width:100%;box-sizing:border-box;height:${channel === "linkedin" ? "110" : "210"}px;max-height:45vh;border:1px solid #ddd;border-radius:10px;padding:10px;font:inherit;resize:vertical;background:white;"></textarea>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-top:8px;">
      <div style="min-width:0;">
        <div class="ir-count" style="font-size:11px;color:#777;"></div>
        <div class="ir-status" style="font-size:11px;color:#555;min-height:15px;margin-top:2px;"></div>
        <div class="ir-proof" style="font-size:11px;color:#0a7a3d;margin-top:4px;display:none;"></div>
      </div>
      <button class="ir-use" style="padding:9px 13px;border:0;border-radius:8px;background:#2fa86f;color:white;cursor:pointer;font:inherit;font-weight:700;white-space:nowrap;flex-shrink:0;">Use this</button>
    </div>
  `;

  document.body.appendChild(panel);

  const toneEl = panel.querySelector(".ir-tone");
  const preview = panel.querySelector(".ir-preview");
  const status = panel.querySelector(".ir-status");
  const proof = panel.querySelector(".ir-proof");
  const count = panel.querySelector(".ir-count");
  preview.value = currentText;

  function updateCount() {
    const len = preview.value.length;
    count.textContent = channel === "linkedin" ? `${len} / 200 characters` : `${len} characters`;
    count.style.color = channel === "linkedin" && len > 200 ? "#d93025" : "#777";
  }
  preview.addEventListener("input", updateCount);
  updateCount();

  let lastAiMode = "rewrite";

  async function runAi(mode) {
    lastAiMode = mode;
    const jobContext = extractJobContextForAi();
    status.textContent = mode === "pro" ? "Personalizing with job + resume..." : "Rewriting...";
    status.style.color = "#555";
    const res = await sendAiRequest({
      mode,
      channel,
      tone: toneEl.value,
      text: preview.value || currentText,
      subject,
      job: {
        personName,
        personTitle,
        company: currentCompany,
        jobTitle: cachedJobTitleForRun || extractJobTitle(),
        category,
        ...jobContext,
      },
      resumeText: mode === "pro" ? cachedAiResumeTextForRun : "",
    });
    if (!res.ok) {
      status.textContent = res.error || "AI rewrite failed.";
      status.style.color = "#d93025";
      return;
    }
    preview.value = res.text || preview.value;
    if (res.proofPoint) {
      proof.style.display = "block";
      proof.textContent = "Used resume point: " + res.proofPoint;
    } else {
      proof.style.display = "none";
      proof.textContent = "";
    }
    currentText = preview.value;
    status.textContent = "Ready. Review/edit, then click Use this.";
    status.style.color = "#0a7a3d";
    updateCount();
  }

  panel.querySelector(".ir-rewrite").addEventListener("click", () => runAi("rewrite"));
  panel.querySelector(".ir-pro").addEventListener("click", () => runAi("pro"));

  if (aiMode === "auto_rewrite") setTimeout(() => runAi("rewrite"), 250);
  if (aiMode === "auto_pro") setTimeout(() => runAi("pro"), 250);

  return new Promise((resolve) => {
    function finish(value, shouldApply = true) {
      panel.remove();
      if (shouldApply && onApply) onApply(value || "");
      resolve(shouldApply ? (value || "") : null);
    }
    // X means cancel/close the AI panel only. It should not continue to Gmail or LinkedIn.
    panel.querySelector(".ir-close").addEventListener("click", () => finish("", false));
    panel.querySelector(".ir-use-original").addEventListener("click", () => finish(text || "", true));
    panel.querySelector(".ir-use").addEventListener("click", () => {
      const selected = preview.value.trim() || text || "";
      chrome.runtime.sendMessage({
        type: "LOG_CLOUD_USAGE_EVENT",
        payload: {
          eventType: "rewrite_accepted",
          mode: lastAiMode === "pro" ? "rewritePro" : "rewrite",
          channel,
        },
      }).catch(() => {});
      finish(selected, true);
    });
  });
}


// --- Outreach log / skip-if-already-contacted -------------------------------

let currentCompany = "";
let contactedSet = new Set();

function normalizeKeyPart(value) {
  return String(value || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeLinkedinProfileUrl(url) {
  if (!url) return "";
  let u = String(url).trim();
  if (!u) return "";
  if (u.startsWith("//")) u = "https:" + u;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u.replace(/^\/+/, "");
  try {
    const parsed = new URL(u);
    if (!parsed.hostname.includes("linkedin.com")) return "";
    if (!/\/in\//i.test(parsed.pathname)) return "";
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}/`;
  } catch (e) {
    return "";
  }
}

function linkedinUrlsCompatible(a, b) {
  const left = normalizeLinkedinProfileUrl(a);
  const right = normalizeLinkedinProfileUrl(b);
  return !!(left && right && left === right);
}

function dedupeKey(channel, identifier, company) {
  return `${channel}::${normalizeKeyPart(identifier)}::${channel === "email" ? "" : normalizeKeyPart(company)}`;
}

function isBadPersonIdentifier(value) {
  const text = normalizeKeyPart(value);
  return !text ||
    text === "unknown" ||
    text === "connection category" ||
    text === "beyond your network" ||
    text === "from your previous company" ||
    text === "from your school" ||
    text === "find more connections" ||
    text === "linkedin" ||
    text === "connect";
}

function contactKeys(channel, { identifier = "", company = currentCompany, name = "", email = "", linkedinUrl = "" } = {}) {
  const keys = new Set();
  if (channel === "email") {
    if (identifier || email) keys.add(dedupeKey("email", identifier || email, ""));
    const addEmailNameKeys = (value) => {
      const cleaned = String(value || "").trim();
      if (!cleaned || isBadPersonIdentifier(cleaned)) return;
      keys.add(dedupeKey("email-name", cleaned, company));
    };
    if (name) addEmailNameKeys(name);
    if (identifier && String(identifier).includes("@")) addEmailNameKeys(name || identifier);
  } else {
    const normalizedUrl = normalizeLinkedinProfileUrl(linkedinUrl || (String(identifier).startsWith("http") ? identifier : ""));
    if (normalizedUrl) keys.add(dedupeKey("linkedin", normalizedUrl, ""));
    if (identifier && String(identifier).startsWith("http")) {
      const normalizedIdentifier = normalizeLinkedinProfileUrl(identifier) || identifier;
      keys.add(dedupeKey("linkedin", normalizedIdentifier, ""));
    }
    const addLinkedinNameKeys = (value) => {
      const cleaned = String(value || "").trim();
      if (!cleaned || isBadPersonIdentifier(cleaned)) return;
      keys.add(dedupeKey("linkedin", cleaned, company));
      // Jobright's note often only gives the first name ("Hi Paapa,") while
      // LinkedIn logs the full name ("Paapa Kusi"). Add a company-scoped
      // first-name key so reruns can skip people already contacted instead
      // of reopening their profile and failing at the missing Connect button.
      const first = cleaned.split(/\s+/)[0];
      if (first && first.length > 1 && !isBadPersonIdentifier(first)) {
        keys.add(dedupeKey("linkedin-first", first, company));
      }
    };
    if (identifier && !String(identifier).startsWith("http")) addLinkedinNameKeys(identifier);
    if (name) addLinkedinNameKeys(name);
  }
  return Array.from(keys);
}

function isAlreadyContacted(channel, identifier, extra = {}) {
  return contactKeys(channel, { identifier, ...extra }).some((key) => contactedSet.has(key));
}

function parseContactKey(key) {
  const parts = String(key || "").split("::");
  if (parts.length < 3) return null;
  return {
    channel: parts[0],
    identifier: parts[1],
    company: parts.slice(2).join("::"),
  };
}

function companiesCompatible(loggedCompany, checkCompany) {
  const logged = normalizeKeyPart(loggedCompany);
  const check = normalizeKeyPart(checkCompany);
  if (!logged || !check) return true;
  return logged === check;
}

function linkedinNamesCompatible(rowName, loggedName) {
  const a = normalizeKeyPart(rowName);
  const b = normalizeKeyPart(loggedName);
  if (!a || !b) return false;
  if (a === b) return true;
  const aFirst = a.split(/\s+/)[0];
  const bFirst = b.split(/\s+/)[0];
  if (aFirst && bFirst && aFirst.length > 1 && aFirst === bFirst) return true;
  if (a.startsWith(`${b} `) || b.startsWith(`${a} `)) return true;
  return false;
}

function isLinkedinPersonAlreadyContacted(name, company = currentCompany, linkedinProfileUrl = "") {
  if (isBadPersonIdentifier(name)) {
    if (!linkedinProfileUrl) return false;
  } else if (isAlreadyContacted("linkedin", name, { name, company })) {
    return true;
  }

  const normalizedProfileUrl = normalizeLinkedinProfileUrl(linkedinProfileUrl);
  if (normalizedProfileUrl && isAlreadyContacted("linkedin", normalizedProfileUrl, { linkedinUrl: normalizedProfileUrl, company })) {
    return true;
  }

  const firstName = isBadPersonIdentifier(name) ? "" : normalizeKeyPart(name).split(/\s+/)[0];
  for (const key of contactedSet) {
    if (!key.startsWith("linkedin")) continue;
    const parsed = parseContactKey(key);
    if (!parsed) continue;
    if (!companiesCompatible(parsed.company, company)) continue;

    const identifier = parsed.identifier;
    if (identifier.startsWith("http")) {
      if (normalizedProfileUrl && linkedinUrlsCompatible(identifier, normalizedProfileUrl)) return true;
      continue;
    }

    if (isBadPersonIdentifier(name)) continue;
    if (parsed.channel === "linkedin-first" && identifier === firstName) return true;
    if (linkedinNamesCompatible(name, identifier)) return true;
  }
  return false;
}

function shouldSkipEmailForPerson(person) {
  if (isBadPersonIdentifier(person.name)) return false;
  return isAlreadyContacted("email", person.name, { name: person.name });
}

function shouldSkipLinkedinForPerson(person) {
  return isLinkedinPersonAlreadyContacted(
    person.name,
    currentCompany,
    person.linkedinProfileUrl || ""
  );
}

function markContactedLocally(channel, identifier, extra = {}) {
  contactKeys(channel, { identifier, ...extra }).forEach((key) => contactedSet.add(key));
}

async function loadContactedSet() {
  const entries = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_OUTREACH_LOG" }, (res) => resolve(res || []));
  });
  contactedSet = new Set(entries.flatMap((e) => contactKeys(e.channel, { identifier: e.identifier, company: e.company, name: e.name, email: e.email, linkedinUrl: e.linkedinUrl })));
}

function extractCompanyName() {
  const heading = findElementByTextMatch(document.body, /Insider Connection\s*@/i);
  if (!heading) return "";
  const match = visibleText(heading).match(/Insider Connection\s*@\s*(.+)/i);
  return match ? match[1].trim() : "";
}

// Waits until `check()` returns a truthy value. Uses MutationObserver so
// it reacts as soon as Jobright/Gmail/LinkedIn renders the next popup, with a
// light polling fallback for non-DOM state changes.
async function waitFor(check, { timeout = 6000, interval = 250, root = document.body } = {}) {
  const immediate = check();
  if (immediate) return immediate;

  return new Promise((resolve) => {
    let done = false;
    let observer = null;
    let pollTimer = null;
    let timeoutTimer = null;

    const finish = (value) => {
      if (done) return;
      done = true;
      if (observer) observer.disconnect();
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve(value || null);
    };

    const test = () => {
      try {
        const result = check();
        if (result) finish(result);
      } catch (err) {
        log("waitFor check failed", err?.message || String(err));
      }
    };

    if (root) {
      observer = new MutationObserver(test);
      observer.observe(root, { childList: true, subtree: true, attributes: true });
    }
    pollTimer = setInterval(test, interval);
    timeoutTimer = setTimeout(() => finish(null), timeout);
  });
}

function visibleText(el) {
  return (el.innerText || el.textContent || "").trim();
}

// Finds a clickable element whose visible text matches exactly (case-insensitive).
function findButtonByText(root, text) {
  const candidates = root.querySelectorAll("button, [role='button'], a");
  for (const el of candidates) {
    if (visibleText(el).toLowerCase() === text.toLowerCase()) return el;
  }
  return null;
}

// Finds any element (not just buttons) whose text contains a pattern.
function findElementByTextMatch(root, regex) {
  const all = root.querySelectorAll("*");
  for (const el of all) {
    const t = visibleText(el);
    if (t && regex.test(t) && el.children.length === 0) return el;
  }
  return null;
}

// --- Locate the Insider Connection section and the people in it -----------

function findInsiderConnectionContainer() {
  const byId = document.getElementById("insider-connection");
  if (byId) return byId;

  // Fallback for if Jobright ever drops that id.
  const heading = findElementByTextMatch(document.body, /Insider Connection/i);
  if (!heading) return null;
  let container = heading;
  for (let i = 0; i < 14 && container.parentElement; i++) {
    container = container.parentElement;
    const t = container.innerText || "";
    if (/Beyond Your Network|From Your/i.test(t)) return container;
  }
  return container;
}

// The three category cards (Beyond your network / previous company / school).
// Each starts collapsed with just a "View" button, the actual person rows
// with email/LinkedIn icons only render after that button is clicked.
function getCategoryCards(container) {
  return Array.from(container.querySelectorAll("[class*='insider-connection-card']"));
}

function getCategoryName(card) {
  const label = card.querySelector("[class*='banner-title-text']") || card.querySelector(".ant-typography") || card;
  return visibleText(label).split("\n")[0].trim() || "Connection category";
}

function logPreviewQueue(items) {
  if (!items.length) {
    log("Preview queue: no people found in the visible Insider Connection categories.");
    return;
  }
  log(`Preview queue: found ${items.length} people.`);
  items.slice(0, 20).forEach((item, idx) => {
    log(`${idx + 1}. ${item.name} - ${item.category}`);
  });
  if (items.length > 20) log(`...and ${items.length - 20} more.`);
}

async function openCategoryPanel(card) {
  const viewBtn = Array.from(card.querySelectorAll("button")).find(
    (b) => visibleText(b).toLowerCase() === "view"
  );
  if (!viewBtn) return false;
  viewBtn.click();
  const appeared = await waitFor(
    () => findElementByTextMatch(document.body, /Find More Connections/i),
    { timeout: 5000 }
  );
  return !!appeared;
}

function closePanels() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

// Returns small, roughly-square icon buttons (the envelope / LinkedIn "in"
// icons), based on size rather than class names, since those vary.
function getIconButtons(container) {
  const buttons = Array.from(container.querySelectorAll("button, [role='button']"));
  return buttons.filter((b) => {
    const r = b.getBoundingClientRect();
    const isSmallSquare = r.width > 0 && r.width < 56 && Math.abs(r.width - r.height) < 8;
    const hasSvgOnly = b.querySelector("svg") && visibleText(b).length < 3;
    return isSmallSquare || hasSvgOnly;
  });
}

// Avatars are the small colored circles showing 1-2 initials next to each
// person's name. This page uses Ant Design, whose avatar initials live in
// a leaf span with the "ant-avatar-string" class, so we check that first
// and fall back to size-based guessing only if that class isn't there.
function isAvatarElement(el) {
  const text = visibleText(el);
  if (!/^[A-Z]{1,2}$/.test(text)) return false;
  if (el.classList && el.classList.contains("ant-avatar-string")) return true;
  if (el.children.length > 0) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 14 || r.width > 70) return false;
  if (Math.abs(r.width - r.height) > 14) return false;
  return true;
}

function findAvatars(container) {
  return Array.from(container.querySelectorAll("*")).filter(isAvatarElement);
}

function extractLinkedinUrlFromRow(rowEl) {
  if (!rowEl || !rowEl.querySelector) return "";
  const link = rowEl.querySelector('a[href*="/in/"], a[href*="linkedin.com/in/"]');
  if (!link) return "";
  return normalizeLinkedinProfileUrl(link.href || link.getAttribute("href") || "");
}

// Groups icon buttons into [emailBtn, linkedinBtn] pairs by starting from
// each avatar and climbing up just far enough to find two icon-sized
// buttons living alongside it.
function getPersonRows(container) {
  const avatars = findAvatars(container);
  const rows = [];
  const seenRows = new Set();

  for (const avatar of avatars) {
    let row = avatar.parentElement;
    let icons = [];
    for (let depth = 0; depth < 6 && row; depth++) {
      icons = getIconButtons(row);
      if (icons.length >= 2) break;
      row = row.parentElement;
    }
    if (!row || icons.length < 2 || seenRows.has(row)) continue;
    seenRows.add(row);

    const nameEl = Array.from(row.querySelectorAll("*")).find((el) => {
      if (el.children.length > 0) return false;
      const t = visibleText(el);
      // Real names: starts capitalized, rest lowercase, this rules out
      // ALL CAPS button labels like "APPLY WITH AUTOFILL".
      return t.length > 2 && /^[A-Z][a-z'.-]+(\s[A-Z][a-z'.-]+){0,3}$/.test(t);
    });

    rows.push({
      name: nameEl ? visibleText(nameEl) : "Unknown",
      emailBtn: icons[0],
      linkedinBtn: icons[1],
      linkedinProfileUrl: extractLinkedinUrlFromRow(row),
    });
  }
  return rows;
}

// --- Email flow -------------------------------------------------------------

function extractEmailModalData(modal) {
  const emailInput = modal.querySelector("#email, input[id='email']");
  const subjectInput = modal.querySelector("#subject, input[id='subject']");
  const bodyEditor = modal.querySelector(".ql-editor");

  if (emailInput) {
    const to = emailInput.value.trim();
    const subject = subjectInput ? subjectInput.value.trim() : "";
    let body = "";
    if (bodyEditor) {
      body = Array.from(bodyEditor.querySelectorAll("p"))
        .map((p) => visibleText(p))
        .join("\n")
        .trim();
    }
    return { to: to || null, subject, body };
  }

  // Fallback for if Jobright changes this modal's structure: parse the
  // rendered text the same rough way as before.
  const text = visibleText(modal);
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const to = emailMatch ? emailMatch[0] : null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const emailLineIdx = lines.findIndex((l) => to && l.includes(to));
  let subject = null;
  const bodyLines = [];
  let i = emailLineIdx + 1;
  while (i < lines.length && lines[i] === "Copy") i++;
  if (i < lines.length) {
    subject = lines[i];
    i++;
  }
  while (i < lines.length && lines[i] !== "Start Email") {
    if (lines[i] !== "Copy" && lines[i] !== "Cancel") bodyLines.push(lines[i]);
    i++;
  }
  return { to, subject, body: bodyLines.join("\n\n") };
}

async function tryEmail(person, resumeId) {
  await honorRunControls();

  if (shouldSkipEmailForPerson(person)) {
    log(`${person.name}: already emailed before, skipping.`);
    return { linkedinHandled: false };
  }

  if (currentRunMode !== "email_only" && shouldSkipLinkedinForPerson(person)) {
    log(`${person.name}: already contacted on LinkedIn before, skipping email lookup.`);
    return { linkedinHandled: true };
  }

  person.emailBtn.click();
  await sleep(2000);

  const connectBtn = document.querySelector("[class*='finish-card-button']");
  const card = connectBtn && connectBtn.parentElement ? connectBtn.parentElement.closest("[class*='finish-card']") : null;
  if (!connectBtn) {
    log(`${person.name}: no email response detected, skipping.`);
    closeAnyModal();
    return { linkedinHandled: false };
  }

  const nameEl = card ? card.querySelector("[class*='finish-card-name']") : null;
  const realName = nameEl ? visibleText(nameEl) : person.name;
  const btnText = visibleText(connectBtn).toLowerCase();

  if (btnText.includes("linkedin")) {
    // "Contact Info Not Found!" card, its button skips straight to the
    // LinkedIn connect modal instead of an email one.
    if (shouldSkipLinkedinForPerson({ name: realName })) {
      log(`${realName}: already contacted on LinkedIn before, skipping.`);
      closeAnyModal();
      return { linkedinHandled: true };
    }
    if (currentRunMode === "email_only") {
      log(`${realName}: no email found. Email-only mode is on, so LinkedIn was skipped.`);
      closeAnyModal();
      return { linkedinHandled: true };
    }
    log(`${realName}: no email found, connecting on LinkedIn instead.`);
    connectBtn.click();
    await sleep(1000);
    await handleLinkedinModalAfterOpen(realName);
    return { linkedinHandled: true };
  }

  connectBtn.click();
  await sleep(1000);

  const modal = await waitFor(() => {
    const direct = document.querySelector(".ant-modal-content");
    return direct && /Start Email/i.test(visibleText(direct)) ? direct : null;
  }, { timeout: 5000 });

  if (!modal) {
    log(`${realName}: email modal did not open, skipping.`);
    closeAnyModal();
    return { linkedinHandled: false };
  }

  const { to, subject, body } = extractEmailModalData(modal);
  if (!to) {
    log(`${realName}: could not read email address from modal, skipping.`);
    closeAnyModal();
    return { linkedinHandled: false };
  }

  if (isAlreadyContacted("email", to)) {
    log(`${realName}: already emailed (${to}) before, skipping.`);
    closeAnyModal();
    return { linkedinHandled: false };
  }

  log(`${realName}: email draft ready.`);
  const bodyEditor = modal.querySelector(".ql-editor");
  const finalBody = await showAiReviewPanel({
    modal,
    channel: "email",
    text: body || "",
    subject: subject || "",
    personName: realName,
    onApply: (value) => setQuillText(bodyEditor, value),
  });

  if (finalBody === null) {
    log(`${realName}: AI panel closed. Email action cancelled for this person.`);
    closeAnyModal();
    return { linkedinHandled: false };
  }

  markContactedLocally("email", to, { name: realName });
  await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "OPEN_GMAIL_COMPOSE", payload: { to, subject: subject || "", body: finalBody || body || "", resumeId, personName: realName, company: currentCompany } },
      resolve
    );
  });
  log(`${realName}: Gmail opened with the resume attached. Waiting for you to hit Send.`);
  closeAnyModal();

  // Pause the whole run here. The Gmail tab will message back once it sees
  // Send happen and closes itself, that's what lets us move on.
  await new Promise((resolve) => {
    waitingForEmailDone = resolve;
  });
  await honorRunControls();
  return { linkedinHandled: false };
}

// --- LinkedIn flow -----------------------------------------------------------

function extractLinkedinModalData(modal) {
  const textarea = modal.querySelector("textarea");
  const message = textarea ? textarea.value.trim() : "";
  const viewBtn = Array.from(modal.querySelectorAll("button")).find((b) =>
    visibleText(b).toLowerCase().includes("view linkedin profile")
  );
  let profileUrl = "";
  const linkCandidates = [
    modal.querySelector('a[href*="/in/"]'),
    modal.querySelector('a[href*="linkedin.com"]'),
    viewBtn && viewBtn.closest('a[href*="linkedin"]'),
  ].filter(Boolean);
  for (const link of linkCandidates) {
    profileUrl = normalizeLinkedinProfileUrl(link.href || link.getAttribute("href") || "");
    if (profileUrl) break;
  }
  return { message, viewBtn, profileUrl };
}

function inferNameFromLinkedinMessage(message, fallback = "") {
  const text = String(message || "").trim();
  const match = text.match(/^\s*Hi\s+([^,\n.!]+)[,\n.!]/i) || text.match(/^\s*Hello\s+([^,\n.!]+)[,\n.!]/i);
  const name = match ? match[1].replace(/\s+/g, " ").trim() : "";
  if (name && !isBadPersonIdentifier(name) && /^[A-Za-z][A-Za-z .'-]{1,80}$/.test(name)) return name;
  return isBadPersonIdentifier(fallback) ? "Unknown" : fallback;
}

function safeLinkedinNameForLog(personName, message = "") {
  return inferNameFromLinkedinMessage(message, personName);
}

async function tryLinkedin(person) {
  await honorRunControls();

  if (shouldSkipLinkedinForPerson(person)) {
    log(`${person.name}: already contacted on LinkedIn before, skipping.`);
    return;
  }

  person.linkedinBtn.click();
  await sleep(900);
  await handleLinkedinModalAfterOpen(person.name);
}

// Shared by both entry points: clicking the "in" icon directly, and the
// "Connect On LinkedIn" button on the "Contact Info Not Found!" card.
// Reads the message, opens the profile, then pauses the whole run until
// that tab signals you've hit Send (it closes itself once it sees that).
async function handleLinkedinModalAfterOpen(personName) {
  const modal = await waitFor(() => {
    const ta = document.querySelector(".ant-modal-content textarea");
    return ta ? ta.closest(".ant-modal-content") : null;
  }, { timeout: 5000 });

  if (!modal) {
    log(`${personName}: LinkedIn connect modal did not open, skipping.`);
    closeAnyModal();
    return;
  }

  const { message, viewBtn, profileUrl } = extractLinkedinModalData(modal);
  if (!message) {
    log(`${personName}: could not read the LinkedIn message, skipping.`);
    closeAnyModal();
    return;
  }

  const realPersonName = safeLinkedinNameForLog(personName, message);

  if (isLinkedinPersonAlreadyContacted(realPersonName, currentCompany, profileUrl)) {
    log(`${realPersonName}: already contacted on LinkedIn before, skipping.`);
    closeAnyModal();
    return;
  }

  if (!viewBtn && !profileUrl) {
    log(`${realPersonName}: could not find the View LinkedIn Profile button, skipping.`);
    closeAnyModal();
    return;
  }

  const textarea = modal.querySelector("textarea");
  log(`${realPersonName}: LinkedIn note ready.`);

  const linkedinRunId = makeRunId("linkedin");
  const usePreload = !!profileUrl;
  let linkedinTabId = null;

  await new Promise((resolve) => {
    chrome.storage.local.set({
      pendingLinkedinJob: {
        note: message,
        personName: realPersonName,
        company: currentCompany,
        runId: linkedinRunId,
        profileUrl,
        automationReady: !usePreload,
      },
      pendingLinkedinClaimedTabId: null,
      lastLinkedinDoneRunId: null,
      lastLinkedinDoneAt: null,
      lastLinkedinDoneReason: null,
    }, resolve);
  });

  if (usePreload) {
    const openRes = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: "OPEN_LINKEDIN_PROFILE",
        payload: {
          profileUrl,
          note: message,
          personName: realPersonName,
          company: currentCompany,
          runId: linkedinRunId,
          automationReady: false,
        },
      }, resolve);
    });
    linkedinTabId = openRes && openRes.tabId ? openRes.tabId : null;
    if (linkedinTabId) {
      log(`${realPersonName}: pre-loading LinkedIn profile while you review the note.`);
    }
  }

  const finalMessage = await showAiReviewPanel({
    modal,
    channel: "linkedin",
    text: message,
    personName: realPersonName,
    onApply: (value) => textarea && setTextareaValue(textarea, value),
  });

  if (finalMessage === null) {
    log(`${realPersonName}: AI panel closed. LinkedIn action cancelled for this person.`);
    if (linkedinTabId) chrome.tabs.remove(linkedinTabId);
    chrome.storage.local.remove(["pendingLinkedinJob", "pendingLinkedinClaimedTabId"], () => {});
    closeAnyModal();
    return;
  }

  // Start waiting before opening/activating LinkedIn so a very fast completion
  // cannot race past this Jobright content script.
  const donePromise = waitForLinkedinDone(linkedinRunId);
  linkedinDoneReason = "sent";

  await new Promise((resolve) => {
    chrome.storage.local.set({
      pendingLinkedinJob: {
        note: finalMessage || message,
        personName: realPersonName,
        company: currentCompany,
        runId: linkedinRunId,
        profileUrl,
        automationReady: true,
      },
    }, resolve);
  });

  if (usePreload && linkedinTabId) {
    await sleep(800);
    log(`${realPersonName}: LinkedIn profile ready. Waiting for you to hit Send.`);
    chrome.tabs.update(linkedinTabId, { active: true });
    closeAnyModal();
  } else {
    log(`${realPersonName}: opening LinkedIn profile now. Waiting for you to hit Send.`);
    if (viewBtn) viewBtn.click();
    closeAnyModal();
  }

  await donePromise;

  if (linkedinDoneReason && linkedinDoneReason !== "sent") {
    if (linkedinDoneReason === "already-handled") {
      markContactedLocally("linkedin", realPersonName, {
        name: realPersonName,
        linkedinUrl: profileUrl || "",
      });
    }
    log(`${realPersonName}: LinkedIn step skipped (${linkedinDoneReason}). Moving to the next person.`);
    await honorRunControls();
    return;
  }

  // Mark only after the LinkedIn step finishes. Do not mark placeholder names
  // like Unknown before opening LinkedIn, otherwise every later Unknown row is
  // treated as a duplicate and skipped.
  markContactedLocally("linkedin", realPersonName, {
    name: realPersonName,
    linkedinUrl: profileUrl || "",
  });
  log(`${realPersonName}: LinkedIn step finished. Moving to the next person.`);
  await honorRunControls();
}

function closeAnyModal() {
  // Close the floating "Contact Info Found!" card if it's still open.
  const finishClose = document.querySelector("[class*='finish-card-close']");
  if (finishClose) finishClose.click();

  // Only look inside something that looks like an actual open dialog/overlay,
  // never the whole page, so we can't accidentally hit a page-level button
  // like the job panel's own close "X".
  const dialog = document.querySelector(".ant-modal-content") ||
    document.querySelector("[role='dialog']") ||
    Array.from(document.querySelectorAll("div")).find((d) => {
      const style = window.getComputedStyle(d);
      return (style.position === "fixed") && d.getBoundingClientRect().width > 200 && /Cancel|Start Email|View Linkedin Profile|View LinkedIn Profile/i.test(d.innerText || "");
    });
  if (!dialog) return;
  const closeBtn = findButtonByText(dialog, "Cancel") || dialog.querySelector("[aria-label='Close'], [aria-label='close']");
  if (closeBtn) closeBtn.click();
}

// --- Main run ----------------------------------------------------------------

async function runAutomation(resumeId, options = {}) {
  if (runInProgress) {
    log("A run is already in progress on this Jobright tab. Ignoring the duplicate Start request.");
    return;
  }

  stopRequested = false; skipRequested = false; retryRequested = false; paused = false;
  currentRunMode = options.runMode || currentRunMode || "both";
  currentAiMode = options.aiMode || currentAiMode || "ask";
  currentCompany = extractCompanyName();
  cachedJobContextForRun = null;
  cachedJobTitleForRun = "";
  cachedAiResumeTextForRun = "";
  const runSettings = await new Promise((resolve) => {
    chrome.storage.local.get(["aiResumeText", "resumes", "activeResumeId"], resolve);
  });
  cachedAiResumeTextForRun = String(runSettings.aiResumeText || "");
  if (!cachedAiResumeTextForRun && runSettings.activeResumeId && Array.isArray(runSettings.resumes)) {
    const selectedResume = runSettings.resumes.find((r) => r.id === runSettings.activeResumeId);
    cachedAiResumeTextForRun = selectedResume && selectedResume.text ? String(selectedResume.text) : "";
  }
  cachedJobTitleForRun = extractJobTitle();
  cachedJobContextForRun = extractJobContextForAi();
  activeRunKey = getCurrentJobRunKey();

  const completedKey = sessionStorage.getItem("insiderreachCompletedRunKey") || "";
  const completedInThisTab = completedKey && completedKey === activeRunKey;
  const completedPersisted = await isJobPageCompleted(activeRunKey);
  if ((completedInThisTab || completedPersisted) && !options.forceRestart) {
    log("This job page was already completed. Stopping now instead of checking everyone again.");
    return;
  }

  runInProgress = true;
  log(`Starting run on this job page. Mode: ${currentRunMode.replace("_", " ")}; AI: ${currentAiMode}.`);
  await loadContactedSet();
  if (currentCompany) log(`Detected company: ${currentCompany}`);
  log("Cached run context", {
    jobTitle: cachedJobTitleForRun,
    resumeChars: cachedAiResumeTextForRun.length,
    responsibilities: cachedJobContextForRun.responsibilities.length,
    required: cachedJobContextForRun.requiredQualifications.length,
    preferred: cachedJobContextForRun.preferredQualifications.length,
    matchedSkills: cachedJobContextForRun.matchedSkills.length,
  });

  const container = findInsiderConnectionContainer();
  if (!container) {
    log("Could not find the Insider Connection section on this page. Scroll to it and try again.");
    runInProgress = false;
    return;
  }

  const cards = getCategoryCards(container);
  if (!cards.length) {
    log("No connection categories found in this section.");
    runInProgress = false;
    return;
  }
  log(`Found ${cards.length} connection categories.`);

  const previewItems = [];
  for (const card of cards) {
    const opened = await openCategoryPanel(card);
    if (!opened) continue;
    await sleep(350);
    const category = getCategoryName(card);
    getPersonRows(document.body).forEach((person) => previewItems.push({ name: person.name, category }));
    closePanels();
    await sleep(250);
  }
  logPreviewQueue(previewItems);

  let totalFound = 0;

  for (const card of cards) {
    const opened = await openCategoryPanel(card);
    if (!opened) {
      log("A category panel did not open after clicking View, skipping it.");
      continue;
    }
    await sleep(500);
    await honorRunControls();
    const categoryName = getCategoryName(card);

    const count = getPersonRows(document.body).length;
    totalFound += count;
    log(`Found ${count} people in ${categoryName}.`);

    for (let idx = 0; idx < count; idx++) {
      await honorRunControls();
      skipRequested = false;
      retryRequested = false;
      const beforeEmail = getPersonRows(document.body)[idx];
      if (!beforeEmail) {
        log(`Could not re-locate person #${idx + 1} after a page update, skipping.`);
        continue;
      }

      if (currentRunMode === "linkedin_only" && shouldSkipLinkedinForPerson(beforeEmail)) {
        log(`${beforeEmail.name}: already contacted on LinkedIn before, skipping.`);
        continue;
      }

      let emailResult = { linkedinHandled: false };
      if (currentRunMode !== "linkedin_only") {
        if (shouldSkipEmailForPerson(beforeEmail) && shouldSkipLinkedinForPerson(beforeEmail)) {
          log(`${beforeEmail.name}: already contacted on email and LinkedIn before, skipping.`);
          emailResult = { linkedinHandled: true };
        } else if (shouldSkipEmailForPerson(beforeEmail)) {
          log(`${beforeEmail.name}: already emailed before, skipping email.`);
          emailResult = { linkedinHandled: false };
        } else {
          log(`Working on ${beforeEmail.name} (email)...`);
          emailResult = await tryEmail(beforeEmail, resumeId);
        }
        await sleep(800);
      } else {
        log(`LinkedIn-only mode: skipping email for ${beforeEmail.name}.`);
      }

      if (skipRequested) {
        log(`${beforeEmail.name}: skipped by user.`);
        continue;
      }
      if (retryRequested) {
        log(`${beforeEmail.name}: retrying from the beginning.`);
        idx--;
        continue;
      }

      if (currentRunMode !== "email_only" && (!emailResult || !emailResult.linkedinHandled)) {
        const beforeLinkedin = getPersonRows(document.body)[idx] || beforeEmail;
        if (shouldSkipLinkedinForPerson(beforeLinkedin)) {
          log(`${beforeLinkedin.name}: already contacted on LinkedIn before, skipping.`);
        } else {
          log(`Working on ${beforeLinkedin.name} (LinkedIn)...`);
          await tryLinkedin(beforeLinkedin);
        }
        await sleep(800);
      } else if (currentRunMode === "email_only") {
        log(`Email-only mode: skipping LinkedIn for ${beforeEmail.name}.`);
      }

      if (skipRequested) {
        log(`${beforeEmail.name}: skipped by user.`);
        continue;
      }
      if (retryRequested) {
        log(`${beforeEmail.name}: retrying from the beginning.`);
        idx--;
        continue;
      }
    }

    closePanels();
    await sleep(500);
  }

  sessionStorage.setItem("insiderreachCompletedRunKey", activeRunKey);
  await markJobPageCompleted(activeRunKey);
  chrome.storage.local.remove(["pendingLinkedinJob", "pendingLinkedinClaimedTabId", "pendingGmailJob"], () => {});
  resolveBlockingWaits();
  runInProgress = false;
  log(`Done with this page. Processed ${totalFound} people total. Stopping now.`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_RUN") {
    runAutomation(message.resumeId, { runMode: message.runMode, aiMode: message.aiMode }).catch((err) => { runInProgress = false; if (err && err.message === "INSIDERREACH_STOP") log("Run stopped."); else log("Run error: " + (err && err.message ? err.message : err)); });
    sendResponse({ started: true });
  }
});
