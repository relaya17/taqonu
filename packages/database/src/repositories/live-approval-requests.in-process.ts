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

  return { rpc };
}
