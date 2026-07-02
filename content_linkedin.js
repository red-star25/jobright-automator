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

// Small pauses so LinkedIn can finish rendering before we click the next control.
const LINKEDIN_TIMING = {
  profileMinLoadMs: 2000,
  settleMs: 1200,
  afterMenuMs: 800,
  afterConnectMs: 900,
  afterModalMs: 700,
  afterAddNoteMs: 1100,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let domSnapshot = null;

function refreshDomSnapshot() {
  domSnapshot = null;
}

// Waits until `check()` returns a truthy value. Uses MutationObserver so
// automation reacts as soon as LinkedIn renders the next dialog step.
async function waitFor(check, { timeout = 8000, interval = 300, root = document.documentElement || document } = {}) {
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
    await sleep(200);
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

function isPreloadInviteUrl() {
  const href = String(location.href || "").toLowerCase();
  const path = String(location.pathname || "").toLowerCase();
  return path.includes("/preload/custom-invite") ||
    href.includes("/preload/custom-invite") ||
    href.includes("custom-invite?");
}

function pageShowsInvitePrompt() {
  const parts = [
    document.body?.innerText,
    document.documentElement?.innerText,
  ];
  refreshDomSnapshot();
  for (const el of deepAll()) {
    if (!isElementVisible(el)) continue;
    const text = visibleText(el);
    if (!text || text.length > 400) continue;
    if (/add a note|send without a note|personalize your invitation/i.test(text)) {
      parts.push(text);
    }
  }
  const haystack = parts.filter(Boolean).join("\n").toLowerCase();
  return /add a note to your invitation|personalize your invitation to|included a note to your invitation|send without a note/i.test(haystack);
}

function isCustomInvitePage() {
  return isPreloadInviteUrl();
}

function pageShowsInvitePromptInDialog() {
  const root = findInviteRoot();
  if (!root) return false;
  const text = visibleText(root).toLowerCase();
  const hasInviteCopy = /add a note to your invitation|personalize your invitation to|included a note to your invitation/i.test(text);
  const hasInviteActions = !!findAddNoteButton(root) ||
    !!findClickableByTextMatch(root, /send without a note/i);
  return hasInviteCopy && hasInviteActions;
}

function isInviteFlowActive() {
  if (isPreloadInviteUrl()) {
    return inviteDialogReady() || pageShowsInvitePrompt() || pageShowsInvitePromptInDialog();
  }
  return inviteDialogReady() || pageShowsInvitePromptInDialog();
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
  return findInviteMessageInput(root);
}

function findInviteMessageInput(root) {
  const scope = root ? getAllElementsDeep(root) : deepAll();
  const byId = scope.find((el) => el.tagName === "TEXTAREA" && el.id === "custom-message");
  if (byId && isElementVisible(byId)) return byId;

  for (const el of scope) {
    if (!isElementVisible(el)) continue;
    if (el.tagName === "TEXTAREA") return el;
    const editable = el.isContentEditable || el.getAttribute("contenteditable") === "true";
    if (!editable) continue;
    const hint = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("placeholder") || ""} ${el.getAttribute("name") || ""}`.toLowerCase();
    if (/message|note|invitation|personalize|connect/.test(hint)) return el;
  }
  return null;
}

function findClickableByTextMatch(root, pattern) {
  const scope = root ? getAllElementsDeep(root) : deepAll();
  for (const el of scope) {
    if (!isElementVisible(el)) continue;
    const text = visibleText(el).toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (pattern.test(text) || pattern.test(aria)) {
      return resolveClickTarget(el) || el;
    }
  }
  return null;
}

function findAddNoteButton(root) {
  const scopes = [];
  if (root) scopes.push(root);
  const inviteRoot = findInviteRoot();
  if (inviteRoot && !scopes.includes(inviteRoot)) scopes.push(inviteRoot);
  if (!scopes.includes(document.documentElement)) scopes.push(document.documentElement);

  for (const scope of scopes) {
    const btn = findByAriaLabelInRoot("Add a note", scope) ||
      findClickableByTextMatch(scope, /^add a note$/i) ||
      findClickableByTextMatch(scope, /\badd a note\b/i);
    if (btn) return btn;
  }
  return findByAriaLabel("Add a note") || findButtonByText("Add a note");
}

function modalLooksLikeInvite(el) {
  if (!el || !isElementVisible(el)) return false;
  const text = visibleText(el).toLowerCase();
  return /add a note|send without a note|personalize your invitation|customize your invitation|included a note|write a message|invitation message|connect with a note|add a note to your invitation/i.test(text) ||
    !!findInviteMessageInput(el);
}

function findVisibleInviteModal() {
  refreshDomSnapshot();
  const candidates = [];

  for (const el of deepAll()) {
    if (!isElementVisible(el)) continue;
    const role = (el.getAttribute("role") || "").toLowerCase();
    const cls = (el.className || "").toString().toLowerCase();
    const isModalLike = (el.classList && el.classList.contains("artdeco-modal")) ||
      role === "dialog" ||
      /artdeco-modal|modal|send-invite|invite/.test(cls);
    if (!isModalLike) continue;
    if (modalLooksLikeInvite(el)) candidates.push(el);
  }

  if (!candidates.length) {
    const input = findInviteMessageInput();
    if (input) {
      let cur = input;
      for (let depth = 0; depth < 14 && cur; depth++) {
        if (isElementVisible(cur) && modalLooksLikeInvite(cur)) {
          candidates.push(cur);
          break;
        }
        cur = cur.parentElement;
      }
    }
  }

  if (!candidates.length && isCustomInvitePage()) {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog && modalLooksLikeInvite(dialog)) candidates.push(dialog);
    else if (modalLooksLikeInvite(document.body)) candidates.push(document.body);
  }

  candidates.sort((a, b) => {
    const aText = visibleText(a).toLowerCase();
    const bText = visibleText(b).toLowerCase();
    const aScore = /add a note|send without a note/i.test(aText) ? 0 : 1;
    const bScore = /add a note|send without a note/i.test(bText) ? 0 : 1;
    return aScore - bScore;
  });

  return candidates[0] || null;
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
  if (document.readyState !== "complete") return true;

  if (isInviteFlowActive()) return false;

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

function inviteDialogReady() {
  const modal = findInviteRoot();
  if (!modal) return pageShowsInvitePrompt() && !!findAddNoteButton();
  return !!(
    findInviteMessageInput(modal) ||
    findAddNoteButton(modal) ||
    findByAriaLabelInRoot("Send without a note", modal) ||
    findClickableByTextMatch(modal, /send without a note/i) ||
    (pageShowsInvitePrompt() && findAddNoteButton(modal))
  );
}

function isProfilePageReady(expectedName = "", job = null) {
  if (isPreloadInviteUrl()) return inviteDialogReady() || pageShowsInvitePrompt() || true;
  if (isInviteFlowActive()) return true;
  if (!/\/in\//i.test(location.pathname)) return false;
  if (job && !isOnExpectedProfile(job)) return false;
  if (isLinkedInPageLoading()) return false;

  const profileName = inferProfileName();
  if (!profileName && !findProfileNameElement()) return false;

  const resolvedName = expectedName || profileName || "";
  const connect = findConnectControl(resolvedName);
  const more = findProfileMoreButton();
  const skipState = findSkipConnectionState();
  return !!(connect || more || skipState);
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
  if (isUiChromeLabel(cleaned)) return false;
  if (/\b(mutual connection|connections|university|portfolio|contact info|followers?)\b/i.test(cleaned)) return false;
  if (/[|@]/.test(cleaned)) return false;
  return /^[A-Za-z][A-Za-z .'-]+$/.test(cleaned);
}

function isUiChromeLabel(name) {
  const cleaned = cleanPersonName(name);
  return /^(unknown|linkedin|profile|connect|message|more|follow|pending|contact info|ad options|options|settings|notifications|search|home|jobs|messaging|skip|cancel|close|dismiss|send|save|advertise|premium|business)$/i.test(cleaned) ||
    /\b(ad options|privacy policy|sign in|join now|learn more|see all|show more|get the app)\b/i.test(cleaned);
}

function nameFromLinkedInSlug(slug) {
  if (!slug) return "";
  let parts = slug.split("-").filter((p) => p && !/^\d+$/.test(p) && p.length > 1);
  const credentials = new Set(["shrm", "scp", "phd", "mba", "cpa", "rn", "md", "jd", "pe", "pmp", "cpnp", "ms", "ma", "bs", "ba"]);
  while (parts.length && /^[a-z0-9]{5,}$/i.test(parts[parts.length - 1])) {
    parts.pop();
  }
  while (parts.length > 2 && credentials.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }
  if (parts.length < 1 || parts.length > 5) return "";
  const name = parts
    .slice(0, 4)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
  return looksLikePersonName(name) ? name : "";
}

function mergePersonName(...candidates) {
  for (const candidate of candidates) {
    const cleaned = cleanPersonName(candidate);
    if (cleaned && looksLikePersonName(cleaned) && !isUiChromeLabel(cleaned)) return cleaned;
  }
  for (const candidate of candidates) {
    const cleaned = cleanPersonName(candidate);
    if (cleaned && !/^unknown$/i.test(cleaned) && !isUiChromeLabel(cleaned)) return cleaned;
  }
  return "Unknown";
}

function slugFromVanityParam() {
  const params = new URLSearchParams(location.search);
  return String(params.get("vanityName") || params.get("vanity") || "").trim().toLowerCase();
}

function currentLinkedInSlug() {
  const match = location.pathname.match(/\/in\/([^/?#]+)/i);
  if (match) return match[1].toLowerCase();
  return slugFromVanityParam();
}

function canonicalProfileUrl(job) {
  const stored = String(job?.profileUrl || "").trim();
  if (stored && /\/in\//i.test(stored)) {
    try {
      const parsed = new URL(stored);
      return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}/`;
    } catch (e) {
      return stored;
    }
  }
  const slug = currentLinkedInSlug();
  if (slug) return `https://www.linkedin.com/in/${slug}/`;
  if (stored && !/\/preload\//i.test(stored)) return stored;
  return stored || location.href;
}

function findInviteRoot() {
  const modal = findVisibleInviteModal();
  if (modal) return modal;
  if (isCustomInvitePage() || pageShowsInvitePrompt()) {
    return document.querySelector('[role="dialog"]') ||
      document.querySelector("main") ||
      document.body ||
      document.documentElement;
  }
  return null;
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

  // Older LinkedIn UI usually has the profile name in the main h1/h2 inside the top card.
  const topCard = getTopCardRoot();
  for (const el of getAllElementsDeep(topCard)) {
    if (el.tagName !== "H1" && el.tagName !== "H2") continue;
    const name = cleanPersonName(visibleText(el));
    if (looksLikePersonName(name)) return name;
  }

  // The invite modal often says: Personalize your invitation to <strong>Name</strong>...
  const modal = findVisibleInviteModal();
  if (modal) {
    for (const el of getAllElementsDeep(modal)) {
      if (el.tagName !== "STRONG") continue;
      const name = cleanPersonName(visibleText(el));
      if (looksLikePersonName(name)) return name;
    }
  }

  // The direct Connect button often has aria-label="Invite Name to connect".
  for (const el of getAllElementsDeep(getTopCardRoot())) {
    const aria = el.getAttribute ? (el.getAttribute("aria-label") || "") : "";
    const match = aria.match(/Invite\s+(.+?)\s+to connect/i);
    if (match) {
      const name = cleanPersonName(match[1]);
      if (looksLikePersonName(name)) return name;
    }
  }

  return "";
}

function inferInviteModalPersonName(modal) {
  if (!modal) return "";

  const text = visibleText(modal);
  const patterns = [
    /personalize your invitation to\s+(.+?)(?:[.!?\n]|$)/i,
    /included a note to\s+(.+?)(?:[.!?\n]|$)/i,
    /invitation to\s+(.+?)(?:[.!?\n]|$)/i,
    /connect with\s+(.+?)(?:[?.\n]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const name = cleanPersonName(match[1]);
      if (looksLikePersonName(name)) return name;
    }
  }

  for (const el of getAllElementsDeep(modal)) {
    if (el.tagName !== "STRONG" && el.tagName !== "H1" && el.tagName !== "H2") continue;
    const name = cleanPersonName(visibleText(el));
    if (looksLikePersonName(name)) return name;
  }

  for (const el of getAllElementsDeep(modal)) {
    const aria = el.getAttribute ? (el.getAttribute("aria-label") || "") : "";
    const match = aria.match(/Invite\s+(.+?)\s+to connect/i);
    if (match) {
      const name = cleanPersonName(match[1]);
      if (looksLikePersonName(name)) return name;
    }
  }

  return "";
}

function resolveJobPersonName(job) {
  const slug = currentLinkedInSlug();
  return mergePersonName(
    job?.personName,
    inferProfileName(),
    nameFromLinkedInSlug(slug)
  );
}

function findSkipConnectionState() {
  const state = findProfileConnectionState();
  if (/^(pending|connected)$/i.test(String(state || "").trim())) return state;
  return "";
}

function finishAlreadyHandled(job, state, logStep) {
  logStep(`profile already handled (${state}). Closing tab and moving on.`);
  savePendingLinkedinJob(job);
  skipLinkedinStep("already-handled");
}

function savePendingLinkedinJob(job) {
  chrome.storage.local.set({
    pendingLinkedinJob: {
      ...job,
      personName: resolveJobPersonName(job),
      profileUrl: canonicalProfileUrl(job),
    },
  });
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

function isNearElement(el, anchor, maxDistance = 320) {
  const a = elementRect(anchor);
  const b = elementRect(el);
  if (!a || !b) return false;
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;
  return Math.hypot(ax - bx, ay - by) <= maxDistance;
}

function isWithinTopCard(el) {
  const topCard = getTopCardRoot();
  const cardRect = elementRect(topCard);
  const elRect = elementRect(el);
  if (!cardRect || !elRect) return false;
  return elRect.top >= cardRect.top - 30 &&
    elRect.bottom <= cardRect.bottom + 140 &&
    elRect.left >= cardRect.left - 60 &&
    elRect.right <= cardRect.right + 60;
}

function scoreConnectCandidate(el, expectedName, moreBtn, inviteName) {
  let score = 100;
  if (inviteName && expectedName && namesLikelyMatch(inviteName, expectedName)) score -= 60;
  else if (inviteName && expectedName) score += 200;
  if (isWithinTopCard(el)) score -= 25;
  if (moreBtn && isNearElement(el, moreBtn, 360)) score -= 40;
  if (isInsideRecommendationRail(el)) score += 300;
  const rect = elementRect(el);
  if (rect && rect.left > window.innerWidth * 0.68) score += 120;
  return score;
}

function collectConnectCandidates(expectedName = "", moreBtn = null) {
  const candidates = [];
  const seen = new Set();

  const consider = (el, source) => {
    if (!el || seen.has(el)) return;
    if (!isClickable(el) || !isElementVisible(el)) return;
    if (isInsideRecommendationRail(el)) return;
    const text = visibleText(el).toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (el.getAttribute("aria-disabled") === "true" || el.disabled) return;
    if (!(text === "connect" || aria.includes("to connect") || (text === "connect" && !aria.includes("disconnect")))) return;

    const inviteName = parseInviteNameFromAria(el);
    if (inviteName && expectedName && !namesLikelyMatch(inviteName, expectedName)) return;

    // Menu connects often have no invite aria — require them to be near More or inside the top card.
    if (!inviteName && moreBtn && !isNearElement(el, moreBtn, 360) && !isWithinTopCard(el)) return;
    if (!inviteName && !moreBtn && !isWithinTopCard(el)) return;

    seen.add(el);
    candidates.push({
      el,
      inviteName,
      score: scoreConnectCandidate(el, expectedName, moreBtn, inviteName),
      source,
    });
  };

  const scopedRoot = getScopedProfileRoot();
  for (const el of getAllElementsDeep(scopedRoot)) {
    if (isValidConnectCandidate(el, expectedName)) consider(el, "scoped");
  }

  const all = deepAll();
  for (const root of all.filter(isOpenMenuOrPopoverRoot)) {
    if (isInsideRecommendationRail(root)) continue;
    for (const el of getAllElementsDeep(root)) {
      if (isValidConnectCandidate(el, expectedName) || (moreBtn && isNearElement(el, moreBtn, 360))) {
        consider(el, "menu");
      }
    }
  }

  if (moreBtn) {
    for (const el of all) {
      if (isNearElement(el, moreBtn, 360)) consider(el, "near-more");
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates;
}

function findConnectInOpenMenu(expectedName = "", moreBtn = null) {
  const candidates = collectConnectCandidates(expectedName, moreBtn);
  const best = candidates[0];
  if (best) {
    log("selected Connect candidate", {
      expectedName,
      inviteName: best.inviteName || "",
      source: best.source,
      score: best.score,
    });
  }
  return best ? best.el : null;
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
    if (!isWithinTopCard(el)) continue;
    if (isValidConnectCandidate(el, expectedName)) return el;
  }
  return null;
}

function findProfileConnectionState() {
  const root = getTopCardRoot();
  let sawMessage = false;

  for (const el of getAllElementsDeep(root)) {
    if (!isElementVisible(el)) continue;
    const componentKey = (el.getAttribute("componentkey") || "").toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const text = visibleText(el).trim().toLowerCase();

    if (/_pending\b|pending:/i.test(componentKey)) return "pending";
    if (/withdraw invitation/.test(aria) || /^pending,/.test(aria)) return "pending";
    if (text === "pending" || (/\bpending\b/.test(aria) && isClickable(el))) return "pending";

    if (text === "connected" || (/\bconnected\b/.test(aria) && isClickable(el))) return "connected";
    if ((text === "message" || /\bmessage\b/.test(aria)) && isClickable(el)) sawMessage = true;
  }

  return sawMessage ? "message" : "";
}

function findAlreadyHandledSignal() {
  return findProfileConnectionState();
}

function findProfilePendingSignal() {
  return findProfileConnectionState() === "pending";
}

function isLikelySendInvitationButton(el) {
  if (!el || !isClickable(el) || !isElementVisible(el)) return false;
  const text = visibleText(el).toLowerCase();
  const aria = (el.getAttribute("aria-label") || "").toLowerCase();
  return text === "send" || /send invitation|send now|send invite/.test(aria);
}

function findSendInvitationButton(root) {
  const scope = root ? getAllElementsDeep(root) : deepAll();
  for (const el of scope) {
    if (isLikelySendInvitationButton(el)) return el;
  }
  return null;
}

let sendWatchActive = false;

function finishLinkedinStep(reason = "sent") {
  chrome.runtime.sendMessage({ type: "LINKEDIN_SEND_DETECTED", reason });
}

function skipLinkedinStep(reason = "skipped") {
  chrome.runtime.sendMessage({ type: "LINKEDIN_STEP_SKIPPED", reason });
}

function handOffToUser(job, message, { inviteUiSeen = false } = {}) {
  log(`${job.personName || "LinkedIn"}: ${message}`);
  savePendingLinkedinJob(job);
  watchForSend({ inviteUiSeen });
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

function setMessageValue(el, value) {
  if (!el) return;
  if (el.tagName === "TEXTAREA") {
    setFrameworkValue(el, value);
    return;
  }
  if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
    try { el.focus(); } catch (e) {}
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function resolveClickTarget(el) {
  if (!el) return null;
  if (isClickable(el)) return el;
  const closest = el.closest && el.closest('button, [role="button"], a');
  return closest || el;
}

async function clickAddNoteButton(root) {
  const btn = findAddNoteButton(root);
  if (!btn) return false;
  const target = resolveClickTarget(btn);
  fireClick(target);
  await sleep(LINKEDIN_TIMING.afterAddNoteMs);
  if (!findInviteMessageInput(findInviteRoot() || root)) {
    fireClick(target);
    await sleep(LINKEDIN_TIMING.afterAddNoteMs);
  }
  return true;
}

async function ensureInviteNoteBox(modalRoot, logStep) {
  let input = findInviteMessageInput(modalRoot || findInviteRoot());
  if (input) return input;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const root = findInviteRoot() || modalRoot;
    if (!root) {
      logStep(`invite dialog not visible (attempt ${attempt}/4).`);
      await sleep(700);
      continue;
    }

    input = findInviteMessageInput(root);
    if (input) return input;

    const addNoteBtn = findAddNoteButton(root);
    if (!addNoteBtn) {
      logStep(`Add a note button not found (attempt ${attempt}/4).`);
      await sleep(700);
      continue;
    }

    logStep(`clicking Add a note (attempt ${attempt}/4)...`);
    await clickAddNoteButton(root);
    input = await waitFor(
      () => findInviteMessageInput(findInviteRoot() || root),
      { timeout: 10000 }
    );
    if (input) return input;
  }

  return null;
}

async function completeInviteModalFlow(job, logStep, { nameHint = "" } = {}) {
  let modalRoot = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const inviteModal = await waitFor(inviteDialogReady, { timeout: 16000 });
    if (!inviteModal) {
      logStep("invite dialog did not open. Finish manually and click Send when ready.");
      handOffToUser(job, "Invite dialog did not open automatically — complete the steps and click Send.");
      return;
    }

    await sleep(LINKEDIN_TIMING.afterModalMs);
    modalRoot = findInviteRoot();
    const expectedBeforeModal = mergePersonName(
      job.personName,
      nameHint,
      nameFromLinkedInSlug(currentLinkedInSlug())
    );
    const nameFromInviteModal = inferInviteModalPersonName(modalRoot);

    if (nameFromInviteModal && expectedBeforeModal && !namesLikelyMatch(nameFromInviteModal, expectedBeforeModal)) {
      logStep(`invite dialog is for ${nameFromInviteModal}, but expected ${expectedBeforeModal}.`);
      if (attempt === 1 && !isCustomInvitePage()) {
        logStep("closing the wrong dialog and retrying Connect once...");
        const closeBtn = findByAriaLabel("Dismiss") || findByAriaLabel("Close") || findButtonByText("Cancel");
        if (closeBtn) fireClick(closeBtn);
        return "retry-connect";
      }
      logStep("wrong invite dialog detected. Finish manually and click Send when ready.");
      const closeBtn = findByAriaLabel("Dismiss") || findByAriaLabel("Close") || findButtonByText("Cancel");
      if (closeBtn) fireClick(closeBtn);
      handOffToUser(job, "Wrong invite dialog detected — complete the correct profile manually and click Send.");
      return;
    }

    if (nameFromInviteModal) {
      job.personName = mergePersonName(job.personName, nameFromInviteModal, nameHint, nameFromLinkedInSlug(currentLinkedInSlug()));
      savePendingLinkedinJob(job);
      logStep(`confirmed invite dialog for ${job.personName}.`);
    }
    break;
  }

  if (!modalRoot) modalRoot = findInviteRoot();

  let textarea = await ensureInviteNoteBox(modalRoot, logStep);
  logStep(textarea ? "found the note box." : "no note box appeared.");
  if (!textarea) {
    refreshDomSnapshot();
    const total = deepAll().length;
    logStep(`connect dialog opened but no note box appeared (scanned ${total} elements total). Paste the note manually and click Send.`);
    handOffToUser(job, "Note box did not appear automatically — add your note and click Send.", { inviteUiSeen: true });
    return;
  }

  setMessageValue(textarea, job.note);
  logStep("note pasted in, review it and click Send, this tab will close on its own a couple seconds after you do.");
  watchForSend({ inviteUiSeen: true });
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
    await sleep(LINKEDIN_TIMING.settleMs);
  }

  // Jobright row scraping can sometimes pass "Unknown". Prefer the LinkedIn
  // page itself, and keep updating again after the invite modal opens because
  // LinkedIn often renders the real name there before the profile h1 is stable.
  // Keep the canonical /in/ profile URL even if LinkedIn navigates to /preload/custom-invite/.
  job.profileUrl = canonicalProfileUrl(job);
  job.personName = resolveJobPersonName(job);
  savePendingLinkedinJob(job);

  const logStep = (text) => log(`${job.personName}: ${text}`);

  if (isPreloadInviteUrl()) {
    logStep(`custom invite URL detected (${location.pathname}) — continuing the note flow...`);
    await sleep(LINKEDIN_TIMING.profileMinLoadMs);
    await completeInviteModalFlow(job, logStep);
    return;
  }

  if (isInviteFlowActive()) {
    logStep("invite prompt detected — continuing the note flow...");
    await sleep(LINKEDIN_TIMING.profileMinLoadMs);
    await completeInviteModalFlow(job, logStep);
    return;
  }

  logStep("waiting for the profile page to finish loading...");
  const profileReady = await waitFor(
    () => isProfilePageReady(job.personName || inferProfileName(), job),
    { timeout: 25000 }
  );
  if (!profileReady) {
    if (isPreloadInviteUrl() || isInviteFlowActive()) {
      logStep("invite step detected after profile wait — continuing the note flow...");
      await completeInviteModalFlow(job, logStep);
      return;
    }
    logStep("profile page did not finish loading in time. Complete the invite manually and click Send.");
    handOffToUser(job, "Profile still loading — finish Connect and Send manually when ready.");
    return;
  }

  logStep("profile detected, waiting for the page to settle...");
  await sleep(LINKEDIN_TIMING.profileMinLoadMs);

  if (isInviteFlowActive()) {
    logStep("invite prompt already open — continuing the note flow...");
    await completeInviteModalFlow(job, logStep);
    return;
  }

  const existingState = findSkipConnectionState();
  if (existingState) {
    finishAlreadyHandled(job, existingState, logStep);
    return;
  }

  logStep("profile loaded, looking for the Connect button...");
  const expectedName = job.personName || nameFromLinkedInSlug(currentLinkedInSlug()) || "";
  let connectEl = findConnectControl(expectedName);
  let profileMoreBtn = null;
  logStep(connectEl ? "found Connect directly." : "did not find Connect directly, checking the More menu...");

  if (!connectEl) {
    profileMoreBtn = await waitFor(findProfileMoreButton, { timeout: 7000 });
    logStep(profileMoreBtn ? "found the More button, opening it." : "could not find a More button either.");
    if (profileMoreBtn) {
      fireClick(profileMoreBtn);
      await sleep(LINKEDIN_TIMING.afterMenuMs);
      connectEl = await waitFor(
        () => findConnectInOpenMenu(expectedName, profileMoreBtn) || findConnectControl(expectedName),
        { timeout: 8000 }
      );
      logStep(connectEl ? "found Connect inside the More menu." : "still no Connect option inside the More menu.");
    }
  }

  if (!connectEl) {
    const state = findSkipConnectionState();
    if (state) {
      finishAlreadyHandled(job, state, logStep);
      return;
    }
    logStep("could not find the Connect button on this profile. Finish manually and click Send when ready.");
    handOffToUser(job, "Connect was not found automatically — click Connect yourself, then Send.");
    return;
  }

  const nameFromConnect = inferProfileName();
  const resolvedBeforeConnect = mergePersonName(job.personName, nameFromConnect, nameFromLinkedInSlug(currentLinkedInSlug()));
  if (resolvedBeforeConnect !== job.personName) {
    job.personName = resolvedBeforeConnect;
    savePendingLinkedinJob(job);
    logStep(`using LinkedIn profile name: ${resolvedBeforeConnect}`);
  }

  await sleep(LINKEDIN_TIMING.settleMs / 2);
  fireClick(connectEl);
  await sleep(LINKEDIN_TIMING.afterConnectMs);
  logStep("clicked Connect, waiting for the invite dialog...");

  if (isCustomInvitePage() || /\/preload\/custom-invite/i.test(location.href)) {
    logStep("LinkedIn navigated to the custom invite page after Connect.");
    await sleep(LINKEDIN_TIMING.profileMinLoadMs);
    await completeInviteModalFlow(job, logStep, { nameHint: nameFromConnect });
    return;
  }

  const flowResult = await completeInviteModalFlow(job, logStep, { nameHint: nameFromConnect });
  if (flowResult === "retry-connect") {
    await sleep(LINKEDIN_TIMING.settleMs);
    connectEl = findConnectControl(job.personName);
    if (!connectEl) {
      const moreBtn = profileMoreBtn || findProfileMoreButton();
      if (moreBtn) {
        fireClick(moreBtn);
        await sleep(LINKEDIN_TIMING.afterMenuMs);
        connectEl = findConnectInOpenMenu(job.personName, moreBtn);
      }
    }
    if (!connectEl) {
      logStep("could not find a safer Connect button on retry.");
      handOffToUser(job, "Connect was not found on retry — finish manually and click Send.");
      return;
    }
    fireClick(connectEl);
    await sleep(LINKEDIN_TIMING.afterConnectMs);
    logStep("retrying Connect, waiting for the invite dialog again...");
    if (isCustomInvitePage()) {
      await sleep(LINKEDIN_TIMING.profileMinLoadMs);
    }
    await completeInviteModalFlow(job, logStep, { nameHint: nameFromConnect });
  }
}

function hasVisibleInviteUi() {
  refreshDomSnapshot();
  const modal = findInviteRoot();
  if (modal && isElementVisible(modal)) return true;
  const input = findInviteMessageInput(modal || undefined);
  if (input && isElementVisible(input)) return true;
  if (findSendInvitationButton(modal || undefined)) return true;
  return !!findAddNoteButton(modal || undefined);
}

function hasStrictSentToast() {
  refreshDomSnapshot();
  for (const el of deepAll()) {
    if (!isElementVisible(el)) continue;
    const text = (el.innerText || "").trim();
    if (!text || text.length > 120) continue;
    if (/invitation sent|invite sent/i.test(text) && text.length < 80) return true;
  }
  return false;
}

function isSendComplete({ sendClicked = false } = {}) {
  if (hasStrictSentToast()) return true;
  if (!sendClicked) return false;
  if (hasVisibleInviteUi()) return false;
  return findProfilePendingSignal();
}

function watchForSend({ inviteUiSeen = false } = {}) {
  if (sendWatchActive) return;
  sendWatchActive = true;

  let sendClicked = false;

  let observer = null;
  let pollTimer = null;
  let timeoutTimer = null;
  let clickListener = null;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    sendWatchActive = false;
    if (observer) observer.disconnect();
    if (pollTimer) clearInterval(pollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (clickListener) {
      document.removeEventListener("click", clickListener, true);
      clickListener = null;
    }
    setTimeout(() => finishLinkedinStep("sent"), 800);
  };

  const test = () => {
    if (isSendComplete({ sendClicked })) finish();
  };

  clickListener = (event) => {
    if (!event.isTrusted) return;
    let el = event.target;
    while (el && el !== document.documentElement) {
      if (isLikelySendInvitationButton(el)) {
        sendClicked = true;
        log("Send click detected, waiting for LinkedIn to finish sending...");
        setTimeout(test, 1500);
        setTimeout(test, 3000);
        setTimeout(test, 5000);
        return;
      }
      el = el.parentElement;
    }
  };
  document.addEventListener("click", clickListener, true);

  observer = new MutationObserver(test);
  observer.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, characterData: true });
  pollTimer = setInterval(test, 400);
  timeoutTimer = setTimeout(() => {
    if (finished) return;
    log("Still waiting for you to click Send on LinkedIn.");
  }, 5 * 60 * 1000);
}

run();
