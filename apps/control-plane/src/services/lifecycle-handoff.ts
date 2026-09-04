/**
 * Control Plane → tenant API: hand a Phase 9 decision to runGovernedLifecycle.
 * Does not run tools locally. Does not convert failure into ALLOW.
 */

import {
  GOVERNED_LIFECYCLE_HANDOFF_PATH,
  GOVERNED_LIFECYCLE_HANDOFF_SCHEMA,
  type GovernedHandoffDecision,
  type GovernedIdentity,
} from "@atlas/shared";
import type { SupervisedGovernanceDecision } from "./supervised-governance.js";
import { assertControlPlaneApiEgress } from "./control-plane-egress.js";

export type LifecycleHandoffStatus =
  | "NOT_ATTEMPTED"
  | "HANDED_OFF"
  | "HANDOFF_FAILED";

export interface LifecycleHandoffResult {
  readonly status: LifecycleHandoffStatus;
  readonly reason: string;
  readonly lifecycleStatus?: string;
  readonly executed?: boolean;
  readonly approvalRequestId?: string | null;
}

function apiBaseUrl(): string | null {
  const raw = process.env["ATLAS_API_URL"]?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/$/, "") : null;
}

function serviceToken(): string | null {
  const raw = process.env["ATLAS_CONTROL_PLANE_TOKEN"]?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export type AtlasApiCallResult =
  | { readonly ok: true; readonly status: number; readonly body: unknown }
  | { readonly ok: false; readonly reason: string };

/**
 * Existing CP → API SERVICE hop (same token as lifecycle handoff).
 * Transport/auth failures are never rewritten into a successful body.
 */
export async function callAtlasApi(
  path: string,
  init: {
    readonly method: string;
    readonly body?: unknown;
    readonly requestId?: string;
    readonly extraHeaders?: Readonly<Record<string, string>>;
  },
): Promise<AtlasApiCallResult> {
  const base = apiBaseUrl();
  const token = serviceToken();
  if (!base || !token) {
    return {
      ok: false,
      reason: "ATLAS_API_URL or ATLAS_CONTROL_PLANE_TOKEN is not set",
    };
  }
  const denied = assertControlPlaneApiEgress(`cp-api:${path}`);
  if (denied) {
    return { ok: false, reason: denied };
  }
  try {
    const response = await fetch(`${base}${path}`, {
      method: init.method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init.requestId ? { "x-request-id": init.requestId } : {}),
        ...(init.extraHeaders ?? {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(8_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        body && typeof body === "object"
          ? ((body as { error?: { message?: string }; reason?: string }).error
              ?.message ??
            (body as { reason?: string }).reason)
          : null;
      return {
        ok: false,
        reason: detail
          ? `API returned ${response.status}: ${detail}`
          : `API returned ${response.status}`,
      };
    }
    return { ok: true, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function decisionToHandoff(decision: SupervisedGovernanceDecision): {
  readonly identity: GovernedIdentity;
  readonly decision: GovernedHandoffDecision;
} {
  const identity: GovernedIdentity = {
    tenantId: decision.tenantId,
    projectId: decision.projectId,
    applicationId: decision.applicationId,
    processId: decision.processId,
    eventId: decision.eventId,
  };
  return {
    identity,
    decision: {
      ...identity,
      decision: decision.decision,
      reason: decision.reason,
      eventType: decision.eventType,
      correlationId: decision.correlationId,
      requestId: decision.requestId,
      policy: {
        entityType: decision.policy.entityType,
        action: decision.policy.action,
        riskTier: decision.policy.riskTier,
      },
    },
  };
}

export async function handoffGovernedDecisionToApi(
  decision: SupervisedGovernanceDecision,
): Promise<LifecycleHandoffResult> {
  const base = apiBaseUrl();
  const token = serviceToken();
  if (!base || !token) {
    return {
      status: "NOT_ATTEMPTED",
      reason: "ATLAS_API_URL or ATLAS_CONTROL_PLANE_TOKEN is not set; execution handoff skipped",
    };
  }

  const payload = {
    schemaVersion: GOVERNED_LIFECYCLE_HANDOFF_SCHEMA,
    ...decisionToHandoff(decision),
    idempotencyKey: `lifecycle:${decision.tenantId}:${decision.applicationId}:${decision.eventId}`,
  };

  const api = await callAtlasApi(GOVERNED_LIFECYCLE_HANDOFF_PATH, {
    method: "POST",
    body: payload,
    requestId: decision.requestId,
    extraHeaders: { "x-idempotency-key": payload.idempotencyKey },
  });
  if (!api.ok) {
    return {
      status: "HANDOFF_FAILED",
      reason: api.reason,
    };
  }
  const body = (api.body ?? {}) as {
    readonly status?: string;
    readonly executed?: boolean;
    readonly reason?: string;
    readonly approvalRequestId?: string | null;
  };
  return {
    status: "HANDED_OFF",
    reason: body.reason ?? "handed off",
    executed: body.executed === true,
    approvalRequestId: body.approvalRequestId ?? null,
    ...(typeof body.status === "string" ? { lifecycleStatus: body.status } : {}),
  };
}
