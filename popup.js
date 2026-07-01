// popup.js
const resumeSelect = document.getElementById("resumeSelect");
const startBtn = document.getElementById("startBtn");
const optionsBtn = document.getElementById("optionsBtn");
const dashboardBtn = document.getElementById("dashboardBtn");
const statToday = document.getElementById("statToday");
const statTotal = document.getElementById("statTotal");
const statRate = document.getElementById("statRate");
const runModeSelect = document.getElementById("runModeSelect");
const aiModeSelect = document.getElementById("aiModeSelect");
const aiModeHint = document.getElementById("aiModeHint");
const accountStripText = document.getElementById("accountStripText");

function aiModeText(mode) {
  if (mode === "off") return "Using Jobright's original messages.";
  if (mode === "auto_rewrite") return "Auto Rewrite before each send.";
  if (mode === "auto_pro") return "Auto Rewrite Pro before each send.";
  return "You'll choose Rewrite or Rewrite Pro each time.";
}

async function renderAccountStrip() {
  const data = await storageGet(["authSession", "cloudUsage"]);
  const session = data.authSession;
  if (!session?.access_token) {
    accountStripText.textContent = "Sign in from Settings to use AI rewrites.";
    return;
  }

  let usage = (await fetchCloudMe()) || data.cloudUsage;
  const email = usage?.email || session.email || "Signed in";
  const planLabel = isProPlan(usage?.plan) ? "Pro" : "Free";

  if (usage?.limits) {
    const rewriteLeft = Math.max(0, usage.limits.rewrite - (usage.usage?.rewrite || 0));
    const proLeft = Math.max(0, usage.limits.pro - (usage.usage?.pro || 0));
    accountStripText.textContent = `${email} · ${planLabel} · ${rewriteLeft} Rewrite · ${proLeft} Pro left`;
  } else {
    accountStripText.textContent = `${email} · ${planLabel}`;
  }
}

function loadWorkflowSettings() {
  chrome.storage.local.get(["runMode", "aiMode", "aiRewriteEnabled"], (data) => {
    runModeSelect.value = data.runMode || "both";
    aiModeSelect.value = resolveAiMode(data);
    aiModeHint.textContent = aiModeText(aiModeSelect.value);
  });
}

runModeSelect.addEventListener("change", () => {
  chrome.storage.local.set({ runMode: runModeSelect.value });
});

aiModeSelect.addEventListener("change", () => {
  const mode = aiModeSelect.value;
  chrome.storage.local.set({ aiMode: mode }, () => {
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
    if (!resumes.length) {
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

startBtn.addEventListener("click", () => {
  const resumeId = resumeSelect.value;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.url?.includes("jobright.ai")) {
      startBtn.textContent = "Open Jobright first";
      setTimeout(() => { startBtn.textContent = "Preview + Start"; }, 1600);
      return;
    }
    chrome.storage.local.set({
      activeResumeId: resumeId,
      jobrightTabId: tab.id,
      runMode: runModeSelect.value,
      aiMode: aiModeSelect.value,
    }, () => {
      chrome.tabs.sendMessage(tab.id, {
        type: "START_RUN",
        resumeId,
        runMode: runModeSelect.value,
        aiMode: aiModeSelect.value,
      }, () => {});
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
