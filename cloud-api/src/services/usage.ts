import { query } from "../db/pool.js";
import { DEV_USER_ID, env } from "../config/env.js";
import {
  currentPeriodStart,
  getLimitsForPlan,
  limitKeyForMode,
  type PlanId,
  type UsageMode,
  usageFieldForMode,
} from "./plans.js";

export type AuthUser = {
  id: string;
  email: string | null;
  plan: PlanId;
};

export async function ensureDevUser(): Promise<AuthUser> {
  const result = await query<{ id: string; email: string | null; plan: PlanId }>(
    `insert into users (id, email, plan)
     values ($1, $2, $3)
     on conflict (id) do update set
       plan = excluded.plan,
       updated_at = now()
     returning id, email, plan`,
    [DEV_USER_ID, "dev@insiderreach.local", env.DEV_USER_PLAN]
  );
  return result.rows[0];
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  const result = await query<{ id: string; email: string | null; plan: PlanId }>(
    `select id, email, plan from users where id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function getOrCreateUsageCounter(userId: string, periodStart: string) {
  const existing = await query<{ id: number; rewrite_count: number; pro_count: number }>(
    `select id, rewrite_count, pro_count from usage_counters
     where user_id = $1 and period_start = $2`,
    [userId, periodStart]
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await query<{ id: number; rewrite_count: number; pro_count: number }>(
    `insert into usage_counters (user_id, period_start, rewrite_count, pro_count)
     values ($1, $2, 0, 0)
     returning id, rewrite_count, pro_count`,
    [userId, periodStart]
  );
  return created.rows[0];
}

export async function getUsageSnapshot(user: AuthUser) {
  const periodStart = currentPeriodStart();
  const counter = await getOrCreateUsageCounter(user.id, periodStart);
  const limits = getLimitsForPlan(user.plan);
  return {
    userId: user.id,
    email: user.email,
    plan: user.plan,
    usage: {
      rewrite: counter.rewrite_count,
      rewritePro: counter.pro_count,
    },
    limits: {
      rewrite: limits.rewritePerMonth,
      rewritePro: limits.rewriteProPerMonth,
    },
    periodStart,
  };
}

export async function checkUsageLimit(user: AuthUser, mode: UsageMode) {
  const snapshot = await getUsageSnapshot(user);
  const used = mode === "rewritePro" ? snapshot.usage.rewritePro : snapshot.usage.rewrite;
  const limit = getLimitsForPlan(user.plan)[limitKeyForMode(mode)];
  return { allowed: used < limit, snapshot, used, limit };
}

export async function incrementUsage(userId: string, mode: UsageMode) {
  const periodStart = currentPeriodStart();
  const counter = await getOrCreateUsageCounter(userId, periodStart);
  const field = usageFieldForMode(mode);
  const nextValue = (field === "pro_count" ? counter.pro_count : counter.rewrite_count) + 1;
  await query(`update usage_counters set ${field} = $1 where id = $2`, [nextValue, counter.id]);
}

export async function logRewriteRequest(
  userId: string,
  mode: UsageMode,
  channel: "email" | "linkedin",
  cached: boolean,
  extensionVersion?: string
) {
  await query(
    `insert into rewrite_requests (user_id, mode, channel, cached, extension_version)
     values ($1, $2, $3, $4, $5)`,
    [userId, mode, channel, cached, extensionVersion || null]
  );
}

const BLOCKED_METADATA_KEYS = /message|resume|subject|body|token|password|secret/i;

export function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (BLOCKED_METADATA_KEYS.test(key)) continue;
    if (typeof value === "string" && value.length > 200) continue;
    out[key] = value;
  }
  return out;
}

export async function logUsageEvent(
  userId: string,
  input: {
    eventType: string;
    mode?: UsageMode;
    channel?: "email" | "linkedin";
    extensionVersion?: string;
    metadata?: Record<string, unknown>;
  }
) {
  await query(
    `insert into usage_events (user_id, event_type, mode, channel, extension_version, metadata)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      userId,
      input.eventType,
      input.mode || null,
      input.channel || null,
      input.extensionVersion || null,
      JSON.stringify(sanitizeMetadata(input.metadata)),
    ]
  );
}
