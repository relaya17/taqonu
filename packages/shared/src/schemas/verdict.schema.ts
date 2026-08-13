import { z } from "zod";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const releaseVerdictStatusSchema = z.enum([
  "READY",
  "CONDITIONAL",
  "BLOCKED",
  "UNKNOWN",
]);

/** Killer product surface — "Is this release actually safe?" */
export const atlasVerdictSchema = z.object({
  projectId: uuidSchema,
  projectName: z.string(),
  status: releaseVerdictStatusSchema,
  confidence: z.number().min(0).max(1),
  productionReadiness: z.number().min(0).max(100),
  criticalBlockers: z.number().int().min(0),
  highRisks: z.number().int().min(0),
  unverifiedClaims: z.number().int().min(0),
  staleClaims: z.number().int().min(0),
  verifiedClaims: z.number().int().min(0),
  evidenceCoverage: z.number().min(0).max(1),
  evidenceCount: z.number().int().min(0),
  conflictCount: z.number().int().min(0),
  patchesProposed: z.number().int().min(0),
  patchesAccepted: z.number().int().min(0),
  lastVerifiedAt: isoDateTimeSchema,
  gateVersion: z.string(),
  plainLanguageSummary: z.string().max(4000),
  blockerItems: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      severity: z.enum(["CRITICAL", "HIGH", "MEDIUM"]),
      epistemicState: epistemicStateSchema,
      evidenceRefs: z.array(z.string()).default([]),
    }),
  ),
  certificateId: uuidSchema.nullable(),
});

export const evidenceReportSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  projectName: z.string(),
  generatedAt: isoDateTimeSchema,
  verdict: atlasVerdictSchema,
  sections: z.array(
    z.object({
      title: z.string(),
      body: z.string(),
      evidenceRefs: z.array(z.string()).default([]),
    }),
  ),
  markdown: z.string(),
});

export const connectExternalRepoSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  workspaceRoot: z.string().min(1).max(1000),
  description: z.string().max(2000).optional(),
  /** Optional: sync project metadata + evidence graph slot to Atlas cloud (freemium). */
  syncEvidenceToCloud: z.boolean().optional().default(false),
});

/**
 * Unified BYO import — any customer repo.
 * Lab names (BrokerOS, etc.) are demos only; product accepts arbitrary sources.
 * Atlas never requires uploading the full source tree.
 */
export const importProjectSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("local"),
    name: z.string().min(1).max(120),
    slug: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/),
    workspaceRoot: z.string().min(1).max(1000),
    description: z.string().max(2000).optional(),
    syncEvidenceToCloud: z.boolean().optional().default(false),
  }),
  z.object({
    source: z.literal("github"),
    /** owner/repo or https://github.com/owner/repo */
    repo: z.string().min(3).max(300),
    name: z.string().min(1).max(120).optional(),
    slug: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    /** Optional one-shot PAT (private repos / higher rate limits). */
    token: z.string().min(8).max(500).optional(),
    reconcile: z.boolean().optional().default(true),
    syncEvidenceToCloud: z.boolean().optional().default(false),
  }),
  z.object({
    source: z.literal("remote"),
    /** Any https git hosting URL — metadata only; code stays at the provider. */
    repoUrl: z.string().url().max(500),
    name: z.string().min(1).max(120),
    slug: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/),
    description: z.string().max(2000).optional(),
    syncEvidenceToCloud: z.boolean().optional().default(false),
  }),
]);

export const usageAnalyticsSchema = z.object({
  projectsConnected: z.number().int().min(0),
  certificatesIssued: z.number().int().min(0),
  verdictsRequested: z.number().int().min(0),
  loopRuns: z.number().int().min(0),
  patchesProposed: z.number().int().min(0),
  patchesApplied: z.number().int().min(0),
  benchmarkSuites: z.number().int().min(0),
  evidenceRecords: z.number().int().min(0),
  designPartnerSessions: z.number().int().min(0),
  reportsGenerated: z.number().int().min(0).default(0),
  updatedAt: isoDateTimeSchema,
});

export type AtlasVerdict = z.infer<typeof atlasVerdictSchema>;
export type EvidenceReport = z.infer<typeof evidenceReportSchema>;
export type UsageAnalytics = z.infer<typeof usageAnalyticsSchema>;
export type ImportProjectRequest = z.infer<typeof importProjectSchema>;
