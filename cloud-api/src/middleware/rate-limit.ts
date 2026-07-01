import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { checkRateLimit } from "../services/rate-limit.js";

export async function rewriteRateLimit(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user) return;

  const limit =
    user.plan === "pro"
      ? env.REWRITE_RATE_LIMIT_PRO_PER_MIN
      : env.REWRITE_RATE_LIMIT_FREE_PER_MIN;

  const result = checkRateLimit(`rewrite:${user.id}`, limit);
  if (result.allowed) return;

  reply.header("Retry-After", String(result.retryAfterSeconds));
  return reply.code(429).send({
    error: "Too many rewrite requests. Please wait before trying again.",
    code: "RATE_LIMITED",
    retryAfterSeconds: result.retryAfterSeconds,
  });
}
