import { buildCacheKey } from "../ai/cache-key.js";
import { callOpenAiChat } from "../ai/openai.js";
import { buildPrompts, buildSubjectPrompt, parseProResponse } from "../ai/prompts.js";
import { aiTextLooksReadable, containsUnsupportedPlaceholder } from "../ai/validation.js";
import { getCachedResponse, setCachedResponse, type CachedRewriteResponse } from "./cache.js";
import type { RewriteRequest } from "../types/api.js";
import type { AuthUser } from "./usage.js";
import {
  checkUsageLimit,
  incrementUsage,
  logRewriteRequest,
} from "./usage.js";

export type RewriteResult =
  | { ok: true; data: CachedRewriteResponse & { cached?: boolean } }
  | { ok: false; status: number; error: string; code?: string; usage?: unknown; limits?: unknown };

export async function executeRewrite(user: AuthUser, body: RewriteRequest): Promise<RewriteResult> {
  const maxChars = body.maxChars ?? (body.channel === "linkedin" ? 200 : 0);
  const resumeText = body.resumeText?.trim() || "";
  const customInstructions = body.customInstructions?.trim() || "";

  if (body.mode === "rewritePro" && !aiTextLooksReadable(resumeText)) {
    return {
      ok: false,
      status: 400,
      error:
        "Rewrite Pro needs clean resume text. Paste your resume text in the extension Options, or upload a .txt resume.",
      code: "VALIDATION_ERROR",
    };
  }

  const usageCheck = await checkUsageLimit(user, body.mode);
  if (!usageCheck.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Monthly ${body.mode === "rewritePro" ? "Rewrite Pro" : "Rewrite"} limit reached.`,
      code: "LIMIT_EXCEEDED",
      usage: usageCheck.snapshot.usage,
      limits: usageCheck.snapshot.limits,
    };
  }

  const cacheKey = buildCacheKey({
    mode: body.mode,
    channel: body.channel,
    tone: body.tone,
    originalMessage: body.originalMessage,
    subject: body.subject,
    personName: body.personName,
    personTitle: body.personTitle,
    company: body.company,
    jobTitle: body.jobTitle,
    jobContext: body.jobContext,
    resumeText,
    customInstructions,
    maxChars: maxChars || undefined,
  });

  const cached = await getCachedResponse(cacheKey);
  if (cached) {
    await logRewriteRequest(user.id, body.mode, body.channel, true, body.extensionVersion);
    return { ok: true, data: { ...cached, cached: true } };
  }

  const internalMode = body.mode === "rewritePro" ? "rewritePro" : "rewrite";

  const { systemPrompt, userPrompt } = buildPrompts({
    mode: internalMode,
    channel: body.channel,
    tone: body.tone,
    originalMessage: body.originalMessage,
    personName: body.personName,
    personTitle: body.personTitle,
    company: body.company,
    jobTitle: body.jobTitle,
    jobContext: body.jobContext,
    resumeText,
    customInstructions,
    maxChars: maxChars || 200,
  });

  const temperature = body.mode === "rewritePro" ? 0.25 : 0.5;

  let json;
  try {
    json = await callOpenAiChat({
      model: "gpt-4o-mini",
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "OpenAI request failed.",
    };
  }

  let text = json.choices?.[0]?.message?.content?.trim() || "";
  let proofPoint = "";

  if (body.mode === "rewritePro") {
    const parsed = parseProResponse(text);
    text = parsed.text;
    proofPoint = parsed.proofPoint;
  }

  if (containsUnsupportedPlaceholder(text) || containsUnsupportedPlaceholder(proofPoint)) {
    try {
      const retryJson = await callOpenAiChat({
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
      });
      text = retryJson.choices?.[0]?.message?.content?.trim() || text;
      if (body.mode === "rewritePro") {
        const parsed = parseProResponse(text);
        text = parsed.text;
        proofPoint = parsed.proofPoint;
      }
    } catch {
      // keep first response
    }
  }

  if (containsUnsupportedPlaceholder(text) || containsUnsupportedPlaceholder(proofPoint)) {
    return {
      ok: false,
      status: 502,
      error:
        "AI tried to use a dummy placeholder like XYZ/ABC. Blocked. Try again after checking your resume text.",
    };
  }

  let subject: string | undefined;
  if (body.channel === "email" && body.subject?.trim()) {
    const subjectPrompts = buildSubjectPrompt({
      tone: body.tone,
      originalSubject: body.subject.trim(),
      originalMessage: body.originalMessage,
      company: body.company,
      jobTitle: body.jobTitle,
    });
    try {
      const subjectJson = await callOpenAiChat({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: subjectPrompts.systemPrompt },
          { role: "user", content: subjectPrompts.userPrompt },
        ],
      });
      const rewritten = subjectJson.choices?.[0]?.message?.content?.trim();
      if (rewritten && !containsUnsupportedPlaceholder(rewritten)) {
        subject = rewritten.replace(/^["']|["']$/g, "");
      }
    } catch {
      // subject rewrite is optional
    }
  }

  const response: CachedRewriteResponse = {
    text,
    ...(proofPoint ? { proofPoint } : {}),
    ...(subject ? { subject } : {}),
  };

  await setCachedResponse(cacheKey, response);
  await incrementUsage(user.id, body.mode);
  await logRewriteRequest(user.id, body.mode, body.channel, false, body.extensionVersion);

  return { ok: true, data: { ...response, cached: false } };
}

export function safeRewriteLogMeta(body: RewriteRequest) {
  return {
    userId: undefined as string | undefined,
    mode: body.mode,
    channel: body.channel,
    originalChars: body.originalMessage.length,
    resumeChars: body.resumeText?.length || 0,
    extensionVersion: body.extensionVersion,
  };
}
