import { createAdminClient } from "@/lib/supabase/admin";
import { currentPeriodStart, getLimitsForPlan } from "@/lib/billing/plans";

export type UsageSnapshot = {
  plan: string;
  rewrite: number;
  pro: number;
  limits: { rewrite: number; pro: number };
  periodStart: string;
};

export async function ensureProfile(userId: string, email?: string | null) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (existing) return existing;

  const { data, error } = await admin
    .from("profiles")
    .upsert({ id: userId, email: email || null, plan: "free" }, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function getOrCreateUsageCounter(userId: string, periodStart: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("usage_counters")
    .select("*")
    .eq("user_id", userId)
    .eq("period_start", periodStart)
    .maybeSingle();

  if (data) return data;

  const { data: created, error } = await admin
    .from("usage_counters")
    .insert({ user_id: userId, period_start: periodStart, rewrite_count: 0, pro_count: 0 })
    .select("*")
    .single();
  if (error) throw error;
  return created;
}

export async function getUsageSnapshot(userId: string, plan: string): Promise<UsageSnapshot> {
  const periodStart = currentPeriodStart();
  const counter = await getOrCreateUsageCounter(userId, periodStart);
  const limits = getLimitsForPlan(plan);
  return {
    plan,
    rewrite: counter.rewrite_count,
    pro: counter.pro_count,
    limits: { rewrite: limits.rewritePerMonth, pro: limits.proPerMonth },
    periodStart,
  };
}

export async function checkUsageLimit(userId: string, plan: string, mode: "rewrite" | "pro") {
  const snapshot = await getUsageSnapshot(userId, plan);
  const used = mode === "pro" ? snapshot.pro : snapshot.rewrite;
  const limit = mode === "pro" ? snapshot.limits.pro : snapshot.limits.rewrite;
  return { allowed: used < limit, snapshot, used, limit };
}

export async function incrementUsage(userId: string, mode: "rewrite" | "pro") {
  const periodStart = currentPeriodStart();
  const counter = await getOrCreateUsageCounter(userId, periodStart);
  const admin = createAdminClient();
  const field = mode === "pro" ? "pro_count" : "rewrite_count";
  const nextValue = (counter[field] || 0) + 1;
  await admin.from("usage_counters").update({ [field]: nextValue }).eq("id", counter.id);
}

export async function logAiRequest(userId: string, mode: "rewrite" | "pro", channel: string, cached: boolean) {
  const admin = createAdminClient();
  await admin.from("ai_requests").insert({
    user_id: userId,
    mode,
    channel,
    cached,
    tokens_est: null,
  });
}

export async function getCachedResponse(cacheKey: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ai_response_cache")
    .select("response, created_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (!data) return null;
  const ageMs = Date.now() - new Date(data.created_at).getTime();
  if (ageMs > 1000 * 60 * 60 * 24 * 14) return null;
  return data.response as { ok: true; text: string; proofPoint?: string };
}

export async function setCachedResponse(cacheKey: string, response: { ok: true; text: string; proofPoint?: string }) {
  const admin = createAdminClient();
  await admin.from("ai_response_cache").upsert({
    cache_key: cacheKey,
    response,
    created_at: new Date().toISOString(),
  });
}
