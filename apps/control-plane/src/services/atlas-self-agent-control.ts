/**
 * Phase 13 — Control Plane agent-control overlay.
 * HTTP must not call setAgentRuntimeStatus until the operating cycle ALLOWs
 * an independently verified Atlas-self approval. CP does not run tools.
 */
import {
  ATLAS_SELF_APPLICATION_ID,
  ATLAS_SELF_CONTROL_REQUEST_PATH,
  ATLAS_SELF_CONTROL_VERIFY_PATH,
  ATLAS_SELF_PROJECT_ID,
  ATLAS_SELF_TENANT_ID,
} from "@atlas/shared";
import { evaluateOperatingCycle } from "./operating-cycle.js";
import { setAgentRuntimeStatus, type AgentStatus } from "./agent-registry.js";
import { appendAuditEntry } from "./governance-state.js";
import { callAtlasApi } from "./lifecycle-handoff.js";

export const AGENT_CONTROL_ACTIONS = [
  "pause",
  "resume",
  "disable",
  "quarantine",
  "revoke",
] as const;

export type AgentControlAction = (typeof AGENT_CONTROL_ACTIONS)[number];

const STATUS_MAP: Record<AgentControlAction, AgentStatus> = {
  pause: "PAUSED",
  resume: "ACTIVE",
  disable: "DISABLED",
  quarantine: "QUARANTINED",
  revoke: "REVOKED",
};

export function isAgentControlAction(value: string): value is AgentControlAction {
  return (AGENT_CONTROL_ACTIONS as readonly string[]).includes(value);
}

export type AtlasSelfControlApprovalVerifier = (input: {
  readonly approvalId: string;
  readonly agentId: string;
  readonly action: AgentControlAction;
}) => boolean | Promise<boolean>;

let approvalVerifier: AtlasSelfControlApprovalVerifier | null = null;

export function setAtlasSelfControlApprovalVerifier(
  next: AtlasSelfControlApprovalVerifier | null,
): void {
  approvalVerifier = next;
}

export async function verifyAtlasSelfControlApprovalViaApi(input: {
  readonly approvalId: string;
  readonly agentId: string;
  readonly action: AgentControlAction;
}): Promise<boolean> {
  const called = await callAtlasApi(ATLAS_SELF_CONTROL_VERIFY_PATH, {
    method: "POST",
    body: {
      approvalId: input.approvalId,
      agentId: input.agentId,
      action: input.action,
    },
  });
  if (!called.ok) return false;
  const body = called.body as { readonly verified?: unknown } | null;
  return body?.verified === true;
}

export async function mintAtlasSelfControlApprovalViaApi(input: {
  readonly agentId: string;
  readonly action: AgentControlAction;
}): Promise<string | null> {
  const called = await callAtlasApi(ATLAS_SELF_CONTROL_REQUEST_PATH, {
    method: "POST",
    body: { agentId: input.agentId, action: input.action },
  });
  if (!called.ok) return null;
  const body = called.body as { readonly approvalId?: unknown } | null;
  return typeof body?.approvalId === "string" && body.approvalId.length > 0
    ? body.approvalId
    : null;
}

export async function verifyIndependentAtlasSelfControlApproval(input: {
  readonly approvalId: string;
  readonly agentId: string;
  readonly action: AgentControlAction;
}): Promise<boolean> {
  try {
    if (approvalVerifier) return await approvalVerifier(input);
    return await verifyAtlasSelfControlApprovalViaApi(input);
  } catch {
    return false;
  }
}

export function evaluateAtlasSelfAgentControl(input: {
  readonly actorId: string;
  readonly agentId: string;
  readonly action: AgentControlAction;
  readonly reauthenticated: boolean;
  readonly independentApprovalVerified: boolean;
}): ReturnType<typeof evaluateOperatingCycle> {
  return evaluateOperatingCycle({
    actorId: input.actorId,
    actorKind: "SYSTEM",
    applicationId: ATLAS_SELF_APPLICATION_ID,
    operation: `agent_control_${input.action}`,
    approved: input.independentApprovalVerified,
    requiresReauth: true,
    reauthenticated: input.reauthenticated,
    readOnly: false,
    verificationPlanPresent: input.independentApprovalVerified,
  });
}

export function applyAtlasSelfAgentControl(input: {
  readonly actorId: string;
  readonly agentId: string;
  readonly action: AgentControlAction;
  readonly reason: string;
  readonly reauthenticated: boolean;
  readonly independentApprovalVerified: boolean;
  readonly approvalId?: string;
}): {
  readonly decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  readonly executed: boolean;
  readonly verified: false;
  readonly reason: string;
  readonly applicationId: typeof ATLAS_SELF_APPLICATION_ID;
  readonly agent?: ReturnType<typeof setAgentRuntimeStatus>;
} {
  const cycle = evaluateAtlasSelfAgentControl(input);
  if (cycle.decision !== "ALLOW") {
    appendAuditEntry({
      seq: Date.now(),
      timestamp: new Date().toISOString(),
      type: "atlas-self.agent.control",
      actorId: input.actorId,
      actorKind: "SYSTEM",
      reason: cycle.reason,
      policy: "CONFIGURATION.UPDATE",
      risk: "CRITICAL",
      approval: cycle.decision === "REQUIRE_APPROVAL" ? "PENDING" : "REJECTED",
      result: "FAILURE",
      ownerId: input.actorId,
      projectId: ATLAS_SELF_PROJECT_ID,
      hash: `atlas-self-control-${Date.now()}`,
      prevHash: "000",
    });
    return {
      decision: cycle.decision,
      executed: false,
      verified: false,
      reason: cycle.reason,
      applicationId: ATLAS_SELF_APPLICATION_ID,
    };
  }

  const next = STATUS_MAP[input.action];
  const agent = setAgentRuntimeStatus(input.agentId, next);
  if (!agent) {
    return {
      decision: "DENY",
      executed: false,
      verified: false,
      reason: `Agent "${input.agentId}" not found`,
      applicationId: ATLAS_SELF_APPLICATION_ID,
    };
  }

  appendAuditEntry({
    seq: Date.now(),
    timestamp: new Date().toISOString(),
    type: "atlas-self.agent.control",
    actorId: input.actorId,
    actorKind: "SYSTEM",
    reason: `applicationId=${ATLAS_SELF_APPLICATION_ID} tenantId=${ATLAS_SELF_TENANT_ID} agent=${input.agentId} action=${input.action} approvalId=${input.approvalId ?? "none"}`,
    policy: "CONFIGURATION.UPDATE",
    risk: "CRITICAL",
    approval: "APPROVED",
    result: "SUCCESS",
    ownerId: input.actorId,
    projectId: ATLAS_SELF_PROJECT_ID,
    hash: `atlas-self-control-${Date.now()}`,
    prevHash: "000",
  });

  return {
    decision: "ALLOW",
    executed: true,
    verified: false,
    reason: input.reason,
    applicationId: ATLAS_SELF_APPLICATION_ID,
    agent,
  };
}
