import type { FastifyInstance } from "fastify";
import { getTokenExpirySeconds, signInsiderReachToken } from "../services/auth-tokens.js";
import { authenticate, requireUser, resolveUserFromToken } from "../middleware/auth.js";
import { getUsageSnapshot } from "../services/usage.js";

function parseBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export async function authSessionRoutes(app: FastifyInstance) {
  app.post("/v1/auth/session", async (request, reply) => {
    const token = parseBearerToken(request.headers.authorization);
    if (!token) {
      return reply.code(401).send({ error: "Missing Bearer token.", code: "UNAUTHORIZED" });
    }

    const user = await resolveUserFromToken(token);
    if (!user) {
      return reply.code(401).send({ error: "Invalid or expired token.", code: "UNAUTHORIZED" });
    }

    const accessToken = await signInsiderReachToken(user);
    const expiresAt = Math.floor(Date.now() / 1000) + getTokenExpirySeconds();
    const snapshot = await getUsageSnapshot(user);

    return reply.send({
      ok: true,
      access_token: accessToken,
      expires_at: expiresAt,
      email: snapshot.email,
      plan: snapshot.plan,
      usage: snapshot.usage,
      limits: snapshot.limits,
    });
  });

  app.get("/v1/auth/session", { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const snapshot = await getUsageSnapshot(user);
    return reply.send({
      ok: true,
      email: snapshot.email,
      plan: snapshot.plan,
      usage: snapshot.usage,
      limits: snapshot.limits,
    });
  });
}
