export type PlanId = "free" | "pro";

export type PlanLimits = {
  rewritePerMonth: number;
  rewriteProPerMonth: number;
  label: string;
};

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    label: "Free",
    rewritePerMonth: 25,
    rewriteProPerMonth: 5,
  },
  pro: {
    label: "Pro",
    rewritePerMonth: 500,
    rewriteProPerMonth: 150,
  },
};

export function getLimitsForPlan(plan: string): PlanLimits {
  return PLANS[plan === "pro" ? "pro" : "free"];
}

export function currentPeriodStart(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export type UsageMode = "rewrite" | "rewritePro";

export function usageFieldForMode(mode: UsageMode): "rewrite_count" | "pro_count" {
  return mode === "rewritePro" ? "pro_count" : "rewrite_count";
}

export function limitKeyForMode(mode: UsageMode): "rewritePerMonth" | "rewriteProPerMonth" {
  return mode === "rewritePro" ? "rewriteProPerMonth" : "rewritePerMonth";
}
