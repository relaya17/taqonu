import { z } from "zod";
import { ENGINEERING_AGENT_MODES } from "../constants/engineering-modes.js";
import {
  confidenceSchema,
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";
import { sourceAuthorityRankSchema } from "./authority.schema.js";

export const engineeringAgentModeSchema = z.enum(ENGINEERING_AGENT_MODES);

export const patchStatusSchema = z.enum([
  "DRAFT",
  "PROPOSED",
  "EVALUATED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "APPLIED",
  "VERIFIED",
  "ROLLED_BACK",
  "REJECTED",
]);

export const patchRiskSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const patchFileChangeSchema = z.object({
  path: z.string().min(1).max(500),
  action: z.enum(["add", "modify", "delete"]),
  summary: z.string().max(500),
  unifiedDiff: z.string().max(200_000).optional(),
  afterContent: z.string().max(500_000).optional(),
});

export const patchArtifactSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  title: z.string().min(1).max(200),
  reason: z.string().min(1).max(4000),
  mode: engineeringAgentModeSchema,
  status: patchStatusSchema,
  risk: patchRiskSchema,
  baseCommit: z.string().max(120).nullable(),
  targetBranch: z.string().max(120).nullable(),
  filesChanged: z.array(patchFileChangeSchema).min(1).max(50),
  evidenceIds: z.array(uuidSchema).default([]),
  claimIds: z.array(uuidSchema).default([]),
  expectedImpact: z.string().max(2000),
  tests: z.array(z.string().max(500)).default([]),
  evaluationSummary: z.string().max(4000).nullable(),
  /** Audit/constitution finding this AUTO_FIX draft remediates (when set). */
  sourceIssueId: uuidSchema.nullable().optional(),
  approvals: z
    .array(
      z.object({
        by: z.string().min(1).max(200),
        at: isoDateTimeSchema,
        note: z.string().max(1000).optional(),
      }),
    )
    .default([]),
  appliedAt: isoDateTimeSchema.nullable(),
  verifiedAt: isoDateTimeSchema.nullable(),
  rollbackRef: z.string().max(500).nullable(),
  rollbackSnapshot: z
    .array(
      z.object({
        path: z.string(),
        previousContent: z.string().nullable(),
      }),
    )
    .default([]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  createdBy: z.string().min(1).max(200),
  epistemicState: epistemicStateSchema.default("PROPOSED"),
  confidence: confidenceSchema.default(0.5),
  authorityHint: sourceAuthorityRankSchema.default("LLM_INFERENCE"),
});

export const createPatchSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  title: z.string().min(1).max(200),
  reason: z.string().min(1).max(4000),
  mode: engineeringAgentModeSchema.default("generate"),
  risk: patchRiskSchema.optional(),
  baseCommit: z.string().max(120).nullable().optional(),
  targetBranch: z.string().max(120).nullable().optional(),
  filesChanged: z.array(patchFileChangeSchema).min(1).max(50),
  evidenceIds: z.array(uuidSchema).optional(),
  expectedImpact: z.string().max(2000).optional(),
  tests: z.array(z.string().max(500)).optional(),
  workspaceRoot: z.string().max(1000).optional(),
});

export const approvePatchSchema = z.object({
  note: z.string().max(1000).optional(),
  approvedBy: z.string().min(1).max(200).default("human"),
});

export const applyPatchSchema = z.object({
  /** Optional when patch.projectId has an explicit osStore workspaceRoot. */
  workspaceRoot: z.string().min(1).max(1000).optional(),
  approvedBy: z.string().min(1).max(200).default("human"),
});

export type PatchArtifact = z.infer<typeof patchArtifactSchema>;
export type CreatePatch = z.infer<typeof createPatchSchema>;
export type PatchFileChange = z.infer<typeof patchFileChangeSchema>;
export type PatchStatus = z.infer<typeof patchStatusSchema>;
export type PatchRisk = z.infer<typeof patchRiskSchema>;
