// content_linkedin.js
// Runs on linkedin.com. Clicks Connect (direct or via the "More" menu),
// works through the two-step note dialog, pastes in the message Jobright
// generated, then waits for the user to hit Send and closes the tab after.
//
// LinkedIn renders some of its dialogs using a DOM portal, and possibly
// shadow DOM, so a plain document.querySelector can miss things that are
// clearly visible and inspectable. Every lookup below walks the full tree
// (light DOM, shadow roots, and starting from <html> not just <body>) to
// deal with that.

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

function visibleText(el) {
  return (el.innerText || el.textContent || "").trim();
}

function getAllElementsDeep(root) {
  const out = [];
  function visit(node) {
    if (node.shadowRoot) visit(node.shadowRoot);
    const kids = node.children ? Array.from(node.children) : [];
    for (const kid of kids) {
      out.push(kid);
      visit(kid);
    }
  }
  visit(root);
  return out;
}

function deepAll() {
  return getAllElementsDeep(document.documentElement || document);
}

function isClickable(el) {
  return el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button";
}

function findButtonByText(text) {
  const all = deepAll();
  for (const el of all) {
    if (isClickable(el) && visibleText(el).toLowerCase() === text.toLowerCase()) return el;
  }
  return null;
}

function findByAriaLabel(label) {
  const all = deepAll();
  for (const el of all) {
    if ((el.getAttribute("aria-label") || "") === label) return el;
  }
  return null;
}

function findTextareaDeep() {
  const all = deepAll();
  return all.find((el) => el.tagName === "TEXTAREA" && el.id === "custom-message") ||
    all.find((el) => el.tagName === "TEXTAREA") ||
    null;
}

function findConnectControl() {
  const all = deepAll();
  for (const el of all) {
    if (!isClickable(el)) continue;
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const text = visibleText(el).toLowerCase();
    if (aria.includes("to connect")) return el;
    if (text === "connect" && !aria.includes("disconnect")) return el;
  }
  return null;
}

function fireClick(el) {
  try {
    el.scrollIntoView({ block: "center" });
  } catch (e) {}
  const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
  try {
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
  } catch (e) {}
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  try {
    el.dispatchEvent(new PointerEvent("pointerup", opts));
  } catch (e) {}
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.click();
}

function setFrameworkValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function run() {
  console.log("[Jobright Autopilot] LinkedIn script started, checking for a pending job...");
  const job = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_PENDING_LINKEDIN_JOB" }, resolve);
  });
  if (!job || !job.note) {
    console.log("[Jobright Autopilot] no pending LinkedIn job found for this page, doing nothing.");
    return;
  }

  // The name Jobright's page scraping found can be wrong ("Unknown") for
  // LinkedIn-only flows, the profile page itself is a much more reliable
  // source, so prefer that whenever it's available.
  const h1 = document.querySelector("h1");
  const profileName = h1 ? visibleText(h1) : "";
  if (profileName && profileName.length < 80) {
    job.personName = profileName;
    chrome.storage.local.set({ pendingLinkedinJob: { ...job, personName: profileName } });
  }

  const log = (text) => {
    console.log("[Jobright Autopilot]", `${job.personName}: ${text}`);
    chrome.runtime.sendMessage({ type: "LOG_STATUS", text: `${job.personName}: ${text}` });
  };

  log("looking for the Connect button...");
  let connectEl = await waitFor(findConnectControl, { timeout: 6000 });
  log(connectEl ? "found Connect directly." : "did not find Connect directly, checking the More menu...");

  if (!connectEl) {
    const moreBtn = await waitFor(() => findButtonByText("more"), { timeout: 4000 });
    log(moreBtn ? "found the More button, opening it." : "could not find a More button either.");
    if (moreBtn) {
      await sleep(600);
      fireClick(moreBtn);
      await sleep(600);
      connectEl = await waitFor(findConnectControl, { timeout: 4000 });
      log(connectEl ? "found Connect inside the More menu." : "still no Connect option inside the More menu.");
    }
  }

  if (!connectEl) {
    log("could not find the Connect button on this profile, do it manually.");
    return;
  }
  await sleep(600);
  fireClick(connectEl);
  log("clicked Connect, waiting for the dialog...");
  await sleep(1200);

  await sleep(600);
  const addNoteBtn = await waitFor(
    () => findByAriaLabel("Add a note") || findButtonByText("Add a note"),
    { timeout: 6000 }
  );
  log(addNoteBtn ? "found Add a note, clicking it." : "no Add a note button showed up, maybe it skipped straight to the note box.");
  if (addNoteBtn) {
    await sleep(600);
    fireClick(addNoteBtn);
    await sleep(800);
  }

  await sleep(600);
  const textarea = await waitFor(findTextareaDeep, { timeout: 5000 });
  log(textarea ? "found the note box." : "no note box appeared.");
  if (!textarea) {
    const total = deepAll().length;
    log(`connect dialog opened but no note box appeared (scanned ${total} elements total), add the note manually and send.`);
    return;
  }

  await sleep(600);
  setFrameworkValue(textarea, job.note);
  await sleep(600);
  log("note pasted in, review it and click Send, this tab will close on its own a couple seconds after you do.");
  watchForSend();
}

function watchForSend() {
  const interval = setInterval(() => {
    const all = deepAll();
    const dialogGone = !all.some((el) => el.id === "custom-message") &&
      !all.some((el) => el.classList && el.classList.contains("artdeco-modal"));
    const sentToast = all.some((el) => /invitation sent|invite sent/i.test(el.textContent || ""));
    if (dialogGone || sentToast) {
      clearInterval(interval);
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: "LINKEDIN_SEND_DETECTED" });
      }, 1500);
    }
  }, 500);

  setTimeout(() => {
    clearInterval(interval);
    chrome.runtime.sendMessage({ type: "LINKEDIN_SEND_DETECTED" });
  }, 5 * 60 * 1000);
}

setTimeout(run, 1200);
