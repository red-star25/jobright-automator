import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function setPlanForUser(userId: string, plan: "free" | "pro", subscriptionStatus: string) {
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ plan, subscription_status: subscriptionStatus, updated_at: new Date().toISOString() })
    .eq("id", userId);
}

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const admin = createAdminClient();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.supabase_user_id;
    if (userId) {
      await setPlanForUser(userId, "pro", "active");
      if (session.customer && typeof session.customer === "string") {
        await admin.from("profiles").update({ stripe_customer_id: session.customer }).eq("id", userId);
      }
    }
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const { data: profile } = await admin.from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
    if (profile) {
      const active = subscription.status === "active" || subscription.status === "trialing";
      await setPlanForUser(profile.id, active ? "pro" : "free", subscription.status);
    }
  }

  return NextResponse.json({ received: true });
}
