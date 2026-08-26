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
 * Lifecycle: PENDING -> APPROVED | REJECTED -> (APPROVED only) CONSUMED.
 * CONSUMED means the approval has already authorized one real action
 * execution and cannot be reused ("one approval, one execution").
 */
export const approvalRequestStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CONSUMED",
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
  decidedBy: z.string().min(1).max(200).nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  decisionReason: z.string().min(1).max(2000).nullable(),
});

export type ApprovalRequestStatus = z.infer<typeof approvalRequestStatusSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ApprovalRequestInput = z.input<typeof approvalRequestSchema>;
