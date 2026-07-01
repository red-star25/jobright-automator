// options.js
const fileInput = document.getElementById("fileInput");
const uploadStatus = document.getElementById("uploadStatus");
const runModeSelect = document.getElementById("runMode");
const aiModeSelect = document.getElementById("aiMode");
const aiProviderSelect = document.getElementById("aiProvider");
const openaiApiKeyInput = document.getElementById("openaiApiKey");
const defaultToneSelect = document.getElementById("defaultTone");
const userNameInput = document.getElementById("userName");
const resumeTextInput = document.getElementById("resumeText");
const customInstructionsInput = document.getElementById("customInstructions");
const saveAiBtn = document.getElementById("saveAiBtn");
const debugLoggingInput = document.getElementById("debugLogging");
const aiStatus = document.getElementById("aiStatus");
const accountSummary = document.getElementById("accountSummary");
const usageSummary = document.getElementById("usageSummary");
const accountStatus = document.getElementById("accountStatus");
const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const upgradeLink = document.getElementById("upgradeLink");
const localKeySection = document.getElementById("localKeySection");

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function decodePdfEscapes(str) {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\[0-7]{1,3}/g, " ");
}

function cleanResumeText(text) {
  return String(text || "")
    .replace(/\u0000/g, " ")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

function resumeTextLooksReadable(text) {
  const sample = cleanResumeText(text);
  if (sample.length < 250) return false;

  const englishWords = sample.match(/\b[A-Za-z][A-Za-z+.#-]{2,}\b/g) || [];
  if (englishWords.length < 45) return false;

  const readableChars = sample.match(/[A-Za-z0-9\s.,;:()@/+&_'’\-#]/g) || [];
  const readableRatio = readableChars.length / sample.length;
  if (readableRatio < 0.82) return false;

  const resumeSignals = /(education|experience|project|skills|university|college|software|engineer|developer|intern|github|linkedin|email|coursework|programming|javascript|python|java|react|node|sql)/i;
  return resumeSignals.test(sample);
}

function bestEffortExtractPdfText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let raw = "";
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);

  const chunks = [];

  const literalRe = /\((?:\\.|[^\\()]){2,}\)/g;
  let match;
  while ((match = literalRe.exec(raw))) {
    const text = decodePdfEscapes(match[0].slice(1, -1));
    if (/[A-Za-z]{2,}/.test(text)) chunks.push(text);
  }

  const hexRe = /<([0-9A-Fa-f]{8,})>/g;
  while ((match = hexRe.exec(raw))) {
    const hex = match[1];
    if (hex.length % 4 !== 0) continue;
    let text = "";
    for (let i = 0; i < hex.length; i += 4) {
      const code = parseInt(hex.slice(i, i + 4), 16);
      if (code >= 32 && code < 127) text += String.fromCharCode(code);
      else if (code === 10 || code === 13) text += "\n";
    }
    if (/[A-Za-z]{2,}/.test(text)) chunks.push(text);
  }

  const extracted = cleanResumeText(chunks.join(" "));
  return resumeTextLooksReadable(extracted) ? extracted : "";
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function renderUsageBars(cloudUsage) {
  if (!usageSummary) return;
  if (!cloudUsage || !cloudUsage.limits) {
    usageSummary.innerHTML = "";
    return;
  }
  const rewritePct = cloudUsage.limits.rewrite
    ? Math.min(100, Math.round((cloudUsage.usage.rewrite / cloudUsage.limits.rewrite) * 100))
    : 0;
  const proPct = cloudUsage.limits.pro
    ? Math.min(100, Math.round((cloudUsage.usage.pro / cloudUsage.limits.pro) * 100))
    : 0;
  usageSummary.innerHTML = `
    <p class="small-note" style="margin-top:10px;"><strong>Rewrite:</strong> ${cloudUsage.usage.rewrite}/${cloudUsage.limits.rewrite}</p>
    <div class="usage-bar"><span style="width:${rewritePct}%"></span></div>
    <p class="small-note" style="margin-top:10px;"><strong>Rewrite Pro:</strong> ${cloudUsage.usage.pro}/${cloudUsage.limits.pro}</p>
    <div class="usage-bar"><span style="width:${proPct}%"></span></div>
  `;
}

async function refreshAccountUi() {
  const data = await new Promise((resolve) => {
    chrome.storage.local.get(["authSession", "cloudUsage", "aiProvider"], resolve);
  });

  const session = data.authSession;
  const cloudUsage = data.cloudUsage;
  const apiBase = typeof getApiBase === "function" ? getApiBase() : "http://localhost:3000";
  if (upgradeLink) upgradeLink.href = `${apiBase}/dashboard`;

  if (session && session.email) {
    accountSummary.textContent = `Signed in as ${session.email}`;
    signInBtn.style.display = "none";
    signOutBtn.style.display = "inline-block";
  } else if (session && session.access_token) {
    accountSummary.textContent = "Signed in to Cloud AI.";
    signInBtn.style.display = "none";
    signOutBtn.style.display = "inline-block";
  } else {
    accountSummary.textContent = "Not signed in.";
    signInBtn.style.display = "inline-block";
    signOutBtn.style.display = "none";
    usageSummary.innerHTML = "";
  }

  if (session && session.access_token && typeof fetchCloudMe === "function") {
    const me = await fetchCloudMe();
    if (me) renderUsageBars(me);
    else renderUsageBars(cloudUsage);
  } else {
    renderUsageBars(cloudUsage);
  }

  updateProviderUi(data.aiProvider || "local");
}

function updateProviderUi(provider) {
  if (!localKeySection || !openaiApiKeyInput) return;
  const isCloud = provider === "cloud";
  localKeySection.style.display = isCloud ? "none" : "block";
}

function render() {
  chrome.storage.local.get(["resumes", "defaultResumeId"], (data) => {
    const resumes = data.resumes || [];
    if (!uploadStatus) return;
    if (!resumes.length) {
      uploadStatus.textContent = "No resume uploaded yet.";
      return;
    }
    const current = resumes.find((r) => r.id === data.defaultResumeId) || resumes[0];
    const textLabel = current.text && resumeTextLooksReadable(current.text) ? "Resume text ready for Rewrite Pro." : "Resume uploaded. Paste clean resume text below for Rewrite Pro.";
    uploadStatus.textContent = `Current resume: ${current.name}. ${textLabel}`;
  });
}

function loadAiSettings() {
  chrome.storage.local.get([
    "runMode",
    "aiMode",
    "aiProvider",
    "aiRewriteEnabled",
    "openaiApiKey",
    "defaultTone",
    "userName",
    "aiResumeText",
    "aiCustomInstructions",
    "debugLogging",
  ], (data) => {
    runModeSelect.value = data.runMode || "both";
    aiModeSelect.value = data.aiMode || (data.aiRewriteEnabled === false ? "off" : "ask");
    aiProviderSelect.value = data.aiProvider || "local";
    openaiApiKeyInput.value = data.openaiApiKey || "";
    defaultToneSelect.value = data.defaultTone || "Professional";
    userNameInput.value = data.userName || "";
    resumeTextInput.value = data.aiResumeText || "";
    customInstructionsInput.value = data.aiCustomInstructions || "";
    debugLoggingInput.checked = !!data.debugLogging;
    updateProviderUi(aiProviderSelect.value);
  });
}

function saveAiSettings() {
  chrome.storage.local.set({
    runMode: runModeSelect.value,
    aiMode: aiModeSelect.value,
    aiProvider: aiProviderSelect.value,
    aiRewriteEnabled: aiModeSelect.value !== "off",
    openaiApiKey: openaiApiKeyInput.value.trim(),
    defaultTone: defaultToneSelect.value,
    userName: userNameInput.value.trim(),
    aiResumeText: resumeTextInput.value.trim(),
    aiCustomInstructions: customInstructionsInput.value.trim(),
    debugLogging: !!debugLoggingInput.checked,
  }, () => {
    aiStatus.textContent = "Saved.";
    setTimeout(() => { aiStatus.textContent = ""; }, 1800);
    updateProviderUi(aiProviderSelect.value);
  });
}

signInBtn.addEventListener("click", async () => {
  accountStatus.textContent = "Opening sign in...";
  try {
    await signInWithCloudAi();
    accountStatus.textContent = "Signed in.";
    await refreshAccountUi();
  } catch (err) {
    accountStatus.textContent = err.message || String(err);
  }
});

signOutBtn.addEventListener("click", async () => {
  await signOutCloudAi();
  accountStatus.textContent = "Signed out.";
  await refreshAccountUi();
});

aiProviderSelect.addEventListener("change", () => {
  updateProviderUi(aiProviderSelect.value);
  saveAiSettings();
});

fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  const newResumes = [];
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    let text = "";

    if (/\.(txt|md)$/i.test(file.name) || /^text\//i.test(file.type || "")) {
      text = cleanResumeText(await readFileAsText(file));
    } else if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      const arrayBuffer = await readFileAsArrayBuffer(file);
      text = bestEffortExtractPdfText(arrayBuffer);
    }

    newResumes.push({
      id: "resume_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      name: file.name,
      dataUrl,
      text: resumeTextLooksReadable(text) ? text : "",
    });
  }

  chrome.storage.local.get(["resumes", "defaultResumeId", "aiResumeText"], (data) => {
    const resumes = (data.resumes || []).concat(newResumes);
    const updates = { resumes };
    if (!data.defaultResumeId) updates.defaultResumeId = newResumes[0].id;
    const firstText = newResumes.find((r) => r.text && resumeTextLooksReadable(r.text))?.text || "";
    if (!data.aiResumeText && firstText) updates.aiResumeText = firstText;
    chrome.storage.local.set(updates, () => {
      fileInput.value = "";
      loadAiSettings();
      render();
    });
  });
});

runModeSelect.addEventListener("change", saveAiSettings);
aiModeSelect.addEventListener("change", saveAiSettings);
saveAiBtn.addEventListener("click", saveAiSettings);
loadAiSettings();
render();
refreshAccountUi();
