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

/**
 * Map a Gateway write-op onto a fabric catalog tool.
 *
 * The Control Plane must not invent runtime tool names (`fs.read_file`).
 * Execution uses `FABRIC_AGENT_CATALOG.allowedTools` and `executeGovernedAction`.
 * If the preferred tool is not granted to this agent, fall back to the first
 * catalog tool rather than a Control Plane registry alias.
 */
export type GatewayHandoffMapping = {
  readonly toolName: string;
  readonly entityType: "DOCUMENT" | "RECORD";
  readonly action: "READ" | "UPDATE";
};

const PREFERRED_HANDOFF_TOOL: Readonly<Record<string, string>> = {
  request_remediation: "propose_patch",
  request_test: "analyze_repo",
  request_verify: "analyze_repo",
  request_agent_run: "analyze_repo",
};

export function mapGatewayHandoff(
  operation: string,
  agentId: string,
): GatewayHandoffMapping | null {
  const preferred = PREFERRED_HANDOFF_TOOL[operation];
  if (!preferred) return null;

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
  };
}
