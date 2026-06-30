// content_gmail.js
// Runs on mail.google.com. The compose window arrives pre-filled (to/subject/
// body) via the URL Gmail was opened with. This script's only job is to
// attach the chosen resume PDF, then stop, leaving Send for the user.

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(check, { timeout = 8000, interval = 300 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = check();
    if (result) return result;
    await sleep(interval);
  }
  return null;
}

function dataUrlToFile(dataUrl, filename) {
  const [meta, base64] = dataUrl.split(",");
  const mimeMatch = meta.match(/data:(.*);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "application/pdf";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

function findComposeBody() {
  return document.querySelector("div[aria-label='Message Body']");
}

function findFileInput() {
  const inputs = Array.from(document.querySelectorAll("input[type='file']"));
  return inputs.length ? inputs[inputs.length - 1] : null;
}

async function attachResumeViaInput(file) {
  const input = await waitFor(findFileInput, { timeout: 5000 });
  if (!input) return false;
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function attachResumeViaDrop(file) {
  const target = await waitFor(findComposeBody, { timeout: 10000 });
  if (!target) return false;

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);

  const eventOpts = { bubbles: true, cancelable: true, dataTransfer };
  target.dispatchEvent(new DragEvent("dragenter", eventOpts));
  target.dispatchEvent(new DragEvent("dragover", eventOpts));
  target.dispatchEvent(new DragEvent("drop", eventOpts));
  return true;
}

async function attachResume(file) {
  const viaInput = await attachResumeViaInput(file);
  if (viaInput) return true;
  return attachResumeViaDrop(file);
}

function watchForSend() {
  const interval = setInterval(() => {
    const composeGone = !findComposeBody();
    const sentToast = Array.from(document.querySelectorAll("span, div")).some(
      (el) => /message sent/i.test(el.textContent || "")
    );
    if (composeGone || sentToast) {
      clearInterval(interval);
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: "GMAIL_SEND_DETECTED" });
      }, 1000);
    }
  }, 500);

  // Safety net in case none of these signals ever fire, don't block the
  // run forever.
  setTimeout(() => {
    clearInterval(interval);
    chrome.runtime.sendMessage({ type: "GMAIL_SEND_DETECTED" });
  }, 5 * 60 * 1000);
}

async function run() {
  const job = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_PENDING_GMAIL_JOB" }, resolve);
  });
  if (!job || !job.resumeId) return;

  const data = await new Promise((resolve) => {
    chrome.storage.local.get("resumes", resolve);
  });
  const resume = (data.resumes || []).find((r) => r.id === job.resumeId);
  let composeRoot = await waitFor(findComposeBody, { timeout: 10000 });

  if (!resume) {
    chrome.runtime.sendMessage({ type: "LOG_STATUS", text: `${job.personName}: resume not found in storage, attach manually.` });
  } else if (composeRoot) {
    const file = dataUrlToFile(resume.dataUrl, resume.name);
    const ok = await attachResume(file);
    chrome.runtime.sendMessage({
      type: "LOG_STATUS",
      text: ok
        ? `${job.personName}: resume "${resume.name}" attached. Review and hit Send, this tab will close on its own a second after you do.`
        : `${job.personName}: could not auto-attach, please attach "${resume.name}" manually, then hit Send.`,
    });
  }

  watchForSend();
}

// Give Gmail a moment to render the compose window before we look for it.
setTimeout(run, 1500);
