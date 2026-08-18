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
};

export type DecideApprovalRequestInput = {
  decidedBy: string;
  approve: boolean;
  decisionReason: string;
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
 * Consumes an APPROVED approval request, flipping it to CONSUMED so it can
 * authorize exactly ONE real action execution (never replayed). Throws
 * unless the current status is APPROVED.
 */
export function consumeApprovalRequest(id: string): ApprovalRequest {
  const existing = approvalRequests.get(id);
  if (!existing) {
    throw new AtlasError("NOT_FOUND", `Approval request ${id} not found`, {
      statusCode: 404,
    });
  }
  if (existing.status !== "APPROVED") {
    throw new AtlasError(
      "CONFLICT",
      `Approval request ${id} is not APPROVED (status=${existing.status}) and cannot be consumed`,
      { statusCode: 409 },
    );
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
