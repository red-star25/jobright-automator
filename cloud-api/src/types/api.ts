import { z } from "zod";

export const jobContextSchema = z
  .object({
    responsibilities: z.array(z.string()).optional(),
    required: z.array(z.string()).optional(),
    preferred: z.array(z.string()).optional(),
    matchedSkills: z.array(z.string()).optional(),
  })
  .optional();

export const rewriteRequestSchema = z.object({
  mode: z.enum(["rewrite", "rewritePro"]),
  channel: z.enum(["email", "linkedin"]),
  tone: z.string().min(1).max(100),
  originalMessage: z.string().min(1).max(20000),
  subject: z.string().max(500).optional(),
  personName: z.string().max(200).optional(),
  personTitle: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  jobTitle: z.string().max(200).optional(),
  jobContext: jobContextSchema,
  resumeText: z.string().max(12000).optional(),
  customInstructions: z.string().max(4000).optional(),
  maxChars: z.number().int().min(50).max(500).optional(),
  extensionVersion: z.string().max(50).optional(),
});

export type RewriteRequest = z.infer<typeof rewriteRequestSchema>;

export const rewriteResponseSchema = z.object({
  text: z.string(),
  subject: z.string().optional(),
  proofPoint: z.string().optional(),
  cached: z.boolean().optional(),
});

export const usageEventSchema = z.object({
  eventType: z.enum(["rewrite_requested", "rewrite_accepted", "rewrite_rejected", "run_started"]),
  mode: z.enum(["rewrite", "rewritePro"]).optional(),
  channel: z.enum(["email", "linkedin"]).optional(),
  extensionVersion: z.string().max(50).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UsageEventRequest = z.infer<typeof usageEventSchema>;

declare module "fastify" {
  interface FastifyRequest {
    user?: import("../services/usage.js").AuthUser;
  }
}
