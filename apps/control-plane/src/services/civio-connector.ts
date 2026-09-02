/**
 * Civio → Atlas Control ingest.
 *
 * Proves the request came from the authorized Civio runtime (HMAC) and
 * belongs to the configured tenant/project. Then runs the existing
 * Control governance cycle. Does not execute Civio or Atlas tools.
 */

import {
  CIVIO_APPLICATION_ID,
  CIVIO_APPLICATION_NAME,
  CIVIO_CONNECTOR_CAPABILITIES,
  CIVIO_CONNECTOR_ID,
  CIVIO_CONNECTOR_STATUS_PATH,
  CIVIO_CONNECTOR_VERSION,
  CIVIO_EVENT_SCHEMA_VERSION,
  CIVIO_EVENT_TYPES,
  CIVIO_PORTFOLIO_INVENTORY_ID,
  CIVIO_SUPPORTED_ACTIONS,
  civioConnectorFoundationStatus,
  civioEventEnvelopeSchema,
  civioProcessStateFromEvent,
  civioProcessTypeFromEvent,
  type CivioAuthenticationState,
  type CivioConnectorContract,
  type CivioEventEnvelope,
  type CivioSupervisedProcess,
} from "@atlas/shared";
import {
  CIVIO_CONNECTOR_SECRET_MIN_LENGTH,
  verifyCivioConnectorSignature,
} from "@atlas/integrations-civio";
import { evaluateOperatingCycle } from "./operating-cycle.js";
import {
  upsertRegisteredApplication,
  recordApplicationEvent,
} from "./application-registry.js";
import { appendAuditEntry } from "./governance-state.js";

export interface CivioConnectorBinding {
  readonly secret: string;
  readonly tenantId: string;
  readonly projectId: string;
}

const REPLAY_TTL_MS = 10 * 60 * 1000;

const usedNonces = new Map<string, number>();
const idempotentResponses = new Map<
  string,
  { readonly fingerprint: string; readonly status: number; readonly body: CivioIngestResult }
>();
const observedProcesses = new Map<string, CivioSupervisedProcess>();
const acceptedEventKeys = new Set<string>();

let lastAuthenticatedAt: string | null = null;

export type CivioIngestDisposition =
  | "ACCEPTED"
  | "DUPLICATE"
  | "REJECTED"
  | "UNSUPPORTED_EVENT"
  | "UNCONFIGURED";

export interface CivioIngestResult {
  readonly accepted: boolean;
  readonly disposition: CivioIngestDisposition;
  readonly reason: string;
  readonly eventId?: string;
  readonly evaluation?: {
    readonly decision: string;
    readonly blockedAt: string | null;
    readonly reason: string;
    readonly stagesPassed: readonly string[];
    readonly executed: false;
  };
  readonly process?: { readonly processId: string } | null;
  readonly audit?: { readonly type: string; readonly inMemory: true };
  readonly execution: "NOT_IMPLEMENTED";
}

export function loadCivioConnectorBinding():
  | { readonly ok: true; readonly binding: CivioConnectorBinding }
  | { readonly ok: false; readonly reason: string } {
  const secret = process.env["ATLAS_CIVIO_CONNECTOR_SECRET"]?.trim() ?? "";
  const tenantId = process.env["ATLAS_CIVIO_TENANT_ID"]?.trim() ?? "";
  const projectId = process.env["ATLAS_CIVIO_PROJECT_ID"]?.trim() ?? "";
  if (secret.length < CIVIO_CONNECTOR_SECRET_MIN_LENGTH) {
    return {
      ok: false,
      reason:
        "ATLAS_CIVIO_CONNECTOR_SECRET must be set (min 32 characters). Never commit the secret.",
    };
  }
  if (!tenantId || !projectId) {
    return {
      ok: false,
      reason:
        "ATLAS_CIVIO_TENANT_ID and ATLAS_CIVIO_PROJECT_ID must be set to the real Civio tenant/project scope.",
    };
  }
  return { ok: true, binding: { secret, tenantId, projectId } };
}

export function headerString(
  headers: { readonly [name: string]: string | string[] | undefined },
  name: string,
): string | null {
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : null;
}

function pruneNonces(now: number): void {
  for (const [nonce, expires] of usedNonces) {
    if (expires <= now) usedNonces.delete(nonce);
  }
}

function fingerprintOf(event: CivioEventEnvelope): string {
  return `${event.eventId}\n${event.idempotencyKey}\n${event.eventType}\n${event.occurredAt}`;
}

function processKey(tenantId: string, projectId: string, processId: string): string {
  return `${tenantId}\0${projectId}\0${processId}`;
}

function rememberProcess(event: CivioEventEnvelope): CivioSupervisedProcess | null {
  if (!event.processId) return null;
  const key = processKey(event.tenantId, event.projectId, event.processId);
  const existing = observedProcesses.get(key);
  const now = event.occurredAt;
  const next: CivioSupervisedProcess = {
    processId: event.processId,
    applicationId: CIVIO_APPLICATION_ID,
    tenantId: event.tenantId,
    projectId: event.projectId,
    processType: civioProcessTypeFromEvent(event.eventType, event.payload),
    state: civioProcessStateFromEvent(event.eventType),
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
    currentEvent: event.eventType,
    correlationId: event.correlationId,
  };
  observedProcesses.set(key, next);
  return next;
}

function writeAudit(input: {
  readonly event: CivioEventEnvelope;
  readonly type: string;
  readonly result: "SUCCESS" | "FAILURE";
  readonly reason: string;
  readonly policy: string;
  readonly risk: string;
}): void {
  const seq = Date.now();
  appendAuditEntry({
    seq,
    timestamp: new Date().toISOString(),
    type: input.type,
    actorId: input.event.actor.id,
    actorKind: input.event.actor.kind,
    reason: input.reason,
    policy: input.policy,
    risk: input.risk,
    approval: "NOT_REQUIRED",
    result: input.result,
    ownerId: input.event.tenantId,
    projectId: input.event.projectId,
    hash: `civio-${input.event.eventId}-${seq}`,
    prevHash: "000",
  });
}

export function listObservedCivioProcesses(): readonly CivioSupervisedProcess[] {
  return [...observedProcesses.values()];
}

export function civioAcceptedEventCount(): number {
  return acceptedEventKeys.size;
}

export function buildCivioConnectorContract(): CivioConnectorContract {
  const loaded = loadCivioConnectorBinding();
  const configured = loaded.ok;
  const authenticationState: CivioAuthenticationState = lastAuthenticatedAt
    ? "AUTHENTICATED"
    : configured
      ? "CONFIGURED"
      : "UNCONFIGURED";
  return {
    applicationId: CIVIO_APPLICATION_ID,
    applicationName: CIVIO_APPLICATION_NAME,
    connectorId: CIVIO_CONNECTOR_ID,
    connectorVersion: CIVIO_CONNECTOR_VERSION,
    tenantId: configured ? loaded.binding.tenantId : null,
    projectId: configured ? loaded.binding.projectId : null,
    authenticationState,
    capabilities: CIVIO_CONNECTOR_CAPABILITIES,
    supportedEvents: CIVIO_EVENT_TYPES,
    supportedProcesses: configured
      ? ["civio.rights", "civio.legal-ai", "civio.process"]
      : [],
    supportedActions: CIVIO_SUPPORTED_ACTIONS,
    health: configured ? "configured" : "unknown",
    compatibility: {
      schemaVersion: CIVIO_EVENT_SCHEMA_VERSION,
      civioRuntimeInThisRepository: false,
      portfolioInventoryId: CIVIO_PORTFOLIO_INVENTORY_ID,
    },
    remainingDeployment: [
      "Set ATLAS_CIVIO_CONNECTOR_SECRET, ATLAS_CIVIO_TENANT_ID, and ATLAS_CIVIO_PROJECT_ID on Atlas Control.",
      "Call emitCivioEventToControl from the Civio runtime (github.com/relaya17/civio). That wiring is not in this repository.",
      `Operator status: GET ${CIVIO_CONNECTOR_STATUS_PATH}`,
    ],
  };
}

export function ingestCivioConnectorEvent(input: {
  readonly rawBody: string;
  readonly timestamp: string | null;
  readonly nonce: string | null;
  readonly signature: string | null;
}): { readonly status: number; readonly body: CivioIngestResult } {
  const loaded = loadCivioConnectorBinding();
  if (!loaded.ok) {
    return {
      status: 503,
      body: {
        accepted: false,
        disposition: "UNCONFIGURED",
        reason: loaded.reason,
        execution: "NOT_IMPLEMENTED",
      },
    };
  }

  const verified = verifyCivioConnectorSignature({
    secret: loaded.binding.secret,
    rawBody: input.rawBody,
    timestamp: input.timestamp,
    nonce: input.nonce,
    signature: input.signature,
  });
  if (!verified.ok) {
    return {
      status: 401,
      body: {
        accepted: false,
        disposition: "REJECTED",
        reason: verified.reason,
        execution: "NOT_IMPLEMENTED",
      },
    };
  }

  const now = Date.now();
  pruneNonces(now);
  const nonce = input.nonce ?? "";
  if (usedNonces.has(nonce)) {
    return {
      status: 401,
      body: {
        accepted: false,
        disposition: "REJECTED",
        reason: "Civio connector nonce has already been used",
        execution: "NOT_IMPLEMENTED",
      },
    };
  }
  usedNonces.set(nonce, now + REPLAY_TTL_MS);

  let parsedJson: unknown;
  try {
    parsedJson = input.rawBody.length === 0 ? {} : JSON.parse(input.rawBody);
  } catch {
    return {
      status: 400,
      body: {
        accepted: false,
        disposition: "REJECTED",
        reason: "Civio event body is not valid JSON",
        execution: "NOT_IMPLEMENTED",
      },
    };
  }

  const record =
    parsedJson && typeof parsedJson === "object"
      ? (parsedJson as Record<string, unknown>)
      : {};
  if (typeof record["eventType"] === "string") {
    const eventType = record["eventType"];
    if (!(CIVIO_EVENT_TYPES as readonly string[]).includes(eventType)) {
      return {
        status: 400,
        body: {
          accepted: false,
          disposition: "UNSUPPORTED_EVENT",
          reason: `Unsupported Civio event type: ${eventType}`,
          execution: "NOT_IMPLEMENTED",
        },
      };
    }
  }

  const parsed = civioEventEnvelopeSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const applicationId =
      typeof record["applicationId"] === "string" ? record["applicationId"] : "";
    if (applicationId && applicationId !== CIVIO_APPLICATION_ID) {
      return {
        status: 403,
        body: {
          accepted: false,
          disposition: "REJECTED",
          reason: "Civio connector application identity does not match civio",
          execution: "NOT_IMPLEMENTED",
        },
      };
    }
    return {
      status: 400,
      body: {
        accepted: false,
        disposition: "REJECTED",
        reason: parsed.error.issues[0]?.message ?? "Civio event envelope is invalid",
        execution: "NOT_IMPLEMENTED",
      },
    };
  }

  const event = parsed.data;
  if (event.applicationId !== CIVIO_APPLICATION_ID) {
    return {
      status: 403,
      body: {
        accepted: false,
        disposition: "REJECTED",
        reason: "Civio connector application identity does not match civio",
        eventId: event.eventId,
        execution: "NOT_IMPLEMENTED",
      },
    };
  }
  if (event.tenantId !== loaded.binding.tenantId) {
    return {
      status: 403,
      body: {
        accepted: false,
        disposition: "REJECTED",
        reason: "Civio event tenant is outside the configured connector scope",
        eventId: event.eventId,
        execution: "NOT_IMPLEMENTED",
      },
    };
  }
  if (event.projectId !== loaded.binding.projectId) {
    return {
      status: 403,
      body: {
        accepted: false,
        disposition: "REJECTED",
        reason: "Civio event project is outside the configured connector scope",
        eventId: event.eventId,
        execution: "NOT_IMPLEMENTED",
      },
    };
  }

  const fingerprint = fingerprintOf(event);
  const priorByEvent = idempotentResponses.get(`event:${event.eventId}`);
  const priorByKey = idempotentResponses.get(`idem:${event.idempotencyKey}`);
  if (priorByEvent) {
    return { status: priorByEvent.status, body: priorByEvent.body };
  }
  if (priorByKey) {
    if (priorByKey.fingerprint !== fingerprint) {
      return {
        status: 409,
        body: {
          accepted: false,
          disposition: "REJECTED",
          reason: "Civio idempotency key reused with a different event",
          eventId: event.eventId,
          execution: "NOT_IMPLEMENTED",
        },
      };
    }
    return { status: priorByKey.status, body: priorByKey.body };
  }

  lastAuthenticatedAt = new Date().toISOString();

  const evaluation = evaluateOperatingCycle({
    actorId: event.actor.id,
    actorKind: event.actor.kind,
    applicationId: event.applicationId,
    operation: `civio.ingest.${event.eventType}`,
    readOnly: true,
  });

  upsertRegisteredApplication({
    applicationId: CIVIO_APPLICATION_ID,
    name: CIVIO_APPLICATION_NAME,
    environment: "civio",
    version: CIVIO_CONNECTOR_VERSION,
    capabilities: [...CIVIO_CONNECTOR_CAPABILITIES],
    tenantId: event.tenantId,
    projectId: event.projectId,
  });
  recordApplicationEvent(CIVIO_APPLICATION_ID, event.eventType);

  const observed = rememberProcess(event);
  acceptedEventKeys.add(event.eventId);

  const auditType = "civio.connector.event.accepted";
  writeAudit({
    event,
    type: auditType,
    result: "SUCCESS",
    reason: `Civio ${event.eventType} ${event.eventId} → ${evaluation.decision} (${evaluation.reason})`,
    policy: "civio.connector.observe",
    risk: evaluation.decision === "DENY" ? "HIGH" : "LOW",
  });

  const body: CivioIngestResult = {
    accepted: true,
    disposition: "ACCEPTED",
    reason: evaluation.reason,
    eventId: event.eventId,
    evaluation: {
      decision: evaluation.decision,
      blockedAt: evaluation.blockedAt,
      reason: evaluation.reason,
      stagesPassed: evaluation.stagesPassed,
      executed: false,
    },
    process: observed ? { processId: observed.processId } : null,
    audit: { type: auditType, inMemory: true },
    execution: "NOT_IMPLEMENTED",
  };
  const duplicate = {
    fingerprint,
    status: 202,
    body: {
      ...body,
      disposition: "DUPLICATE" as const,
      reason: "Duplicate Civio event; original evaluation retained",
    },
  };
  idempotentResponses.set(`event:${event.eventId}`, duplicate);
  idempotentResponses.set(`idem:${event.idempotencyKey}`, duplicate);
  return { status: 202, body };
}

export function resetCivioConnectorForTests(): void {
  usedNonces.clear();
  idempotentResponses.clear();
  observedProcesses.clear();
  acceptedEventKeys.clear();
  lastAuthenticatedAt = null;
}

export { civioConnectorFoundationStatus };
