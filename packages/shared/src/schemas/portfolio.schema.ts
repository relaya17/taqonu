import { z } from "zod";
import {
  confidenceSchema,
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const portfolioPatternKindSchema = z.enum([
  "SHARED_ARCHITECTURE",
  "DUPLICATED_INFRASTRUCTURE",
  "DUPLICATED_AUTH",
  "DUPLICATED_VALIDATION",
  "REPEATED_DEFECT",
  "DECISION_DIVERGENCE",
  "REUSABLE_PACKAGE_CANDIDATE",
  "SECURITY_INCONSISTENCY",
  "TESTING_GAP",
]);

export const portfolioPatternSchema = z.object({
  id: uuidSchema,
  kind: portfolioPatternKindSchema,
  title: z.string().min(1).max(500),
  summary: z.string().min(1).max(4000),
  projectIds: z.array(uuidSchema).min(1),
  evidenceIds: z.array(uuidSchema).default([]),
  graphNodeIds: z.array(uuidSchema).default([]),
  epistemicState: epistemicStateSchema,
  confidence: confidenceSchema,
  detectedAt: isoDateTimeSchema,
});

export const portfolioOverviewSchema = z.object({
  ownerId: uuidSchema,
  projectCount: z.number().int().min(0),
  projects: z.array(
    z.object({
      id: uuidSchema,
      slug: z.string(),
      name: z.string(),
      stateEpistemic: epistemicStateSchema.nullable(),
      openRiskCount: z.number().int().min(0),
      lastReconciledAt: isoDateTimeSchema.nullable(),
    }),
  ),
  topPatterns: z.array(portfolioPatternSchema),
  asOf: isoDateTimeSchema,
  epistemicState: z.enum(["INFERRED", "UNKNOWN"]),
});

export type PortfolioPattern = z.infer<typeof portfolioPatternSchema>;
export type PortfolioOverview = z.infer<typeof portfolioOverviewSchema>;
