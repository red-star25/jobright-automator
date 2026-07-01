import Stripe from "stripe";

export const PRODUCTION_APP_URL = "https://web-gamma-silk-53.vercel.app";

let stripeClient: Stripe | null = null;

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  if (!stripeClient) stripeClient = new Stripe(key);
  return stripeClient;
}

export function appUrl(path = "") {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === "production" ? PRODUCTION_APP_URL : "http://localhost:3000");
  return `${base.replace(/\/$/, "")}${path}`;
}
