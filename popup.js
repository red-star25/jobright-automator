// popup.js
const resumeSelect = document.getElementById("resumeSelect");
const startBtn = document.getElementById("startBtn");
const optionsBtn = document.getElementById("optionsBtn");
const dashboardBtn = document.getElementById("dashboardBtn");
const statusBox = document.getElementById("status");
const statToday = document.getElementById("statToday");
const statTotal = document.getElementById("statTotal");
const statRate = document.getElementById("statRate");

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
    chrome.storage.local.set({ statusLog: [], activeResumeId: resumeId, jobrightTabId: tab.id }, () => {
      chrome.tabs.sendMessage(tab.id, { type: "START_RUN", resumeId }, () => {
        // content script will log its own progress via storage
      });
    });
  });
});

optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loadResumes();
renderStatus();
renderOutreachStats();
setInterval(renderStatus, 1000);
setInterval(renderOutreachStats, 2000);
