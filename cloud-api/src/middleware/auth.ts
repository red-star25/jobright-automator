import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { ensureDevUser, getUserById, type AuthUser } from "../services/usage.js";

function parseBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const token = parseBearerToken(request.headers.authorization);
  if (!token) {
    return reply.code(401).send({ error: "Missing Bearer token." });
  }

  if (token === env.DEV_AUTH_TOKEN) {
    const user = await ensureDevUser();
    request.user = user;
    return;
  }

  if (looksLikeJwt(token)) {
    return reply.code(401).send({ error: "JWT auth not enabled yet." });
  }

  return reply.code(401).send({ error: "Invalid token." });
}

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) {
    throw new Error("User not authenticated");
  }
  return request.user;
}

export async function resolveUserFromToken(token: string): Promise<AuthUser | null> {
  if (token === env.DEV_AUTH_TOKEN) {
    return ensureDevUser();
  }
  // Future JWT: verify and load user by sub claim
  return null;
}

export async function refreshUserPlan(userId: string): Promise<AuthUser | null> {
  return getUserById(userId);
}
