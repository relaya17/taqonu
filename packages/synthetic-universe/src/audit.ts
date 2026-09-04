import type { UnifiedAuditEntryInput } from "@atlas/shared";
import { deterministicUuid } from "./ids.js";
import type { AuthorizationTrace } from "./types.js";

/**
 * In-memory sink using the canonical unified-audit *shape*.
 * Does not replace `appendUnifiedAuditEntry`. An API host may forward these.
 */
export class SyntheticAuditSink {
  private readonly entries: UnifiedAuditEntryInput[] = [];

  record(entry: UnifiedAuditEntryInput): UnifiedAuditEntryInput {
    this.entries.push(entry);
    return entry;
  }

  recordAuthorization(input: {
    readonly tenantId: string;
    readonly runId: string;
    readonly actorId: string;
    readonly ownerId: string;
    readonly correlationId: string;
    readonly trace: AuthorizationTrace;
    readonly toolName: string;
  }): void {
    this.record({
      type: "synthetic.authorization",
      toolName: input.toolName,
      entityType: input.trace.entityType,
      action: input.trace.action,
      actorId: input.actorId,
      actorKind: "AGENT",
      agentId: input.actorId,
      ownerId: input.ownerId,
      reason: input.trace.reason,
      intent: "synthetic_universe",
      policy: `${input.trace.entityType}.${input.trace.action}`,
      risk:
        input.trace.entityType === "FINANCIAL_TRANSACTION" ||
        input.trace.entityType === "COMMUNICATION"
          ? "HIGH"
          : "LOW",
      approval: input.trace.decision === "ALLOWED" ? "NOT_REQUIRED" : "PENDING",
      decision:
        input.trace.decision === "ALLOWED"
          ? "ALLOW"
          : input.trace.decision === "APPROVAL_REQUIRED"
            ? "REQUIRE_APPROVAL"
            : "DENY",
      input: { tenantId: input.tenantId, runId: input.runId },
      output: { decision: input.trace.decision },
      result: input.trace.decision === "DENIED" ? "FAILURE" : "SUCCESS",
      correlationId: input.correlationId,
    });
  }

  recordAction(input: {
    readonly tenantId: string;
    readonly runId: string;
    readonly actorId: string;
    readonly ownerId: string;
    readonly correlationId: string;
    readonly type: string;
    readonly reason: string;
    readonly decision: "ALLOW" | "DENY";
    readonly result: "SUCCESS" | "FAILURE" | "PARTIAL";
    readonly extra?: Record<string, unknown>;
  }): void {
    this.record({
      type: input.type,
      toolName: null,
      entityType: null,
      action: null,
      actorId: input.actorId,
      actorKind: "SYSTEM",
      agentId: input.actorId,
      ownerId: input.ownerId,
      reason: input.reason,
      intent: "synthetic_universe",
      policy: "synthetic.sandbox",
      risk: "LOW",
      approval: "NOT_REQUIRED",
      decision: input.decision,
      input: { tenantId: input.tenantId, runId: input.runId, ...(input.extra ?? {}) },
      output: {},
      result: input.result,
      correlationId: input.correlationId,
    });
  }

  list(): readonly UnifiedAuditEntryInput[] {
    return this.entries;
  }

  complete(tenantId: string): boolean {
    return this.entries.some(
      (entry) =>
        entry.type === "synthetic.scenario.completed" &&
        (entry.input as { tenantId?: string } | undefined)?.tenantId === tenantId,
    );
  }
}

export function syntheticOwnerId(tenantId: string): string {
  return deterministicUuid(`synthetic-owner:${tenantId}`);
}

export function syntheticRunIds(scenarioId: string, tenantId: string): {
  readonly runId: string;
  readonly correlationId: string;
  readonly ownerId: string;
} {
  return {
    runId: deterministicUuid(`synthetic-run:${scenarioId}:${tenantId}`),
    correlationId: deterministicUuid(`synthetic-corr:${scenarioId}:${tenantId}`),
    ownerId: syntheticOwnerId(tenantId),
  };
}
