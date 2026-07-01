import type { FastifyInstance } from "fastify";
import { authenticate, requireUser } from "../middleware/auth.js";
import { getUsageSnapshot } from "../services/usage.js";

export async function meRoutes(app: FastifyInstance) {
  app.get("/v1/me", { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const fresh = await getUsageSnapshot(user);
    return reply.send(fresh);
  });
}
