import {
  AtlasError,
  approvalRequestSchema,
  type ApprovalRequest,
} from "@atlas/shared";
import { appendUnifiedAuditEntry } from "./audit-log.js";

/**
 * Minimal approval-workflow store, closing the loop left open by
 * `authorizeEntityAction` (`@atlas/agent-core`) returning
 * `APPROVAL_REQUIRED` with no way for anyone to actually supply that
 * approval. This is deliberately self-contained rather than folded into
 * `apps/api/src/store/os-store.ts` — that file is a large, heavily-used
 * singleton, and adding to it here would be out of scope and risk
 * conflicting with other concurrent work.
 *
 * SCOPE LIMIT (honest, deliberate — not an oversight): this is an
 * in-memory, process-local `Map`. It does not survive a process restart
 * and is not shared across multiple API instances. For multi-process
 * durability this would need to move into `osStore` (or a real database)
 * the same way other persisted entities do.
 */
const approvalRequests = new Map<string, ApprovalRequest>();

export type CreateApprovalRequestInput = {
  entityType: string;
  action: string;
  requestedBy: string;
  reason: string;
  context?: Record<string, unknown>;
  /**
   * Bind this approval to one exact artifact (patch diff, proposal payload,
   * command). When set, `consumeApprovalRequest()` will only authorize an
   * execution presenting this same hash — approving a category is not
   * approving a change. Omit for categorical approvals.
   */
  artifactHash?: string | null;
  /** ISO datetime after which this approval can no longer be consumed. */
  expiresAt?: string | null;
};

export type DecideApprovalRequestInput = {
  decidedBy: string;
  approve: boolean;
  decisionReason: string;
};

export type RevokeApprovalRequestInput = {
  /** Actor id (user id) taking the authorization back. */
  revokedBy: string;
  /** WHY it is being taken back — recorded on the request and in the audit log. */
  reason: string;
};

function inferRisk(entityType: string, action: string): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (action === "DELETE" || action === "EXECUTE") return "HIGH";
  if (action === "UPDATE") return "MEDIUM";
  return entityType === "CONFIGURATION" ? "MEDIUM" : "LOW";
}

/** Creates a new PENDING approval request and writes a unified audit entry. */
export function createApprovalRequest(
  input: CreateApprovalRequestInput,
): ApprovalRequest {
  const now = new Date().toISOString();
  const request = approvalRequestSchema.parse({
    id: crypto.randomUUID(),
    entityType: input.entityType,
    action: input.action,
    requestedBy: input.requestedBy,
    requestedAt: now,
    status: "PENDING",
    reason: input.reason,
    context: input.context ?? {},
    artifactHash: input.artifactHash ?? null,
    expiresAt: input.expiresAt ?? null,
    revokedBy: null,
    revokedAt: null,
    revocationReason: null,
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
  });

  approvalRequests.set(request.id, request);

  appendUnifiedAuditEntry({
    type: "approval.requested",
    actorId: input.requestedBy,
    actorKind: "USER",
    reason: input.reason,
    input: {
      approvalId: request.id,
      entityType: input.entityType,
      action: input.action,
      context: request.context,
      // On the audit entry so a reviewer can later prove WHICH artifact was
      // put in front of the approver, not merely that something was.
      artifactHash: request.artifactHash,
      expiresAt: request.expiresAt,
    },
    output: { status: request.status },
    policy: `${input.entityType}.${input.action}`,
    risk: inferRisk(input.entityType, input.action),
    approval: "PENDING",
    result: "SUCCESS",
  });

  return request;
}

/** Lists all approval requests, optionally filtered by status. */
export function listApprovalRequests(
  status?: ApprovalRequest["status"],
): ApprovalRequest[] {
  const items = [...approvalRequests.values()];
  const filtered = status ? items.filter((item) => item.status === status) : items;
  return filtered.sort(
    (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
  );
}

/** Looks up a single approval request by id. */
export function getApprovalRequest(id: string): ApprovalRequest | undefined {
  return approvalRequests.get(id);
}

/**
 * Records a human decision (approve/reject) on a PENDING approval request.
 * Throws NOT_FOUND if the id doesn't exist, and throws (CONFLICT) if the
 * request isn't PENDING — a decision can only be made once.
 */
export function decideApprovalRequest(
  id: string,
  input: DecideApprovalRequestInput,
): ApprovalRequest {
  const existing = approvalRequests.get(id);
  if (!existing) {
    throw new AtlasError("NOT_FOUND", `Approval request ${id} not found`, {
      statusCode: 404,
    });
  }
  if (existing.status !== "PENDING") {
    throw new AtlasError(
      "CONFLICT",
      `Approval request ${id} has already been decided (status=${existing.status})`,
      { statusCode: 409 },
    );
  }

  const now = new Date().toISOString();
  const status: ApprovalRequest["status"] = input.approve ? "APPROVED" : "REJECTED";
  const updated = approvalRequestSchema.parse({
    ...existing,
    status,
    decidedBy: input.decidedBy,
    decidedAt: now,
    decisionReason: input.decisionReason,
  });
  approvalRequests.set(id, updated);

  appendUnifiedAuditEntry({
    type: "approval.decided",
    actorId: input.decidedBy,
    actorKind: "USER",
    reason: input.decisionReason,
    input: {
      approvalId: id,
      entityType: existing.entityType,
      action: existing.action,
      approve: input.approve,
    },
    output: { status: updated.status },
    policy: `${existing.entityType}.${existing.action}`,
    risk: inferRisk(existing.entityType, existing.action),
    approval: status === "APPROVED" ? "APPROVED" : "REJECTED",
    result: "SUCCESS",
  });

  return updated;
}

/**
 * Revokes an approval, moving it to the terminal REVOKED state so it can
 * never authorize an execution again.
 *
 * The governing principle is that REVOCATION BEATS APPROVAL: an approval a
 * human has explicitly taken back is dead regardless of how valid it still
 * looks — correct artifact hash, well within its expiry, right agent, right
 * action. Those checks answer "does this execution match what was signed
 * off?"; revocation answers the prior question, "is that sign-off still in
 * force?", and a `no` there cannot be outvoted.
 *
 * WHICH STATES CAN BE REVOKED:
 *
 * - APPROVED — the central case. A live authorization is withdrawn before
 *   anyone spends it.
 * - PENDING — ALLOWED, deliberately. A requester or approver who realises a
 *   request should not go ahead (the patch was superseded, the incident is
 *   over) can withdraw it instead of leaving a live request sitting in the
 *   queue for some later approver to rubber-stamp against a world that has
 *   moved on. Terminating a PENDING request destroys nothing: it has never
 *   authorized anything, so there is no history to distort. Rejecting it
 *   via `decideApprovalRequest` is the alternative, but that records a
 *   *review verdict* ("we looked at this and said no") which is a different
 *   and stronger claim than "this was withdrawn before review".
 * - REJECTED — refused. It already authorizes nothing; "revoking" it would
 *   add noise, not safety, and would overwrite the reviewer's verdict.
 * - CONSUMED — refused, and this one matters. The execution already
 *   happened. Marking the record REVOKED afterwards would let it claim that
 *   an action which really ran was never authorized. Undoing an executed
 *   action is a compensating operation, not a bookkeeping edit.
 * - REVOKED — refused; already terminal, and the first revocation's
 *   provenance is the one worth keeping.
 */
export function revokeApprovalRequest(
  id: string,
  input: RevokeApprovalRequestInput,
): ApprovalRequest {
  const existing = approvalRequests.get(id);
  if (!existing) {
    throw new AtlasError("NOT_FOUND", `Approval request ${id} not found`, {
      statusCode: 404,
    });
  }
  if (existing.status === "CONSUMED") {
    throw new AtlasError(
      "CONFLICT",
      `Approval request ${id} has already been CONSUMED and cannot be revoked — the execution it authorized already happened`,
      { statusCode: 409 },
    );
  }
  if (existing.status !== "PENDING" && existing.status !== "APPROVED") {
    throw new AtlasError(
      "CONFLICT",
      `Approval request ${id} cannot be revoked (status=${existing.status}); only PENDING or APPROVED requests can be revoked`,
      { statusCode: 409 },
    );
  }

  const now = new Date().toISOString();
  const updated = approvalRequestSchema.parse({
    ...existing,
    status: "REVOKED" as const,
    revokedBy: input.revokedBy,
    revokedAt: now,
    revocationReason: input.reason,
  });
  approvalRequests.set(id, updated);

  appendUnifiedAuditEntry({
    type: "approval.revoked",
    actorId: input.revokedBy,
    actorKind: "USER",
    reason: input.reason,
    input: {
      approvalId: id,
      entityType: existing.entityType,
      action: existing.action,
      // The state we revoked FROM: withdrawing a live APPROVED authorization
      // is a materially different event from withdrawing a PENDING request,
      // and a reviewer must be able to tell them apart after the fact.
      previousStatus: existing.status,
      artifactHash: existing.artifactHash,
    },
    output: { status: updated.status },
    policy: `${existing.entityType}.${existing.action}`,
    risk: inferRisk(existing.entityType, existing.action),
    // The unified audit enum has no REVOKED member (it models the approval
    // *gate*: NOT_REQUIRED / PENDING / APPROVED / REJECTED). REJECTED is the
    // honest projection — the outcome is "this is not authorized" — and the
    // `type` and `previousStatus` fields carry the precise story.
    approval: "REJECTED",
    result: "SUCCESS",
  });

  return updated;
}

/**
 * Consumes an APPROVED approval request, flipping it to CONSUMED so it can
 * authorize exactly ONE real action execution (never replayed). Throws
 * unless the current status is APPROVED.
 */
/**
 * What the caller is ACTUALLY about to execute. Every field present here is
 * matched against what the approver signed off on; a mismatch is refused.
 *
 * Approving is not approving a category — it is approving one action, on
 * one target, by one actor, over one artifact. Each field below closes a
 * different substitution: swapping the patch (`artifactHash`), escalating
 * UPDATE into DELETE (`action`), retargeting RECORD onto
 * FINANCIAL_TRANSACTION (`entityType`), or a different agent riding another
 * agent's approval (`agentId`).
 */
export type PresentedExecution = {
  readonly artifactHash?: string;
  readonly entityType?: string;
  readonly action?: string;
  readonly agentId?: string;
};

export function consumeApprovalRequest(
  id: string,
  presented?: PresentedExecution,
): ApprovalRequest {
  const existing = approvalRequests.get(id);
  if (!existing) {
    throw new AtlasError("NOT_FOUND", `Approval request ${id} not found`, {
      statusCode: 404,
    });
  }
  // REVOCATION — checked FIRST, ahead of the status check, the expiry check
  // and the artifact binding, and that ordering is itself the control.
  //
  // Revocation is an explicit human decision to withdraw authorization, so
  // it must not be maskable by any other check. If it ran later, a revoked
  // approval that had also expired would be refused with "expired at ..." —
  // truthful but misleading, since the reason it can never be used again is
  // that a person took it back, not that a clock ran out. Ordering it first
  // guarantees the denial always NAMES the revocation.
  //
  // It also runs ahead of the artifact-binding check so the caller can never
  // learn "the artifact matched" about a revoked approval: a distinguishable
  // "artifact mismatch" vs "artifact matched but revoked" pair of errors is a
  // free oracle for probing what a withdrawn approval covered. A revoked
  // approval answers exactly one thing — no — and reveals nothing else.
  //
  // Placing it before the generic `status !== "APPROVED"` guard is what makes
  // the message specific; that guard would otherwise swallow REVOKED into a
  // flat "not APPROVED".
  if (existing.status === "REVOKED") {
    throw new AtlasError(
      "CONFLICT",
      `Approval request ${id} was REVOKED by ${existing.revokedBy ?? "unknown"} at ${existing.revokedAt ?? "unknown time"} and can never authorize an action`,
      { statusCode: 409 },
    );
  }

  if (existing.status !== "APPROVED") {
    throw new AtlasError(
      "CONFLICT",
      `Approval request ${id} is not APPROVED (status=${existing.status}) and cannot be consumed`,
      { statusCode: 409 },
    );
  }

  // EXPIRY — checked before the binding check, because an expired approval
  // is unusable regardless of which artifact is presented.
  if (existing.expiresAt !== null && Date.parse(existing.expiresAt) <= Date.now()) {
    throw new AtlasError(
      "CONFLICT",
      `Approval request ${id} expired at ${existing.expiresAt} and can no longer authorize an action`,
      { statusCode: 409 },
    );
  }

  // ARTIFACT BINDING — the load-bearing check.
  //
  // An artifact-bound approval authorizes exactly the artifact whose hash
  // the approver saw. Presenting a different one (a patch edited after
  // sign-off) is refused, and presenting none at all is ALSO refused: a
  // caller that "forgets" the hash must not be able to downgrade a bound
  // approval back into a categorical one — that would make the control
  // opt-out at the point where it matters most.
  // ACTION / TARGET / ACTOR MATCH — an approval for RECORD.UPDATE must not
  // authorize RECORD.DELETE, and an approval requested by one agent must
  // not be redeemed by another.
  if (presented?.entityType !== undefined && presented.entityType !== existing.entityType) {
    throw new AtlasError(
      "CONFLICT",
      `Approval request ${id} authorizes entityType ${existing.entityType}, not ${presented.entityType}`,
      { statusCode: 409 },
    );
  }
  if (presented?.action !== undefined && presented.action !== existing.action) {
    throw new AtlasError(
      "CONFLICT",
      `Approval request ${id} authorizes action ${existing.action}, not ${presented.action}`,
      { statusCode: 409 },
    );
  }
  if (presented?.agentId !== undefined && presented.agentId !== existing.requestedBy) {
    throw new AtlasError(
      "CONFLICT",
      `Approval request ${id} was requested by ${existing.requestedBy} and cannot be redeemed by ${presented.agentId}`,
      { statusCode: 409 },
    );
  }

  const artifactHash = presented?.artifactHash;
  if (existing.artifactHash) {
    if (artifactHash === undefined) {
      throw new AtlasError(
        "CONFLICT",
        `Approval request ${id} is bound to a specific artifact; consuming it requires presenting that artifact's hash`,
        { statusCode: 409 },
      );
    }
    if (artifactHash !== existing.artifactHash) {
      throw new AtlasError(
        "CONFLICT",
        `Approval request ${id} authorizes artifact ${existing.artifactHash}, not ${artifactHash} — the approved artifact changed after sign-off`,
        { statusCode: 409 },
      );
    }
  }

  const updated = approvalRequestSchema.parse({
    ...existing,
    status: "CONSUMED" as const,
  });
  approvalRequests.set(id, updated);
  return updated;
}

/** Test helper — clear the in-memory store so tests start clean. */
export function resetApprovalsForTests(): void {
  approvalRequests.clear();
}
