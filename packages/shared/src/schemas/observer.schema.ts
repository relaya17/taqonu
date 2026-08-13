import { z } from "zod";
import { epistemicStateSchema, uuidSchema } from "./common.schema.js";
import { evidenceSourceTypeSchema } from "./evidence.schema.js";
import { evidenceCategorySchema } from "./evidence.schema.js";

/** Observer claim confidence — product-facing subset (+ SUSPECTED). */
export const OBSERVER_CLAIM_KINDS = [
  "OBSERVED",
  "VERIFIED",
  "INFERRED",
  "SUSPECTED",
  "UNKNOWN",
] as const;
export type ObserverClaimKind = (typeof OBSERVER_CLAIM_KINDS)[number];
export const observerClaimKindSchema = z.enum(OBSERVER_CLAIM_KINDS);

export const BUG_STATUSES = [
  "OPEN",
  "REPRODUCED",
  "FIXED",
  "VERIFIED",
  "WONTFIX",
] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];
export const bugStatusSchema = z.enum(BUG_STATUSES);

export const BUG_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];
export const bugSeveritySchema = z.enum(BUG_SEVERITIES);

export const genomeFlowStepSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(200),
});
export type GenomeFlowStep = z.infer<typeof genomeFlowStepSchema>;

export const genomeFlowSchema = z.object({
  id: z.string().min(1).max(200),
  method: z.string().min(1).max(16).default("POST"),
  path: z.string().min(1).max(400),
  steps: z.array(genomeFlowStepSchema).max(80),
  sourceFile: z.string().max(500).nullable().optional(),
});
export type GenomeFlow = z.infer<typeof genomeFlowSchema>;

export const projectGenomeSchema = z.object({
  version: z.literal(1),
  projectId: uuidSchema.nullable(),
  projectSlug: z.string().max(120).nullable(),
  capturedAt: z.string().datetime(),
  workspaceRoot: z.string().min(1).max(1000),
  architecture: z.object({
    apps: z.array(z.string()).max(100),
    packages: z.array(z.string()).max(200),
    topLevel: z.array(z.string()).max(100),
    fileCount: z.number().int().nonnegative(),
  }),
  apis: z.array(genomeFlowSchema).max(200),
  services: z.array(z.string().max(200)).max(200),
  dependencies: z.array(z.string().max(200)).max(300),
  knownBehaviorIds: z.array(z.string().max(200)).max(200),
});
export type ProjectGenome = z.infer<typeof projectGenomeSchema>;

export const behaviorDifferenceSchema = z.object({
  flowId: z.string(),
  method: z.string(),
  path: z.string(),
  beforeSteps: z.array(z.string()),
  afterSteps: z.array(z.string()),
  kind: z.enum([
    "STEP_ORDER_CHANGED",
    "STEP_ADDED",
    "STEP_REMOVED",
    "FLOW_ADDED",
    "FLOW_REMOVED",
  ]),
  title: z.string(),
  detail: z.string(),
  claim: observerClaimKindSchema,
  riskBand: bugSeveritySchema,
});
export type BehaviorDifference = z.infer<typeof behaviorDifferenceSchema>;

export const observerBugSchema = z.object({
  id: z.string().uuid(),
  projectId: uuidSchema.nullable(),
  title: z.string().min(1).max(300),
  detail: z.string().max(4000).default(""),
  status: bugStatusSchema,
  severity: bugSeveritySchema,
  claim: observerClaimKindSchema,
  source: z.string().max(200).default("manual"),
  linkedFlowId: z.string().max(200).nullable().optional(),
  evidenceRefs: z.array(z.string().max(200)).max(40).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ObserverBug = z.infer<typeof observerBugSchema>;

export const observerFindingSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  claim: observerClaimKindSchema,
  epistemicState: epistemicStateSchema,
  riskBand: bugSeveritySchema,
  category: z.enum(["BEHAVIOR", "TEMPORAL", "BUG", "GENOME", "RISK"]),
  flowId: z.string().nullable().optional(),
  evidenceRefs: z.array(z.string().max(400)).max(40).default([]),
  impactNodeCount: z.number().int().nonnegative().optional(),
});
export type ObserverFinding = z.infer<typeof observerFindingSchema>;

export const truthCountersSchema = z.object({
  analyzed: z.number().int().nonnegative(),
  meaningfulRisks: z.number().int().nonnegative(),
  confirmedRegressions: z.number().int().nonnegative(),
  caughtBeforeProd: z.number().int().nonnegative(),
  cycles: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

export const cycleHistoryEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  riskBand: z.string(),
  riskScore: z.number(),
  findingCount: z.number().int(),
  behaviorDiffCount: z.number().int(),
  graphNodes: z.number().int(),
  graphEdges: z.number().int(),
  trigger: z.string(),
  topFindingTitle: z.string().nullable(),
});

export const observeCycleRequestSchema = z.object({
  projectId: uuidSchema.optional(),
  workspaceRoot: z.string().min(1).max(1000).optional(),
  /** Optional explicit flows for lab / golden fixtures. */
  flows: z.array(genomeFlowSchema).max(50).optional(),
  bugs: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        detail: z.string().max(4000).optional(),
        severity: bugSeveritySchema.optional(),
        source: z.string().max(200).optional(),
        linkedFlowId: z.string().max(200).nullable().optional(),
      }),
    )
    .max(50)
    .optional(),
  persist: z.boolean().default(true),
  /** github_webhook | manual | deploy | unknown */
  trigger: z.string().max(80).optional(),
  /** Promote current observed flows to EXPECTED baseline. */
  promoteExpected: z.boolean().optional(),
});
export type ObserveCycleRequest = z.infer<typeof observeCycleRequestSchema>;

export const observeCycleResultSchema = z.object({
  id: z.string().uuid(),
  projectId: uuidSchema.nullable(),
  workspaceRoot: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  genome: projectGenomeSchema,
  previousGenomeAt: z.string().datetime().nullable(),
  behaviorDiffs: z.array(behaviorDifferenceSchema),
  findings: z.array(observerFindingSchema),
  bugs: z.array(observerBugSchema),
  risk: z.object({
    score: z.number(),
    band: bugSeveritySchema,
    summary: z.string(),
  }),
  atlasDir: z.string(),
  counters: truthCountersSchema,
  history: z.array(cycleHistoryEntrySchema).max(50),
  expectedPromotedAt: z.string().datetime().nullable(),
  evidenceDrafts: z.array(
    z.object({
      source: z.string(),
      sourceType: evidenceSourceTypeSchema,
      excerpt: z.string(),
      epistemicState: epistemicStateSchema,
      category: evidenceCategorySchema,
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type ObserveCycleResult = z.infer<typeof observeCycleResultSchema>;

export const ingestBugsRequestSchema = z.object({
  projectId: uuidSchema.optional(),
  workspaceRoot: z.string().min(1).max(1000).optional(),
  bugs: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        detail: z.string().max(4000).optional(),
        severity: bugSeveritySchema.optional(),
        status: bugStatusSchema.optional(),
        source: z.string().max(200).optional(),
        linkedFlowId: z.string().max(200).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type IngestBugsRequest = z.infer<typeof ingestBugsRequestSchema>;
