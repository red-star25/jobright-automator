import { NextResponse } from "next/server";

/** Billing webhooks are handled by cloud-api (Railway), not this app. */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "This webhook endpoint is deprecated. Point Stripe at your cloud-api URL: POST /v1/stripe/webhook",
    },
    { status: 410 }
  );
}
