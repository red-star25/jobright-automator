import { getLimitsForPlan } from "@/lib/billing/plans";

export type CloudMeResponse = {
  userId: string;
  email: string | null;
  plan: string;
  usage: { rewrite: number; rewritePro: number };
  limits: { rewrite: number; rewritePro: number };
  periodStart: string;
};

export type DashboardMeResponse = {
  ok: true;
  email?: string;
  plan: string;
  subscriptionStatus: string;
  usage: { rewrite: number; pro: number };
  limits: { rewrite: number; pro: number };
  periodStart: string;
  planLabel: string;
};

function cloudApiBase(): string {
  const base =
    process.env.CLOUD_API_URL ||
    process.env.NEXT_PUBLIC_CLOUD_API_URL ||
    "https://jobright-automator-production.up.railway.app";
  return base.replace(/\/$/, "");
}

export async function cloudApiRequest<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${cloudApiBase()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  let json: Record<string, unknown> | null = null;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const error =
      (typeof json?.error === "string" && json.error) ||
      `Cloud API request failed (${response.status}).`;
    return { ok: false, status: response.status, error };
  }

  return { ok: true, data: json as T };
}

export function normalizeCloudMe(data: CloudMeResponse): DashboardMeResponse {
  const plan = data.plan === "pro" ? "pro" : "free";
  return {
    ok: true,
    email: data.email || undefined,
    plan,
    subscriptionStatus: plan === "pro" ? "active" : "none",
    usage: {
      rewrite: data.usage?.rewrite ?? 0,
      pro: data.usage?.rewritePro ?? 0,
    },
    limits: {
      rewrite: data.limits?.rewrite ?? 0,
      pro: data.limits?.rewritePro ?? 0,
    },
    periodStart: data.periodStart,
    planLabel: getLimitsForPlan(plan).label,
  };
}
