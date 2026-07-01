// background.js
// Acts as the message hub. Content scripts cannot talk to each other directly,
// so they all send messages here, and this script opens tabs / stores data
// so the next tab knows what to do when it loads. It also keeps the
// outreach log, the record of everyone contacted, used for stats and for
// skipping people already reached out to.


function cleanAiText(text) {
  return String(text || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}



async function callOpenAiChat(apiKey, requestBody) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  let json = null;
  try {
    json = await response.json();
  } catch (_) {
    // Leave json as null; handled below.
  }

  if (!response.ok) {
    const message = json?.error?.message || `OpenAI request failed with status ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.response = json;
    throw err;
  }

  return json || {};
}

// Backwards-compatible alias in case any older code path calls this spelling.
const callOpenAIChat = callOpenAiChat;

function containsUnsupportedPlaceholder(text) {
  const value = String(text || "");
  return /\b(?:XYZ\s*(?:Corp|Inc|Company)?|ABC\s*(?:Corp|Inc|Company)?|Acme\s*(?:Corp|Inc|Company)?|Example\s*(?:Corp|Inc|Company)?|Company\s*Name|Project\s*Name)\b/i.test(value);
}

function simpleHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function debugConsole(enabled, ...args) {
  if (enabled) console.log(...args);
}

function warnConsole(enabled, ...args) {
  if (enabled) console.warn(...args);
}

function errorConsole(enabled, ...args) {
  if (enabled) console.error(...args);
}

function buildAiCacheKey({ mode, channel, tone, originalText, job, resumeText, customInstructions, userName }) {
  const normalized = {
    mode,
    channel,
    tone,
    originalText: cleanAiText(originalText),
    personName: cleanAiText(job.personName || ""),
    company: cleanAiText(job.company || ""),
    jobTitle: cleanAiText(job.jobTitle || ""),
    category: cleanAiText(job.category || ""),
    responsibilities: job.responsibilities || [],
    requiredQualifications: job.requiredQualifications || [],
    preferredQualifications: job.preferredQualifications || [],
    matchedSkills: job.matchedSkills || [],
    resumeHash: mode === "pro" ? simpleHash(cleanAiText(resumeText || "")) : "",
    customInstructions: cleanAiText(customInstructions || ""),
    userName: cleanAiText(userName || ""),
  };
  return "ai::" + simpleHash(JSON.stringify(normalized));
}

function getCachedAiResponse(cacheKey) {
  return new Promise((resolve) => {
    chrome.storage.local.get("aiResponseCache", (data) => {
      const cache = data.aiResponseCache || {};
      const hit = cache[cacheKey];
      if (hit && Date.now() - (hit.createdAt || 0) < 1000 * 60 * 60 * 24 * 14) {
        resolve(hit.response || null);
      } else {
        resolve(null);
      }
    });
  });
}

function setCachedAiResponse(cacheKey, response) {
  chrome.storage.local.get("aiResponseCache", (data) => {
    const cache = data.aiResponseCache || {};
    cache[cacheKey] = { createdAt: Date.now(), response };
    const entries = Object.entries(cache).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0)).slice(0, 250);
    chrome.storage.local.set({ aiResponseCache: Object.fromEntries(entries) });
  });
}

function aiTextLooksReadable(text) {
  const sample = cleanAiText(text);
  if (sample.length < 250) return false;
  const englishWords = sample.match(/\b[A-Za-z][A-Za-z+.#-]{2,}\b/g) || [];
  if (englishWords.length < 45) return false;
  const readableChars = sample.match(/[A-Za-z0-9\s.,;:()@/+&_'’\-#]/g) || [];
  if ((readableChars.length / sample.length) < 0.82) return false;
  return /(education|experience|project|skills|university|college|software|engineer|developer|intern|github|linkedin|email|coursework|programming|javascript|python|java|react|node|sql)/i.test(sample);
}

function normalizeKeyPart(value) {
  return String(value || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function outreachEntryKeys(entry) {
  const keys = [];
  if (!entry || !entry.channel) return keys;
  if (entry.channel === "email") {
    const email = normalizeKeyPart(entry.email || entry.identifier);
    if (email) keys.push(`email::${email}`);
  } else if (entry.channel === "linkedin") {
    const url = normalizeKeyPart(entry.linkedinUrl || (String(entry.identifier || "").startsWith("http") ? entry.identifier : ""));
    const rawName = normalizeKeyPart(entry.name || entry.identifier);
    const company = normalizeKeyPart(entry.company);
    const nameCompany = `${rawName}::${company}`;
    if (url) keys.push(`linkedin-url::${url}`);
    if (nameCompany !== "::") keys.push(`linkedin-name::${nameCompany}`);
    const first = rawName.split(/\s+/)[0];
    if (first && company) keys.push(`linkedin-first::${first}::${company}`);
  }
  return keys;
}

function addOutreachEntry(entry) {
  chrome.storage.local.get(["outreachLog", "outreachIndex"], (data) => {
    const log = data.outreachLog || [];
    const index = data.outreachIndex || {};
    const newKeys = outreachEntryKeys(entry);
    const alreadyLogged = newKeys.some((key) => index[key]) ||
      log.some((existing) => outreachEntryKeys(existing).some((key) => newKeys.includes(key)));
    if (alreadyLogged) return;

    const nextEntry = {
      id: Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      date: Date.now(),
      status: "sent",
      ...entry,
    };
    log.push(nextEntry);
    newKeys.forEach((key) => { index[key] = nextEntry.id; });

    chrome.storage.local.set({ outreachLog: log.slice(-3000), outreachIndex: index });
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
          email: job.to,
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
    chrome.storage.local.get(["jobrightTabId", "pendingLinkedinJob", "pendingLinkedinClaimedTabId"], (data) => {
      const job = data.pendingLinkedinJob;
      const senderTabId = sender.tab && sender.tab.id;

      // Ignore completion messages from any LinkedIn tab that did not claim
      // the current pending job. This prevents stale tabs from advancing the
      // Jobright automation or reusing the same note.
      if (data.pendingLinkedinClaimedTabId && senderTabId && data.pendingLinkedinClaimedTabId !== senderTabId) {
        return;
      }

      if (job) {
        addOutreachEntry({
          name: job.personName,
          company: job.company || "",
          channel: "linkedin",
          identifier: job.profileUrl || job.personName,
          linkedinUrl: job.profileUrl || "",
        });
      }

      // Mark completion in storage first. The Jobright content script polls this
      // as a backup because runtime messages can be missed while the Jobright
      // tab is inactive. Then clear the pending job before telling Jobright to
      // continue, so the same profile cannot be claimed again.
      const doneRunId = job && job.runId ? job.runId : null;
      chrome.storage.local.set({
        lastLinkedinDoneRunId: doneRunId,
        lastLinkedinDoneAt: Date.now(),
      }, () => {
        chrome.storage.local.remove(["pendingLinkedinJob", "pendingLinkedinClaimedTabId"], () => {
          if (data.jobrightTabId) {
            chrome.tabs.sendMessage(data.jobrightTabId, { type: "PERSON_LINKEDIN_DONE", runId: doneRunId }).catch(() => {});
          }
          if (senderTabId) {
            setTimeout(() => chrome.tabs.remove(senderTabId), 300);
          }
        });
      });
    });
    return false;
  }


  if (message.type === "AI_PERSONALIZE") {
    chrome.storage.local.get(["openaiApiKey", "defaultTone", "userName", "aiResumeText", "aiCustomInstructions", "debugLogging", "aiResponseCache"], async (data) => {
      try {
        const apiKey = data.openaiApiKey;
        if (!apiKey) {
          sendResponse({ ok: false, error: "Add your OpenAI API key in InsiderReach Options > AI Settings first." });
          return;
        }

        const payload = message.payload || {};
        const tone = payload.tone || data.defaultTone || "Professional";
        const channel = payload.channel || "email";
        const mode = payload.mode || "rewrite";
        const originalText = payload.text || "";
        const job = payload.job || {};
        const resumeText = mode === "pro" ? cleanAiText(payload.resumeText || data.aiResumeText || "") : "";
        const resumeLooksReadable = mode !== "pro" || aiTextLooksReadable(resumeText);
        const userName = data.userName || payload.userName || "";
        const customInstructions = cleanAiText(data.aiCustomInstructions || payload.customInstructions || "");
        const debugLogging = !!data.debugLogging;
        const cacheKey = buildAiCacheKey({ mode, channel, tone, originalText, job, resumeText, customInstructions, userName });
        const cached = await getCachedAiResponse(cacheKey);
        if (cached) {
          debugConsole(debugLogging, "[InsiderReach AI] Cache hit", { mode, channel, tone, cacheKey });
          sendResponse({ ...cached, cached: true });
          return;
        }

        debugConsole(debugLogging, "[InsiderReach AI] Request", {
          mode,
          channel,
          tone,
          originalChars: originalText.length,
          resumeChars: resumeText.length,
          resumeLooksReadable,
          jobTitle: job.jobTitle || "",
          company: job.company || "",
          responsibilitiesCount: (job.responsibilities || []).length,
          requiredCount: (job.requiredQualifications || []).length,
          preferredCount: (job.preferredQualifications || []).length,
          matchedSkillsCount: (job.matchedSkills || []).length,
          hasCustomInstructions: !!customInstructions,
        });

        if (mode === "pro" && !resumeLooksReadable) {
          sendResponse({
            ok: false,
            error: "Rewrite Pro needs clean resume text. Your PDF text extraction looks unreadable, so paste your resume text in Options > AI Settings, or upload a .txt resume."
          });
          return;
        }

        const systemPrompt = [
          "You rewrite outreach messages for job referrals.",
          "Never invent experience, education, employers, projects, metrics, or personal details.",
          "Never use dummy placeholders such as XYZ Corp, ABC, Acme, Example Corp, Project Name, or Company Name.",
          "If the resume does not contain a named company/project, use a real supported detail from the resume or omit the proof point.",
          "For Rewrite Pro, use the provided Responsibilities and Qualifications as the job description source of truth.",
          "Only mention resume strengths that are clearly supported by the resume text and relevant to the job description.",
          "Rewrite Pro must be specific, not generic: it should include exactly one concrete resume proof point when the resume contains one, such as a named project, internship, technical experience, tool/tech stack, or measurable accomplishment.",
          "Avoid generic filler phrases such as solid foundation, passionate about, aligns well, hope this message finds you well, and innovative solutions.",
          "Keep the ask polite, specific, and low-pressure. Do not sound arrogant or overconfident.",
          "For normal Rewrite, return only the final message text, no subject line, no markdown, and no explanations."
        ].join(" ");

        const lengthRule = channel === "linkedin"
          ? "The output MUST be 200 characters or fewer, including spaces. Mention at most one concrete relevant match from the resume."
          : "The output should be concise, usually 100-160 words, and formatted as a readable email body. Do not include a subject line.";

        const formatList = (items) => Array.isArray(items)
          ? items.filter(Boolean).slice(0, 10).map((x) => `- ${String(x).trim()}`).join("\n")
          : "";

        const jobDescriptionText = [
          job.responsibilities && job.responsibilities.length ? `Responsibilities:\n${formatList(job.responsibilities)}` : "",
          job.requiredQualifications && job.requiredQualifications.length ? `Required qualifications:\n${formatList(job.requiredQualifications)}` : "",
          job.preferredQualifications && job.preferredQualifications.length ? `Preferred qualifications:\n${formatList(job.preferredQualifications)}` : "",
          job.matchedSkills && job.matchedSkills.length ? `Jobright matched skills/tags:\n${formatList(job.matchedSkills)}` : "",
        ].filter(Boolean).join("\n\n");

        const userPrompt = mode === "pro"
          ? `Mode: Rewrite Pro\nChannel: ${channel}\nTone: ${tone}\n${lengthRule}\n\nTask:\nWrite a personalized outreach message by matching the resume to the Jobright job description. The message should feel like it was written for this exact role, not a generic referral template.\n\nStrict rules:\n1. First, silently identify the single strongest resume proof point that matches the role. Prefer a named project, internship, technical experience, tool/tech stack, or accomplishment from the resume.\n2. Include exactly one sentence using that proof point. Make it relevant to one of the Responsibilities, Required qualifications, Preferred qualifications, or matched skills.\n3. Do not mention a skill unless it appears in the resume text or Jobright matched skills. Do not invent facts.\n4. Do not use generic phrases like "solid foundation", "passion for", "aligns well", "innovative solutions", or "I hope this message finds you well".
4a. Never write dummy examples or placeholders such as XYZ Corp, ABC, Acme, Example Corp, Project Name, or Company Name. If no exact employer/project name exists in the resume, do not invent one.\n5. For email, use this structure: greeting, interest in the specific role/company, one concrete resume proof point, low-pressure ask, signature.\n6. For LinkedIn, keep it natural and under 200 characters; include the strongest proof point only if it fits.\n7. Return exactly this format for Rewrite Pro:\nPROOF_POINT: the specific resume proof point used, or None\nMESSAGE:\nthe final message body only, no subject line\n\nCustom user instructions to follow when possible without inventing facts:\n${customInstructions || "None"}\n\nPerson name: ${job.personName || ""}\nPerson title: ${job.personTitle || ""}\nCompany: ${job.company || ""}\nJob title: ${job.jobTitle || ""}\nRelationship/category: ${job.category || ""}\nUser/signature name: ${userName}\n\nJob description extracted from Jobright:\n${jobDescriptionText || "No responsibilities or qualifications were extracted."}\n\nOriginal message:\n${originalText}\n\nResume text:\n${resumeText.slice(0, 12000)}`
          : `Mode: Rewrite\nChannel: ${channel}\nTone: ${tone}\n${lengthRule}\n\nRewrite the existing message in the selected tone. Preserve the same intent and facts. Do not add unsupported details. Do not include a subject line.\n\nCustom user instructions to follow when possible without inventing facts:\n${customInstructions || "None"}\n\nUser/signature name: ${userName}\n\nOriginal message:\n${originalText}`;

        const requestBody = {
          model: "gpt-4o-mini",
          temperature: mode === "pro" ? 0.25 : 0.5,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        };

        let json;
        try {
          json = await callOpenAiChat(apiKey, requestBody);
        } catch (apiErr) {
          warnConsole(debugLogging, "[InsiderReach AI] OpenAI request failed", { status: apiErr.status, message: apiErr.message });
          sendResponse({ ok: false, error: apiErr.message });
          return;
        }
        let text = json.choices?.[0]?.message?.content?.trim() || "";
        let proofPoint = "";
        if (mode === "pro") {
          const proofMatch = text.match(/PROOF_POINT:\s*([\s\S]*?)(?:\n\s*MESSAGE:\s*|$)/i);
          const messageMatch = text.match(/MESSAGE:\s*([\s\S]*)$/i);
          if (proofMatch) proofPoint = proofMatch[1].trim();
          if (messageMatch) text = messageMatch[1].trim();
          proofPoint = /^(none|n\/a|not found)$/i.test(proofPoint) ? "" : proofPoint;
        }
        if (containsUnsupportedPlaceholder(text) || containsUnsupportedPlaceholder(proofPoint)) {
          warnConsole(debugLogging, "[InsiderReach AI] Placeholder detected; requesting one revision without invented details.");
          const reviseBody = {
            model: "gpt-4o-mini",
            temperature: 0.15,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
              { role: "assistant", content: text },
              { role: "user", content: "Revise the message. Remove every dummy placeholder or invented employer/project. Use only exact facts from the provided resume/job text. If there is no concrete proof point, set PROOF_POINT: None and write a concise message without one." },
            ],
          };
          try {
            const retryJson = await callOpenAiChat(apiKey, reviseBody);
            text = retryJson.choices?.[0]?.message?.content?.trim() || text;
            if (mode === "pro") {
              const retryProofMatch = text.match(/PROOF_POINT:\s*([\s\S]*?)(?:\n\s*MESSAGE:\s*|$)/i);
              const retryMessageMatch = text.match(/MESSAGE:\s*([\s\S]*)$/i);
              proofPoint = retryProofMatch ? retryProofMatch[1].trim() : "";
              if (retryMessageMatch) text = retryMessageMatch[1].trim();
              proofPoint = /^(none|n\/a|not found)$/i.test(proofPoint) ? "" : proofPoint;
            }
          } catch (retryErr) {
            warnConsole(debugLogging, "[InsiderReach AI] Placeholder revision failed", { message: retryErr.message });
          }
        }

        if (containsUnsupportedPlaceholder(text) || containsUnsupportedPlaceholder(proofPoint)) {
          sendResponse({ ok: false, error: "AI tried to use a dummy placeholder like XYZ/ABC. I blocked it. Try Rewrite Pro again after checking your resume text." });
          return;
        }

        debugConsole(debugLogging, "[InsiderReach AI] Response received", { outputChars: text.length, proofPoint: proofPoint ? proofPoint.slice(0, 120) : "", cacheKey });
        const response = { ok: true, text, proofPoint };
        setCachedAiResponse(cacheKey, response);
        sendResponse(response);
      } catch (err) {
        errorConsole(!!(data && data.debugLogging), "[InsiderReach AI] Request error", err);
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    });
    return true;
  }

  if (message.type === "GET_OUTREACH_LOG") {
    chrome.storage.local.get("outreachLog", (data) => {
      sendResponse(data.outreachLog || []);
    });
    return true;
  }

  if (message.type === "OPEN_LINKEDIN_PROFILE") {
    // message.payload = { profileUrl, note, personName }
    chrome.storage.local.set({ pendingLinkedinJob: message.payload, pendingLinkedinClaimedTabId: null }, () => {
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
    chrome.storage.local.get(["pendingLinkedinJob", "pendingLinkedinClaimedTabId"], (data) => {
      const job = data.pendingLinkedinJob || null;
      const tabId = sender.tab && sender.tab.id;
      if (!job || !tabId) {
        sendResponse(null);
        return;
      }

      // Only one LinkedIn tab should consume a pending job. Without this,
      // the same pending note can be picked up again if LinkedIn reloads or
      // another LinkedIn tab appears, which causes the same profile to reopen
      // or be processed twice.
      if (data.pendingLinkedinClaimedTabId && data.pendingLinkedinClaimedTabId !== tabId) {
        sendResponse(null);
        return;
      }

      const claimedJob = {
        ...job,
        profileUrl: job.profileUrl || (sender.tab && sender.tab.url) || "",
      };
      chrome.storage.local.set({ pendingLinkedinJob: claimedJob, pendingLinkedinClaimedTabId: tabId }, () => {
        sendResponse(claimedJob);
      });
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
