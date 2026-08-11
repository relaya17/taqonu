import { z } from "zod";
import {
  ACTION_KINDS,
  ENGINEERING_LOOP_STAGES,
  LOOP_STAGE_STATUS,
} from "../constants/actions.js";
import { ENGINEERING_AGENT_MODES } from "../constants/engineering-modes.js";
import { patchRiskSchema } from "./patch.schema.js";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const actionKindSchema = z.enum(ACTION_KINDS);

export const classifyActionRequestSchema = z.object({
  userRequest: z.string().min(1).max(4000),
});

export const classifyActionResultSchema = z.object({
  kind: actionKindSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(2000),
  requiresHumanApproval: z.boolean(),
  mayProposePatch: z.boolean(),
  epistemicState: epistemicStateSchema,
});

export const loopStageStatusSchema = z.enum(LOOP_STAGE_STATUS);
export const engineeringLoopStageSchema = z.enum(ENGINEERING_LOOP_STAGES);

export const loopStageResultSchema = z.object({
  stage: engineeringLoopStageSchema,
  status: loopStageStatusSchema,
  summary: z.string().max(4000),
  epistemicState: epistemicStateSchema,
  evidenceIds: z.array(uuidSchema).default([]),
  artifactRefs: z.array(z.string()).default([]),
  durationMs: z.number().int().min(0).default(0),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
});

export const engineeringLoopRunSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  projectSlug: z.string().nullable(),
  workspaceRoot: z.string().min(1).max(1000),
  userRequest: z.string().min(1).max(4000),
  actionKind: actionKindSchema,
  mode: z.enum(ENGINEERING_AGENT_MODES),
  status: z.enum([
    "RUNNING",
    "AWAITING_APPROVAL",
    "PASSED",
    "FAILED",
    "BLOCKED",
    "APPLIED",
  ]),
  stages: z.array(loopStageResultSchema),
  patchId: uuidSchema.nullable(),
  risk: patchRiskSchema.nullable(),
  decisionId: uuidSchema.nullable(),
  plainLanguageSummary: z.string().max(8000),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
});

export const startEngineeringLoopSchema = z.object({
  workspaceRoot: z.string().min(1).max(1000).optional(),
  userRequest: z.string().min(1).max(4000),
  projectId: uuidSchema.nullable().optional(),
  projectSlug: z.string().max(64).optional(),
  mode: z.enum(ENGINEERING_AGENT_MODES).optional(),
  /** When false, skip shell typecheck/lint/test (default true for safety/speed). */
  runHeavyChecks: z.boolean().optional(),
  taskId: z.string().max(120).optional(),
});

export const approveEngineeringLoopSchema = z.object({
  approvedBy: z.string().min(1).max(200),
  apply: z.boolean().default(true),
  note: z.string().max(2000).optional(),
});

export type ActionKind = z.infer<typeof actionKindSchema>;
export type ClassifyActionResult = z.infer<typeof classifyActionResultSchema>;
export type LoopStageResult = z.infer<typeof loopStageResultSchema>;
export type EngineeringLoopRun = z.infer<typeof engineeringLoopRunSchema>;
