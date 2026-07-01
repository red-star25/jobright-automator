// popup.js
const resumeSelect = document.getElementById("resumeSelect");
const startBtn = document.getElementById("startBtn");
const optionsBtn = document.getElementById("optionsBtn");
const dashboardBtn = document.getElementById("dashboardBtn");
const statusBox = document.getElementById("status"); // optional; popup logs are hidden in this build
const statToday = document.getElementById("statToday");
const statTotal = document.getElementById("statTotal");
const statRate = document.getElementById("statRate");
const runModeSelect = document.getElementById("runModeSelect");
const aiModeSelect = document.getElementById("aiModeSelect");
const aiModeHint = document.getElementById("aiModeHint");
const accountStripText = document.getElementById("accountStripText");

function renderAccountStrip() {
  chrome.storage.local.get(["aiProvider", "authSession", "cloudUsage"], async (data) => {
    const provider = data.aiProvider || "local";
    if (provider !== "cloud") {
      accountStripText.textContent = "Using Local AI. Sign in via Manage resumes > Account for Cloud AI.";
      return;
    }

    const session = data.authSession;
    if (!session || !session.access_token) {
      accountStripText.textContent = "Cloud AI selected. Sign in from Manage resumes > Account.";
      return;
    }

    let usage = data.cloudUsage;
    if (typeof fetchCloudMe === "function") {
      const fresh = await fetchCloudMe();
      if (fresh) usage = fresh;
    }

    const email = usage?.email || session.email || "Signed in";
    if (usage?.limits) {
      const rewriteLeft = Math.max(0, usage.limits.rewrite - (usage.usage?.rewrite || 0));
      const proLeft = Math.max(0, usage.limits.pro - (usage.usage?.pro || 0));
      accountStripText.textContent = `${email} · ${rewriteLeft} Rewrite · ${proLeft} Pro left this month (${usage.plan || "free"} plan)`;
    } else {
      accountStripText.textContent = `${email} · Cloud AI active`;
    }
  });
}

function aiModeText(mode) {
  if (mode === "off") return "Skip AI and use Jobright's original text.";
  if (mode === "auto_rewrite") return "Automatically run Rewrite, then show a preview.";
  if (mode === "auto_pro") return "Automatically run Rewrite Pro with job + resume, then show a preview.";
  return "Show Rewrite / Rewrite Pro and let you choose each time.";
}

function loadWorkflowSettings() {
  chrome.storage.local.get(["runMode", "aiMode", "aiRewriteEnabled"], (data) => {
    runModeSelect.value = data.runMode || "both";
    let mode = data.aiMode;
    if (!mode) mode = data.aiRewriteEnabled === false ? "off" : "ask";
    aiModeSelect.value = mode;
    aiModeHint.textContent = aiModeText(mode);
  });
}

runModeSelect.addEventListener("change", () => {
  chrome.storage.local.set({ runMode: runModeSelect.value });
});

aiModeSelect.addEventListener("change", () => {
  const mode = aiModeSelect.value;
  chrome.storage.local.set({ aiMode: mode, aiRewriteEnabled: mode !== "off" }, () => {
    aiModeHint.textContent = aiModeText(mode);
  });
});

function renderOutreachStats() {
  chrome.storage.local.get("outreachLog", (data) => {
    const log = data.outreachLog || [];
    const todayStr = new Date().toDateString();
    const today = log.filter((e) => new Date(e.date).toDateString() === todayStr).length;
    const replied = log.filter((e) => e.status === "replied").length;
    const rate = log.length ? Math.round((replied / log.length) * 100) : 0;
    statToday.textContent = today;
    statTotal.textContent = log.length;
    statRate.textContent = rate + "%";
  });
}

dashboardBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

function loadResumes() {
  chrome.storage.local.get(["resumes", "defaultResumeId"], (data) => {
    const resumes = data.resumes || [];
    resumeSelect.innerHTML = "";
    if (resumes.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No resumes added yet";
      opt.disabled = true;
      resumeSelect.appendChild(opt);
      startBtn.disabled = true;
      return;
    }
    resumes.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.name + (r.id === data.defaultResumeId ? " (default)" : "");
      resumeSelect.appendChild(opt);
    });
    if (data.defaultResumeId) resumeSelect.value = data.defaultResumeId;
    startBtn.disabled = false;
  });
}

function renderStatus() {
  // Status logs are intentionally hidden from the popup UI.
  // They are still stored internally for debugging when needed.
}

startBtn.addEventListener("click", () => {
  const resumeId = resumeSelect.value;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || !tab.url.includes("jobright.ai")) {
      startBtn.textContent = "Open Jobright first";
      setTimeout(() => { startBtn.textContent = "Preview + Start"; }, 1600);
      return;
    }
    chrome.storage.local.set({ statusLog: [], activeResumeId: resumeId, jobrightTabId: tab.id, runMode: runModeSelect.value, aiMode: aiModeSelect.value, aiRewriteEnabled: aiModeSelect.value !== "off" }, () => {
      chrome.tabs.sendMessage(tab.id, { type: "START_RUN", resumeId, runMode: runModeSelect.value, aiMode: aiModeSelect.value }, () => {
        // content script will log its own progress via storage
      });
    });
  });
});

optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loadResumes();
loadWorkflowSettings();
renderOutreachStats();
renderAccountStrip();
setInterval(renderOutreachStats, 2000);
setInterval(renderAccountStrip, 5000);
