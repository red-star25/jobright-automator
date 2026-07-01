export type PlanId = "free" | "pro";

export type PlanLimits = {
  rewritePerMonth: number;
  proPerMonth: number;
  label: string;
  priceMonthlyUsd: number | null;
};

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    label: "Free",
    rewritePerMonth: 25,
    proPerMonth: 5,
    priceMonthlyUsd: null,
  },
  pro: {
    label: "Pro",
    rewritePerMonth: 500,
    proPerMonth: 150,
    priceMonthlyUsd: 12,
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
