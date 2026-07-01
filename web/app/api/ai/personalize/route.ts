import { NextRequest, NextResponse } from "next/server";
import { buildAiCacheKey, cleanAiText, runPersonalize } from "@/lib/ai/personalize";
import { appUrl } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { getUserFromBearerToken } from "@/lib/supabase/server-auth";
import {
  checkUsageLimit,
  ensureProfile,
  getCachedResponse,
  incrementUsage,
  logAiRequest,
  setCachedResponse,
} from "@/lib/usage";

export async function POST(request: NextRequest) {
  const user = await getUserFromBearerToken(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in to use Cloud AI.", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  if (!checkRateLimit(user.id)) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please wait a minute.", code: "RATE_LIMITED" },
      { status: 429 }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Server AI is not configured." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const mode = body.mode === "pro" ? "pro" : "rewrite";
  const channel = body.channel === "linkedin" ? "linkedin" : "email";
  const tone = String(body.tone || "Professional");
  const originalText = String(body.text || "");
  const job = (body.job as Record<string, unknown>) || {};
  const resumeText = mode === "pro" ? cleanAiText(String(body.resumeText || "")) : "";
  const customInstructions = cleanAiText(String(body.customInstructions || ""));
  const userName = String(body.userName || "");

  const profile = await ensureProfile(user.id, user.email);
  const usageCheck = await checkUsageLimit(user.id, profile.plan, mode);
  if (!usageCheck.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: `Monthly ${mode === "pro" ? "Rewrite Pro" : "Rewrite"} limit reached.`,
        code: "LIMIT_EXCEEDED",
        usage: { rewrite: usageCheck.snapshot.rewrite, pro: usageCheck.snapshot.pro },
        limit: usageCheck.snapshot.limits,
        upgradeUrl: appUrl("/dashboard"),
      },
      { status: 429 }
    );
  }

  const cacheKey = buildAiCacheKey({
    mode,
    channel,
    tone,
    originalText,
    job,
    resumeText,
    customInstructions,
    userName,
  });

  const cached = await getCachedResponse(cacheKey);
  if (cached) {
    await logAiRequest(user.id, mode, channel, true);
    return NextResponse.json({ ...cached, cached: true });
  }

  const result = await runPersonalize({
    mode,
    channel,
    tone,
    originalText,
    job,
    resumeText,
    customInstructions,
    userName,
    apiKey,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.code === "VALIDATION_ERROR" ? 400 : 502 });
  }

  await incrementUsage(user.id, mode);
  await logAiRequest(user.id, mode, channel, false);
  const response = { ok: true as const, text: result.text, proofPoint: result.proofPoint };
  await setCachedResponse(cacheKey, response);
  return NextResponse.json(response);
}
