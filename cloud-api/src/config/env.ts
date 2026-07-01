import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

export const PRODUCTION_APP_URL = "https://web-gamma-silk-53.vercel.app";

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  JWT_SECRET: z.string().min(8),
  DEV_AUTH_TOKEN: z.string().min(8),
  DEV_USER_PLAN: z.enum(["free", "pro"]).default("free"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRO_PRICE_ID: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  PUBLIC_APP_URL: z.string().url().default(PRODUCTION_APP_URL),
  REWRITE_RATE_LIMIT_FREE_PER_MIN: z.coerce.number().int().positive().default(10),
  REWRITE_RATE_LIMIT_PRO_PER_MIN: z.coerce.number().int().positive().default(30),
  ALLOWED_EXTENSION_ORIGINS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Missing or invalid environment variables:");
  for (const [key, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${errors?.join(", ")}`);
  }
  process.exit(1);
}
export const env = parsed.data;

export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

export function getAllowedOrigins(): string[] {
  const fromEnv = (env.ALLOWED_EXTENSION_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...fromEnv, "http://localhost:3000", "http://127.0.0.1:3000"])];
}
