import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { authenticate, requireUser } from "../middleware/auth.js";
import { getStripe } from "../services/stripe.js";
import {
  getUserByStripeCustomerId,
  setStripeCustomerId,
  setUserPlan,
} from "../services/usage.js";

function appUrl(path = "") {
  const base = process.env.PUBLIC_APP_URL || "https://app.insiderreach.com";
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function stripeRoutes(app: FastifyInstance) {
  app.post("/v1/stripe/checkout", { preHandler: authenticate }, async (request, reply) => {
    const stripe = getStripe();
    const priceId = env.STRIPE_PRO_PRICE_ID;
    if (!stripe || !priceId) {
      return reply.code(503).send({ error: "Billing is not configured." });
    }

    const user = requireUser(request);
    const row = await query<{ stripe_customer_id: string | null }>(
      `select stripe_customer_id from users where id = $1`,
      [user.id]
    );
    let customerId = row.rows[0]?.stripe_customer_id || null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await setStripeCustomerId(user.id, customerId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: appUrl("/dashboard?checkout=success"),
      cancel_url: appUrl("/dashboard?checkout=cancel"),
      metadata: { user_id: user.id },
    });

    return reply.send({ ok: true, url: session.url });
  });

  app.post("/v1/stripe/portal", { preHandler: authenticate }, async (request, reply) => {
    const stripe = getStripe();
    if (!stripe) {
      return reply.code(503).send({ error: "Billing is not configured." });
    }

    const user = requireUser(request);
    const row = await query<{ stripe_customer_id: string | null }>(
      `select stripe_customer_id from users where id = $1`,
      [user.id]
    );
    const customerId = row.rows[0]?.stripe_customer_id || null;
    if (!customerId) {
      return reply.code(400).send({ error: "No billing account found." });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: appUrl("/dashboard"),
    });

    return reply.send({ ok: true, url: session.url });
  });

  app.post("/v1/stripe/webhook", async (request, reply) => {
    const stripe = getStripe();
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !webhookSecret) {
      return reply.code(503).send({ error: "Webhook not configured." });
    }

    const signature = request.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      return reply.code(400).send({ error: "Missing stripe-signature." });
    }

    const rawBody = (request as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      return reply.code(400).send({ error: "Missing raw body." });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid signature";
      return reply.code(400).send({ error: message });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;
      if (userId) {
        await setUserPlan(userId, "pro");
        if (session.customer && typeof session.customer === "string") {
          await setStripeCustomerId(userId, session.customer);
        }
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
      const user = await getUserByStripeCustomerId(customerId);
      if (user) {
        const active =
          subscription.status === "active" || subscription.status === "trialing";
        await setUserPlan(user.id, active ? "pro" : "free");
      }
    }

    return reply.send({ received: true });
  });
}
