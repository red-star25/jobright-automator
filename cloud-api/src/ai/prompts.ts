import type { JobContextInput } from "./cache-key.js";

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
  mode: "rewrite" | "rewritePro";
  channel: "email" | "linkedin";
  tone: string;
  originalMessage: string;
  personName?: string;
  personTitle?: string;
  company?: string;
  jobTitle?: string;
  jobContext?: JobContextInput;
  resumeText: string;
  customInstructions: string;
  maxChars: number;
}) {
  const {
    mode,
    channel,
    tone,
    originalMessage,
    personName,
    personTitle,
    company,
    jobTitle,
    jobContext,
    resumeText,
    customInstructions,
    maxChars,
  } = input;

  const ctx = jobContext || {};

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
      ? `The output MUST be ${maxChars} characters or fewer, including spaces. Mention at most one concrete relevant match from the resume.`
      : "The output should be concise, usually 100-160 words, and formatted as a readable email body. Do not include a subject line.";

  const jobDescriptionText = [
    ctx.responsibilities?.length ? `Responsibilities:\n${formatList(ctx.responsibilities)}` : "",
    ctx.required?.length ? `Required qualifications:\n${formatList(ctx.required)}` : "",
    ctx.preferred?.length ? `Preferred qualifications:\n${formatList(ctx.preferred)}` : "",
    ctx.matchedSkills?.length ? `Jobright matched skills/tags:\n${formatList(ctx.matchedSkills)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt =
    mode === "rewritePro"
      ? `Mode: Rewrite Pro\nChannel: ${channel}\nTone: ${tone}\n${lengthRule}\n\nTask:\nWrite a personalized outreach message by matching the resume to the Jobright job description. The message should feel like it was written for this exact role, not a generic referral template.\n\nStrict rules:\n1. First, silently identify the single strongest resume proof point that matches the role. Prefer a named project, internship, technical experience, tool/tech stack, or accomplishment from the resume.\n2. Include exactly one sentence using that proof point. Make it relevant to one of the Responsibilities, Required qualifications, Preferred qualifications, or matched skills.\n3. Do not mention a skill unless it appears in the resume text or Jobright matched skills. Do not invent facts.\n4. Do not use generic phrases like "solid foundation", "passion for", "aligns well", "innovative solutions", or "I hope this message finds you well".
4a. Never write dummy examples or placeholders such as XYZ Corp, ABC, Acme, Example Corp, Project Name, or Company Name. If no exact employer/project name exists in the resume, do not invent one.\n5. For email, use this structure: greeting, interest in the specific role/company, one concrete resume proof point, low-pressure ask, signature.\n6. For LinkedIn, keep it natural and under ${maxChars} characters; include the strongest proof point only if it fits.\n7. Return exactly this format for Rewrite Pro:\nPROOF_POINT: the specific resume proof point used, or None\nMESSAGE:\nthe final message body only, no subject line\n\nCustom user instructions to follow when possible without inventing facts:\n${customInstructions || "None"}\n\nPerson name: ${personName || ""}\nPerson title: ${personTitle || ""}\nCompany: ${company || ""}\nJob title: ${jobTitle || ""}\n\nJob description extracted from Jobright:\n${jobDescriptionText || "No responsibilities or qualifications were extracted."}\n\nOriginal message:\n${originalMessage}\n\nResume text:\n${resumeText.slice(0, 12000)}`
      : `Mode: Rewrite\nChannel: ${channel}\nTone: ${tone}\n${lengthRule}\n\nRewrite the existing message in the selected tone. Preserve the same intent and facts. Do not add unsupported details. Do not include a subject line.\n\nCustom user instructions to follow when possible without inventing facts:\n${customInstructions || "None"}\n\nOriginal message:\n${originalMessage}`;

  return { systemPrompt, userPrompt };
}

export function buildSubjectPrompt(input: {
  tone: string;
  originalSubject: string;
  originalMessage: string;
  company?: string;
  jobTitle?: string;
}) {
  return {
    systemPrompt:
      "You rewrite email subject lines for job referral outreach. Never invent facts. Never use dummy placeholders such as XYZ Corp, ABC, Acme, or Example Corp. Return only the subject line, no quotes or explanation.",
    userPrompt: `Tone: ${input.tone}\nCompany: ${input.company || ""}\nJob title: ${input.jobTitle || ""}\nOriginal subject: ${input.originalSubject}\nMessage preview: ${input.originalMessage.slice(0, 400)}\n\nRewrite the subject line in the selected tone. Keep it concise and specific.`,
  };
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

export { parseProResponse };
