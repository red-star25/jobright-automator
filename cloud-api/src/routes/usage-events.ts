import type { FastifyInstance } from "fastify";
import { authenticate, requireUser } from "../middleware/auth.js";
import { logUsageEvent } from "../services/usage.js";
import { usageEventSchema } from "../types/api.js";

export async function usageEventRoutes(app: FastifyInstance) {
  app.post("/v1/usage/events", { preHandler: authenticate }, async (request, reply) => {
    const parsed = usageEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body.",
        details: parsed.error.flatten(),
      });
    }

    const user = requireUser(request);
    const body = parsed.data;

    await logUsageEvent(user.id, {
      eventType: body.eventType,
      mode: body.mode,
      channel: body.channel,
      extensionVersion: body.extensionVersion,
      metadata: body.metadata,
    });

    request.log.info({
      userId: user.id,
      eventType: body.eventType,
      mode: body.mode,
      channel: body.channel,
      extensionVersion: body.extensionVersion,
      msg: "usage_event",
    });

    return reply.send({ ok: true });
  });
}
