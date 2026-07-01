import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import {
  verifyInsiderReachToken,
  verifySupabaseAccessToken,
} from "../services/auth-tokens.js";
import {
  ensureDevUser,
  ensureUserFromSupabase,
  getUserById,
  type AuthUser,
} from "../services/usage.js";

function parseBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

async function resolveUserFromToken(token: string): Promise<AuthUser | null> {
  if (token === env.DEV_AUTH_TOKEN) {
    return ensureDevUser();
  }

  if (!looksLikeJwt(token)) {
    return null;
  }

  const irClaims = await verifyInsiderReachToken(token);
  if (irClaims) {
    const user = await getUserById(irClaims.sub);
    if (user) return user;
    return ensureUserFromSupabase(irClaims.sub, irClaims.email || null);
  }

  const supabaseClaims = await verifySupabaseAccessToken(token);
  if (supabaseClaims) {
    return ensureUserFromSupabase(supabaseClaims.sub, supabaseClaims.email || null);
  }

  return null;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const token = parseBearerToken(request.headers.authorization);
  if (!token) {
    return reply.code(401).send({ error: "Missing Bearer token.", code: "UNAUTHORIZED" });
  }

  const user = await resolveUserFromToken(token);
  if (!user) {
    return reply.code(401).send({ error: "Invalid or expired token.", code: "UNAUTHORIZED" });
  }

  request.user = user;
}

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) {
    throw new Error("User not authenticated");
  }
  return request.user;
}

export { resolveUserFromToken };
