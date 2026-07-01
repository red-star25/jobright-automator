import * as jose from "jose";
import { env } from "../config/env.js";

export type TokenClaims = {
  sub: string;
  email?: string;
  plan?: string;
};

const ISSUER = "insiderreach-cloud-api";
const IR_TOKEN_TTL = "7d";

let supabaseJwks: jose.JWTVerifyGetKey | null = null;

function getSupabaseJwks(): jose.JWTVerifyGetKey | null {
  if (!env.SUPABASE_URL) return null;
  if (!supabaseJwks) {
    const base = env.SUPABASE_URL.replace(/\/$/, "");
    supabaseJwks = jose.createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
  }
  return supabaseJwks;
}

function emailFromPayload(payload: jose.JWTPayload): string | undefined {
  if (typeof payload.email === "string") return payload.email;
  const meta = payload.user_metadata;
  if (meta && typeof meta === "object" && typeof (meta as { email?: string }).email === "string") {
    return (meta as { email: string }).email;
  }
  return undefined;
}

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

async function verifySupabaseWithJwks(token: string): Promise<TokenClaims | null> {
  const jwks = getSupabaseJwks();
  if (!jwks || !env.SUPABASE_URL) return null;

  const issuer = `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
  try {
    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer,
      algorithms: ["ES256"],
    });
    if (!payload.sub) return null;
    return { sub: String(payload.sub), email: emailFromPayload(payload) };
  } catch {
    return null;
  }
}

async function verifySupabaseWithLegacySecret(token: string): Promise<TokenClaims | null> {
  if (!env.SUPABASE_JWT_SECRET) return null;
  try {
    const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    if (!payload.sub) return null;
    return { sub: String(payload.sub), email: emailFromPayload(payload) };
  } catch {
    return null;
  }
}

/** Accepts Supabase access tokens (ES256 via JWKS, or legacy HS256 secret). */
export async function verifySupabaseAccessToken(token: string): Promise<TokenClaims | null> {
  const fromJwks = await verifySupabaseWithJwks(token);
  if (fromJwks) return fromJwks;
  return verifySupabaseWithLegacySecret(token);
}

export function getTokenExpirySeconds(): number {
  return 7 * 24 * 60 * 60;
}
