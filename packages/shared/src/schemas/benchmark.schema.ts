import { z } from "zod";
import { AUTHORITY_TIERS } from "../constants/tools.js";
import {
  confidenceSchema,
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const benchmarkDomainSchema = z.enum([
  "DESIGN",
  "MARKETING",
  "SEO",
  "SECURITY",
  "CODE_QUALITY",
  "ACCESSIBILITY",
  "PERFORMANCE",
  "PRIVACY",
]);

export const benchmarkSourceSchema = z.object({
  id: uuidSchema,
  domain: benchmarkDomainSchema,
  organization: z.string().min(1).max(255),
  url: z.string().url(),
  authorityLevel: z.enum(AUTHORITY_TIERS),
  allowed: z.boolean(),
});

/** Gap vs world-class practice — always PROPOSED until cited CONFIRMED claim exists. */
export const benchmarkGapSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  domain: benchmarkDomainSchema,
  statement: z.string().min(1).max(2000),
  epistemicState: z.enum(["PROPOSED", "CONFIRMED", "UNKNOWN"]),
  confidence: confidenceSchema,
  citationIds: z.array(uuidSchema).default([]),
  detectedAt: isoDateTimeSchema,
});

export type BenchmarkGap = z.infer<typeof benchmarkGapSchema>;
export type BenchmarkSource = z.infer<typeof benchmarkSourceSchema>;
