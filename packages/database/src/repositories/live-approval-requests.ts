import { approvalRequestSchema, type ApprovalRequest } from "@atlas/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LiveApprovalRpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type CreateLiveApprovalInput = {
  entityType: string;
  action: string;
  requestedBy: string;
  reason: string;
  context?: Record<string, unknown>;
  artifactHash?: string | null;
  expiresAt?: string | null;
  expectedObservations?: readonly string[];
  baselineObservations?: readonly string[];
};

export type DecideLiveApprovalInput = {
  decidedBy: string;
  approve: boolean;
  decisionReason: string;
};

export type RevokeLiveApprovalInput = {
  revokedBy: string;
  reason: string;
};

export type PresentedLiveExecution = {
  readonly artifactHash?: string;
  readonly entityType?: string;
  readonly action?: string;
  readonly agentId?: string;
};

export class LiveApprovalPersistenceError extends Error {
  constructor(
    readonly kind: "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "LiveApprovalPersistenceError";
  }
}

function parseRecord(value: unknown): ApprovalRequest {
  return approvalRequestSchema.parse(value);
}

function mapRpcError(error: { message: string }): never {
  const message = error.message;
  if (/not found/i.test(message)) {
    throw new LiveApprovalPersistenceError("NOT_FOUND", message);
  }
  if (
    /already been decided|not APPROVED|REVOKED|expired at|authorizes |cannot be revoked|cannot be redeemed|requires presenting that artifact/i.test(
      message,
    )
  ) {
    throw new LiveApprovalPersistenceError("CONFLICT", message);
  }
  throw new LiveApprovalPersistenceError("UNAVAILABLE", message);
}

async function callRpc(
  client: LiveApprovalRpcClient,
  fn: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  let result: { data: unknown; error: { message: string } | null };
  try {
    result = await Promise.resolve(client.rpc(fn, args));
  } catch (cause) {
    throw new LiveApprovalPersistenceError(
      "UNAVAILABLE",
      cause instanceof Error ? cause.message : "Live approval store is unavailable",
      { cause },
    );
  }
  if (result.error) {
    mapRpcError(result.error);
  }
  return result.data;
}

export class LiveApprovalRequestRepository {
  private readonly client: LiveApprovalRpcClient;

  constructor(client: LiveApprovalRpcClient | SupabaseClient) {
    this.client = client as LiveApprovalRpcClient;
  }

  async create(input: CreateLiveApprovalInput): Promise<ApprovalRequest> {
    const data = await callRpc(this.client, "create_live_approval_request", {
      p_entity_type: input.entityType,
      p_action: input.action,
      p_requested_by: input.requestedBy,
      p_reason: input.reason,
      p_context: input.context ?? {},
      p_artifact_hash: input.artifactHash ?? null,
      p_expires_at: input.expiresAt ?? null,
      p_expected_observations: [...(input.expectedObservations ?? [])],
      p_baseline_observations: [...(input.baselineObservations ?? [])],
    });
    return parseRecord(data);
  }

  async get(id: string): Promise<ApprovalRequest | undefined> {
    const data = await callRpc(this.client, "get_live_approval_request", { p_id: id });
    if (data === null || data === undefined) return undefined;
    return parseRecord(data);
  }

  async list(status?: ApprovalRequest["status"]): Promise<ApprovalRequest[]> {
    const data = await callRpc(this.client, "list_live_approval_requests", {
      p_status: status ?? null,
    });
    if (!Array.isArray(data)) {
      throw new LiveApprovalPersistenceError("UNAVAILABLE", "Invalid live approval list response");
    }
    return data
      .map((item) => parseRecord(item))
      .sort(
        (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
      );
  }

  async decide(id: string, input: DecideLiveApprovalInput): Promise<ApprovalRequest> {
    const data = await callRpc(this.client, "decide_live_approval_request", {
      p_id: id,
      p_decided_by: input.decidedBy,
      p_approve: input.approve,
      p_decision_reason: input.decisionReason,
    });
    return parseRecord(data);
  }

  async revoke(id: string, input: RevokeLiveApprovalInput): Promise<ApprovalRequest> {
    const data = await callRpc(this.client, "revoke_live_approval_request", {
      p_id: id,
      p_revoked_by: input.revokedBy,
      p_reason: input.reason,
    });
    return parseRecord(data);
  }

  async consume(id: string, presented?: PresentedLiveExecution): Promise<ApprovalRequest> {
    const data = await callRpc(this.client, "consume_live_approval_request", {
      p_id: id,
      p_artifact_hash: presented?.artifactHash ?? null,
      p_entity_type: presented?.entityType ?? null,
      p_action: presented?.action ?? null,
      p_agent_id: presented?.agentId ?? null,
    });
    return parseRecord(data);
  }
}
