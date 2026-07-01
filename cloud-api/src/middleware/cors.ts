import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { getAllowedOrigins } from "../config/env.js";

function isChromeExtensionOrigin(origin: string): boolean {
  return origin.startsWith("chrome-extension://");
}

export async function registerCors(app: FastifyInstance) {
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      const allowed = getAllowedOrigins();
      if (allowed.includes(origin) || origin.startsWith("http://localhost:")) {
        cb(null, true);
        return;
      }
      // Chrome extension service workers send Origin: chrome-extension://<id>.
      // When ALLOWED_EXTENSION_ORIGINS is unset, allow any extension (local dev).
      // In production, set ALLOWED_EXTENSION_ORIGINS to your published extension ID(s).
      if (isChromeExtensionOrigin(origin)) {
        const extensionAllowlist = allowed.filter(isChromeExtensionOrigin);
        if (extensionAllowlist.length === 0 || extensionAllowlist.includes(origin)) {
          cb(null, true);
          return;
        }
      }
      cb(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
  });
}
