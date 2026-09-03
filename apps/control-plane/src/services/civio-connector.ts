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
  civioProcessTypeFromEvent,
  mapCivioEventToSupervisedState,
  type CivioAuthenticationState,
  type CivioConnectorContract,
  type CivioEventEnvelope,
  type CivioProcessState,
  type CivioSupervisedProcess,
  type SupervisedProcess,
} from "@atlas/shared";
import {
  CIVIO_CONNECTOR_SECRET_MIN_LENGTH,
  verifyCivioConnectorSignature,
} from "@atlas/integrations-civio";
import {
  upsertRegisteredApplication,
  recordApplicationEvent,
} from "./application-registry.js";
import { appendAuditEntry } from "./governance-state.js";
import {
  bindProcessGovernance,
  listSupervisedProcesses,
  observeConnectorProcessEvent,
  resetProcessRegistryForTests,
} from "./process-registry.js";
import {
  evaluateSupervisedEvent,
  resetSupervisedGovernanceForTests,
} from "./supervised-governance.js";
import { handoffGovernedDecisionToApi } from "./lifecycle-handoff.js";

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
    readonly applicationId?: string;
    readonly processId?: string | null;
    readonly eventId?: string;
    readonly policy?: {
      readonly entityType: string;
      readonly action: string;
      readonly riskTier: string;
    };
    readonly risk?: { readonly status: "EVALUATED"; readonly tier: string };
  };
  readonly process?: { readonly processId: string } | null;
  readonly audit?: { readonly type: string; readonly inMemory: true };
  readonly execution: "NOT_IMPLEMENTED" | "HANDED_OFF" | "HANDOFF_FAILED";
  readonly lifecycle?: {
    readonly status: string;
    readonly executed: boolean;
    readonly approvalRequestId?: string | null;
    readonly reason: string;
  };
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

function requestIdOf(event: CivioEventEnvelope): string {
  const declared =
    typeof event.payload["requestId"] === "string"
      ? event.payload["requestId"].trim()
      : "";
  return declared.length > 0 ? declared : event.correlationId;
}

function actorBinding(event: CivioEventEnvelope): {
  readonly agentId: string | null;
  readonly workerId: string | null;
} {
  return {
    agentId: event.actor.kind === "AGENT" ? event.actor.id : null,
    workerId: event.actor.kind === "SYSTEM" ? event.actor.id : null,
  };
}

function toCivioProcessState(state: SupervisedProcess["state"]): CivioProcessState {
  if (state === "CREATED") return "STARTED";
  if (state === "RUNNING") return "ACTIVE";
  if (state === "COMPLETED") return "COMPLETED";
  return "FAILED";
}

function toCivioSupervisedProcess(process: SupervisedProcess): CivioSupervisedProcess {
  return {
    processId: process.processId,
    applicationId: CIVIO_APPLICATION_ID,
    tenantId: process.tenantId,
    projectId: process.projectId,
    processType: process.processType,
    state: toCivioProcessState(process.state),
    startedAt: process.startedAt,
    updatedAt: process.updatedAt,
    currentEvent: process.currentEvent,
    correlationId: process.correlationId,
  };
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
  return listSupervisedProcesses({ applicationId: CIVIO_APPLICATION_ID }).map(
    toCivioSupervisedProcess,
  );
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
      "Civio runtime emit is wired in relaya17/civio at POST /api/ai/legal-query. Set ATLAS_CIVIO_* on both runtimes.",
      `Operator status: GET ${CIVIO_CONNECTOR_STATUS_PATH}`,
    ],
  };
}

export async function ingestCivioConnectorEvent(input: {
  readonly rawBody: string;
  readonly timestamp: string | null;
  readonly nonce: string | null;
  readonly signature: string | null;
}): Promise<{ readonly status: number; readonly body: CivioIngestResult }> {
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

  upsertRegisteredApplication({
    applicationId: CIVIO_APPLICATION_ID,
    name: CIVIO_APPLICATION_NAME,
    environment: "civio",
    version: CIVIO_CONNECTOR_VERSION,
    capabilities: [...CIVIO_CONNECTOR_CAPABILITIES],
    tenantId: event.tenantId,
    projectId: event.projectId,
  });

  const observed = observeConnectorProcessEvent({
    processId: event.processId,
    applicationId: CIVIO_APPLICATION_ID,
    tenantId: event.tenantId,
    projectId: event.projectId,
    processType: civioProcessTypeFromEvent(event.eventType, event.payload),
    connectorId: CIVIO_CONNECTOR_ID,
    occurredAt: event.occurredAt,
    eventId: event.eventId,
    eventType: event.eventType,
    correlationId: event.correlationId,
    requestId: requestIdOf(event),
    ...actorBinding(event),
    proposedState: mapCivioEventToSupervisedState(event.eventType),
    registration: event.eventType === "civio.process.started",
    governance: null,
  });
  if (!observed.ok) {
    return {
      status: observed.status,
      body: {
        accepted: false,
        disposition: "REJECTED",
        reason: observed.reason,
        eventId: event.eventId,
        execution: "NOT_IMPLEMENTED",
      },
    };
  }

  const governance = evaluateSupervisedEvent({
    tenantId: event.tenantId,
    projectId: event.projectId,
    applicationId: CIVIO_APPLICATION_ID,
    processId: observed.process?.processId ?? null,
    eventId: event.eventId,
    eventType: event.eventType,
    correlationId: event.correlationId,
    requestId: requestIdOf(event),
    connectorId: CIVIO_CONNECTOR_ID,
    actorId: event.actor.id,
    actorKind: event.actor.kind,
  });
  if (observed.process) {
    bindProcessGovernance({
      tenantId: event.tenantId,
      projectId: event.projectId,
      applicationId: CIVIO_APPLICATION_ID,
      processId: observed.process.processId,
      governance: {
        decision: governance.decision,
        reason: governance.reason,
        evaluatedAt: governance.evaluatedAt,
      },
    });
  }

  recordApplicationEvent(CIVIO_APPLICATION_ID, event.eventType);

  acceptedEventKeys.add(event.eventId);

  const auditType = "civio.connector.event.accepted";
  writeAudit({
    event,
    type: auditType,
    result: "SUCCESS",
    reason: `Civio ${event.eventType} ${event.eventId} → ${governance.decision} (${governance.reason})`,
    policy: "civio.connector.observe",
    risk: governance.decision === "DENY" ? "HIGH" : governance.decision === "REQUIRE_APPROVAL" ? "APPROVAL" : "LOW",
  });

  const handoff = await handoffGovernedDecisionToApi(governance);
  if (handoff.status === "HANDOFF_FAILED") {
    writeAudit({
      event,
      type: "civio.lifecycle.handoff.failed",
      result: "FAILURE",
      reason: handoff.reason,
      policy: "civio.connector.observe",
      risk: "HIGH",
    });
  }

  const execution =
    handoff.status === "HANDED_OFF"
      ? "HANDED_OFF"
      : handoff.status === "HANDOFF_FAILED"
        ? "HANDOFF_FAILED"
        : "NOT_IMPLEMENTED";

  const body: CivioIngestResult = {
    accepted: true,
    disposition: "ACCEPTED",
    reason: governance.reason,
    eventId: event.eventId,
    evaluation: {
      decision: governance.decision,
      blockedAt: governance.cycle.blockedAt,
      reason: governance.reason,
      stagesPassed: governance.cycle.stagesPassed,
      executed: false,
      applicationId: CIVIO_APPLICATION_ID,
      processId: observed.process?.processId ?? event.processId ?? null,
      eventId: event.eventId,
      policy: {
        entityType: governance.policy.entityType,
        action: governance.policy.action,
        riskTier: governance.policy.riskTier,
      },
      risk: governance.risk,
    },
    process: observed.process ? { processId: observed.process.processId } : null,
    audit: { type: auditType, inMemory: true },
    execution,
    lifecycle: {
      status: handoff.status,
      executed: false,
      approvalRequestId: handoff.approvalRequestId ?? null,
      reason: handoff.reason,
    },
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
  acceptedEventKeys.clear();
  lastAuthenticatedAt = null;
  resetProcessRegistryForTests();
  resetSupervisedGovernanceForTests();
}

export { civioConnectorFoundationStatus };
