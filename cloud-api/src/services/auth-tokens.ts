import * as jose from "jose";
import { env } from "../config/env.js";

export type TokenClaims = {
  sub: string;
  email?: string;
  plan?: string;
};

const ISSUER = "insiderreach-cloud-api";
const IR_TOKEN_TTL = "7d";

export async function signInsiderReachToken(user: { id: string; email?: string | null; plan: string }) {
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  return new jose.SignJWT({
    email: user.email || undefined,
    plan: user.plan,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(IR_TOKEN_TTL)
    .sign(secret);
}

export async function verifyInsiderReachToken(token: string): Promise<TokenClaims | null> {
  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: ISSUER,
    });
    if (!payload.sub) return null;
    return {
      sub: String(payload.sub),
      email: typeof payload.email === "string" ? payload.email : undefined,
      plan: typeof payload.plan === "string" ? payload.plan : undefined,
    };
  } catch {
    return null;
  }
}

export async function verifySupabaseAccessToken(token: string): Promise<TokenClaims | null> {
  if (!env.SUPABASE_JWT_SECRET) return null;
  try {
    const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    if (!payload.sub) return null;
    const email =
      typeof payload.email === "string"
        ? payload.email
        : typeof (payload as { user_metadata?: { email?: string } }).user_metadata?.email === "string"
          ? (payload as { user_metadata: { email: string } }).user_metadata.email
          : undefined;
    return { sub: String(payload.sub), email };
  } catch {
    return null;
  }
}

export function getTokenExpirySeconds(): number {
  return 7 * 24 * 60 * 60;
}
