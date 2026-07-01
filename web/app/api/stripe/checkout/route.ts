import { NextRequest, NextResponse } from "next/server";
import { appUrl, getStripe } from "@/lib/stripe";
import { getUserFromBearerToken } from "@/lib/supabase/server-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProfile } from "@/lib/usage";

export async function POST(request: NextRequest) {
  const user = await getUserFromBearerToken(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ ok: false, error: "Billing is not configured." }, { status: 503 });
  }

  const profile = await ensureProfile(user.id, user.email);
  const stripe = getStripe();
  const admin = createAdminClient();

  let customerId = profile.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile.email || user.email || undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: appUrl("/dashboard?checkout=success"),
    cancel_url: appUrl("/dashboard?checkout=cancel"),
    metadata: { supabase_user_id: user.id },
  });

  return NextResponse.json({ ok: true, url: session.url });
}
