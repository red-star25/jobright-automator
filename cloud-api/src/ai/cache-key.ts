import { cleanAiText, containsUnsupportedPlaceholder } from "./validation.js";

export function simpleHash(value: string): string {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export type JobContextInput = {
  responsibilities?: string[];
  required?: string[];
  preferred?: string[];
  matchedSkills?: string[];
};

export function buildCacheKey(input: {
  mode: string;
  channel: string;
  tone: string;
  originalMessage: string;
  subject?: string;
  personName?: string;
  personTitle?: string;
  company?: string;
  jobTitle?: string;
  jobContext?: JobContextInput;
  resumeText?: string;
  customInstructions?: string;
  maxChars?: number;
}): string {
  const jobContext = input.jobContext || {};
  const normalized = {
    mode: input.mode,
    channel: input.channel,
    tone: input.tone,
    originalMessage: cleanAiText(input.originalMessage),
    subject: cleanAiText(input.subject || ""),
    personName: cleanAiText(input.personName || ""),
    personTitle: cleanAiText(input.personTitle || ""),
    company: cleanAiText(input.company || ""),
    jobTitle: cleanAiText(input.jobTitle || ""),
    responsibilities: jobContext.responsibilities || [],
    required: jobContext.required || [],
    preferred: jobContext.preferred || [],
    matchedSkills: jobContext.matchedSkills || [],
    resumeHash: input.mode === "rewritePro" ? simpleHash(cleanAiText(input.resumeText || "")) : "",
    customInstructions: cleanAiText(input.customInstructions || ""),
    maxChars: input.maxChars || (input.channel === "linkedin" ? 200 : 0),
  };
  return "ai::" + simpleHash(JSON.stringify(normalized));
}

export { containsUnsupportedPlaceholder };
