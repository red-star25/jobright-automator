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

function log(...args) {
  console.log("[InsiderReach]", ...args);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let domSnapshot = null;

function refreshDomSnapshot() {
  domSnapshot = null;
}

// Waits until `check()` returns a truthy value. Uses MutationObserver so
// automation reacts as soon as LinkedIn renders the next dialog step.
async function waitFor(check, { timeout = 8000, interval = 200, root = document.documentElement || document } = {}) {
  refreshDomSnapshot();
  const immediate = check();
  if (immediate) return immediate;

  return new Promise((resolve) => {
    let done = false;
    let observer = null;
    let pollTimer = null;
    let timeoutTimer = null;

    const finish = (value) => {
      if (done) return;
      done = true;
      if (observer) observer.disconnect();
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve(value || null);
    };

    const test = () => {
      try {
        refreshDomSnapshot();
        const result = check();
        if (result) finish(result);
      } catch (err) {
        log("waitFor check failed", err?.message || String(err));
      }
    };

    if (root) {
      observer = new MutationObserver(test);
      observer.observe(root, { childList: true, subtree: true, attributes: true });
    }
    pollTimer = setInterval(test, interval);
    timeoutTimer = setTimeout(() => finish(null), timeout);
  });
}

async function waitForAutomationReady(job) {
  if (job.automationReady !== false) return job;

  const start = Date.now();
  while (Date.now() - start < 120000) {
    const data = await new Promise((resolve) => chrome.storage.local.get(["pendingLinkedinJob"], resolve));
    const pending = data.pendingLinkedinJob;
    if (pending && pending.runId === job.runId && pending.automationReady !== false) {
      return { ...job, ...pending };
    }
    await sleep(150);
  }
  return job;
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
  if (domSnapshot) return domSnapshot;
  domSnapshot = getAllElementsDeep(document.documentElement || document);
  return domSnapshot;
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

function findTextareaDeep(root) {
  const scope = root ? getAllElementsDeep(root) : deepAll();
  return scope.find((el) => el.tagName === "TEXTAREA" && el.id === "custom-message") ||
    scope.find((el) => el.tagName === "TEXTAREA") ||
    null;
}

function findByAriaLabelInRoot(label, root) {
  const scope = root ? getAllElementsDeep(root) : deepAll();
  for (const el of scope) {
    if ((el.getAttribute("aria-label") || "") === label) return el;
  }
  return null;
}

function findButtonByTextInRoot(text, root, options = {}) {
  const scope = root ? getAllElementsDeep(root) : deepAll();
  for (const el of scope) {
    if (!isClickable(el)) continue;
    if (options.excludeRecommendations && isInsideRecommendationRail(el)) continue;
    if (visibleText(el).toLowerCase() === text.toLowerCase()) return el;
  }
  return null;
}

function isLinkedInPageLoading() {
  if (document.readyState === "loading") return true;

  const loader = document.querySelector(".artdeco-loader, .artdeco-loading, [data-test-loader]");
  if (loader && isElementVisible(loader)) return true;

  const main = document.querySelector("main");
  if (main && main.getAttribute("aria-busy") === "true") return true;

  // LinkedIn often paints action buttons before the profile name is stable.
  const hasProfileChrome = !!getTopCardRoot() && !!findProfileNameElement();
  const hasActions = !!findConnectControl() || !!findProfileMoreButton() || !!findAlreadyHandledSignal();
  if (!hasProfileChrome && !hasActions) return true;

  return false;
}

function isOnExpectedProfile(job) {
  if (!job || !job.profileUrl || !/\/in\//i.test(job.profileUrl)) return true;
  const expectedMatch = job.profileUrl.match(/\/in\/([^/?#]+)/i);
  const currentSlug = currentLinkedInSlug();
  if (!expectedMatch || !currentSlug) return true;
  return expectedMatch[1].toLowerCase() === currentSlug;
}

function findVisibleInviteModal() {
  refreshDomSnapshot();
  const modals = deepAll().filter((el) =>
    el.classList &&
    el.classList.contains("artdeco-modal") &&
    isElementVisible(el)
  );
  return modals.find((modal) => {
    const text = visibleText(modal).toLowerCase();
    return /add a note|send without a note|personalize your invitation|invitation/i.test(text) ||
      !!findTextareaDeep(modal);
  }) || modals[0] || null;
}

function isProfilePageReady(expectedName = "", job = null) {
  if (!/\/in\//i.test(location.pathname)) return false;
  if (job && !isOnExpectedProfile(job)) return false;
  if (isLinkedInPageLoading()) return false;

  const profileName = inferProfileName();
  if (!profileName && !findProfileNameElement()) return false;

  const resolvedName = expectedName || profileName || "";
  const connect = findConnectControl(resolvedName);
  const more = findProfileMoreButton();
  const handled = findAlreadyHandledSignal();
  return !!(connect || more || handled);
}

function inviteDialogReady() {
  const modal = findVisibleInviteModal();
  if (!modal) return false;
  return !!(
    findTextareaDeep(modal) ||
    findByAriaLabelInRoot("Add a note", modal) ||
    findButtonByTextInRoot("Add a note", modal) ||
    findByAriaLabelInRoot("Send without a note", modal) ||
    findButtonByTextInRoot("Send without a note", modal)
  );
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
    log("ignoring Connect button for a different profile", { expectedName, inviteName });
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
  refreshDomSnapshot();
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
  refreshDomSnapshot();
}

function setFrameworkValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function run() {
  log("LinkedIn script started, checking for a pending job...");
  let job = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_PENDING_LINKEDIN_JOB" }, resolve);
  });
  if (!job || !job.note) {
    log("no pending LinkedIn job found for this page.");
    return;
  }

  if (job.automationReady === false) {
    log("profile pre-loaded, waiting for note review to finish...");
    job = await waitForAutomationReady(job);
  }

  // Jobright row scraping can sometimes pass "Unknown". Prefer the LinkedIn
  // page itself, and keep updating again after the invite modal opens because
  // LinkedIn often renders the real name there before the profile h1 is stable.
  job.profileUrl = location.href;
  const earlyName = inferProfileName();
  if (earlyName) job.personName = earlyName;
  savePendingLinkedinJob(job);

  const logStep = (text) => log(`${job.personName}: ${text}`);

  logStep("waiting for the profile page to finish loading...");
  const profileReady = await waitFor(
    () => isProfilePageReady(job.personName || inferProfileName(), job),
    { timeout: 25000 }
  );
  if (!profileReady) {
    logStep("profile page did not finish loading in time. Closing and moving on.");
    savePendingLinkedinJob(job);
    setTimeout(() => finishLinkedinStep("profile-not-ready"), 600);
    return;
  }

  logStep("profile loaded, looking for the Connect button...");
  let connectEl = findConnectControl(job.personName || inferProfileName());
  logStep(connectEl ? "found Connect directly." : "did not find Connect directly, checking the More menu...");

  if (!connectEl) {
    const moreBtn = await waitFor(findProfileMoreButton, { timeout: 4000 });
    logStep(moreBtn ? "found the More button, opening it." : "could not find a More button either.");
    if (moreBtn) {
      fireClick(moreBtn);
      connectEl = await waitFor(
        () => findConnectInOpenMenu(job.personName || inferProfileName()) || findConnectControl(job.personName || inferProfileName()),
        { timeout: 5000 }
      );
      logStep(connectEl ? "found Connect inside the More menu." : "still no Connect option inside the More menu.");
    }
  }

  if (!connectEl) {
    const state = findAlreadyHandledSignal();
    if (state) {
      logStep(`no Connect button found; profile looks already handled (${state}). Closing and moving on.`);
      savePendingLinkedinJob(job);
      setTimeout(() => finishLinkedinStep("already-handled"), 400);
      return;
    }
    logStep("could not find the Connect button on this profile. Closing and moving on so the run does not get stuck.");
    savePendingLinkedinJob(job);
    setTimeout(() => finishLinkedinStep("connect-not-found"), 600);
    return;
  }

  const nameFromConnect = inferProfileName();
  if (nameFromConnect && (!job.personName || /^unknown$/i.test(job.personName))) {
    job.personName = nameFromConnect;
    savePendingLinkedinJob(job);
    logStep(`using LinkedIn profile name: ${nameFromConnect}`);
  }

  fireClick(connectEl);
  logStep("clicked Connect, waiting for the invite dialog...");
  const inviteModal = await waitFor(inviteDialogReady, { timeout: 12000 });
  if (!inviteModal) {
    logStep("invite dialog did not open after clicking Connect. Closing and moving on.");
    savePendingLinkedinJob(job);
    setTimeout(() => finishLinkedinStep("invite-dialog-timeout"), 600);
    return;
  }

  const modalRoot = findVisibleInviteModal();

  const expectedBeforeModal = job.personName || nameFromConnect || earlyName || "";
  const nameFromInviteModal = inferProfileName();
  if (nameFromInviteModal && expectedBeforeModal && !namesLikelyMatch(nameFromInviteModal, expectedBeforeModal)) {
    logStep(`invite dialog is for ${nameFromInviteModal}, but expected ${expectedBeforeModal}. Closing this wrong dialog and moving on.`);
    const closeBtn = findByAriaLabel("Dismiss") || findByAriaLabel("Close") || findButtonByText("Cancel");
    if (closeBtn) fireClick(closeBtn);
    savePendingLinkedinJob(job);
    setTimeout(() => finishLinkedinStep("wrong-profile-dialog"), 400);
    return;
  }
  if (nameFromInviteModal && (!job.personName || /^unknown$/i.test(job.personName) || job.personName !== nameFromInviteModal)) {
    job.personName = nameFromInviteModal;
    savePendingLinkedinJob(job);
    logStep(`confirmed LinkedIn name: ${nameFromInviteModal}`);
  }

  let textarea = modalRoot ? findTextareaDeep(modalRoot) : findTextareaDeep();
  if (!textarea) {
    const addNoteBtn = modalRoot
      ? (findByAriaLabelInRoot("Add a note", modalRoot) || findButtonByTextInRoot("Add a note", modalRoot))
      : (findByAriaLabel("Add a note") || findButtonByText("Add a note"));
    logStep(addNoteBtn ? "found Add a note, clicking it." : "no Add a note button showed up, maybe it skipped straight to the note box.");
    if (addNoteBtn) {
      fireClick(addNoteBtn);
      textarea = await waitFor(
        () => (modalRoot ? findTextareaDeep(findVisibleInviteModal() || modalRoot) : findTextareaDeep()),
        { timeout: 8000 }
      );
      if (!textarea) {
        logStep("note box did not appear after Add a note, retrying once...");
        fireClick(addNoteBtn);
        textarea = await waitFor(
          () => (modalRoot ? findTextareaDeep(findVisibleInviteModal() || modalRoot) : findTextareaDeep()),
          { timeout: 8000 }
        );
      }
    }
  } else {
    logStep("note box already visible, skipping Add a note.");
  }

  logStep(textarea ? "found the note box." : "no note box appeared.");
  if (!textarea) {
    refreshDomSnapshot();
    const total = deepAll().length;
    logStep(`connect dialog opened but no note box appeared (scanned ${total} elements total). Closing and moving on.`);
    savePendingLinkedinJob(job);
    setTimeout(() => finishLinkedinStep("note-box-timeout"), 600);
    return;
  }

  setFrameworkValue(textarea, job.note);
  logStep("note pasted in, review it and click Send, this tab will close on its own a couple seconds after you do.");
  watchForSend();
}

function isSendComplete() {
  refreshDomSnapshot();
  const all = deepAll();
  const dialogGone = !all.some((el) => el.id === "custom-message") &&
    !all.some((el) => el.classList && el.classList.contains("artdeco-modal"));
  const sentToast = all.some((el) => /invitation sent|invite sent/i.test(el.textContent || ""));
  return dialogGone || sentToast;
}

function watchForSend() {
  if (isSendComplete()) {
    setTimeout(() => finishLinkedinStep("sent"), 800);
    return;
  }

  let observer = null;
  let pollTimer = null;
  let timeoutTimer = null;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    if (observer) observer.disconnect();
    if (pollTimer) clearInterval(pollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    setTimeout(() => finishLinkedinStep("sent"), 800);
  };

  const test = () => {
    if (isSendComplete()) finish();
  };

  observer = new MutationObserver(test);
  observer.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, characterData: true });
  pollTimer = setInterval(test, 250);
  timeoutTimer = setTimeout(finish, 5 * 60 * 1000);
}

run();
