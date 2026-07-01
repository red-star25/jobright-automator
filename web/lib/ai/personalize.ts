export function cleanAiText(text: string): string {
  return String(text || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsUnsupportedPlaceholder(text: string): boolean {
  const value = String(text || "");
  return /\b(?:XYZ\s*(?:Corp|Inc|Company)?|ABC\s*(?:Corp|Inc|Company)?|Acme\s*(?:Corp|Inc|Company)?|Example\s*(?:Corp|Inc|Company)?|Company\s*Name|Project\s*Name)\b/i.test(
    value
  );
}

export function simpleHash(value: string): string {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function aiTextLooksReadable(text: string): boolean {
  const sample = cleanAiText(text);
  if (sample.length < 250) return false;
  const englishWords = sample.match(/\b[A-Za-z][A-Za-z+.#-]{2,}\b/g) || [];
  if (englishWords.length < 45) return false;
  const readableChars = sample.match(/[A-Za-z0-9\s.,;:()@/+&_'’\-#]/g) || [];
  if (readableChars.length / sample.length < 0.82) return false;
  return /(education|experience|project|skills|university|college|software|engineer|developer|intern|github|linkedin|email|coursework|programming|javascript|python|java|react|node|sql)/i.test(
    sample
  );
}

export function buildAiCacheKey(input: {
  mode: string;
  channel: string;
  tone: string;
  originalText: string;
  job: Record<string, unknown>;
  resumeText: string;
  customInstructions: string;
  userName: string;
}): string {
  const job = input.job || {};
  const normalized = {
    mode: input.mode,
    channel: input.channel,
    tone: input.tone,
    originalText: cleanAiText(input.originalText),
    personName: cleanAiText(String(job.personName || "")),
    company: cleanAiText(String(job.company || "")),
    jobTitle: cleanAiText(String(job.jobTitle || "")),
    category: cleanAiText(String(job.category || "")),
    responsibilities: job.responsibilities || [],
    requiredQualifications: job.requiredQualifications || [],
    preferredQualifications: job.preferredQualifications || [],
    matchedSkills: job.matchedSkills || [],
    resumeHash: input.mode === "pro" ? simpleHash(cleanAiText(input.resumeText || "")) : "",
    customInstructions: cleanAiText(input.customInstructions || ""),
    userName: cleanAiText(input.userName || ""),
  };
  return "ai::" + simpleHash(JSON.stringify(normalized));
}

function formatList(items: unknown): string {
  return Array.isArray(items)
    ? items
        .filter(Boolean)
        .slice(0, 10)
        .map((x) => `- ${String(x).trim()}`)
        .join("\n")
    : "";
}

export function buildPrompts(input: {
  mode: "rewrite" | "pro";
  channel: "email" | "linkedin";
  tone: string;
  originalText: string;
  job: Record<string, unknown>;
  resumeText: string;
  customInstructions: string;
  userName: string;
}) {
  const { mode, channel, tone, originalText, job, resumeText, customInstructions, userName } = input;

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
    "For normal Rewrite, return only the final message text, no subject line, no markdown, and no explanations.",
  ].join(" ");

  const lengthRule =
    channel === "linkedin"
      ? "The output MUST be 200 characters or fewer, including spaces. Mention at most one concrete relevant match from the resume."
      : "The output should be concise, usually 100-160 words, and formatted as a readable email body. Do not include a subject line.";

  const jobDescriptionText = [
    job.responsibilities && (job.responsibilities as string[]).length
      ? `Responsibilities:\n${formatList(job.responsibilities)}`
      : "",
    job.requiredQualifications && (job.requiredQualifications as string[]).length
      ? `Required qualifications:\n${formatList(job.requiredQualifications)}`
      : "",
    job.preferredQualifications && (job.preferredQualifications as string[]).length
      ? `Preferred qualifications:\n${formatList(job.preferredQualifications)}`
      : "",
    job.matchedSkills && (job.matchedSkills as string[]).length
      ? `Jobright matched skills/tags:\n${formatList(job.matchedSkills)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt =
    mode === "pro"
      ? `Mode: Rewrite Pro\nChannel: ${channel}\nTone: ${tone}\n${lengthRule}\n\nTask:\nWrite a personalized outreach message by matching the resume to the Jobright job description. The message should feel like it was written for this exact role, not a generic referral template.\n\nStrict rules:\n1. First, silently identify the single strongest resume proof point that matches the role. Prefer a named project, internship, technical experience, tool/tech stack, or accomplishment from the resume.\n2. Include exactly one sentence using that proof point. Make it relevant to one of the Responsibilities, Required qualifications, Preferred qualifications, or matched skills.\n3. Do not mention a skill unless it appears in the resume text or Jobright matched skills. Do not invent facts.\n4. Do not use generic phrases like "solid foundation", "passion for", "aligns well", "innovative solutions", or "I hope this message finds you well".
4a. Never write dummy examples or placeholders such as XYZ Corp, ABC, Acme, Example Corp, Project Name, or Company Name. If no exact employer/project name exists in the resume, do not invent one.\n5. For email, use this structure: greeting, interest in the specific role/company, one concrete resume proof point, low-pressure ask, signature.\n6. For LinkedIn, keep it natural and under 200 characters; include the strongest proof point only if it fits.\n7. Return exactly this format for Rewrite Pro:\nPROOF_POINT: the specific resume proof point used, or None\nMESSAGE:\nthe final message body only, no subject line\n\nCustom user instructions to follow when possible without inventing facts:\n${customInstructions || "None"}\n\nPerson name: ${job.personName || ""}\nPerson title: ${job.personTitle || ""}\nCompany: ${job.company || ""}\nJob title: ${job.jobTitle || ""}\nRelationship/category: ${job.category || ""}\nUser/signature name: ${userName}\n\nJob description extracted from Jobright:\n${jobDescriptionText || "No responsibilities or qualifications were extracted."}\n\nOriginal message:\n${originalText}\n\nResume text:\n${resumeText.slice(0, 12000)}`
      : `Mode: Rewrite\nChannel: ${channel}\nTone: ${tone}\n${lengthRule}\n\nRewrite the existing message in the selected tone. Preserve the same intent and facts. Do not add unsupported details. Do not include a subject line.\n\nCustom user instructions to follow when possible without inventing facts:\n${customInstructions || "None"}\n\nUser/signature name: ${userName}\n\nOriginal message:\n${originalText}`;

  return { systemPrompt, userPrompt };
}

export async function callOpenAiChat(
  apiKey: string,
  requestBody: {
    model: string;
    temperature: number;
    messages: Array<{ role: string; content: string }>;
  }
) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  let json: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message = json?.error?.message || `OpenAI request failed with status ${response.status}`;
    throw new Error(message);
  }

  return json || {};
}

function parseProResponse(raw: string) {
  let text = raw.trim();
  let proofPoint = "";
  const proofMatch = text.match(/PROOF_POINT:\s*([\s\S]*?)(?:\n\s*MESSAGE:\s*|$)/i);
  const messageMatch = text.match(/MESSAGE:\s*([\s\S]*)$/i);
  if (proofMatch) proofPoint = proofMatch[1].trim();
  if (messageMatch) text = messageMatch[1].trim();
  proofPoint = /^(none|n\/a|not found)$/i.test(proofPoint) ? "" : proofPoint;
  return { text, proofPoint };
}

export async function runPersonalize(input: {
  mode: "rewrite" | "pro";
  channel: "email" | "linkedin";
  tone: string;
  originalText: string;
  job: Record<string, unknown>;
  resumeText: string;
  customInstructions: string;
  userName: string;
  apiKey: string;
}) {
  const { mode, channel, tone, originalText, job, resumeText, customInstructions, userName, apiKey } = input;

  if (mode === "pro" && !aiTextLooksReadable(resumeText)) {
    return {
      ok: false as const,
      error:
        "Rewrite Pro needs clean resume text. Your PDF text extraction looks unreadable, so paste your resume text in Options > AI Settings, or upload a .txt resume.",
      code: "VALIDATION_ERROR" as const,
    };
  }

  const { systemPrompt, userPrompt } = buildPrompts({
    mode,
    channel,
    tone,
    originalText,
    job,
    resumeText,
    customInstructions,
    userName,
  });

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
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let text = json.choices?.[0]?.message?.content?.trim() || "";
  let proofPoint = "";
  if (mode === "pro") {
    const parsed = parseProResponse(text);
    text = parsed.text;
    proofPoint = parsed.proofPoint;
  }

  if (containsUnsupportedPlaceholder(text) || containsUnsupportedPlaceholder(proofPoint)) {
    const reviseBody = {
      model: "gpt-4o-mini",
      temperature: 0.15,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
        { role: "assistant", content: text },
        {
          role: "user",
          content:
            "Revise the message. Remove every dummy placeholder or invented employer/project. Use only exact facts from the provided resume/job text. If there is no concrete proof point, set PROOF_POINT: None and write a concise message without one.",
        },
      ],
    };
    try {
      const retryJson = await callOpenAiChat(apiKey, reviseBody);
      text = retryJson.choices?.[0]?.message?.content?.trim() || text;
      if (mode === "pro") {
        const parsed = parseProResponse(text);
        text = parsed.text;
        proofPoint = parsed.proofPoint;
      }
    } catch {
      // Keep first response if revision fails.
    }
  }

  if (containsUnsupportedPlaceholder(text) || containsUnsupportedPlaceholder(proofPoint)) {
    return {
      ok: false as const,
      error:
        "AI tried to use a dummy placeholder like XYZ/ABC. I blocked it. Try Rewrite Pro again after checking your resume text.",
    };
  }

  return { ok: true as const, text, proofPoint };
}
