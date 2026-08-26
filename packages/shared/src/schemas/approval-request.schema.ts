import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

/**
 * Minimal approval-request record for the closed-loop approval workflow
 * referenced (but not implemented) alongside `authorizeEntityAction` in
 * `@atlas/agent-core`'s entity-policy layer: some entity actions resolve to
 * `APPROVAL_REQUIRED` (e.g. `CONFIGURATION.EXECUTE`), and this is the
 * shape of the distinct, auditable decision that turns `approved: false`
 * into `approved: true` for a specific, single downstream execution.
 *
 * Lifecycle: PENDING -> APPROVED | REJECTED | REVOKED;
 * APPROVED -> CONSUMED (one execution) or REVOKED.
 */
export const approvalRequestStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CONSUMED",
  "REVOKED",
]);

export const approvalRequestSchema = z.object({
  id: uuidSchema,
  /** Business-entity type this approval gates, e.g. "CONFIGURATION". */
  entityType: z.string().min(1).max(200),
  /** Entity action this approval gates, e.g. "EXECUTE". */
  action: z.string().min(1).max(200),
  /** Actor id (user id) that requested the approval. */
  requestedBy: z.string().min(1).max(200),
  requestedAt: isoDateTimeSchema,
  status: approvalRequestStatusSchema,
  /** WHY the approval was requested. */
  reason: z.string().min(1).max(2000),
  /** Free-form details about what's being approved (e.g. which endpoint/request). */
  context: z.record(z.string(), z.unknown()).default({}),
  /** When set, consume only authorizes this exact artifact hash. */
  artifactHash: z.string().min(1).max(128).nullable().default(null),
  /** After this instant the approval cannot be consumed. */
  expiresAt: isoDateTimeSchema.nullable().default(null),
  revokedBy: z.string().min(1).max(200).nullable().default(null),
  revokedAt: isoDateTimeSchema.nullable().default(null),
  revocationReason: z.string().min(1).max(2000).nullable().default(null),
  decidedBy: z.string().min(1).max(200).nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  decisionReason: z.string().min(1).max(2000).nullable(),
});

export type ApprovalRequestStatus = z.infer<typeof approvalRequestStatusSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ApprovalRequestInput = z.input<typeof approvalRequestSchema>;
