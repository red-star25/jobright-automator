import type { FastifyInstance } from "fastify";
import { authenticate, requireUser } from "../middleware/auth.js";
import { executeRewrite, safeRewriteLogMeta } from "../services/rewrite.js";
import { rewriteRequestSchema } from "../types/api.js";

export async function rewriteRoutes(app: FastifyInstance) {
  app.post("/v1/rewrite", { preHandler: authenticate }, async (request, reply) => {
    const parsed = rewriteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body.",
        details: parsed.error.flatten(),
      });
    }

    const user = requireUser(request);
    const body = parsed.data;

    request.log.info({
      ...safeRewriteLogMeta(body),
      userId: user.id,
      msg: "rewrite_request",
    });

    const result = await executeRewrite(user, body);
    if (!result.ok) {
      return reply.code(result.status).send({
        error: result.error,
        code: result.code,
        usage: result.usage,
        limits: result.limits,
      });
    }

    request.log.info({
      userId: user.id,
      mode: body.mode,
      channel: body.channel,
      cached: result.data.cached,
      outputChars: result.data.text.length,
      msg: "rewrite_success",
    });

    return reply.send(result.data);
  });
}
