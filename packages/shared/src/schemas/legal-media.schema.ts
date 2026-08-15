import { z } from "zod";
import { epistemicStateSchema, uuidSchema } from "./common.schema.js";

export const lawyerReadinessSchema = z.enum([
  "READY_FOR_COUNSEL",
  "NEEDS_FIXES",
  "INSUFFICIENT_EVIDENCE",
]);

export const legalMediaFindingSchema = z.object({
  id: z.string().min(1),
  area: z.string().min(1).max(80),
  status: z.enum(["PASS", "WARN", "FAIL", "UNKNOWN"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  title: z.string().min(1).max(300),
  note: z.string().max(2000),
  fixHint: z.string().max(2000),
  evidenceRefs: z.array(z.string()).default([]),
  epistemicState: epistemicStateSchema,
});

export const verifiedSourceCiteSchema = z.object({
  id: z.string(),
  titleEn: z.string(),
  titleHe: z.string(),
  url: z.string().url(),
  kind: z.enum(["GOVERNMENT", "UNIVERSITY", "TREATY_OR_OFFICIAL_BODY"]),
  region: z.enum(["IL", "EU", "US", "INTL"]),
  topics: z.array(z.string()),
});

export const legalMediaReviewSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  generatedAt: z.string().datetime(),
  disclaimerEn: z.string(),
  disclaimerHe: z.string(),
  disclaimerAr: z.string(),
  lawyerReadiness: lawyerReadinessSchema,
  summaryEn: z.string(),
  summaryHe: z.string(),
  findings: z.array(legalMediaFindingSchema),
  counselTopics: z.array(z.string()),
  verifiedSources: z.array(verifiedSourceCiteSchema),
  epistemicState: epistemicStateSchema,
  notALawyer: z.literal(true),
  briefMarkdown: z.string().min(1),
});

export type LawyerReadiness = z.infer<typeof lawyerReadinessSchema>;
export type LegalMediaFinding = z.infer<typeof legalMediaFindingSchema>;
export type LegalMediaReview = z.infer<typeof legalMediaReviewSchema>;
