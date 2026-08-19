import { z } from "zod";
import { ACTION_KINDS } from "../constants/actions.js";
import { patchRiskSchema } from "./patch.schema.js";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const atlasEvalCategorySchema = z.enum([
  "code-generation",
  "bug-fixing",
  "refactoring",
  "test-generation",
  "security",
  "architecture",
  "qa",
  "evidence",
  "regression",
]);

export const atlasEvalTaskSchema = z.object({
  id: z.string().min(1).max(120),
  category: atlasEvalCategorySchema,
  title: z.string().min(1).max(200),
  task: z.string().min(1).max(4000),
  expectedBehavior: z.string().min(1).max(4000),
  repository: z.string().min(1).max(200),
  repositoryVersion: z.string().min(1).max(120),
  allowedTools: z.array(z.string()).default([]),
  requiredEvidence: z.array(z.string()).default([]),
  expectedTests: z.array(z.string()).default([]),
  riskLevel: patchRiskSchema,
  acceptanceCriteria: z.array(z.string()).min(1),
  actionKindHint: z.enum(ACTION_KINDS).optional(),
  goldenProject: z.boolean().default(false),
});

export const atlasEvalResultSchema = z.object({
  id: uuidSchema,
  taskId: z.string(),
  atlasVersion: z.string(),
  status: z.enum(["PASS", "FAIL", "SKIP", "ERROR"]),
  score: z.number().min(0).max(1),
  notes: z.string().max(4000),
  loopRunId: uuidSchema.nullable(),
  evidenceCount: z.number().int().min(0),
  patchProposed: z.boolean(),
  unauthorizedWrite: z.boolean(),
  durationMs: z.number().int().min(0),
  epistemicState: epistemicStateSchema,
  createdAt: isoDateTimeSchema,
});

export const atlasEvalSuiteRunSchema = z.object({
  id: uuidSchema,
  atlasVersion: z.string(),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  results: z.array(atlasEvalResultSchema),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  passRate: z.number().min(0).max(1),
  unauthorizedWrites: z.number().int().min(0),
  /**
   * Tenant attribution — added so `GET /benchmarks/suites` can be filtered
   * per-tenant (`canReadProjectScoped`) instead of returning every suite in
   * the store to every signed-in caller. `.default(null)` keeps this
   * backward-compatible with any suite persisted before this field existed.
   */
  projectId: uuidSchema.nullable().default(null),
  /** Who actually triggered this run (real actorId, not fabricated). */
  ownerId: uuidSchema.nullable().default(null),
});

export const regressionCompareSchema = z.object({
  previousSuiteId: uuidSchema,
  currentSuiteId: uuidSchema,
});

export const regressionReportSchema = z.object({
  id: uuidSchema,
  previousSuiteId: uuidSchema,
  currentSuiteId: uuidSchema,
  previousPassRate: z.number().min(0).max(1),
  currentPassRate: z.number().min(0).max(1),
  delta: z.number(),
  status: z.enum(["PASS", "BLOCKED", "IMPROVED"]),
  regressions: z.array(
    z.object({
      taskId: z.string(),
      previous: z.enum(["PASS", "FAIL", "SKIP", "ERROR"]),
      current: z.enum(["PASS", "FAIL", "SKIP", "ERROR"]),
    }),
  ),
  plainLanguageSummary: z.string(),
  createdAt: isoDateTimeSchema,
  /** Same tenant-attribution rationale as `atlasEvalSuiteRunSchema` above. */
  projectId: uuidSchema.nullable().default(null),
  ownerId: uuidSchema.nullable().default(null),
});

export type AtlasEvalTask = z.infer<typeof atlasEvalTaskSchema>;
export type AtlasEvalResult = z.infer<typeof atlasEvalResultSchema>;
export type AtlasEvalSuiteRun = z.infer<typeof atlasEvalSuiteRunSchema>;
export type RegressionReport = z.infer<typeof regressionReportSchema>;
