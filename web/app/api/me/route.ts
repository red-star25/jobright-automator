import { NextRequest, NextResponse } from "next/server";
import { getLimitsForPlan } from "@/lib/billing/plans";
import { appUrl, getStripe } from "@/lib/stripe";
import { getUserFromBearerToken } from "@/lib/supabase/server-auth";
import { ensureProfile, getUsageSnapshot } from "@/lib/usage";

export async function GET(request: NextRequest) {
  const user = await getUserFromBearerToken(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const profile = await ensureProfile(user.id, user.email);
  const usage = await getUsageSnapshot(user.id, profile.plan);
  const planInfo = getLimitsForPlan(profile.plan);

  return NextResponse.json({
    ok: true,
    email: profile.email || user.email,
    plan: profile.plan,
    subscriptionStatus: profile.subscription_status || "none",
    usage: { rewrite: usage.rewrite, pro: usage.pro },
    limits: usage.limits,
    periodStart: usage.periodStart,
    planLabel: planInfo.label,
    upgradeUrl: appUrl("/dashboard"),
  });
}

export async function POST(request: NextRequest) {
  const user = await getUserFromBearerToken(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.action !== "portal") {
    return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
  }

  const profile = await ensureProfile(user.id, user.email);
  if (!profile.stripe_customer_id) {
    return NextResponse.json({ ok: false, error: "No billing account found." }, { status: 400 });
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: appUrl("/dashboard"),
  });

  return NextResponse.json({ ok: true, url: session.url });
}
