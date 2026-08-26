import { domainEventBus } from "@atlas/agent-core";
import { classifyKind, type DomainEvent } from "@atlas/shared";
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
