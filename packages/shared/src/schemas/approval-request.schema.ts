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
  /**
   * Hash of the EXACT artifact this approval authorizes (a patch diff, a
   * proposal payload, a command string).
   *
   * P0 governance fix. Without this, an approval was bound only to an
   * `entityType`/`action` PAIR — so a human could approve "apply patch A",
   * and the agent could then execute a completely different patch B under
   * the same still-valid approval. Approving a category is not approving a
   * change. `consumeApprovalRequest()` now refuses to authorize an artifact
   * whose hash does not match the one that was shown to the approver.
   *
   * `null` means the approval is not artifact-bound (legacy/categorical
   * approvals such as "may this caller dispatch at all"). Those keep their
   * previous behaviour exactly; binding is opt-in per request, so nothing
   * that never had an artifact is retroactively broken.
   */
  artifactHash: z.string().min(1).max(200).nullable().default(null),
  /**
   * When this approval stops being usable. An approval that nobody consumes
   * must not stay live forever: a decision made against last month's state
   * of the world is not a decision about today's.
   *
   * Enforced lazily at `consumeApprovalRequest()`/read time rather than by a
   * background sweeper — this codebase has no scheduler, and an expiry that
   * is evaluated when it actually matters cannot drift out of sync with a
   * job that failed to run.
   */
  expiresAt: isoDateTimeSchema.nullable().default(null),
  decidedBy: z.string().min(1).max(200).nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  decisionReason: z.string().min(1).max(2000).nullable(),
});

export type ApprovalRequestStatus = z.infer<typeof approvalRequestStatusSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ApprovalRequestInput = z.input<typeof approvalRequestSchema>;
