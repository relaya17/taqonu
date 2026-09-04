/**
 * Atlas Gateway — the governed integration boundary.
 *
 * Control Plane → Application: evaluate then (maybe) enqueue an operation.
 * Application → Control Plane: ingest an event into registry + audit.
 *
 * Atlas never auto-executes forbidden self-mutations.
 */

import { ATLAS_SELF_APPLICATION_ID } from "@atlas/shared";
import {
  appendAuditEntry,
  type AuditEntry,
} from "./governance-state.js";
import { getRegisteredAgent } from "./agent-registry.js";
import {
  getRegisteredApplication,
  recordApplicationEvent,
  upsertRegisteredApplication,
} from "./application-registry.js";
import { evaluateOperatingCycle } from "./operating-cycle.js";
import {
  hashReceiptArtifact,
  newReceiptIds,
  type ExecutionReceipt,
  type ReceiptVerificationVerdict,
} from "./execution-receipt.js";
import { callAtlasApi } from "./lifecycle-handoff.js";

export const GATEWAY_OPERATIONS = [
  "inspect",
  "diagnose",
  "request_agent_run",
  "request_test",
  "request_verify",
  "retrieve_health",
  "retrieve_findings",
  "request_remediation",
] as const;

export type GatewayOperation = (typeof GATEWAY_OPERATIONS)[number];

export const FORBIDDEN_SELF_MUTATIONS = [
  "weaken_auth",
  "grant_privilege",
  "delete_audit",
  "modify_operator",
  "disable_verification",
] as const;

export type GatewayDecision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export interface GatewayRequest {
  readonly actorId: string;
  readonly actorKind?: "USER" | "AGENT" | "SYSTEM";
  readonly applicationId: string;
  readonly operation: string;
  readonly agentId?: string;
  readonly reason: string;
  readonly approved?: boolean;
  /**
   * Set only after an independent live-approval record is verified.
   * Never copied from an HTTP `approved: true` body on Atlas-self ops.
   */
  readonly independentApprovalVerified?: boolean;
  readonly reauthenticated?: boolean;
  readonly requiresReauth?: boolean;
  readonly delegationHopCount?: number;
  readonly verificationPlanPresent?: boolean;
  readonly evidenceCount?: number;
  readonly evidenceConflicting?: boolean;
  readonly evidenceStale?: boolean;
  readonly boundEvidenceIds?: readonly string[];
  readonly conflictingClaimIds?: readonly string[];
}

export interface GatewayEvaluation {
  readonly decision: GatewayDecision;
  readonly reason: string;
  readonly operation: string;
  readonly applicationId: string;
  readonly principalId: string;
  readonly executed: boolean;
  readonly blockedAt?: string | null;
  readonly stagesPassed?: readonly string[];
  readonly receipt: ExecutionReceipt | null;
}

export interface GatewayEventInput {
  readonly type: string;
  readonly applicationId: string;
  readonly agentId?: string;
  readonly payload?: Record<string, unknown>;
}

const APPLICATION_EVENT_TYPES = new Set([
  "application.registered",
  "application.health",
  "agent.started",
  "agent.completed",
  "agent.failed",
  "tool.executed",
  "finding.created",
  "security.alert",
  "test.failed",
  "deployment.changed",
  "proposal.created",
  "verification.completed",
]);

function isGatewayOperation(value: string): value is GatewayOperation {
  return (GATEWAY_OPERATIONS as readonly string[]).includes(value);
}

function nextAudit(partial: Omit<AuditEntry, "seq" | "hash" | "prevHash"> & Partial<Pick<AuditEntry, "seq" | "hash" | "prevHash">>): void {
  const seq = Date.now();
  appendAuditEntry({
    seq: partial.seq ?? seq,
    timestamp: partial.timestamp,
    type: partial.type,
    actorId: partial.actorId,
    actorKind: partial.actorKind,
    reason: partial.reason,
    policy: partial.policy,
    risk: partial.risk,
    approval: partial.approval,
    result: partial.result,
    ownerId: partial.ownerId,
    projectId: partial.projectId,
    hash: partial.hash ?? `gw-${seq}`,
    prevHash: partial.prevHash ?? "000",
  });
}

const AGENT_OPS = new Set<GatewayOperation>([
  "request_agent_run",
  "request_test",
  "request_verify",
  "request_remediation",
]);

function effectiveApproved(input: GatewayRequest): boolean {
  if (input.applicationId === ATLAS_SELF_APPLICATION_ID) {
    return input.independentApprovalVerified === true;
  }
  return input.approved === true;
}

function isReadLike(operation: string): boolean {
  return (
    operation === "inspect" ||
    operation === "retrieve_health" ||
    operation === "retrieve_findings" ||
    operation === "diagnose"
  );
}

/**
 * Keep aligned with `mapGatewayHandoff` in packages/shared.
 * Copied so this process stays free of a compile-time shared coupling.
 * Must use fabric catalog names — never Control Plane `fs.read_file` aliases.
 */
function mapControlPlaneHandoff(
  operation: string,
  agentId: string | undefined,
): { entityType: string; action: string; toolName: string } {
  if (operation === "request_remediation") {
    return { entityType: "RECORD", action: "UPDATE", toolName: "propose_patch" };
  }
  if (agentId === "RESEARCHER") {
    return { entityType: "DOCUMENT", action: "READ", toolName: "knowledge_search" };
  }
  return { entityType: "DOCUMENT", action: "READ", toolName: "analyze_repo" };
}

function requiredCapability(operation: string): string | null {
  switch (operation) {
    case "request_remediation":
      return "code.propose";
    case "request_test":
      return "test.read";
    case "request_verify":
      return "finding.create";
    case "request_agent_run":
      return null;
    default:
      return null;
  }
}

function emptyReceipt(
  input: GatewayRequest,
  evaluation: Omit<GatewayEvaluation, "receipt">,
): ExecutionReceipt {
  const ids = newReceiptIds();
  return {
    receiptId: ids.receiptId,
    requestId: ids.requestId,
    applicationId: input.applicationId,
    operation: input.operation,
    agentId: input.agentId ?? null,
    decision: evaluation.decision,
    executed: false,
    executionKind: "NONE",
    observation: null,
    verification: {
      verdict:
        evaluation.decision === "ALLOW"
          ? "INCONCLUSIVE"
          : "BLOCKED",
      detail: evaluation.reason,
    },
    artifactHash: hashReceiptArtifact({
      applicationId: input.applicationId,
      operation: input.operation,
      decision: evaluation.decision,
    }),
    governedHandoff: null,
  };
}

function denyEval(
  input: GatewayRequest,
  reason: string,
  blockedAt: string,
  stagesPassed: readonly string[] = [],
): GatewayEvaluation {
  const base = {
    decision: "DENY" as const,
    reason,
    operation: input.operation,
    applicationId: input.applicationId,
    principalId: input.actorId,
    executed: false,
    blockedAt,
    stagesPassed,
  };
  return { ...base, receipt: emptyReceipt(input, base) };
}

function observeApplication(applicationId: string): Record<string, unknown> | null {
  const app = getRegisteredApplication(applicationId);
  if (!app) return null;
  return {
    applicationId: app.applicationId,
    name: app.name,
    health: app.health,
    environment: app.environment,
    version: app.version,
    findingCount: app.findingCount,
    lastAuditAt: app.lastAuditAt,
    lastEventType: app.lastEventType,
    agentIds: [...app.agentIds],
  };
}

function asReceiptVerdict(value: unknown): ReceiptVerificationVerdict | null {
  if (
    value === "VERIFIED" ||
    value === "FAILED" ||
    value === "PARTIAL" ||
    value === "INCONCLUSIVE" ||
    value === "BLOCKED"
  ) {
    return value;
  }
  return null;
}

async function fulfillAllow(input: GatewayRequest, evaluation: GatewayEvaluation): Promise<GatewayEvaluation> {
  const ids = newReceiptIds();
  if (isReadLike(input.operation)) {
    const observation = observeApplication(input.applicationId);
    const verified = observation !== null;
    const receipt: ExecutionReceipt = {
      receiptId: ids.receiptId,
      requestId: ids.requestId,
      applicationId: input.applicationId,
      operation: input.operation,
      agentId: input.agentId ?? null,
      decision: "ALLOW",
      executed: verified,
      executionKind: "OBSERVATION",
      observation,
      verification: verified
        ? {
            verdict: "VERIFIED",
            detail: "Observation matches registered application state",
          }
        : {
            verdict: "INCONCLUSIVE",
            detail: "No registered application to observe",
          },
      artifactHash: hashReceiptArtifact(observation ?? { missing: true }),
      governedHandoff: null,
    };
    if (verified) {
      ingestGatewayEvent({
        type: "verification.completed",
        applicationId: input.applicationId,
        payload: { receiptId: receipt.receiptId, verdict: "VERIFIED" },
      });
    }
    return { ...evaluation, executed: receipt.executed, receipt };
  }

  const governedHandoff = mapControlPlaneHandoff(input.operation, input.agentId);
  const artifactHash = hashReceiptArtifact({
    applicationId: input.applicationId,
    operation: input.operation,
    agentId: input.agentId ?? null,
  });

  if (input.applicationId !== ATLAS_SELF_APPLICATION_ID) {
    const receipt: ExecutionReceipt = {
      receiptId: ids.receiptId,
      requestId: ids.requestId,
      applicationId: input.applicationId,
      operation: input.operation,
      agentId: input.agentId ?? null,
      decision: "ALLOW",
      executed: false,
      executionKind: "HANDED_OFF_GOVERNED",
      observation: null,
      verification: {
        verdict: "INCONCLUSIVE",
        detail:
          "Handed off to executeGovernedAction in apps/api — Control Plane does not run tools. HTTP fulfill hop is Atlas-self only.",
      },
      artifactHash,
      governedHandoff,
    };
    return { ...evaluation, executed: false, receipt };
  }

  if (!input.agentId) {
    const receipt: ExecutionReceipt = {
      receiptId: ids.receiptId,
      requestId: ids.requestId,
      applicationId: input.applicationId,
      operation: input.operation,
      agentId: null,
      decision: "ALLOW",
      executed: false,
      executionKind: "HANDED_OFF_GOVERNED",
      observation: null,
      verification: {
        verdict: "FAILED",
        detail: "Gateway fulfill handoff failed closed: agentId is required",
      },
      artifactHash,
      governedHandoff,
    };
    return { ...evaluation, executed: false, receipt };
  }

  const api = await callAtlasApi("/api/v1/gateway/fulfill", {
    method: "POST",
    body: {
      applicationId: input.applicationId,
      agentId: input.agentId,
      operation: input.operation,
    },
  });

  if (!api.ok) {
    const receipt: ExecutionReceipt = {
      receiptId: ids.receiptId,
      requestId: ids.requestId,
      applicationId: input.applicationId,
      operation: input.operation,
      agentId: input.agentId,
      decision: "ALLOW",
      executed: false,
      executionKind: "HANDED_OFF_GOVERNED",
      observation: null,
      verification: {
        verdict: "FAILED",
        detail: `Gateway fulfill handoff failed closed: ${api.reason}`,
      },
      artifactHash,
      governedHandoff,
    };
    return { ...evaluation, executed: false, receipt };
  }

  const body = (api.body ?? {}) as {
    readonly executed?: unknown;
    readonly verificationVerdict?: unknown;
    readonly verificationDetail?: unknown;
    readonly observation?: unknown;
  };
  const executed = body.executed === true;
  const receipt: ExecutionReceipt = {
    receiptId: ids.receiptId,
    requestId: ids.requestId,
    applicationId: input.applicationId,
    operation: input.operation,
    agentId: input.agentId,
    decision: "ALLOW",
    executed,
    executionKind: "HANDED_OFF_GOVERNED",
    observation:
      body.observation && typeof body.observation === "object"
        ? (body.observation as Record<string, unknown>)
        : null,
    verification: {
      verdict:
        asReceiptVerdict(body.verificationVerdict) ??
        (executed ? "INCONCLUSIVE" : "INCONCLUSIVE"),
      detail:
        typeof body.verificationDetail === "string"
          ? body.verificationDetail
          : "API gateway fulfill completed — Control Plane did not run tools",
    },
    artifactHash,
    governedHandoff,
  };
  return { ...evaluation, executed, receipt };
}

export function evaluateGatewayRequest(input: GatewayRequest): GatewayEvaluation {
  if (!isGatewayOperation(input.operation) && !(FORBIDDEN_SELF_MUTATIONS as readonly string[]).includes(input.operation)) {
    return denyEval(input, `Unknown gateway operation: ${input.operation}`, "POLICY", ["IDENTITY"]);
  }

  if (!getRegisteredApplication(input.applicationId)) {
    return denyEval(
      input,
      `Unknown application: ${input.applicationId}`,
      "IDENTITY",
    );
  }

  const writeNeedsAgent = isGatewayOperation(input.operation) && AGENT_OPS.has(input.operation);
  if (writeNeedsAgent && !input.agentId) {
    return denyEval(input, "Agent identity is required for this operation", "IDENTITY");
  }

  const agent = input.agentId ? getRegisteredAgent(input.agentId) : undefined;
  if (input.agentId && !agent) {
    return denyEval(input, `Unknown agent: ${input.agentId}`, "IDENTITY");
  }

  const needed = requiredCapability(input.operation);
  const capabilityAllowed =
    needed === null || (agent?.allowedCapabilities.includes(needed) ?? false);
  const capabilityDenied = Boolean(
    agent && needed && agent.deniedCapabilities.includes(needed),
  );

  const readLike = isReadLike(input.operation);

  const cycle = evaluateOperatingCycle({
    actorId: input.actorId,
    actorKind: input.actorKind ?? "SYSTEM",
    applicationId: input.applicationId,
    operation: input.operation,
    forbiddenSelfMutation: (FORBIDDEN_SELF_MUTATIONS as readonly string[]).includes(
      input.operation,
    ),
    readOnly: readLike,
    capabilityDenied,
    ...(writeNeedsAgent ? { capabilityAllowed } : {}),
    ...(agent
      ? {
          agentId: agent.agentId,
          agentStatus: agent.status,
        }
      : {}),
    ...(effectiveApproved(input) ? { approved: true } : {}),
    ...(input.reauthenticated !== undefined
      ? { reauthenticated: input.reauthenticated }
      : {}),
    ...(input.requiresReauth !== undefined
      ? { requiresReauth: input.requiresReauth }
      : {}),
    ...(input.delegationHopCount !== undefined
      ? { delegationHopCount: input.delegationHopCount }
      : {}),
    ...(input.verificationPlanPresent !== undefined
      ? { verificationPlanPresent: input.verificationPlanPresent }
      : {}),
    ...(input.evidenceCount !== undefined ? { evidenceCount: input.evidenceCount } : {}),
    ...(input.evidenceConflicting !== undefined
      ? { evidenceConflicting: input.evidenceConflicting }
      : {}),
    ...(input.evidenceStale !== undefined ? { evidenceStale: input.evidenceStale } : {}),
    ...(input.boundEvidenceIds !== undefined
      ? { boundEvidenceIds: input.boundEvidenceIds }
      : {}),
    ...(input.conflictingClaimIds !== undefined
      ? { conflictingClaimIds: input.conflictingClaimIds }
      : {}),
  });

  const base = {
    decision: cycle.decision,
    reason: cycle.reason,
    operation: input.operation,
    applicationId: input.applicationId,
    principalId: input.actorId,
    executed: false,
    blockedAt: cycle.blockedAt,
    stagesPassed: cycle.stagesPassed,
  };
  return { ...base, receipt: emptyReceipt(input, base) };
}

export async function dispatchGatewayOperation(input: GatewayRequest): Promise<GatewayEvaluation> {
  let evaluation = evaluateGatewayRequest(input);
  if (evaluation.decision === "ALLOW") {
    evaluation = await fulfillAllow(input, evaluation);
  }
  nextAudit({
    timestamp: new Date().toISOString(),
    type: `gateway.${input.operation}`,
    actorId: input.actorId,
    actorKind: input.actorKind ?? "SYSTEM",
    reason: input.reason,
    policy: `gateway.${input.operation}`,
    risk: evaluation.decision === "DENY" ? "HIGH" : evaluation.decision === "REQUIRE_APPROVAL" ? "APPROVAL" : "LOW",
    approval:
      evaluation.decision === "REQUIRE_APPROVAL"
        ? "PENDING"
        : evaluation.decision === "ALLOW"
          ? "NOT_REQUIRED"
          : "REJECTED",
    result: evaluation.decision === "DENY" ? "FAILURE" : "SUCCESS",
    ownerId: input.actorId,
    projectId: null,
  });

  // REQUIRE_APPROVAL is a decision, not a second queue. Consume via
  // apps/api/src/services/approvals.ts then POST /api/v1/gateway/fulfill.

  return evaluation;
}

export function ingestGatewayEvent(event: GatewayEventInput): {
  readonly accepted: boolean;
  readonly reason: string;
} {
  if (!APPLICATION_EVENT_TYPES.has(event.type)) {
    return { accepted: false, reason: `Unknown application event: ${event.type}` };
  }

  if (event.type === "application.registered") {
    const name =
      typeof event.payload?.["name"] === "string"
        ? event.payload["name"]
        : event.applicationId;
    upsertRegisteredApplication({
      applicationId: event.applicationId,
      name,
    });
  }

  const health =
    event.type === "agent.failed" ||
    event.type === "security.alert" ||
    event.type === "test.failed" ||
    event.type === "finding.created"
      ? "degraded"
      : event.type === "application.health"
        ? "healthy"
        : undefined;

  const findingDelta =
    event.type === "finding.created" || event.type === "security.alert" ? 1 : 0;

  const updated = recordApplicationEvent(event.applicationId, event.type, {
    findingDelta,
    ...(health ? { health } : {}),
  });

  if (!updated && event.type !== "application.registered") {
    upsertRegisteredApplication({
      applicationId: event.applicationId,
      name: event.applicationId,
    });
    recordApplicationEvent(event.applicationId, event.type, {
      findingDelta,
      ...(health ? { health } : {}),
    });
  }

  nextAudit({
    timestamp: new Date().toISOString(),
    type: event.type,
    actorId: event.agentId ?? event.applicationId,
    actorKind: event.agentId ? "AGENT" : "SYSTEM",
    reason: "application event via Atlas Gateway",
    policy: "gateway.ingest",
    risk: event.type === "security.alert" ? "HIGH" : "LOW",
    approval: "NOT_REQUIRED",
    result: "SUCCESS",
    ownerId: event.applicationId,
    projectId: null,
  });

  return { accepted: true, reason: "recorded" };
}

export function describeGatewaySnapshot(): {
  readonly application: ReturnType<typeof getRegisteredApplication>;
  readonly note: string;
} {
  return {
    application: getRegisteredApplication("def-000"),
    note: "Write ops hand off to executeGovernedAction in apps/api. Control Plane does not run tools.",
  };
}
