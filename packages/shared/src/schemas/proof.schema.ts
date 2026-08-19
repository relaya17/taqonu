import { z } from "zod";
import { atlasEvalSuiteRunSchema } from "./atlas-eval.schema.js";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

export const PROOF_GATE_IDS = ["A", "B", "C", "D", "E", "F"] as const;

export const proofGateIdSchema = z.enum(PROOF_GATE_IDS);

export const proofGoldenSourceSchema = z.enum([
  "env",
  "brokeros",
  "fixture",
  "explicit",
]);

export const proofGateResultSchema = z.object({
  id: proofGateIdSchema,
  taskId: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  status: z.enum(["PASS", "FAIL", "SKIP", "ERROR"]),
  notes: z.string().max(4000),
  evidenceCount: z.number().int().min(0),
  unauthorizedWrite: z.boolean(),
});

export const proofChecklistSchema = z.object({
  workspaceExists: z.boolean(),
  allGatesPass: z.boolean(),
  unauthorizedWritesZero: z.boolean(),
  suitePassRateOk: z.boolean(),
});

export const proofMetricsSchema = z.object({
  truth: z.number().min(0).max(1),
  engineeringSuccess: z.number().min(0).max(1),
  qaAccuracy: z.number().min(0).max(1),
  autonomy: z.number().min(0).max(1),
});

export const proofVerdictSummarySchema = z.object({
  status: z.string().max(64).nullable(),
  productionReadiness: z.number().min(0).max(100).nullable(),
  evidenceCoverage: z.number().min(0).max(1).nullable(),
  criticalBlockers: z.number().int().min(0).nullable(),
  evidenceCount: z.number().int().min(0).nullable(),
}).nullable();

export const atlasProofReportSchema = z.object({
  id: uuidSchema,
  atlasVersion: z.string().min(1).max(32),
  status: z.enum(["PASS", "FAIL", "PARTIAL"]),
  golden: z.object({
    slug: z.string().min(1).max(64),
    workspaceRoot: z.string().min(1).max(1000),
    source: proofGoldenSourceSchema,
    exists: z.boolean(),
  }),
  evalsRoot: z.string().min(1).max(1000),
  suite: atlasEvalSuiteRunSchema,
  gates: z.array(proofGateResultSchema).min(1),
  checklist: proofChecklistSchema,
  metrics: proofMetricsSchema,
  verdictSummary: proofVerdictSummarySchema,
  evidenceReportMarkdown: z.string().max(50_000),
  plainLanguageSummary: z.string().max(8000),
  createdAt: isoDateTimeSchema,
  /**
   * Tenant attribution at the report level (mirrors `suite.projectId`) so
   * `GET /proof/status` can be namespaced per-project instead of sharing one
   * global `osStore` meta slot across every tenant. `.default(null)` keeps
   * this backward-compatible with any report persisted before this field
   * existed.
   */
  projectId: uuidSchema.nullable().default(null),
});

export const runProofRequestSchema = z.object({
  workspaceRoot: z.string().min(1).max(1000).optional(),
  projectId: uuidSchema.nullable().optional(),
  projectSlug: z.string().max(64).optional(),
  /** Restrict to specific gate task ids; default = BrokerOS A–F. */
  taskIds: z.array(z.string().min(1).max(120)).optional(),
});

export type ProofGateId = z.infer<typeof proofGateIdSchema>;
export type ProofGateResult = z.infer<typeof proofGateResultSchema>;
export type AtlasProofReport = z.infer<typeof atlasProofReportSchema>;
export type RunProofRequest = z.infer<typeof runProofRequestSchema>;
