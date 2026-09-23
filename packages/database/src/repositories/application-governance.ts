/**
 * Durable application governance (G16 R01+R02+R03).
 *
 * Postgres RPCs are the live authority. This client must not insert
 * public.audit_logs itself — T1/T2 RPCs write audit_logs in the same
 * transaction as the operational rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ApplicationGovernanceRpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type ApplicationGovernanceErrorKind =
  | "CONFLICT"
  | "UNAVAILABLE"
  | "REJECTED";

export class ApplicationGovernancePersistenceError extends Error {
  constructor(
    readonly kind: ApplicationGovernanceErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ApplicationGovernancePersistenceError";
  }
}

export interface PersistedPreflightDecision {
  readonly decisionId: string;
  readonly requestId: string;
  readonly applicationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly operation: string;
  readonly operationClass: string;
  readonly decision: string;
  readonly agentId: string | null;
  readonly httpStatus: number;
  readonly response: Record<string, unknown>;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: string;
  readonly expired: boolean;
}

export interface PreflightIdempotencyHit {
  readonly fingerprint: string;
  readonly decisionId: string;
  readonly httpStatus: number;
  readonly response: Record<string, unknown>;
}

export interface RecordPreflightOutcomeInput {
  readonly decisionId: string;
  readonly requestId: string;
  readonly applicationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly operation: string;
  readonly operationClass: string;
  readonly decision: string;
  readonly agentId: string | null;
  readonly approvalId: string | null;
  readonly httpStatus: number;
  readonly response: Record<string, unknown>;
  readonly expiresAt: string;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
  readonly auditId: string;
  readonly auditPayload: Record<string, unknown>;
}

export type RecordPreflightOutcomeResult =
  | {
      readonly kind: "RECORDED";
      readonly decisionId: string;
      readonly httpStatus: number;
      readonly response: Record<string, unknown>;
      readonly auditId: string;
    }
  | {
      readonly kind: "IDEMPOTENT_HIT";
      readonly decisionId: string;
      readonly httpStatus: number;
      readonly response: Record<string, unknown>;
    }
  | {
      readonly kind: "IDEMPOTENT_CONFLICT";
      readonly decisionId: string;
    };

export interface RecordExecutionReportInput {
  readonly decisionId: string;
  readonly executionId: string;
  readonly applicationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly requestId: string;
  readonly operation: string;
  readonly executionStatus: "SUCCESS" | "FAILURE";
  readonly agentId: string | null;
  readonly auditId: string;
  readonly auditPayload: Record<string, unknown>;
}

export interface PersistedExecutionReport {
  readonly decisionId: string;
  readonly requestId: string;
  readonly executionId: string;
  readonly executionStatus: "SUCCESS" | "FAILURE";
  readonly applicationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly operation: string;
  readonly agentId: string | null;
}

export type RecordExecutionReportResult =
  | {
      readonly kind: "RECORDED";
      readonly reason: string;
      readonly report: PersistedExecutionReport;
      readonly auditId: string;
    }
  | {
      readonly kind: "IDEMPOTENT_HIT";
      readonly reason: string;
      readonly report: PersistedExecutionReport;
    }
  | {
      readonly kind: "CONFLICT";
      readonly reason: string;
    }
  | {
      readonly kind: "REJECTED";
      readonly reason: string;
    };

function mapRpcError(error: { message: string }): never {
  const message = error.message;
  if (/already been used|idempotent|conflict|does not match|expired|not found/i.test(message)) {
    throw new ApplicationGovernancePersistenceError("CONFLICT", message);
  }
  throw new ApplicationGovernancePersistenceError("UNAVAILABLE", message);
}

async function callRpc(
  client: ApplicationGovernanceRpcClient,
  fn: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  let result: { data: unknown; error: { message: string } | null };
  try {
    result = await Promise.resolve(client.rpc(fn, args));
  } catch (cause) {
    throw new ApplicationGovernancePersistenceError(
      "UNAVAILABLE",
      cause instanceof Error ? cause.message : "Application governance store is unavailable",
      { cause },
    );
  }
  if (result.error) {
    mapRpcError(result.error);
  }
  return result.data;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new ApplicationGovernancePersistenceError(
    "UNAVAILABLE",
    "Invalid application governance payload",
  );
}

function parseDecision(value: unknown): PersistedPreflightDecision {
  const row = asRecord(value);
  return {
    decisionId: String(row.decisionId ?? ""),
    requestId: String(row.requestId ?? ""),
    applicationId: String(row.applicationId ?? ""),
    tenantId: String(row.tenantId ?? ""),
    projectId: String(row.projectId ?? ""),
    operation: String(row.operation ?? ""),
    operationClass: String(row.operationClass ?? ""),
    decision: String(row.decision ?? ""),
    agentId: row.agentId == null ? null : String(row.agentId),
    httpStatus: Number(row.httpStatus ?? 0),
    response: asRecord(row.response),
    createdAt: String(row.createdAt ?? ""),
    expiresAt: String(row.expiresAt ?? ""),
    status: String(row.status ?? "RECORDED"),
    expired: Boolean(row.expired),
  };
}

function parseReport(value: unknown): PersistedExecutionReport {
  const row = asRecord(value);
  const status = row.executionStatus === "FAILURE" ? "FAILURE" : "SUCCESS";
  return {
    decisionId: String(row.decisionId ?? ""),
    requestId: String(row.requestId ?? ""),
    executionId: String(row.executionId ?? ""),
    executionStatus: status,
    applicationId: String(row.applicationId ?? ""),
    tenantId: String(row.tenantId ?? ""),
    projectId: String(row.projectId ?? ""),
    operation: String(row.operation ?? ""),
    agentId: row.agentId == null ? null : String(row.agentId),
  };
}

export class ApplicationGovernanceRepository {
  private readonly client: ApplicationGovernanceRpcClient;

  constructor(client: ApplicationGovernanceRpcClient | SupabaseClient) {
    this.client = client as ApplicationGovernanceRpcClient;
  }

  async consumeNonce(input: {
    readonly applicationId: string;
    readonly nonce: string;
    readonly expiresAt: string;
  }): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
    const data = await callRpc(this.client, "consume_application_connector_nonce", {
      p_application_id: input.applicationId,
      p_nonce: input.nonce,
      p_expires_at: input.expiresAt,
    });
    const row = asRecord(data);
    if (row.ok === true) return { ok: true };
    return {
      ok: false,
      reason: String(row.reason ?? "Application connector nonce has already been used"),
    };
  }

  async lookupIdempotency(input: {
    readonly applicationId: string;
    readonly idempotencyKey: string;
  }): Promise<PreflightIdempotencyHit | null> {
    const data = await callRpc(this.client, "lookup_application_preflight_idempotency", {
      p_application_id: input.applicationId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (data === null || data === undefined) return null;
    const row = asRecord(data);
    return {
      fingerprint: String(row.fingerprint ?? ""),
      decisionId: String(row.decisionId ?? ""),
      httpStatus: Number(row.httpStatus ?? 0),
      response: asRecord(row.response),
    };
  }

  async lookupDecision(decisionId: string): Promise<PersistedPreflightDecision | null> {
    const data = await callRpc(this.client, "lookup_application_preflight_decision", {
      p_decision_id: decisionId,
    });
    if (data === null || data === undefined) return null;
    return parseDecision(data);
  }

  async recordOutcome(
    input: RecordPreflightOutcomeInput,
  ): Promise<RecordPreflightOutcomeResult> {
    const data = await callRpc(this.client, "record_application_preflight_outcome", {
      p_decision_id: input.decisionId,
      p_request_id: input.requestId,
      p_application_id: input.applicationId,
      p_tenant_id: input.tenantId,
      p_project_id: input.projectId,
      p_operation: input.operation,
      p_operation_class: input.operationClass,
      p_decision: input.decision,
      p_agent_id: input.agentId,
      p_approval_id: input.approvalId,
      p_http_status: input.httpStatus,
      p_response: input.response,
      p_expires_at: input.expiresAt,
      p_idempotency_key: input.idempotencyKey,
      p_fingerprint: input.fingerprint,
      p_audit_id: input.auditId,
      p_audit_payload: input.auditPayload,
    });
    const row = asRecord(data);
    const kind = String(row.kind ?? "");
    if (kind === "IDEMPOTENT_HIT") {
      return {
        kind: "IDEMPOTENT_HIT",
        decisionId: String(row.decisionId ?? ""),
        httpStatus: Number(row.httpStatus ?? 0),
        response: asRecord(row.response),
      };
    }
    if (kind === "IDEMPOTENT_CONFLICT") {
      return {
        kind: "IDEMPOTENT_CONFLICT",
        decisionId: String(row.decisionId ?? ""),
      };
    }
    if (kind === "RECORDED") {
      return {
        kind: "RECORDED",
        decisionId: String(row.decisionId ?? input.decisionId),
        httpStatus: Number(row.httpStatus ?? input.httpStatus),
        response: asRecord(row.response ?? input.response),
        auditId: String(row.auditId ?? input.auditId),
      };
    }
    throw new ApplicationGovernancePersistenceError(
      "UNAVAILABLE",
      `Unexpected preflight outcome kind ${kind}`,
    );
  }

  async recordReport(
    input: RecordExecutionReportInput,
  ): Promise<RecordExecutionReportResult> {
    const data = await callRpc(this.client, "record_application_execution_report", {
      p_decision_id: input.decisionId,
      p_execution_id: input.executionId,
      p_application_id: input.applicationId,
      p_tenant_id: input.tenantId,
      p_project_id: input.projectId,
      p_request_id: input.requestId,
      p_operation: input.operation,
      p_execution_status: input.executionStatus,
      p_agent_id: input.agentId,
      p_audit_id: input.auditId,
      p_audit_payload: input.auditPayload,
    });
    const row = asRecord(data);
    const kind = String(row.kind ?? "");
    if (kind === "REJECTED") {
      return { kind: "REJECTED", reason: String(row.reason ?? "rejected") };
    }
    if (kind === "CONFLICT") {
      return { kind: "CONFLICT", reason: String(row.reason ?? "conflict") };
    }
    if (kind === "IDEMPOTENT_HIT") {
      return {
        kind: "IDEMPOTENT_HIT",
        reason: String(row.reason ?? "Replay of an already accepted execution report"),
        report: parseReport(row.report),
      };
    }
    if (kind === "RECORDED") {
      return {
        kind: "RECORDED",
        reason: String(row.reason ?? "Execution report correlated to a preceding ALLOW"),
        report: parseReport(row.report),
        auditId: String(row.auditId ?? input.auditId),
      };
    }
    throw new ApplicationGovernancePersistenceError(
      "UNAVAILABLE",
      `Unexpected execution report kind ${kind}`,
    );
  }
}
