import { approvalRequestSchema, type ApprovalRequest } from "@atlas/shared";
import type { LiveApprovalRpcClient } from "./live-approval-requests.js";

/**
 * Isolated in-process RPC backend for tests only.
 * Production `approvals.ts` never constructs this client.
 */
export function createInProcessLiveApprovalClient(): LiveApprovalRpcClient {
  const rows = new Map<string, ApprovalRequest>();

  function toIso(value: Date): string {
    return value.toISOString();
  }

  const rpc: LiveApprovalRpcClient["rpc"] = async (fn, args = {}) => {
    try {
      return { data: dispatch(fn, args), error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  };

  function dispatch(fn: string, args: Record<string, unknown>): unknown {
    switch (fn) {
      case "create_live_approval_request":
        return create(args);
      case "get_live_approval_request":
        return get(String(args["p_id"] ?? ""));
      case "list_live_approval_requests":
        return list(args["p_status"] == null ? undefined : String(args["p_status"]));
      case "decide_live_approval_request":
        return decide(args);
      case "revoke_live_approval_request":
        return revoke(args);
      case "consume_live_approval_request":
        return consume(args);
      case "claim_live_approval_request":
        return claim(args);
      case "mark_live_approval_execution_started":
        return markStarted(args);
      case "finalize_live_approval_request":
        return finalize(args);
      default:
        throw new Error(`Unknown live approval RPC ${fn}`);
    }
  }

  function create(args: Record<string, unknown>): ApprovalRequest {
    const now = toIso(new Date());
    const request = approvalRequestSchema.parse({
      id: crypto.randomUUID(),
      entityType: args["p_entity_type"],
      action: args["p_action"],
      requestedBy: args["p_requested_by"],
      requestedAt: now,
      status: "PENDING",
      reason: args["p_reason"],
      context: args["p_context"] ?? {},
      artifactHash: args["p_artifact_hash"] ?? null,
      expiresAt: args["p_expires_at"] ?? null,
      expectedObservations: args["p_expected_observations"] ?? [],
      baselineObservations: args["p_baseline_observations"] ?? [],
      revokedBy: null,
      revokedAt: null,
      revocationReason: null,
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      liveExecutionId: null,
      claimedAt: null,
      claimedBy: null,
      requestId: null,
      executionStartedAt: null,
      finalizedAt: null,
      finalOutcome: null,
      finalizeReason: null,
      runtimeExecutionId: null,
      outputEvidence: null,
    });
    rows.set(request.id, request);
    return request;
  }

  function get(id: string): ApprovalRequest | null {
    return rows.get(id) ?? null;
  }

  function list(status?: string): ApprovalRequest[] {
    const items = [...rows.values()];
    const filtered = status ? items.filter((item) => item.status === status) : items;
    return filtered.sort(
      (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    );
  }

  function decide(args: Record<string, unknown>): ApprovalRequest {
    const id = String(args["p_id"]);
    const existing = rows.get(id);
    if (!existing) throw new Error(`Approval request ${id} not found`);
    if (existing.status !== "PENDING") {
      throw new Error(
        `Approval request ${id} has already been decided (status=${existing.status})`,
      );
    }
    const updated = approvalRequestSchema.parse({
      ...existing,
      status: args["p_approve"] ? "APPROVED" : "REJECTED",
      decidedBy: args["p_decided_by"],
      decidedAt: toIso(new Date()),
      decisionReason: args["p_decision_reason"],
    });
    rows.set(id, updated);
    return updated;
  }

  function revoke(args: Record<string, unknown>): ApprovalRequest {
    const id = String(args["p_id"]);
    const existing = rows.get(id);
    if (!existing) throw new Error(`Approval request ${id} not found`);
    if (existing.status === "CONSUMED") {
      throw new Error(
        `Approval request ${id} has already been CONSUMED and cannot be revoked — the execution it authorized already happened`,
      );
    }
    if (
      existing.status === "CLAIMED" ||
      existing.status === "FULFILLED" ||
      existing.status === "FAILED" ||
      existing.status === "OUTCOME_UNKNOWN"
    ) {
      throw new Error(
        `Approval request ${id} cannot be revoked (status=${existing.status}); claimed or finalized approvals cannot be revoked`,
      );
    }
    if (existing.status !== "PENDING" && existing.status !== "APPROVED") {
      throw new Error(
        `Approval request ${id} cannot be revoked (status=${existing.status}); only PENDING or APPROVED requests can be revoked`,
      );
    }
    const updated = approvalRequestSchema.parse({
      ...existing,
      status: "REVOKED",
      revokedBy: args["p_revoked_by"],
      revokedAt: toIso(new Date()),
      revocationReason: args["p_reason"],
    });
    rows.set(id, updated);
    return updated;
  }

  function consume(args: Record<string, unknown>): ApprovalRequest {
    const id = String(args["p_id"]);
    const existing = rows.get(id);
    if (!existing) throw new Error(`Approval request ${id} not found`);
    if (existing.status === "REVOKED") {
      throw new Error(
        `Approval request ${id} was REVOKED by ${existing.revokedBy ?? "unknown"} at ${existing.revokedAt ?? "unknown time"} and can never authorize an action`,
      );
    }
    if (existing.status !== "APPROVED") {
      throw new Error(
        `Approval request ${id} is not APPROVED (status=${existing.status}) and cannot be consumed`,
      );
    }
    if (existing.expiresAt !== null && Date.parse(existing.expiresAt) <= Date.now()) {
      throw new Error(
        `Approval request ${id} expired at ${existing.expiresAt} and can no longer authorize an action`,
      );
    }
    const entityType = args["p_entity_type"];
    const action = args["p_action"];
    const agentId = args["p_agent_id"];
    const artifactHash = args["p_artifact_hash"];
    if (entityType != null && entityType !== existing.entityType) {
      throw new Error(
        `Approval request ${id} authorizes entityType ${existing.entityType}, not ${String(entityType)}`,
      );
    }
    if (action != null && action !== existing.action) {
      throw new Error(
        `Approval request ${id} authorizes action ${existing.action}, not ${String(action)}`,
      );
    }
    if (agentId != null && agentId !== existing.requestedBy) {
      throw new Error(
        `Approval request ${id} was requested by ${existing.requestedBy} and cannot be redeemed by ${String(agentId)}`,
      );
    }
    if (existing.artifactHash) {
      if (artifactHash == null) {
        throw new Error(
          `Approval request ${id} is bound to a specific artifact; consuming it requires presenting that artifact's hash`,
        );
      }
      if (artifactHash !== existing.artifactHash) {
        throw new Error(
          `Approval request ${id} authorizes artifact ${existing.artifactHash}, not ${String(artifactHash)} — the approved artifact changed after sign-off`,
        );
      }
    }
    const updated = approvalRequestSchema.parse({ ...existing, status: "CONSUMED" });
    rows.set(id, updated);
    return updated;
  }

  function asText(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value);
    return text.length === 0 ? null : text;
  }

  function claim(args: Record<string, unknown>): ApprovalRequest {
    const id = String(args["p_id"]);
    const entityType = asText(args["p_entity_type"]);
    const action = asText(args["p_action"]);
    const executorId = asText(args["p_executor_id"]);
    if (!entityType || !action || !executorId) {
      throw new Error("claim requires entityType, action, and executorId");
    }
    const existing = rows.get(id);
    if (!existing) throw new Error(`Approval request ${id} not found`);
    if (existing.status === "REVOKED") {
      throw new Error(
        `Approval request ${id} was REVOKED by ${existing.revokedBy ?? "unknown"} at ${existing.revokedAt ?? "unknown time"} and can never authorize an action`,
      );
    }
    if (existing.status !== "APPROVED") {
      throw new Error(
        `Approval request ${id} is not APPROVED (status=${existing.status}) and cannot be claimed`,
      );
    }
    if (existing.expiresAt !== null && Date.parse(existing.expiresAt) <= Date.now()) {
      throw new Error(
        `Approval request ${id} expired at ${existing.expiresAt} and can no longer authorize an action`,
      );
    }
    if (entityType !== existing.entityType) {
      throw new Error(
        `Approval request ${id} authorizes entityType ${existing.entityType}, not ${entityType}`,
      );
    }
    if (action !== existing.action) {
      throw new Error(
        `Approval request ${id} authorizes action ${existing.action}, not ${action}`,
      );
    }
    if (executorId !== existing.requestedBy) {
      throw new Error(
        `Approval request ${id} was requested by ${existing.requestedBy} and cannot be claimed by ${executorId}`,
      );
    }
    let artifactHash = existing.artifactHash;
    const presentedHash = asText(args["p_artifact_hash"]);
    if (artifactHash) {
      if (!presentedHash) {
        throw new Error(
          `Approval request ${id} is bound to a specific artifact; claiming it requires presenting that artifact's hash`,
        );
      }
      if (presentedHash !== artifactHash) {
        throw new Error(
          `Approval request ${id} authorizes artifact ${artifactHash}, not ${presentedHash} — the approved artifact changed after sign-off`,
        );
      }
    } else if (presentedHash) {
      artifactHash = presentedHash;
    }
    const updated = approvalRequestSchema.parse({
      ...existing,
      status: "CLAIMED",
      artifactHash,
      liveExecutionId: crypto.randomUUID(),
      claimedAt: toIso(new Date()),
      claimedBy: executorId,
      requestId: asText(args["p_request_id"]),
    });
    rows.set(id, updated);
    return updated;
  }

  function markStarted(args: Record<string, unknown>): ApprovalRequest {
    const id = String(args["p_id"]);
    const liveExecutionId = asText(args["p_live_execution_id"]);
    const existing = rows.get(id);
    if (!existing) throw new Error(`Approval request ${id} not found`);
    if (existing.status !== "CLAIMED") {
      throw new Error(
        `Approval request ${id} is not CLAIMED (status=${existing.status}) and cannot mark execution started`,
      );
    }
    if (existing.liveExecutionId !== liveExecutionId) {
      throw new Error("liveExecutionId does not match");
    }
    if (existing.executionStartedAt !== null) {
      return existing;
    }
    const updated = approvalRequestSchema.parse({
      ...existing,
      executionStartedAt: toIso(new Date()),
    });
    rows.set(id, updated);
    return updated;
  }

  function finalize(args: Record<string, unknown>): ApprovalRequest {
    const id = String(args["p_id"]);
    const liveExecutionId = asText(args["p_live_execution_id"]);
    const outcome = asText(args["p_outcome"]);
    if (outcome !== "FULFILLED" && outcome !== "FAILED" && outcome !== "OUTCOME_UNKNOWN") {
      throw new Error("invalid terminal outcome");
    }
    const existing = rows.get(id);
    if (!existing) throw new Error(`Approval request ${id} not found`);
    if (
      existing.status === "FULFILLED" ||
      existing.status === "FAILED" ||
      existing.status === "OUTCOME_UNKNOWN"
    ) {
      if (existing.liveExecutionId !== liveExecutionId) {
        throw new Error("liveExecutionId does not match");
      }
      if (existing.finalOutcome === outcome) {
        return existing;
      }
      throw new Error("conflicting terminal outcome");
    }
    if (existing.status !== "CLAIMED") {
      throw new Error(
        `Approval request ${id} is not CLAIMED (status=${existing.status}) and cannot be finalized`,
      );
    }
    if (existing.liveExecutionId !== liveExecutionId) {
      throw new Error("liveExecutionId does not match");
    }
    const reason = asText(args["p_reason"]);
    const runtimeExecutionId = asText(args["p_runtime_execution_id"]);
    const outputEvidence = asText(args["p_output_evidence"]);
    if (outcome === "FULFILLED") {
      if (!runtimeExecutionId && !outputEvidence) {
        throw new Error("FULFILLED requires execution evidence");
      }
    } else if (outcome === "FAILED") {
      if (!reason) {
        throw new Error("FAILED requires a reason");
      }
    } else {
      if (existing.executionStartedAt === null) {
        throw new Error("OUTCOME_UNKNOWN requires execution to have started");
      }
      if (!reason) {
        throw new Error("OUTCOME_UNKNOWN requires a reason");
      }
    }
    const updated = approvalRequestSchema.parse({
      ...existing,
      status: outcome,
      finalizedAt: toIso(new Date()),
      finalOutcome: outcome,
      finalizeReason: reason,
      runtimeExecutionId,
      outputEvidence,
    });
    rows.set(id, updated);
    return updated;
  }

  return { rpc };
}
