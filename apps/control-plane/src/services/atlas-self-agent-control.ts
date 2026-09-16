/**
 * Phase 13 — Control Plane agent-control overlay.
 * HTTP must not call setAgentRuntimeStatus until the operating cycle ALLOWs
 * an independently verified Atlas-self approval. CP does not run tools.
 */
import {
  AGENT_RUNTIME_CONTROL_PATH,
  ATLAS_SELF_APPLICATION_ID,
  ATLAS_SELF_CONTROL_REQUEST_PATH,
  ATLAS_SELF_CONTROL_VERIFY_PATH,
  ATLAS_SELF_PROJECT_ID,
  ATLAS_SELF_TENANT_ID,
} from "@atlas/shared";
import { evaluateOperatingCycle } from "./operating-cycle.js";
import { getRegisteredAgent, setAgentRuntimeStatus, type AgentStatus } from "./agent-registry.js";
import { appendAuditEntry } from "./governance-state.js";
import { callAtlasApi } from "./lifecycle-handoff.js";

export const AGENT_CONTROL_ACTIONS = [
  "pause",
  "resume",
  "disable",
  "quarantine",
  "revoke",
  "retire",
] as const;

export type AgentControlAction = (typeof AGENT_CONTROL_ACTIONS)[number];

const STATUS_MAP: Record<AgentControlAction, AgentStatus> = {
  pause: "PAUSED",
  resume: "ACTIVE",
  disable: "DISABLED",
  quarantine: "QUARANTINED",
  revoke: "REVOKED",
  retire: "RETIRED",
};

/**
 * F-08 (lifecycle governance). REVOKED and RETIRED are terminal: once an
 * agent lands in either state, no further transition through this function
 * is permitted -- not even a "resume", and not even a re-application of the
 * same terminal action. A revoked/retired agent must not regain authority
 * merely by changing a status field, and this check runs AFTER independent
 * approval has already been verified above, so a valid approval cannot
 * override it either. This is deliberately the strict reading: the
 * lifecycle model's REVOKED -> RETIRED arrow is not honored as a further
 * transition here (RETIRED is reached only directly, from a
 * non-terminal state) -- the safer, more conservative interpretation for a
 * security control is that "terminal" means no further transitions at all.
 */
const TERMINAL_STATUSES: ReadonlySet<AgentStatus> = new Set(["REVOKED", "RETIRED"]);

export function isAgentControlAction(value: string): value is AgentControlAction {
  return (AGENT_CONTROL_ACTIONS as readonly string[]).includes(value);
}

/**
 * Step 4 Decision B — the durable subset (PAUSED/QUARANTINED/REVOKED/
 * DISABLED) is now owned by apps/api's own database, not Control Plane's
 * in-memory Map. "resume" (-> ACTIVE) and "retire" (-> RETIRED, explicitly
 * out of the approved durable scope -- terminal, unchanged, Control-Plane-
 * local as before) never call apps/api here. This uses the existing
 * `callAtlasApi` CP -> API SERVICE-hop pattern
 * (`lifecycle-handoff.ts`/`handoffGovernedDecisionToApi`) -- not a new
 * communication mechanism.
 */
const DURABLE_CONTROL_ACTIONS: ReadonlySet<AgentControlAction> = new Set([
  "pause",
  "disable",
  "quarantine",
  "revoke",
]);

async function syncDurableAgentRuntimeControl(input: {
  readonly agentId: string;
  readonly action: AgentControlAction;
  readonly status: AgentStatus;
  readonly setBy: string;
  readonly reason: string;
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  if (input.action === "resume") {
    const cleared = await callAtlasApi(`${AGENT_RUNTIME_CONTROL_PATH}/${encodeURIComponent(input.agentId)}`, {
      method: "DELETE",
    });
    if (!cleared.ok) {
      return { ok: false, reason: `Failed to clear durable runtime control: ${cleared.reason}` };
    }
    return { ok: true };
  }
  if (!DURABLE_CONTROL_ACTIONS.has(input.action)) {
    // "retire" -- out of the approved durable scope; Control-Plane-local only.
    return { ok: true };
  }
  const set = await callAtlasApi(AGENT_RUNTIME_CONTROL_PATH, {
    method: "POST",
    body: {
      agentId: input.agentId,
      status: input.status,
      setBy: input.setBy,
      reason: input.reason,
    },
  });
  if (!set.ok) {
    return { ok: false, reason: `Failed to persist durable runtime control: ${set.reason}` };
  }
  return { ok: true };
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

export async function applyAtlasSelfAgentControl(input: {
  readonly actorId: string;
  readonly agentId: string;
  readonly action: AgentControlAction;
  readonly reason: string;
  readonly reauthenticated: boolean;
  readonly independentApprovalVerified: boolean;
  readonly approvalId?: string;
}): Promise<{
  readonly decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  readonly executed: boolean;
  readonly verified: false;
  readonly reason: string;
  readonly applicationId: typeof ATLAS_SELF_APPLICATION_ID;
  readonly agent?: ReturnType<typeof setAgentRuntimeStatus>;
}> {
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

  const currentStatus = getRegisteredAgent(input.agentId)?.status;
  if (currentStatus !== undefined && TERMINAL_STATUSES.has(currentStatus)) {
    appendAuditEntry({
      seq: Date.now(),
      timestamp: new Date().toISOString(),
      type: "atlas-self.agent.control",
      actorId: input.actorId,
      actorKind: "SYSTEM",
      reason:
        `Agent "${input.agentId}" is ${currentStatus} -- a terminal lifecycle ` +
        `state. Action "${input.action}" was refused: no transition out of a ` +
        "terminal state is permitted, regardless of approval.",
      policy: "CONFIGURATION.UPDATE",
      risk: "CRITICAL",
      approval: "APPROVED",
      result: "FAILURE",
      ownerId: input.actorId,
      projectId: ATLAS_SELF_PROJECT_ID,
      hash: `atlas-self-control-${Date.now()}`,
      prevHash: "000",
    });
    return {
      decision: "DENY",
      executed: false,
      verified: false,
      reason:
        `Agent "${input.agentId}" is ${currentStatus} -- a terminal lifecycle ` +
        "state and cannot be changed by any subsequent transition",
      applicationId: ATLAS_SELF_APPLICATION_ID,
    };
  }

  const next = STATUS_MAP[input.action];
  if (!getRegisteredAgent(input.agentId)) {
    return {
      decision: "DENY",
      executed: false,
      verified: false,
      reason: `Agent "${input.agentId}" not found`,
      applicationId: ATLAS_SELF_APPLICATION_ID,
    };
  }

  // Step 4 Decision B: persist the durable subset to apps/api's own
  // database BEFORE mutating Control Plane's own (now display-only, for
  // this subset) in-memory Map. Fail closed on a durable-write failure --
  // an agent that Control Plane's Map shows as PAUSED/QUARANTINED/REVOKED/
  // DISABLED (or ACTIVE, on a failed resume) while apps/api's actual
  // enforcement point never learned about it would be a dangerous,
  // silent split between what the operator sees and what is actually
  // enforced. Never partially apply: no local mutation happens unless the
  // durable write already succeeded (or was a no-op, for "retire").
  const durableSync = await syncDurableAgentRuntimeControl({
    agentId: input.agentId,
    action: input.action,
    status: next,
    setBy: input.actorId,
    reason: input.reason,
  });
  if (!durableSync.ok) {
    appendAuditEntry({
      seq: Date.now(),
      timestamp: new Date().toISOString(),
      type: "atlas-self.agent.control",
      actorId: input.actorId,
      actorKind: "SYSTEM",
      reason: durableSync.reason,
      policy: "CONFIGURATION.UPDATE",
      risk: "CRITICAL",
      approval: "APPROVED",
      result: "FAILURE",
      ownerId: input.actorId,
      projectId: ATLAS_SELF_PROJECT_ID,
      hash: `atlas-self-control-${Date.now()}`,
      prevHash: "000",
    });
    return {
      decision: "DENY",
      executed: false,
      verified: false,
      reason: durableSync.reason,
      applicationId: ATLAS_SELF_APPLICATION_ID,
    };
  }

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
