/**
 * Control Plane Registration Service
 *
 * Registers agents (fabric specialists and PSA) with the Control Plane.
 * Idempotent — safe to call multiple times. Fail-open — PSA creation and
 * agent dispatch are NOT blocked if Control Plane is unavailable.
 */

import { safeOutboundFetch } from "@atlas/shared/node";
import { assertEgressAllowed } from "./egress-gate.js";
import { classifyKind } from "@atlas/shared";

export interface ControlRegistrationRecord {
  readonly agentId: string;
  readonly registrationSource: "STATIC_CATALOG" | "DYNAMIC_API" | "PSA_OWNER";
  readonly ownerId: string | null;
  readonly registeredAt: string;
  readonly registeredBy: string;
  readonly evidence: string;
  readonly status: "CONTROL_REGISTERED" | "CONTROL_REVOKED" | "CONTROL_SUSPENDED";
  readonly idempotencyKey: string;
}

export type SpecialistRegistrationResult =
  | { readonly agentId: string; readonly registered: true; readonly record: ControlRegistrationRecord }
  | { readonly agentId: string; readonly registered: false; readonly reason: string };

function controlPlaneUrl(): string | null {
  const raw = process.env.ATLAS_CONTROL_PLANE_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/$/, "") : null;
}

function controlPlaneToken(): string | null {
  const raw = process.env.ATLAS_CONTROL_PLANE_TOKEN?.trim();
  return raw && raw.length > 0 ? raw : null;
}

async function postRegister(params: {
  agentId: string;
  registrationSource: "STATIC_CATALOG" | "DYNAMIC_API" | "PSA_OWNER";
  ownerId?: string | null;
  evidence: string;
  registeredBy: string;
}): Promise<ControlRegistrationRecord | null> {
  const base = controlPlaneUrl();
  if (!base) return null;
  const token = controlPlaneToken();
  if (!token) return null;

  try {
    assertEgressAllowed({
      dataClass: classifyKind("agent_trace"),
      destination: "atlas_internal",
      operation: "TELEMETRY",
      purpose: "control-plane.agent-register",
    });
  } catch {
    return null;
  }

  try {
    const response = await safeOutboundFetch(`${base}/api/v1/agents/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as ControlRegistrationRecord;
  } catch {
    return null;
  }
}

const SPECIALIST_AGENTS = [
  "SECURITY",
  "LEGAL_MEDIA_COMMS",
  "CODE_ENGINEER",
  "RESEARCHER",
] as const;

/**
 * Register all four fabric specialist agents with Control Plane.
 * Idempotent — safe to call multiple times.
 */
export async function registerSpecialistAgentsWithControl(): Promise<
  readonly SpecialistRegistrationResult[]
> {
  const results: SpecialistRegistrationResult[] = [];

  for (const agentId of SPECIALIST_AGENTS) {
    const record = await postRegister({
      agentId,
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: `Fabric specialist agent registered from static catalog at ${new Date().toISOString()}`,
      registeredBy: "atlas-api-bootstrap",
    });

    if (record) {
      results.push({ agentId, registered: true, record });
    } else {
      results.push({
        agentId,
        registered: false,
        reason: "Control Plane unavailable or not configured",
      });
    }
  }

  return results;
}

/**
 * Register a PSA with the Control Plane using owner-isolated identity.
 * `psa:<ownerId>` never collides between owners because ownerId is
 * included in the agent identity and in the idempotency key.
 * Idempotent — repeat calls for same ownerId return the same record.
 * Fail-open — returns null if Control Plane is unavailable.
 */
export async function registerPsaWithControl(
  ownerId: string,
): Promise<ControlRegistrationRecord | null> {
  const agentId = `psa:${ownerId}`;
  return postRegister({
    agentId,
    registrationSource: "PSA_OWNER",
    ownerId,
    evidence: `Personal Supervising Agent registered for owner ${ownerId} at ${new Date().toISOString()}`,
    registeredBy: "atlas-api-psa-init",
  });
}
