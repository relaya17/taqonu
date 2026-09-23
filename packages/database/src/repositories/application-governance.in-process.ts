import type { ApplicationGovernanceRpcClient } from "./application-governance.js";

export type ApplicationGovernanceFailPoint =
  | "t1_after_decision"
  | "t1_after_idempotency"
  | "t1_before_audit"
  | "t2_after_report"
  | "t2_before_audit";

interface NonceRow {
  readonly expiresAt: number;
}

interface DecisionRow {
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
}

interface IdempotencyRow {
  readonly applicationId: string;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
  readonly decisionId: string;
  readonly httpStatus: number;
}

interface ReportRow {
  readonly decisionId: string;
  readonly executionId: string;
  readonly applicationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly requestId: string;
  readonly operation: string;
  readonly executionStatus: "SUCCESS" | "FAILURE";
  readonly agentId: string | null;
}

interface AuditRow {
  readonly id: string;
  readonly action: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly payload: Record<string, unknown>;
}

export interface ApplicationGovernanceMemory {
  readonly nonces: Map<string, NonceRow>;
  readonly decisions: Map<string, DecisionRow>;
  readonly decisionsByRequest: Map<string, string>;
  readonly idempotency: Map<string, IdempotencyRow>;
  readonly reports: Map<string, ReportRow>;
  readonly audits: Map<string, AuditRow>;
  failNext: ApplicationGovernanceFailPoint | null;
}

export function createApplicationGovernanceMemory(): ApplicationGovernanceMemory {
  return {
    nonces: new Map(),
    decisions: new Map(),
    decisionsByRequest: new Map(),
    idempotency: new Map(),
    reports: new Map(),
    audits: new Map(),
    failNext: null,
  };
}

export interface InProcessApplicationGovernanceClient extends ApplicationGovernanceRpcClient {
  readonly memory: ApplicationGovernanceMemory;
  failNext(point: ApplicationGovernanceFailPoint): void;
}

function nonceKey(applicationId: string, nonce: string): string {
  return `${applicationId}:${nonce}`;
}

function idemKey(applicationId: string, key: string): string {
  return `${applicationId}:${key}`;
}

function requestKey(applicationId: string, requestId: string): string {
  return `${applicationId}:${requestId}`;
}

function reportKey(decisionId: string, executionId: string): string {
  return `${decisionId}:${executionId}`;
}

function cloneMemory(memory: ApplicationGovernanceMemory): ApplicationGovernanceMemory {
  return {
    nonces: new Map(memory.nonces),
    decisions: new Map(memory.decisions),
    decisionsByRequest: new Map(memory.decisionsByRequest),
    idempotency: new Map(memory.idempotency),
    reports: new Map(memory.reports),
    audits: new Map(memory.audits),
    failNext: memory.failNext,
  };
}

function restoreMemory(target: ApplicationGovernanceMemory, snap: ApplicationGovernanceMemory): void {
  target.nonces.clear();
  for (const [k, v] of snap.nonces) target.nonces.set(k, v);
  target.decisions.clear();
  for (const [k, v] of snap.decisions) target.decisions.set(k, v);
  target.decisionsByRequest.clear();
  for (const [k, v] of snap.decisionsByRequest) target.decisionsByRequest.set(k, v);
  target.idempotency.clear();
  for (const [k, v] of snap.idempotency) target.idempotency.set(k, v);
  target.reports.clear();
  for (const [k, v] of snap.reports) target.reports.set(k, v);
  target.audits.clear();
  for (const [k, v] of snap.audits) target.audits.set(k, v);
}

function trip(memory: ApplicationGovernanceMemory, point: ApplicationGovernanceFailPoint): void {
  if (memory.failNext === point) {
    memory.failNext = null;
    throw new Error(`injected failure at ${point}`);
  }
}

function asIso(value: unknown, fallback = new Date().toISOString()): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Date) return value.toISOString();
  return fallback;
}

function decisionJson(row: DecisionRow, now = Date.now()) {
  const expired = Date.parse(row.expiresAt) <= now || row.status === "EXPIRED";
  return {
    decisionId: row.decisionId,
    requestId: row.requestId,
    applicationId: row.applicationId,
    tenantId: row.tenantId,
    projectId: row.projectId,
    operation: row.operation,
    operationClass: row.operationClass,
    decision: row.decision,
    agentId: row.agentId,
    httpStatus: row.httpStatus,
    response: row.response,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    status: row.status,
    expired,
  };
}

function reportJson(row: ReportRow) {
  return {
    decisionId: row.decisionId,
    requestId: row.requestId,
    executionId: row.executionId,
    executionStatus: row.executionStatus,
    applicationId: row.applicationId,
    tenantId: row.tenantId,
    projectId: row.projectId,
    operation: row.operation,
    agentId: row.agentId,
  };
}

export function createInProcessApplicationGovernanceClient(
  memory: ApplicationGovernanceMemory = createApplicationGovernanceMemory(),
): InProcessApplicationGovernanceClient {
  const rpc: ApplicationGovernanceRpcClient["rpc"] = async (fn, args = {}) => {
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
      case "consume_application_connector_nonce":
        return consumeNonce(args);
      case "lookup_application_preflight_idempotency":
        return lookupIdempotency(args);
      case "lookup_application_preflight_decision":
        return lookupDecision(args);
      case "record_application_preflight_outcome":
        return withTxn(() => recordOutcome(args));
      case "record_application_execution_report":
        return withTxn(() => recordReport(args));
      default:
        throw new Error(`Unknown application governance RPC ${fn}`);
    }
  }

  function withTxn<T>(fn: () => T): T {
    const snap = cloneMemory(memory);
    try {
      return fn();
    } catch (error) {
      restoreMemory(memory, snap);
      throw error;
    }
  }

  function consumeNonce(args: Record<string, unknown>): { ok: boolean; reason?: string } {
    const applicationId = String(args["p_application_id"] ?? "");
    const nonce = String(args["p_nonce"] ?? "");
    const expiresAt = Date.parse(asIso(args["p_expires_at"]));
    const now = Date.now();
    if (!applicationId || nonce.length < 8) {
      throw new Error("application_id and nonce are required");
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      throw new Error("nonce expires_at must be in the future");
    }
    for (const [key, row] of memory.nonces) {
      if (row.expiresAt <= now) memory.nonces.delete(key);
    }
    const key = nonceKey(applicationId, nonce);
    if (memory.nonces.has(key)) {
      return { ok: false, reason: "Application connector nonce has already been used" };
    }
    memory.nonces.set(key, { expiresAt });
    return { ok: true };
  }

  function lookupIdempotency(args: Record<string, unknown>): unknown {
    const row = memory.idempotency.get(
      idemKey(String(args["p_application_id"] ?? ""), String(args["p_idempotency_key"] ?? "")),
    );
    if (!row) return null;
    const decision = memory.decisions.get(row.decisionId);
    if (!decision) return null;
    return {
      fingerprint: row.fingerprint,
      decisionId: row.decisionId,
      httpStatus: row.httpStatus,
      response: decision.response,
    };
  }

  function lookupDecision(args: Record<string, unknown>): unknown {
    const row = memory.decisions.get(String(args["p_decision_id"] ?? ""));
    if (!row) return null;
    return decisionJson(row);
  }

  function recordOutcome(args: Record<string, unknown>): unknown {
    const applicationId = String(args["p_application_id"] ?? "");
    const idempotencyKey = String(args["p_idempotency_key"] ?? "");
    const fingerprint = String(args["p_fingerprint"] ?? "");
    const decisionId = String(args["p_decision_id"] ?? "");
    const requestId = String(args["p_request_id"] ?? "");
    const auditId = String(args["p_audit_id"] ?? "");
    const existing = memory.idempotency.get(idemKey(applicationId, idempotencyKey));
    if (existing) {
      if (existing.fingerprint === fingerprint) {
        const decision = memory.decisions.get(existing.decisionId);
        return {
          kind: "IDEMPOTENT_HIT",
          decisionId: existing.decisionId,
          httpStatus: existing.httpStatus,
          response: decision?.response ?? {},
          auditId: null,
        };
      }
      return {
        kind: "IDEMPOTENT_CONFLICT",
        decisionId: existing.decisionId,
        httpStatus: 409,
        response: null,
        auditId: null,
      };
    }

    const reqKey = requestKey(applicationId, requestId);
    if (memory.decisionsByRequest.has(reqKey) || memory.decisions.has(decisionId)) {
      throw new Error("unique_violation: preflight_decisions");
    }
    if (memory.audits.has(auditId)) {
      throw new Error("unique_violation: audit_logs");
    }

    const decision: DecisionRow = {
      decisionId,
      requestId,
      applicationId,
      tenantId: String(args["p_tenant_id"] ?? ""),
      projectId: String(args["p_project_id"] ?? ""),
      operation: String(args["p_operation"] ?? ""),
      operationClass: String(args["p_operation_class"] ?? ""),
      decision: String(args["p_decision"] ?? ""),
      agentId: args["p_agent_id"] == null ? null : String(args["p_agent_id"]),
      httpStatus: Number(args["p_http_status"] ?? 0),
      response: (args["p_response"] as Record<string, unknown>) ?? {},
      createdAt: new Date().toISOString(),
      expiresAt: asIso(args["p_expires_at"]),
      status: "RECORDED",
    };
    memory.decisions.set(decisionId, decision);
    memory.decisionsByRequest.set(reqKey, decisionId);
    trip(memory, "t1_after_decision");

    memory.idempotency.set(idemKey(applicationId, idempotencyKey), {
      applicationId,
      idempotencyKey,
      fingerprint,
      decisionId,
      httpStatus: decision.httpStatus,
    });
    trip(memory, "t1_after_idempotency");
    trip(memory, "t1_before_audit");

    const payload = (args["p_audit_payload"] as Record<string, unknown>) ?? {};
    memory.audits.set(auditId, {
      id: auditId,
      action: String(payload.type ?? "application.preflight.evaluated"),
      entityType: String(payload.entityType ?? "application_preflight"),
      entityId: decisionId,
      payload,
    });

    return {
      kind: "RECORDED",
      decisionId,
      httpStatus: decision.httpStatus,
      response: decision.response,
      auditId,
    };
  }

  function recordReport(args: Record<string, unknown>): unknown {
    const decisionId = String(args["p_decision_id"] ?? "");
    const executionId = String(args["p_execution_id"] ?? "");
    const applicationId = String(args["p_application_id"] ?? "");
    const tenantId = String(args["p_tenant_id"] ?? "");
    const projectId = String(args["p_project_id"] ?? "");
    const requestId = String(args["p_request_id"] ?? "");
    const operation = String(args["p_operation"] ?? "");
    const executionStatus =
      args["p_execution_status"] === "FAILURE" ? "FAILURE" : "SUCCESS";
    const agentId = args["p_agent_id"] == null ? null : String(args["p_agent_id"]);
    const auditId = String(args["p_audit_id"] ?? "");

    const decision = memory.decisions.get(decisionId);
    if (!decision) {
      return {
        kind: "REJECTED",
        reason: "No preceding preflight authorization exists for this decisionId",
      };
    }
    if (Date.parse(decision.expiresAt) <= Date.now() || decision.status === "EXPIRED") {
      return {
        kind: "REJECTED",
        reason: "Preceding preflight authorization has expired",
      };
    }
    if (decision.applicationId !== applicationId) {
      return {
        kind: "REJECTED",
        reason: "Execution report application does not match the preceding authorization",
      };
    }
    if (decision.tenantId !== tenantId || decision.projectId !== projectId) {
      return {
        kind: "REJECTED",
        reason: "Execution report tenant or project does not match the preceding authorization",
      };
    }
    if (decision.requestId !== requestId) {
      return {
        kind: "REJECTED",
        reason: "Execution report requestId does not match the preceding authorization",
      };
    }
    if (decision.operation !== operation) {
      return {
        kind: "REJECTED",
        reason: "Execution report operation does not match the preceding authorization",
      };
    }
    if (decision.decision !== "ALLOW") {
      return {
        kind: "REJECTED",
        reason: `Execution report requires a preceding ALLOW; found ${decision.decision}`,
      };
    }
    if (decision.agentId && agentId && decision.agentId !== agentId) {
      return {
        kind: "REJECTED",
        reason: "Execution report agentId does not match the preceding authorization",
      };
    }

    const existing = memory.reports.get(reportKey(decisionId, executionId));
    if (existing) {
      if (existing.executionStatus !== executionStatus) {
        return {
          kind: "CONFLICT",
          reason: "Conflicting execution report for the same decisionId and executionId",
        };
      }
      return {
        kind: "IDEMPOTENT_HIT",
        reason: "Replay of an already accepted execution report",
        report: reportJson(existing),
      };
    }

    const recorded: ReportRow = {
      decisionId,
      executionId,
      applicationId,
      tenantId,
      projectId,
      requestId,
      operation,
      executionStatus,
      agentId: agentId ?? decision.agentId,
    };
    memory.reports.set(reportKey(decisionId, executionId), recorded);
    trip(memory, "t2_after_report");
    trip(memory, "t2_before_audit");

    if (memory.audits.has(auditId)) {
      throw new Error("unique_violation: audit_logs");
    }
    const payload = (args["p_audit_payload"] as Record<string, unknown>) ?? {};
    memory.audits.set(auditId, {
      id: auditId,
      action: String(payload.type ?? "application.execution.reported"),
      entityType: String(payload.entityType ?? "application_execution_report"),
      entityId: decisionId,
      payload,
    });

    return {
      kind: "RECORDED",
      reason: "Execution report correlated to a preceding ALLOW",
      report: reportJson(recorded),
      auditId,
    };
  }

  return {
    rpc,
    memory,
    failNext(point) {
      memory.failNext = point;
    },
  };
}
