import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    ok: true,
    service: "insiderreach-cloud-api",
    version: "1.0.0",
  }));
}
