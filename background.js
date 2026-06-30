// background.js
// Acts as the message hub. Content scripts cannot talk to each other directly,
// so they all send messages here, and this script opens tabs / stores data
// so the next tab knows what to do when it loads. It also keeps the
// outreach log, the record of everyone contacted, used for stats and for
// skipping people already reached out to.

function addOutreachEntry(entry) {
  chrome.storage.local.get("outreachLog", (data) => {
    const log = data.outreachLog || [];
    log.push({
      id: Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      date: Date.now(),
      status: "sent",
      ...entry,
    });
    chrome.storage.local.set({ outreachLog: log.slice(-3000) });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OPEN_GMAIL_COMPOSE") {
    // message.payload = { to, subject, body, resumeId, personName, company }
    chrome.storage.local.set({ pendingGmailJob: message.payload }, () => {
      const url =
        "https://mail.google.com/mail/?view=cm&fs=1&tf=1" +
        "&to=" + encodeURIComponent(message.payload.to) +
        "&su=" + encodeURIComponent(message.payload.subject) +
        "&body=" + encodeURIComponent(message.payload.body);
      chrome.tabs.create({ url, active: true }, (tab) => {
        chrome.storage.local.set({ activeGmailTabId: tab.id });
        sendResponse({ ok: true, tabId: tab.id });
      });
    });
    return true; // keep channel open for async sendResponse
  }

  if (message.type === "GMAIL_SEND_DETECTED") {
    // Sent from content_gmail.js once it sees the compose window close.
    // Log it, close that tab, and tell the Jobright tab it can move on.
    chrome.storage.local.get(["jobrightTabId", "pendingGmailJob"], (data) => {
      const job = data.pendingGmailJob;
      if (job) {
        addOutreachEntry({
          name: job.personName,
          company: job.company || "",
          channel: "email",
          identifier: job.to,
        });
      }
      if (data.jobrightTabId) {
        chrome.tabs.sendMessage(data.jobrightTabId, { type: "PERSON_EMAIL_DONE" }).catch(() => {});
      }
      if (sender.tab && sender.tab.id) {
        chrome.tabs.remove(sender.tab.id);
      }
    });
    return false;
  }

  if (message.type === "LINKEDIN_SEND_DETECTED") {
    chrome.storage.local.get(["jobrightTabId", "pendingLinkedinJob"], (data) => {
      const job = data.pendingLinkedinJob;
      if (job) {
        addOutreachEntry({
          name: job.personName,
          company: job.company || "",
          channel: "linkedin",
          identifier: job.personName,
        });
      }
      if (data.jobrightTabId) {
        chrome.tabs.sendMessage(data.jobrightTabId, { type: "PERSON_LINKEDIN_DONE" }).catch(() => {});
      }
      if (sender.tab && sender.tab.id) {
        chrome.tabs.remove(sender.tab.id);
      }
    });
    return false;
  }

  if (message.type === "GET_OUTREACH_LOG") {
    chrome.storage.local.get("outreachLog", (data) => {
      sendResponse(data.outreachLog || []);
    });
    return true;
  }

  if (message.type === "OPEN_LINKEDIN_PROFILE") {
    // message.payload = { profileUrl, note, personName }
    chrome.storage.local.set({ pendingLinkedinJob: message.payload }, () => {
      chrome.tabs.create({ url: message.payload.profileUrl, active: false }, (tab) => {
        sendResponse({ ok: true, tabId: tab.id });
      });
    });
    return true;
  }

  if (message.type === "GET_PENDING_GMAIL_JOB") {
    chrome.storage.local.get("pendingGmailJob", (data) => {
      sendResponse(data.pendingGmailJob || null);
    });
    return true;
  }

  if (message.type === "GET_PENDING_LINKEDIN_JOB") {
    chrome.storage.local.get("pendingLinkedinJob", (data) => {
      sendResponse(data.pendingLinkedinJob || null);
    });
    return true;
  }

  if (message.type === "LOG_STATUS") {
    chrome.storage.local.get("statusLog", (data) => {
      const log = data.statusLog || [];
      log.push({ time: Date.now(), text: message.text });
      chrome.storage.local.set({ statusLog: log.slice(-100) });
    });
  }
});
