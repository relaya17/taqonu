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
 *
 * REVOKED is a terminal state reachable from PENDING or APPROVED: a human
 * has explicitly taken the authorization back before it was spent. It is
 * deliberately NOT reachable from CONSUMED — the execution already
 * happened, and re-labelling that record would make the audit trail lie
 * about history.
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
  /**
   * Actor id (user id) that revoked this approval, or `null` if it has
   * never been revoked.
   *
   * Revocation is a decision in its own right, so it gets its own
   * provenance rather than overwriting `decidedBy`/`decidedAt`: the person
   * who takes an authorization back is frequently NOT the person who
   * granted it, and collapsing the two would erase exactly the fact a
   * reviewer needs — that someone else intervened after sign-off.
   */
  revokedBy: z.string().min(1).max(200).nullable().default(null),
  /**
   * When the revocation was recorded. Paired with `revokedBy` so an
   * auditor can place the revocation on the timeline relative to
   * `decidedAt` and to any execution attempt that was refused because of
   * it.
   */
  revokedAt: isoDateTimeSchema.nullable().default(null),
  /**
   * WHY the approval was taken back ("the patch was superseded", "the
   * incident is over"). Stored separately from `decisionReason` for the
   * same reason as the fields above: the justification for granting and
   * the justification for withdrawing are different claims, and only one
   * of them explains why a later execution was denied.
   */
  revocationReason: z.string().min(1).max(2000).nullable().default(null),
  decidedBy: z.string().min(1).max(200).nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  decisionReason: z.string().min(1).max(2000).nullable(),
});

export type ApprovalRequestStatus = z.infer<typeof approvalRequestStatusSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ApprovalRequestInput = z.input<typeof approvalRequestSchema>;
