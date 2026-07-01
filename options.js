// options.js
const fileInput = document.getElementById("fileInput");
const list = document.getElementById("list");
const runModeSelect = document.getElementById("runMode");
const aiModeSelect = document.getElementById("aiMode");
const openaiApiKeyInput = document.getElementById("openaiApiKey");
const defaultToneSelect = document.getElementById("defaultTone");
const userNameInput = document.getElementById("userName");
const resumeTextInput = document.getElementById("resumeText");
const customInstructionsInput = document.getElementById("customInstructions");
const saveAiBtn = document.getElementById("saveAiBtn");
const aiStatus = document.getElementById("aiStatus");

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

  // If the PDF parser produced mostly binary/control/glyph junk, do not save it.
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

  // Common uncompressed PDF literal strings: (text) Tj / [(text) ...] TJ.
  // Many resumes are compressed or font-encoded, so this may return nothing useful.
  const literalRe = /\((?:\\.|[^\\()]){2,}\)/g;
  let match;
  while ((match = literalRe.exec(raw))) {
    const text = decodePdfEscapes(match[0].slice(1, -1));
    if (/[A-Za-z]{2,}/.test(text)) chunks.push(text);
  }

  // UTF-16BE hex strings sometimes appear as <00480069>.
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

function render() {
  chrome.storage.local.get(["resumes", "defaultResumeId"], (data) => {
    const resumes = data.resumes || [];
    list.innerHTML = "";
    resumes.forEach((r) => {
      const row = document.createElement("div");
      row.className = "row";

      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = r.name;
      const qualityTag = document.createElement("span");
      qualityTag.className = "default-tag";
      qualityTag.style.color = r.text && resumeTextLooksReadable(r.text) ? "#2fa86f" : "#d9822b";
      qualityTag.textContent = r.text && resumeTextLooksReadable(r.text) ? "TEXT OK" : "PASTE TEXT";
      nameSpan.appendChild(qualityTag);
      if (r.id === data.defaultResumeId) {
        const tag = document.createElement("span");
        tag.className = "default-tag";
        tag.textContent = "DEFAULT";
        nameSpan.appendChild(tag);
      }
      row.appendChild(nameSpan);

      const actions = document.createElement("div");
      actions.className = "actions";

      const setDefaultBtn = document.createElement("button");
      setDefaultBtn.textContent = "Set default";
      setDefaultBtn.onclick = () => {
        const updates = { defaultResumeId: r.id };
        if (r.text && !resumeTextInput.value.trim()) updates.aiResumeText = r.text;
        chrome.storage.local.set(updates, () => { loadAiSettings(); render(); });
      };
      actions.appendChild(setDefaultBtn);

      const useTextBtn = document.createElement("button");
      useTextBtn.textContent = "Use text";
      useTextBtn.title = "Use this resume's extracted text for Rewrite Pro";
      useTextBtn.onclick = () => {
        resumeTextInput.value = r.text || "";
        saveAiSettings();
      };
      actions.appendChild(useTextBtn);

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "Remove";
      removeBtn.onclick = () => {
        const next = resumes.filter((x) => x.id !== r.id);
        const updates = { resumes: next };
        if (data.defaultResumeId === r.id) updates.defaultResumeId = next[0] ? next[0].id : null;
        chrome.storage.local.set(updates, render);
      };
      actions.appendChild(removeBtn);

      row.appendChild(actions);
      list.appendChild(row);
    });
  });
}

function loadAiSettings() {
  chrome.storage.local.get(["runMode", "aiMode", "aiRewriteEnabled", "openaiApiKey", "defaultTone", "userName", "aiResumeText", "aiCustomInstructions"], (data) => {
    runModeSelect.value = data.runMode || "both";
    aiModeSelect.value = data.aiMode || (data.aiRewriteEnabled === false ? "off" : "ask");
    openaiApiKeyInput.value = data.openaiApiKey || "";
    defaultToneSelect.value = data.defaultTone || "Professional";
    userNameInput.value = data.userName || "";
    resumeTextInput.value = data.aiResumeText || "";
    customInstructionsInput.value = data.aiCustomInstructions || "";
  });
}

function saveAiSettings() {
  chrome.storage.local.set({
    runMode: runModeSelect.value,
    aiMode: aiModeSelect.value,
    aiRewriteEnabled: aiModeSelect.value !== "off",
    openaiApiKey: openaiApiKeyInput.value.trim(),
    defaultTone: defaultToneSelect.value,
    userName: userNameInput.value.trim(),
    aiResumeText: resumeTextInput.value.trim(),
    aiCustomInstructions: customInstructionsInput.value.trim(),
  }, () => {
    aiStatus.textContent = "Saved.";
    setTimeout(() => { aiStatus.textContent = ""; }, 1800);
  });
}

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
