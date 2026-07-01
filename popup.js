// popup.js
const resumeSelect = document.getElementById("resumeSelect");
const startBtn = document.getElementById("startBtn");
const optionsBtn = document.getElementById("optionsBtn");
const dashboardBtn = document.getElementById("dashboardBtn");
const statusBox = document.getElementById("status");
const statToday = document.getElementById("statToday");
const statTotal = document.getElementById("statTotal");
const statRate = document.getElementById("statRate");
const runModeSelect = document.getElementById("runModeSelect");
const aiModeSelect = document.getElementById("aiModeSelect");
const aiModeHint = document.getElementById("aiModeHint");



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
  chrome.storage.local.get("statusLog", (data) => {
    const log = data.statusLog || [];
    statusBox.textContent = log.length
      ? log.map((l) => l.text).join("\n")
      : "Idle.";
    statusBox.scrollTop = statusBox.scrollHeight;
  });
}

startBtn.addEventListener("click", () => {
  const resumeId = resumeSelect.value;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || !tab.url.includes("jobright.ai")) {
      statusBox.textContent = "Open a Jobright job page first, then click Start.";
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
renderStatus();
renderOutreachStats();
setInterval(renderStatus, 1000);
setInterval(renderOutreachStats, 2000);
