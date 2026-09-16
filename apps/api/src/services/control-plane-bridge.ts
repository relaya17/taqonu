import { domainEventBus } from "@atlas/agent-core";
import {
  AGENT_RUNTIME_CONTROLS,
  classifyKind,
  type AgentRuntimeControl,
  type DomainEvent,
} from "@atlas/shared";
import { assertEgressAllowed } from "./egress-gate.js";

const GATEWAY_MAP: Partial<Record<DomainEvent["type"], string>> = {
  "agent.run.started": "agent.started",
  "agent.run.completed": "agent.completed",
  "authorization.denied": "security.alert",
  "secret.detected": "security.alert",
  "evaluation.completed": "verification.completed",
};

function controlPlaneUrl(): string | null {
  const raw = process.env.ATLAS_CONTROL_PLANE_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/$/, "") : null;
}

function controlPlaneToken(): string | null {
  const raw = process.env.ATLAS_CONTROL_PLANE_TOKEN?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export type ControlPlaneAgentStatusLookup =
  | { readonly configured: false }
  | {
      readonly configured: true;
      readonly status: AgentRuntimeControl;
      /**
       * Step 4 Decision C. True only when `status` is "UNKNOWN" because
       * Control Plane itself could not be reached/read (missing token,
       * egress denied, timeout, non-2xx, or a transport exception) --
       * distinct from a genuine "UNKNOWN" value Control Plane actually
       * returned, and distinct from the 404 "no overlay" case (which
       * resolves to ACTIVE, not UNKNOWN). Callers thread this through so
       * the fail-open/fail-closed decision can become action-class-aware
       * at the point action is known, instead of a uniform block. See
       * `resolveGovernedAgentIdentity` and `dispatchAgentAction`.
       */
      readonly unreachable: boolean;
    };

function asAgentRuntimeControl(value: unknown): AgentRuntimeControl | null {
  return typeof value === "string" &&
    (AGENT_RUNTIME_CONTROLS as readonly string[]).includes(value)
    ? (value as AgentRuntimeControl)
    : null;
}

/**
 * Read Control Plane oversight status for a fabric/oversight agent.
 * Unset CP URL → not configured (caller defaults ACTIVE).
 * Configured but unreachable / invalid → UNKNOWN (fail closed).
 * 404 → no overlay for this id → ACTIVE.
 */
export async function lookupControlPlaneAgentRuntimeStatus(
  agentId: string,
): Promise<ControlPlaneAgentStatusLookup> {
  const base = controlPlaneUrl();
  if (!base) return { configured: false };
  const token = controlPlaneToken();
  if (!token) {
    return { configured: true, status: "UNKNOWN", unreachable: true };
  }
  try {
    assertEgressAllowed({
      dataClass: classifyKind("agent_trace"),
      destination: "atlas_internal",
      operation: "TELEMETRY",
      purpose: "control-plane.agent-status",
    });
  } catch {
    return { configured: true, status: "UNKNOWN", unreachable: true };
  }
  try {
    const response = await fetch(
      `${base}/api/v1/agents/${encodeURIComponent(agentId)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (response.status === 404) {
      return { configured: true, status: "ACTIVE", unreachable: false };
    }
    if (!response.ok) {
      return { configured: true, status: "UNKNOWN", unreachable: true };
    }
    const body = (await response.json()) as { status?: unknown };
    return {
      configured: true,
      status: asAgentRuntimeControl(body.status) ?? "UNKNOWN",
      unreachable: false,
    };
  } catch {
    return { configured: true, status: "UNKNOWN", unreachable: true };
  }
}

/**
 * Application → Control Plane: forward selected domain events through the
 * Atlas Gateway. Fail-open — tenant work must not break if :3100 is down.
 */
export function registerControlPlaneBridge(): () => void {
  return domainEventBus.subscribe("*", (event) => {
    const mapped = GATEWAY_MAP[event.type];
    if (!mapped) return;
    const base = controlPlaneUrl();
    if (!base) return;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Atlas-Reason": `domain.${event.type}`,
    };
    const token = controlPlaneToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      assertEgressAllowed({
        dataClass: classifyKind("agent_trace"),
        destination: "atlas_internal",
        operation: "TELEMETRY",
        purpose: "control-plane.bridge",
      });
    } catch {
      return;
    }
    void fetch(`${base}/api/v1/gateway/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: mapped,
        applicationId: "def-000",
        payload: {
          domainEventId: event.id,
          domainEventType: event.type,
          projectId: event.projectId,
        },
      }),
    }).catch(() => {
      /* fail-open */
    });
  });
}
