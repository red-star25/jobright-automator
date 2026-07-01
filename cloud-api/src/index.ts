import Fastify from "fastify";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { registerCors } from "./middleware/cors.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { rewriteRoutes } from "./routes/rewrite.js";
import { usageEventRoutes } from "./routes/usage-events.js";
import { pruneExpiredCache } from "./services/cache.js";

const app = Fastify({
  logger: {
    level: "info",
    redact: ["req.headers.authorization", "OPENAI_API_KEY"],
  },
});

await registerCors(app);
await app.register(healthRoutes);
await app.register(meRoutes);
await app.register(rewriteRoutes);
await app.register(usageEventRoutes);

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  reply.code(500).send({ error: "Internal server error." });
});

async function start() {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`InsiderReach Cloud API listening on port ${env.PORT}`);

  try {
    await pool.query("select 1");
    await pruneExpiredCache();
    app.log.info("Database connected");
  } catch (err) {
    app.log.error({ err }, "Database warmup failed — check DATABASE_URL on Railway");
  }
}

start().catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
