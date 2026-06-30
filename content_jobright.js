// content_jobright.js
// Runs on jobright.ai job pages. Listens for START_RUN from the popup,
// then walks the Insider Connection list and processes each person.

function log(text) {
  console.log("[Jobright Autopilot]", text);
  chrome.runtime.sendMessage({ type: "LOG_STATUS", text });
}

// Resolved by the PERSON_EMAIL_DONE message once the Gmail tab for the
// current person detects Send and closes itself. Lets tryEmail pause the
// whole run until that happens instead of firing every email at once.
let waitingForEmailDone = null;
let waitingForLinkedinDone = null;
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PERSON_EMAIL_DONE" && waitingForEmailDone) {
    waitingForEmailDone();
    waitingForEmailDone = null;
  }
  if (message.type === "PERSON_LINKEDIN_DONE" && waitingForLinkedinDone) {
    waitingForLinkedinDone();
    waitingForLinkedinDone = null;
  }
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Polls until `check()` returns a truthy value, or times out.
async function waitFor(check, { timeout = 6000, interval = 250 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = check();
    if (result) return result;
    await sleep(interval);
  }
  return null;
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

  await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "OPEN_GMAIL_COMPOSE", payload: { to, subject: subject || "", body: body || "", resumeId, personName: realName } },
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
  return { linkedinHandled: false };
}

// --- LinkedIn flow -----------------------------------------------------------

function extractLinkedinModalData(modal) {
  const textarea = modal.querySelector("textarea");
  const message = textarea ? textarea.value.trim() : "";
  const viewBtn = Array.from(modal.querySelectorAll("button")).find((b) =>
    visibleText(b).toLowerCase().includes("view linkedin profile")
  );
  return { message, viewBtn };
}

async function tryLinkedin(person) {
  person.linkedinBtn.click();
  await sleep(400);
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

  const { message, viewBtn } = extractLinkedinModalData(modal);
  if (!message) {
    log(`${personName}: could not read the LinkedIn message, skipping.`);
    closeAnyModal();
    return;
  }
  if (!viewBtn) {
    log(`${personName}: could not find the View LinkedIn Profile button, skipping.`);
    closeAnyModal();
    return;
  }

  await new Promise((resolve) => {
    chrome.storage.local.set({ pendingLinkedinJob: { note: message, personName } }, resolve);
  });

  log(`${personName}: LinkedIn note ready, opening their profile now. Waiting for you to hit Send.`);
  viewBtn.click();
  closeAnyModal();

  await new Promise((resolve) => {
    waitingForLinkedinDone = resolve;
  });
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

async function runAutomation(resumeId) {
  log("Starting run on this job page.");
  const container = findInsiderConnectionContainer();
  if (!container) {
    log("Could not find the Insider Connection section on this page. Scroll to it and try again.");
    return;
  }

  const cards = getCategoryCards(container);
  if (!cards.length) {
    log("No connection categories found in this section.");
    return;
  }
  log(`Found ${cards.length} connection categories.`);

  let totalFound = 0;

  for (const card of cards) {
    const opened = await openCategoryPanel(card);
    if (!opened) {
      log("A category panel did not open after clicking View, skipping it.");
      continue;
    }
    await sleep(500);

    const count = getPersonRows(document.body).length;
    totalFound += count;
    log(`Found ${count} people in this category.`);

    for (let idx = 0; idx < count; idx++) {
      const beforeEmail = getPersonRows(document.body)[idx];
      if (!beforeEmail) {
        log(`Could not re-locate person #${idx + 1} after a page update, skipping.`);
        continue;
      }
      log(`Working on ${beforeEmail.name} (email)...`);
      const emailResult = await tryEmail(beforeEmail, resumeId);
      await sleep(800);

      if (!emailResult || !emailResult.linkedinHandled) {
        // Re-query fresh, the page may have re-rendered while we were
        // waiting on the email step.
        const beforeLinkedin = getPersonRows(document.body)[idx] || beforeEmail;
        log(`Working on ${beforeLinkedin.name} (LinkedIn)...`);
        await tryLinkedin(beforeLinkedin);
        await sleep(800);
      }
    }

    closePanels();
    await sleep(500);
  }

  log(`Done with this page. Processed ${totalFound} people total.`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_RUN") {
    runAutomation(message.resumeId);
    sendResponse({ started: true });
  }
});
