import { z } from "zod";
import { PROJECT_STATE_SLICES } from "../constants/state.js";
import {
  confidenceSchema,
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";
import {
  evidenceByCategoryBucketSchema,
  evidenceRecordSchema,
} from "./evidence.schema.js";

export const projectStateSliceKeySchema = z.enum(PROJECT_STATE_SLICES);

export const projectStateSliceSchema = z.object({
  key: projectStateSliceKeySchema,
  summary: z.string().max(4000),
  epistemicState: epistemicStateSchema,
  confidence: confidenceSchema,
  evidenceIds: z.array(uuidSchema).default([]),
  claimIds: z.array(uuidSchema).default([]),
  asOf: isoDateTimeSchema,
  validUntil: isoDateTimeSchema.nullable(),
  stale: z.boolean().default(false),
});

export const stateConflictSchema = z.object({
  id: uuidSchema,
  sliceKey: projectStateSliceKeySchema,
  claimAId: uuidSchema,
  claimBId: uuidSchema,
  resolution: z.string().max(2000).nullable(),
  epistemicState: z.literal("CONFLICTED"),
  detectedAt: isoDateTimeSchema,
});

/** Reconciled Current State — primary product read model. */
export const projectStateSnapshotSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  asOf: isoDateTimeSchema,
  reconciledAt: isoDateTimeSchema,
  slices: z.array(projectStateSliceSchema),
  conflicts: z.array(stateConflictSchema).default([]),
  overallEpistemicState: epistemicStateSchema,
  sourceConnectors: z.array(z.string().min(1)).default(["github"]),
});

/** GET Current State rollup — snapshot + evidence referenced by slices. */
export const projectCurrentStateResponseSchema =
  projectStateSnapshotSchema.extend({
    evidence: z.array(evidenceRecordSchema).default([]),
    /** Category buckets always present — never collapse CODE/GIT/SECURITY/… */
    evidenceByCategory: z.array(evidenceByCategoryBucketSchema).default([]),
  });

export const reconcileProjectStateRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type ProjectStateSlice = z.infer<typeof projectStateSliceSchema>;
export type ProjectStateSnapshot = z.infer<typeof projectStateSnapshotSchema>;
export type StateConflict = z.infer<typeof stateConflictSchema>;
export type ProjectCurrentStateResponse = z.infer<
  typeof projectCurrentStateResponseSchema
>;
