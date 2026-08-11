import { z } from "zod";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const readinessDimensionKeySchema = z.enum([
  "security",
  "reliability",
  "testing",
  "infrastructure",
  "observability",
  "documentation",
]);

export const readinessDimensionSchema = z.object({
  key: readinessDimensionKeySchema,
  score: z.number().min(0).max(100),
  epistemicState: epistemicStateSchema,
  evidenceRefs: z.array(z.string()).default([]),
  notes: z.string().max(2000),
});

/** Sellable wedge — every score opens to Evidence. */
export const productionReadinessCertificateSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  projectName: z.string().min(1).max(200),
  overallScore: z.number().min(0).max(100),
  dimensions: z.array(readinessDimensionSchema).min(1),
  blockers: z.number().int().min(0),
  highRisks: z.number().int().min(0),
  unknownClaims: z.number().int().min(0),
  blockerSummaries: z.array(z.string()).default([]),
  highRiskSummaries: z.array(z.string()).default([]),
  unknownSummaries: z.array(z.string()).default([]),
  lastVerifiedAt: isoDateTimeSchema,
  plainLanguageSummary: z.string().max(4000),
  gateGraphId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export const issueCertificateSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  projectName: z.string().min(1).max(200).optional(),
  workspaceRoot: z.string().max(1000).optional(),
});

export type ProductionReadinessCertificate = z.infer<
  typeof productionReadinessCertificateSchema
>;
export type ReadinessDimension = z.infer<typeof readinessDimensionSchema>;
