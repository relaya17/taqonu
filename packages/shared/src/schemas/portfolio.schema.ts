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

/** System-health dimension keys used in portfolio rollups (ADR-019). */
export const portfolioHealthDimensionKeySchema = z.enum([
  "architecture",
  "security",
  "dependencies",
  "codeQuality",
  "testing",
  "performance",
  "observability",
]);

export const portfolioVerdictHintSchema = z.enum([
  "READY",
  "CONDITIONAL",
  "BLOCKED",
  "UNKNOWN",
]);

export const portfolioHealthBlockerSchema = z.object({
  title: z.string().min(1).max(500),
  severity: z.enum(["CRITICAL", "HIGH"]),
  category: z.string().max(80).optional(),
});

export const portfolioHealthProjectItemSchema = z.object({
  projectId: uuidSchema,
  slug: z.string(),
  name: z.string(),
  workspaceRoot: z.string().nullable(),
  overallScore: z.number().min(0).max(100).nullable(),
  criticalIssues: z.number().int().min(0),
  highRisk: z.number().int().min(0).default(0),
  constitutionScore: z.number().min(0).max(100).nullable(),
  architectureDriftScore: z.number().min(0).max(100).nullable().optional(),
  dimensions: z
    .array(
      z.object({
        key: portfolioHealthDimensionKeySchema,
        score: z.number().min(0).max(100),
      }),
    )
    .default([]),
  blockers: z.array(portfolioHealthBlockerSchema).default([]),
  driftCount: z.number().int().min(0).default(0),
  verdictHint: portfolioVerdictHintSchema.default("UNKNOWN"),
  epistemicState: epistemicStateSchema,
  notes: z.string().max(2000),
});

export const portfolioSharedDriftPatternSchema = z.object({
  key: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  category: z.string().max(80).optional(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  projectIds: z.array(uuidSchema).min(2),
  projectCount: z.number().int().min(2),
  occurrenceCount: z.number().int().min(2),
});

export const portfolioWorstDimensionSchema = z.object({
  key: portfolioHealthDimensionKeySchema,
  worstScore: z.number().min(0).max(100),
  averageScore: z.number().min(0).max(100),
  projectId: uuidSchema,
  projectName: z.string(),
});

export const portfolioHealthAggregateSchema = z.object({
  averageScore: z.number().min(0).max(100).nullable(),
  /** Conservative portfolio score — min overall across audited projects. */
  worstOfScore: z.number().min(0).max(100).nullable(),
  criticalTotal: z.number().int().min(0),
  highTotal: z.number().int().min(0),
  constitutionWorst: z.number().min(0).max(100).nullable(),
  constitutionAverage: z.number().min(0).max(100).nullable(),
  openBlockers: z.number().int().min(0),
  worstDimensions: z.array(portfolioWorstDimensionSchema),
  sharedPatterns: z.array(portfolioSharedDriftPatternSchema),
  portfolioVerdict: portfolioVerdictHintSchema,
  /** Count of projects per verdict hint (READY/CONDITIONAL/BLOCKED/UNKNOWN). */
  verdictSpread: z
    .object({
      READY: z.number().int().min(0),
      CONDITIONAL: z.number().int().min(0),
      BLOCKED: z.number().int().min(0),
      UNKNOWN: z.number().int().min(0),
    })
    .optional(),
  /** Share of audited projects with constitution score ≥ 70. */
  constitutionPassRate: z.number().min(0).max(1).nullable().optional(),
  /** Audited projects missing workspaceRoot (cannot deepen scan). */
  missingWorkspaceRoot: z.number().int().min(0).optional(),
});

export const portfolioHealthReportSchema = z.object({
  projectCount: z.number().int().min(0),
  audited: z.number().int().min(0),
  skipped: z.number().int().min(0),
  /** @deprecated Prefer aggregate.averageScore — kept for UI back-compat. */
  averageScore: z.number().min(0).max(100).nullable(),
  criticalTotal: z.number().int().min(0),
  aggregate: portfolioHealthAggregateSchema,
  items: z.array(portfolioHealthProjectItemSchema),
  epistemicState: epistemicStateSchema,
  asOf: isoDateTimeSchema,
  note: z.string().max(2000),
  persisted: z.boolean().optional(),
});

/** Link status for portfolio discovery (workspaceRoot vs registered project). */
export const portfolioDiscoveryLinkStatusSchema = z.enum([
  "LINKED",
  "UNLINKED",
  "MISSING_ON_DISK",
]);

export const portfolioDiscoverySourceKindSchema = z.enum([
  "local",
  "github_token",
  "github_app",
  "manual",
]);

export const portfolioDiscoveryProjectItemSchema = z.object({
  projectId: uuidSchema,
  slug: z.string(),
  name: z.string(),
  githubFullName: z.string().nullable(),
  workspaceRoot: z.string().nullable(),
  linkStatus: portfolioDiscoveryLinkStatusSchema,
  notes: z.string().max(500).optional(),
});

export const portfolioDiscoveryLocalCandidateSchema = z.object({
  folderName: z.string(),
  absolutePath: z.string(),
  fullName: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  matchedProjectId: uuidSchema.nullable(),
  matchedSlug: z.string().nullable(),
  alreadyLinked: z.boolean(),
  registered: z.boolean(),
});

export const portfolioDiscoverySourcesSchema = z.object({
  local: z.object({
    connected: z.boolean(),
    reposRoot: z.string().nullable(),
    lastScanAt: isoDateTimeSchema.nullable(),
    lastScanRepoCount: z.number().int().min(0).nullable(),
  }),
  githubToken: z.object({
    connected: z.boolean(),
    login: z.string().nullable(),
  }),
  githubApp: z.object({
    configured: z.boolean(),
    installationCount: z.number().int().min(0),
    installationIds: z.array(z.string()),
  }),
});

export const portfolioDiscoveryStatusSchema = z.object({
  sources: portfolioDiscoverySourcesSchema,
  summary: z.object({
    projectCount: z.number().int().min(0),
    linkedCount: z.number().int().min(0),
    unlinkedCount: z.number().int().min(0),
    missingOnDiskCount: z.number().int().min(0),
    localCandidateCount: z.number().int().min(0),
    unregisteredLocalCount: z.number().int().min(0),
  }),
  projects: z.array(portfolioDiscoveryProjectItemSchema),
  unlinkedProjects: z.array(portfolioDiscoveryProjectItemSchema),
  localCandidates: z.array(portfolioDiscoveryLocalCandidateSchema),
  pathHints: z.array(z.string()).default([]),
  asOf: isoDateTimeSchema,
  epistemicState: z.enum(["INFERRED", "UNKNOWN", "OBSERVED"]),
  note: z.string().max(2000),
});

export const portfolioDiscoveryRefreshRequestSchema = z.object({
  /** Which sources to pull. Default: all currently connected/configured. */
  sources: z
    .array(z.enum(["local", "github_token", "github_app"]))
    .max(3)
    .optional(),
  reconcile: z.boolean().default(true),
  maxDepth: z.number().int().min(1).max(4).default(2),
  /** Auto-set workspaceRoot from local absolute paths when scanning. */
  linkLocalRoots: z.boolean().default(true),
});

export const portfolioDiscoveryLinkRequestSchema = z.object({
  projectId: uuidSchema,
  workspaceRoot: z.string().min(1).max(1000),
});

export const portfolioDiscoveryRefreshResultSchema = z.object({
  local: z
    .object({
      scanned: z.number().int().min(0),
      created: z.number().int().min(0),
      updated: z.number().int().min(0),
      linked: z.number().int().min(0),
    })
    .nullable(),
  githubToken: z
    .object({
      imported: z.number().int().min(0),
      created: z.number().int().min(0),
      updated: z.number().int().min(0),
    })
    .nullable(),
  githubApp: z
    .object({
      installations: z.number().int().min(0),
      imported: z.number().int().min(0),
      created: z.number().int().min(0),
      updated: z.number().int().min(0),
      errors: z.array(z.string()).default([]),
    })
    .nullable(),
  status: portfolioDiscoveryStatusSchema,
});

export type PortfolioPattern = z.infer<typeof portfolioPatternSchema>;
export type PortfolioOverview = z.infer<typeof portfolioOverviewSchema>;
export type PortfolioHealthReport = z.infer<typeof portfolioHealthReportSchema>;
export type PortfolioHealthProjectItem = z.infer<
  typeof portfolioHealthProjectItemSchema
>;
export type PortfolioHealthAggregate = z.infer<
  typeof portfolioHealthAggregateSchema
>;
export type PortfolioVerdictHint = z.infer<typeof portfolioVerdictHintSchema>;
export type PortfolioDiscoveryStatus = z.infer<
  typeof portfolioDiscoveryStatusSchema
>;
export type PortfolioDiscoveryRefreshRequest = z.infer<
  typeof portfolioDiscoveryRefreshRequestSchema
>;
export type PortfolioDiscoveryLinkRequest = z.infer<
  typeof portfolioDiscoveryLinkRequestSchema
>;
export type PortfolioDiscoveryRefreshResult = z.infer<
  typeof portfolioDiscoveryRefreshResultSchema
>;
