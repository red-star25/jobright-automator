import Stripe from "stripe";
import { env } from "../config/env.js";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

// Future: Stripe webhook handler updates users.plan via stripe_customer_id.
