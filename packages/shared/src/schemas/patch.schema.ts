import { z } from "zod";
import { ENGINEERING_AGENT_MODES } from "../constants/engineering-modes.js";
import {
  confidenceSchema,
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";
import { sourceAuthorityRankSchema } from "./authority.schema.js";
import { patchRemediationTargetSchema } from "./remediation-truth.schema.js";

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

function isWorkspaceRelativePath(path: string): boolean {
  const rel = path.replace(/\\/g, "/");
  return !rel.includes("..") && !rel.startsWith("/") && !/^[A-Za-z]:/.test(rel);
}

export const patchFileChangeSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(500)
    .refine(isWorkspaceRelativePath, {
      message: "path must be a relative workspace path without traversal",
    }),
  action: z.enum(["add", "modify", "delete"]),
  summary: z.string().max(500),
  unifiedDiff: z.string().max(200_000).optional(),
  afterContent: z.string().max(500_000).optional(),
  /**
   * Stage 5 (D3): SHA-256 of the target file when the patch was created,
   * captured by the server from the workspace. `null` = the path did not
   * exist. Absent (legacy) = base unknown: Apply fails closed. Never taken
   * from client input.
   */
  baseSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .optional(),
});

/** Client-submitted file change: the server computes `baseSha256` itself. */
export const patchFileChangeInputSchema = patchFileChangeSchema.omit({ baseSha256: true });

/**
 * Stage 5 (D2): persisted Understanding that justified an agent proposal.
 * Epistemic vocabulary per the approved D2 set.
 */
export const patchUnderstandingSchema = z.object({
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
  projectId: uuidSchema.nullable(),
  workspaceRoot: z.string().max(1000),
  request: z.string().max(4000),
  focusPath: z.string().max(1000).nullable(),
  targets: z
    .array(
      z.object({
        path: z.string().max(500),
        action: z.enum(["add", "modify", "delete"]),
        observed: z.boolean(),
        baseSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
      }),
    )
    .max(50),
  repository: z.object({
    apps: z.number().int().nonnegative(),
    packages: z.number().int().nonnegative(),
    topLevel: z.number().int().nonnegative(),
  }),
  guardian: z.object({
    verdict: z.enum(["CONSISTENT", "CONFLICT", "UNKNOWN"]),
    action: z.enum(["ALLOW", "WARN", "BLOCK"]),
    summary: z.string().max(1000),
    knowledgeUsed: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
  }),
  memoryIdsUsed: z.array(z.string().max(120)).max(50),
  epistemicState: z.enum([
    "OBSERVED",
    "VERIFIED",
    "INFERRED",
    "UNVERIFIED",
    "CONFLICTED",
    "INSUFFICIENT_EVIDENCE",
  ]),
  gate: z.enum(["PROCEED", "BLOCKED"]),
  gateReason: z.string().max(1000),
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
  /** Sentinel/Observer finding this governed patch intends to remediate. */
  remediationTarget: patchRemediationTargetSchema.optional(),
  approvals: z
    .array(
      z.object({
        by: z.string().min(1).max(200),
        /** Stage 5: authenticated approver id, set by the server only. */
        userId: z.string().min(1).max(200).optional(),
        at: isoDateTimeSchema,
        note: z.string().max(1000).optional(),
      }),
    )
    .default([]),
  /** Stage 5 (D2): Understanding that justified an agent proposal. */
  understanding: patchUnderstandingSchema.optional(),
  /** Stage 5 (D4): terminal rejection record. Never cleared once set. */
  rejection: z
    .object({
      by: z.string().min(1).max(200),
      userId: z.string().min(1).max(200),
      at: isoDateTimeSchema,
      reason: z.string().min(1).max(2000),
    })
    .nullable()
    .optional(),
  /** Stage 5 (D4): a correction points at the REJECTED patch it supersedes. */
  supersedesPatchId: uuidSchema.nullable().optional(),
  appliedAt: isoDateTimeSchema.nullable(),
  verifiedAt: isoDateTimeSchema.nullable(),
  rollbackRef: z.string().max(500).nullable(),
  /**
   * Pre-apply snapshot of patched paths only.
   * `previousContent: null` means the path was created by Apply and must be
   * deleted on Rollback. Unrelated workspace files are out of scope.
   */
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
  filesChanged: z.array(patchFileChangeInputSchema).min(1).max(50),
  evidenceIds: z.array(uuidSchema).optional(),
  /** Stage 5 (D4): must reference a REJECTED patch in the same project. */
  supersedesPatchId: uuidSchema.optional(),
  expectedImpact: z.string().max(2000).optional(),
  tests: z.array(z.string().max(500)).optional(),
  workspaceRoot: z.string().max(1000).optional(),
});

export const approvePatchSchema = z.object({
  note: z.string().max(1000).optional(),
  /**
   * Accepted for wire compatibility only and ignored: the approver identity
   * is always the authenticated session (Stage 5, G-7).
   */
  approvedBy: z.string().min(1).max(200).optional(),
});

export const rejectPatchSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

export const applyPatchSchema = z.object({
  /** Optional when patch.projectId has an explicit osStore workspaceRoot. */
  workspaceRoot: z.string().min(1).max(1000).optional(),
  approvedBy: z.string().min(1).max(200).default("human"),
});

export type PatchArtifact = z.infer<typeof patchArtifactSchema>;
export type CreatePatch = z.infer<typeof createPatchSchema>;
export type PatchFileChange = z.infer<typeof patchFileChangeSchema>;
export type PatchUnderstanding = z.infer<typeof patchUnderstandingSchema>;
export type PatchStatus = z.infer<typeof patchStatusSchema>;
export type PatchRisk = z.infer<typeof patchRiskSchema>;
