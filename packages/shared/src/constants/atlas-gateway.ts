/**
 * Atlas Gateway contracts — the only integration boundary between the
 * Control Plane and managed applications/agents.
 *
 * Admin UI must not talk to application databases or filesystems directly.
 */

import { FABRIC_AGENT_CATALOG, type FabricAgentId } from "./agents.js";

export const ATLAS_SELF_APPLICATION_ID = "def-000";

export const APPLICATION_EVENT_TYPES = [
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
] as const;

export type ApplicationEventType = (typeof APPLICATION_EVENT_TYPES)[number];

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

/** Operations Atlas must never auto-execute against itself. */
export const FORBIDDEN_SELF_MUTATIONS = [
  "weaken_auth",
  "grant_privilege",
  "delete_audit",
  "modify_operator",
  "disable_verification",
] as const;

export type ForbiddenSelfMutation = (typeof FORBIDDEN_SELF_MUTATIONS)[number];

export function isApplicationEventType(
  value: string,
): value is ApplicationEventType {
  return (APPLICATION_EVENT_TYPES as readonly string[]).includes(value);
}

export function isGatewayOperation(value: string): value is GatewayOperation {
  return (GATEWAY_OPERATIONS as readonly string[]).includes(value);
}

export function isForbiddenSelfMutation(
  value: string,
): value is ForbiddenSelfMutation {
  return (FORBIDDEN_SELF_MUTATIONS as readonly string[]).includes(value);
}

export type GatewayHandoffEntityType = "DOCUMENT" | "RECORD";
export type GatewayHandoffAction = "READ" | "UPDATE" | "CREATE" | "EXECUTE";

/**
 * Two-layer handoff. Do not collapse these into one enum.
 *
 * 1. Tool-runtime pair (`entityType`/`action`/`toolName`):
 *    What `executeGovernedAction` asserts against `DEFAULT_TOOL_POLICIES`.
 *    `analyze_repo` / `knowledge_search` stay DOCUMENT.READ. `propose_patch`
 *    stays RECORD.UPDATE. Passing RECORD.EXECUTE into executeGovernedAction
 *    for analyze_repo is a mismatch deny, not an approval gate.
 *
 * 2. Operation classification (`operationEntityType`/`operationAction` +
 *    `requiresApproval`): aligned with Control Plane `mapControlPlaneHandoff`
 *    and `evaluateOperatingCycle`. Write-adjacent gateway ops are not
 *    inspect/diagnose/retrieve_* even when the mapped tool is read-only.
 *
 * Per-operation (not a blanket READ/EXECUTE):
 * - request_agent_run → RECORD.EXECUTE, requiresApproval true (HIGH_RISK_WRITE)
 * - request_test → RECORD.READ, requiresApproval true (LOW_RISK_WRITE; entity
 *   RECORD.READ itself does not require approval — the cycle still does)
 * - request_verify → RECORD.CREATE, requiresApproval true (LOW_RISK_WRITE;
 *   entity RECORD.CREATE does not require approval — the cycle still does)
 * - request_remediation → RECORD.UPDATE, requiresApproval true (DESTRUCTIVE)
 */
export type GatewayHandoffMapping = {
  readonly toolName: string;
  readonly entityType: GatewayHandoffEntityType;
  readonly action: GatewayHandoffAction;
  readonly operationEntityType: GatewayHandoffEntityType;
  readonly operationAction: GatewayHandoffAction;
  readonly requiresApproval: boolean;
};

const PREFERRED_HANDOFF_TOOL: Readonly<Record<string, string>> = {
  request_remediation: "propose_patch",
  request_test: "analyze_repo",
  request_verify: "analyze_repo",
  request_agent_run: "analyze_repo",
};

function operationClassification(
  operation: string,
): {
  readonly entityType: GatewayHandoffEntityType;
  readonly action: GatewayHandoffAction;
  readonly requiresApproval: boolean;
} | null {
  switch (operation) {
    case "request_agent_run":
      return { entityType: "RECORD", action: "EXECUTE", requiresApproval: true };
    case "request_test":
      return { entityType: "RECORD", action: "READ", requiresApproval: true };
    case "request_verify":
      return { entityType: "RECORD", action: "CREATE", requiresApproval: true };
    case "request_remediation":
      return { entityType: "RECORD", action: "UPDATE", requiresApproval: true };
    default:
      return null;
  }
}

export function mapGatewayHandoff(
  operation: string,
  agentId: string,
): GatewayHandoffMapping | null {
  const preferred = PREFERRED_HANDOFF_TOOL[operation];
  const classified = operationClassification(operation);
  if (!preferred || !classified) return null;

  const def =
    agentId in FABRIC_AGENT_CATALOG
      ? FABRIC_AGENT_CATALOG[agentId as FabricAgentId]
      : undefined;
  if (!def) return null;

  const toolName = def.allowedTools.includes(preferred)
    ? preferred
    : (def.allowedTools[0] ?? null);
  if (!toolName) return null;

  const mutating = operation === "request_remediation";
  return {
    toolName,
    entityType: mutating ? "RECORD" : "DOCUMENT",
    action: mutating ? "UPDATE" : "READ",
    operationEntityType: classified.entityType,
    operationAction: classified.action,
    requiresApproval: classified.requiresApproval,
  };
}
