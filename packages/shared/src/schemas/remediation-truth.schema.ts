import { z } from "zod";
import { uuidSchema } from "./common.schema.js";

/** Patch file write succeeded or failed. Independent of finding presence. */
export const patchVerifyStatusSchema = z.enum(["PASS", "FAIL"]);

/**
 * Detector re-check of the original finding after apply.
 * PASS only when the detector no longer observes the finding.
 */
export const remediationVerifyStatusSchema = z.enum([
  "PASS",
  "FAIL",
  "UNSUPPORTED",
  "NOT_RUN",
]);

export const findingPresenceSchema = z.enum([
  "STILL_PRESENT",
  "ABSENT",
  "UNKNOWN",
]);

export const remediationResultSchema = z.enum([
  "FIXED",
  "NOT_FIXED",
  "UNSUPPORTED",
  "NOT_ATTEMPTED",
]);

export const remediationFindingTypeSchema = z.enum([
  "sentinel-secret",
  "sentinel-other",
  "observer",
]);

/** Canonical link from a Patch to the Finding it claims to remediate. */
export const patchRemediationTargetSchema = z.object({
  findingId: z.string().min(1).max(200),
  projectId: uuidSchema.nullable(),
  findingType: remediationFindingTypeSchema,
  detector: z.string().min(1).max(80),
  path: z.string().max(500).nullable(),
  line: z.number().int().positive().nullable(),
  originalRiskBand: z.string().min(1).max(20),
});

export const findingRemediationVerdictSchema = z.object({
  result: remediationResultSchema,
  verifyStatus: remediationVerifyStatusSchema,
  findingPresence: findingPresenceSchema,
  findingId: z.string().max(200).nullable(),
  path: z.string().max(500).nullable(),
  summary: z.string().max(2000),
});

export type PatchVerifyStatus = z.infer<typeof patchVerifyStatusSchema>;
export type RemediationVerifyStatus = z.infer<
  typeof remediationVerifyStatusSchema
>;
export type FindingPresence = z.infer<typeof findingPresenceSchema>;
export type RemediationResult = z.infer<typeof remediationResultSchema>;
export type RemediationFindingType = z.infer<
  typeof remediationFindingTypeSchema
>;
export type PatchRemediationTarget = z.infer<
  typeof patchRemediationTargetSchema
>;
export type FindingRemediationVerdict = z.infer<
  typeof findingRemediationVerdictSchema
>;
