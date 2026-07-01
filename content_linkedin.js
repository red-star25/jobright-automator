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
  const role = (el.getAttribute && (el.getAttribute("role") || "").toLowerCase()) || "";
  return el.tagName === "BUTTON" ||
    el.tagName === "A" ||
    role === "button" ||
    role === "menuitem" ||
    role === "option" ||
    el.getAttribute("tabindex") === "0";
}

function findButtonByText(text, { excludeRecommendations = false } = {}) {
  const all = deepAll();
  for (const el of all) {
    if (!isClickable(el)) continue;
    if (excludeRecommendations && isInsideRecommendationRail(el)) continue;
    if (visibleText(el).toLowerCase() === text.toLowerCase()) return el;
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

function cleanPersonName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .replace(/^(invite|connect with)\s+/i, "")
    .replace(/\s+to connect.*$/i, "")
    .replace(/\s+(he\/him|she\/her|they\/them)\s*.*$/i, "")
    .replace(/\s*[·|].*$/g, "")
    .trim();
}

function looksLikePersonName(name) {
  const cleaned = cleanPersonName(name);
  if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return false;
  if (/^(unknown|linkedin|profile|connect|message|more|follow|pending|contact info)$/i.test(cleaned)) return false;
  if (/\b(mutual connection|connections|university|portfolio|contact info|message|pending|followers?)\b/i.test(cleaned)) return false;
  if (/[|@]/.test(cleaned)) return false;
  return /^[A-Za-z][A-Za-z .'-]+$/.test(cleaned);
}

function currentLinkedInSlug() {
  const match = location.pathname.match(/\/in\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : "";
}

function textFromNameHeading(container) {
  if (!container) return "";
  const heading = container.querySelector ? container.querySelector("h1, h2") : null;
  const name = cleanPersonName(heading ? visibleText(heading) : "");
  return looksLikePersonName(name) ? name : "";
}

function inferProfileName() {
  const all = deepAll();
  const slug = currentLinkedInSlug();

  // New LinkedIn UI: the real profile name is often an h2 inside the profile
  // verification anchor, e.g. href="/in/paapa-k-kusi/" and h2="Paapa Kusi".
  // Check this first so we do not accidentally log a mutual connection name.
  const profileAnchors = all.filter((el) => {
    if (!el.matches || !el.matches('a[href*="/in/"]')) return false;
    const href = (el.getAttribute("href") || "").toLowerCase();
    return slug ? href.includes(`/in/${slug}`) : true;
  });
  for (const anchor of profileAnchors) {
    const name = textFromNameHeading(anchor);
    if (name) return name;
  }

  // Fallback for the exact verification trigger component LinkedIn is using.
  for (const el of all) {
    const componentKey = el.getAttribute ? (el.getAttribute("componentkey") || "") : "";
    if (/ProfileVerificationTriggerRef/i.test(componentKey)) {
      const name = textFromNameHeading(el);
      if (name) return name;
    }
  }

  // Older LinkedIn UI usually has the profile name in the main h1.
  const selectors = [
    "main h1.text-heading-xlarge",
    "main .text-heading-xlarge",
    "main h1",
    "main h2",
  ];
  for (const selector of selectors) {
    try {
      const candidates = Array.from(document.querySelectorAll(selector));
      for (const el of candidates) {
        const name = cleanPersonName(visibleText(el));
        if (looksLikePersonName(name)) return name;
      }
    } catch (e) {}
  }

  // The invite modal often says: Personalize your invitation to <strong>Name</strong>...
  for (const el of all) {
    if (el.tagName === "STRONG") {
      const name = cleanPersonName(visibleText(el));
      if (looksLikePersonName(name)) return name;
    }
  }

  // The direct Connect button often has aria-label="Invite Name to connect".
  for (const el of all) {
    const aria = el.getAttribute ? (el.getAttribute("aria-label") || "") : "";
    const match = aria.match(/Invite\s+(.+?)\s+to connect/i);
    if (match) {
      const name = cleanPersonName(match[1]);
      if (looksLikePersonName(name)) return name;
    }
  }

  return "";
}

function savePendingLinkedinJob(job) {
  chrome.storage.local.set({ pendingLinkedinJob: { ...job, profileUrl: location.href } });
}

function parseInviteNameFromAria(el) {
  const aria = el && el.getAttribute ? (el.getAttribute("aria-label") || "") : "";
  const match = aria.match(/Invite\s+(.+?)\s+to connect/i);
  return match ? cleanPersonName(match[1]) : "";
}

function firstName(name) {
  return cleanPersonName(name).split(/\s+/).filter(Boolean)[0] || "";
}

function namesLikelyMatch(a, b) {
  const ca = cleanPersonName(a).toLowerCase();
  const cb = cleanPersonName(b).toLowerCase();
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  const fa = firstName(ca);
  const fb = firstName(cb);
  return !!fa && fa === fb && (ca.includes(cb) || cb.includes(ca) || ca.split(/\s+/).length === 1 || cb.split(/\s+/).length === 1);
}

function elementRect(el) {
  try {
    return el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
  } catch (e) {
    return null;
  }
}

function isElementVisible(el) {
  const rect = elementRect(el);
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
  if (style && (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0)) return false;
  return true;
}

function isInsideRecommendationRail(el) {
  // Keep this deliberately conservative. A previous version climbed to very
  // large ancestors whose text included "More profiles for you", which made
  // the real More-menu Connect option look like it was inside recommendations.
  const elRect = elementRect(el);
  let cur = el;
  let depth = 0;
  while (cur && depth < 10) {
    const tag = (cur.tagName || "").toLowerCase();
    if (tag === "aside") return true;

    const rect = elementRect(cur);
    const txt = visibleText(cur).toLowerCase();
    const isRightRail = rect && rect.width > 0 && rect.left > window.innerWidth * 0.68;
    const isSmallRecommendationBox = rect && rect.width > 0 && rect.height > 0 && rect.height < window.innerHeight * 0.9;

    if (isRightRail && /more profiles for you|people also viewed|similar profiles|recommended profiles|explore relevant opportunities/.test(txt)) {
      return true;
    }

    // Also protect against individual right-rail Connect buttons even if the
    // heading is outside the small parent chain.
    if (elRect && elRect.left > window.innerWidth * 0.72 && /connect|follow|message/.test(visibleText(el).toLowerCase())) {
      return true;
    }

    if (!isSmallRecommendationBox && depth > 3) break;
    cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
    depth += 1;
  }
  return false;
}

function findProfileNameElement() {
  const slug = currentLinkedInSlug();
  const all = deepAll();
  const anchors = all.filter((el) => {
    if (!el.matches || !el.matches('a[href*="/in/"]')) return false;
    const href = (el.getAttribute("href") || "").toLowerCase();
    return slug ? href.includes(`/in/${slug}`) : true;
  });
  for (const anchor of anchors) {
    const heading = anchor.querySelector && anchor.querySelector("h1, h2");
    if (heading && looksLikePersonName(visibleText(heading))) return heading;
  }
  const candidates = Array.from(document.querySelectorAll("main h1, main h2"));
  return candidates.find((el) => looksLikePersonName(visibleText(el))) || null;
}

function getScopedProfileRoot() {
  const nameEl = findProfileNameElement();
  if (!nameEl) return document.querySelector("main") || document.body || document.documentElement;
  let cur = nameEl;
  let best = cur;
  let depth = 0;
  while (cur && depth < 8) {
    const txt = visibleText(cur);
    if (/\b(Message|Connect|Follow|More|Pending)\b/i.test(txt) && !/More profiles for you|People also viewed/i.test(txt)) {
      best = cur;
    }
    cur = cur.parentElement;
    depth += 1;
  }
  return best || document.querySelector("main") || document.body || document.documentElement;
}

function getTopCardRoot() {
  const all = deepAll();
  const byComponent = all.find((el) => {
    const key = el.getAttribute ? (el.getAttribute("componentkey") || "") : "";
    return /topcard/i.test(key) && (el.tagName || "").toLowerCase() === "section";
  });
  if (byComponent) return byComponent;

  const nameEl = findProfileNameElement();
  if (nameEl) {
    let cur = nameEl;
    while (cur && cur !== document.documentElement) {
      if ((cur.tagName || "").toLowerCase() === "section") return cur;
      cur = cur.parentElement;
    }
  }
  return getScopedProfileRoot();
}

function findProfileMoreButton() {
  const root = getTopCardRoot();
  const candidates = getAllElementsDeep(root).filter((el) => {
    if (!isClickable(el) || !isElementVisible(el) || isInsideRecommendationRail(el)) return false;
    const text = visibleText(el).trim().toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
    return text === "more" || aria === "more";
  });

  candidates.sort((a, b) => {
    const aCollapsed = a.getAttribute("aria-expanded") === "false" ? 0 : 1;
    const bCollapsed = b.getAttribute("aria-expanded") === "false" ? 0 : 1;
    if (aCollapsed !== bCollapsed) return aCollapsed - bCollapsed;
    const aAria = (a.getAttribute("aria-label") || "").toLowerCase() === "more" ? 0 : 1;
    const bAria = (b.getAttribute("aria-label") || "").toLowerCase() === "more" ? 0 : 1;
    return aAria - bAria;
  });

  return candidates[0] || null;
}

function isValidConnectCandidate(el, expectedName) {
  if (!el || !isClickable(el)) return false;
  if (isInsideRecommendationRail(el)) return false;
  const aria = (el.getAttribute("aria-label") || "").toLowerCase();
  const text = visibleText(el).toLowerCase();
  const looksConnect = aria.includes("to connect") || (text === "connect" && !aria.includes("disconnect"));
  if (!looksConnect) return false;
  const inviteName = parseInviteNameFromAria(el);
  if (inviteName && expectedName && !namesLikelyMatch(inviteName, expectedName)) {
    console.log("[InsiderReach] ignoring Connect button for a different profile", { expectedName, inviteName });
    return false;
  }
  return true;
}


function isOpenMenuOrPopoverRoot(el) {
  if (!el || !el.getAttribute) return false;
  const role = (el.getAttribute("role") || "").toLowerCase();
  const cls = (el.className || "").toString().toLowerCase();
  return role === "menu" ||
    role === "listbox" ||
    el.hasAttribute("popover") ||
    /dropdown|overflow|popover|artdeco-dropdown__content|pvs-overflow-actions/.test(cls);
}

function findConnectInOpenMenu(expectedName = "") {
  const all = deepAll();
  const roots = all.filter(isOpenMenuOrPopoverRoot);

  for (const root of roots) {
    if (isInsideRecommendationRail(root)) continue;
    const candidates = [root, ...getAllElementsDeep(root)];
    for (const el of candidates) {
      if (!isClickable(el) || !isElementVisible(el)) continue;
      if (isInsideRecommendationRail(el)) continue;
      const text = visibleText(el).toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const disabled = el.getAttribute("aria-disabled") === "true" || el.disabled;
      if (disabled) continue;
      if (text === "connect" || aria.includes("connect")) {
        const inviteName = parseInviteNameFromAria(el);
        if (inviteName && expectedName && !namesLikelyMatch(inviteName, expectedName)) continue;
        return el;
      }
    }
  }

  // LinkedIn's new UI sometimes renders the More menu as a fixed popover with
  // no helpful role. In that case, only consider Connect controls that are
  // currently visible around the center area of the page, not the right rail.
  for (const el of all) {
    if (!isClickable(el) || !isElementVisible(el) || isInsideRecommendationRail(el)) continue;
    const text = visibleText(el).toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (!(text === "connect" || aria.includes("connect"))) continue;
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
    if (rect.left > window.innerWidth * 0.72) continue;
    const inviteName = parseInviteNameFromAria(el);
    if (inviteName && expectedName && !namesLikelyMatch(inviteName, expectedName)) continue;
    return el;
  }
  return null;
}

function findConnectControl(expectedName = "") {
  const scopedRoot = getScopedProfileRoot();
  const scoped = getAllElementsDeep(scopedRoot);
  for (const el of scoped) {
    if (isValidConnectCandidate(el, expectedName)) return el;
  }

  // Fallback scan, still excluding right-rail recommendations and any aria-label
  // that clearly belongs to another profile. This prevents clicking "Connect" in
  // LinkedIn's "More profiles for you" sidebar.
  const all = deepAll();
  for (const el of all) {
    if (isValidConnectCandidate(el, expectedName)) return el;
  }
  return null;
}

function findAlreadyHandledSignal() {
  const all = deepAll();
  for (const el of all) {
    if (!isClickable(el)) continue;
    const text = visibleText(el).toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (/^(pending|message|connected)$/i.test(text)) return text;
    if (aria.includes("pending") || aria.includes("message")) return aria;
  }
  return "";
}

function finishLinkedinStep(reason = "done") {
  chrome.runtime.sendMessage({ type: "LINKEDIN_SEND_DETECTED", reason });
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
  console.log("[InsiderReach] LinkedIn script started, checking for a pending job...");
  const job = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_PENDING_LINKEDIN_JOB" }, resolve);
  });
  if (!job || !job.note) {
    console.log("[InsiderReach] no pending LinkedIn job found for this page, doing nothing.");
    return;
  }

  // Jobright row scraping can sometimes pass "Unknown". Prefer the LinkedIn
  // page itself, and keep updating again after the invite modal opens because
  // LinkedIn often renders the real name there before the profile h1 is stable.
  job.profileUrl = location.href;
  const earlyName = inferProfileName();
  if (earlyName) job.personName = earlyName;
  savePendingLinkedinJob(job);

  const log = (text) => {
    console.log("[InsiderReach]", `${job.personName}: ${text}`);
    chrome.runtime.sendMessage({ type: "LOG_STATUS", text: `${job.personName}: ${text}` });
  };

  log("looking for the Connect button...");
  let connectEl = await waitFor(() => findConnectControl(job.personName || inferProfileName()), { timeout: 6000 });
  log(connectEl ? "found Connect directly." : "did not find Connect directly, checking the More menu...");

  if (!connectEl) {
    const moreBtn = await waitFor(findProfileMoreButton, { timeout: 4000 });
    log(moreBtn ? "found the More button, opening it." : "could not find a More button either.");
    if (moreBtn) {
      await sleep(600);
      fireClick(moreBtn);
      await sleep(600);
      connectEl = await waitFor(() => findConnectInOpenMenu(job.personName || inferProfileName()) || findConnectControl(job.personName || inferProfileName()), { timeout: 5000 });
      log(connectEl ? "found Connect inside the More menu." : "still no Connect option inside the More menu.");
    }
  }

  if (!connectEl) {
    const state = findAlreadyHandledSignal();
    if (state) {
      log(`no Connect button found; profile looks already handled (${state}). Closing and moving on.`);
      savePendingLinkedinJob(job);
      setTimeout(() => finishLinkedinStep("already-handled"), 800);
      return;
    }
    log("could not find the Connect button on this profile. Closing and moving on so the run does not get stuck.");
    savePendingLinkedinJob(job);
    setTimeout(() => finishLinkedinStep("connect-not-found"), 1200);
    return;
  }

  const nameFromConnect = inferProfileName();
  if (nameFromConnect && (!job.personName || /^unknown$/i.test(job.personName))) {
    job.personName = nameFromConnect;
    savePendingLinkedinJob(job);
    log(`using LinkedIn profile name: ${nameFromConnect}`);
  }

  await sleep(600);
  fireClick(connectEl);
  log("clicked Connect, waiting for the dialog...");
  await sleep(1200);

  const expectedBeforeModal = job.personName || nameFromConnect || earlyName || "";
  const nameFromInviteModal = inferProfileName();
  if (nameFromInviteModal && expectedBeforeModal && !namesLikelyMatch(nameFromInviteModal, expectedBeforeModal)) {
    log(`invite dialog is for ${nameFromInviteModal}, but expected ${expectedBeforeModal}. Closing this wrong dialog and moving on.`);
    const closeBtn = findByAriaLabel("Dismiss") || findByAriaLabel("Close") || findButtonByText("Cancel");
    if (closeBtn) fireClick(closeBtn);
    savePendingLinkedinJob(job);
    setTimeout(() => finishLinkedinStep("wrong-profile-dialog"), 800);
    return;
  }
  if (nameFromInviteModal && (!job.personName || /^unknown$/i.test(job.personName) || job.personName !== nameFromInviteModal)) {
    job.personName = nameFromInviteModal;
    savePendingLinkedinJob(job);
    log(`confirmed LinkedIn name: ${nameFromInviteModal}`);
  }

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
        finishLinkedinStep("sent");
      }, 1500);
    }
  }, 500);

  setTimeout(() => {
    clearInterval(interval);
    finishLinkedinStep("sent");
  }, 5 * 60 * 1000);
}

setTimeout(run, 1200);
