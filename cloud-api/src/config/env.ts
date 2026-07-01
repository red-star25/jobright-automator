import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  JWT_SECRET: z.string().min(8),
  DEV_AUTH_TOKEN: z.string().min(8),
  DEV_USER_PLAN: z.enum(["free", "pro"]).default("free"),
  STRIPE_SECRET_KEY: z.string().optional(),
  ALLOWED_EXTENSION_ORIGINS: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

export function getAllowedOrigins(): string[] {
  const fromEnv = (env.ALLOWED_EXTENSION_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...fromEnv, "http://localhost:3000", "http://127.0.0.1:3000"])];
}
