/**
 * Civio ↔ Atlas Control connector contract.
 *
 * Inspection of this repository (Phase 3): Civio is not an in-monorepo
 * runtime. It is an external SOURCE application (`github.com/relaya17/civio`,
 * portfolio slug `civio`). Atlas does not host Civio auth, Gemini, or
 * Civio databases. This contract is the Atlas-side identity and event
 * envelope. It does not invent a live Civio process store.
 *
 * applicationId is the known Civio slug. It is never `def-000`.
 * Tenant/project scope is supplied at deployment — not hardcoded here.
 */

import { z } from "zod";
import { isoDateTimeSchema } from "../schemas/common.schema.js";

export const CIVIO_APPLICATION_ID = "civio" as const;
export const CIVIO_APPLICATION_NAME = "Civio" as const;
export const CIVIO_CONNECTOR_ID = "atlas-civio-connector" as const;
export const CIVIO_CONNECTOR_VERSION = "1.0.0" as const;
export const CIVIO_EVENT_SCHEMA_VERSION = "1.0.0" as const;

/** Portfolio inventory id is not the Control application identity. */
export const CIVIO_PORTFOLIO_INVENTORY_ID =
  "a11c0000-0000-4000-a000-000000000007" as const;

export const CIVIO_EVENT_TYPES = [
  "civio.health",
  "civio.rights.answered",
  "civio.legal.ai.completed",
  "civio.legal.ai.failed",
  "civio.process.started",
  "civio.process.updated",
  "civio.process.completed",
] as const;
export type CivioEventType = (typeof CIVIO_EVENT_TYPES)[number];

export const CIVIO_CONNECTOR_CAPABILITIES = [
  "emit.event",
  "report.health",
  "report.process",
] as const;
export type CivioConnectorCapability =
  (typeof CIVIO_CONNECTOR_CAPABILITIES)[number];

export const CIVIO_SUPPORTED_ACTIONS = [] as const;

export const CIVIO_PROCESS_STATES = [
  "STARTED",
  "ACTIVE",
  "COMPLETED",
  "FAILED",
] as const;
export type CivioProcessState = (typeof CIVIO_PROCESS_STATES)[number];

export const CIVIO_ACTOR_KINDS = ["USER", "AGENT", "SYSTEM"] as const;
export type CivioActorKind = (typeof CIVIO_ACTOR_KINDS)[number];

const scopedIdSchema = z.string().trim().min(1).max(128);

export const civioActorSchema = z.object({
  id: scopedIdSchema,
  kind: z.enum(CIVIO_ACTOR_KINDS),
  displayName: z.string().trim().min(1).max(256).optional(),
});
export type CivioActor = z.infer<typeof civioActorSchema>;

export const civioEventSourceSchema = z.object({
  runtime: z.literal("civio"),
  path: z.string().trim().min(1).max(512).optional(),
  commit: z.string().trim().min(7).max(40).optional(),
});
export type CivioEventSource = z.infer<typeof civioEventSourceSchema>;

export const civioEventEnvelopeSchema = z.object({
  eventId: scopedIdSchema,
  eventType: z.enum(CIVIO_EVENT_TYPES),
  occurredAt: isoDateTimeSchema,
  applicationId: z.literal(CIVIO_APPLICATION_ID),
  connectorId: z.literal(CIVIO_CONNECTOR_ID),
  tenantId: scopedIdSchema,
  projectId: scopedIdSchema,
  processId: scopedIdSchema.optional(),
  actor: civioActorSchema,
  source: civioEventSourceSchema,
  payload: z.record(z.string(), z.unknown()),
  schemaVersion: z.literal(CIVIO_EVENT_SCHEMA_VERSION),
  correlationId: scopedIdSchema,
  causationId: scopedIdSchema.optional(),
  idempotencyKey: scopedIdSchema,
  evidenceRef: scopedIdSchema.optional(),
});
export type CivioEventEnvelope = z.infer<typeof civioEventEnvelopeSchema>;

export const CIVIO_CONNECTOR_INGRESS_PATH =
  "/api/v1/connectors/civio/events" as const;
export const CIVIO_CONNECTOR_STATUS_PATH = "/api/v1/connectors/civio" as const;

export const CIVIO_SIGNATURE_HEADER = "x-atlas-civio-signature" as const;
export const CIVIO_TIMESTAMP_HEADER = "x-atlas-civio-timestamp" as const;
export const CIVIO_NONCE_HEADER = "x-atlas-civio-nonce" as const;

export type CivioAuthenticationState =
  | "UNCONFIGURED"
  | "CONFIGURED"
  | "AUTHENTICATED"
  | "REJECTED";

export type CivioConnectorHealth = "unknown" | "configured" | "degraded";

export interface CivioConnectorContract {
  readonly applicationId: typeof CIVIO_APPLICATION_ID;
  readonly applicationName: typeof CIVIO_APPLICATION_NAME;
  readonly connectorId: typeof CIVIO_CONNECTOR_ID;
  readonly connectorVersion: typeof CIVIO_CONNECTOR_VERSION;
  readonly tenantId: string | null;
  readonly projectId: string | null;
  readonly authenticationState: CivioAuthenticationState;
  readonly capabilities: typeof CIVIO_CONNECTOR_CAPABILITIES;
  readonly supportedEvents: typeof CIVIO_EVENT_TYPES;
  readonly supportedProcesses: readonly string[];
  readonly supportedActions: typeof CIVIO_SUPPORTED_ACTIONS;
  readonly health: CivioConnectorHealth;
  readonly compatibility: {
    readonly schemaVersion: typeof CIVIO_EVENT_SCHEMA_VERSION;
    readonly civioRuntimeInThisRepository: false;
    readonly portfolioInventoryId: typeof CIVIO_PORTFOLIO_INVENTORY_ID;
  };
  readonly remainingDeployment: readonly string[];
}

export interface CivioSupervisedProcess {
  readonly processId: string;
  readonly applicationId: typeof CIVIO_APPLICATION_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly processType: string;
  readonly state: CivioProcessState;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly currentEvent: string;
  readonly correlationId: string;
}

export interface CivioConnectorFoundationStatus {
  readonly status: "PARTIAL";
  readonly applicationId: typeof CIVIO_APPLICATION_ID;
  readonly atlasIngress: "IMPLEMENTED";
  readonly authenticatedCaller: "IMPLEMENTED";
  readonly civioRuntimeInThisRepository: false;
  readonly civioRuntimeWiring: "NOT_IMPLEMENTED";
  readonly execution: "NOT_IMPLEMENTED";
  readonly inboundAtlasToCivio: "NOT_IMPLEMENTED";
}

export function civioConnectorFoundationStatus(): CivioConnectorFoundationStatus {
  return {
    status: "PARTIAL",
    applicationId: CIVIO_APPLICATION_ID,
    atlasIngress: "IMPLEMENTED",
    authenticatedCaller: "IMPLEMENTED",
    civioRuntimeInThisRepository: false,
    civioRuntimeWiring: "NOT_IMPLEMENTED",
    execution: "NOT_IMPLEMENTED",
    inboundAtlasToCivio: "NOT_IMPLEMENTED",
  };
}

export function civioProcessTypeFromEvent(
  eventType: CivioEventType,
  payload: Readonly<Record<string, unknown>>,
): string {
  const declared =
    typeof payload["processType"] === "string" ? payload["processType"].trim() : "";
  if (declared.length > 0) return declared;
  if (eventType === "civio.rights.answered") return "civio.rights";
  if (eventType.startsWith("civio.legal.ai.")) return "civio.legal-ai";
  if (eventType.startsWith("civio.process.")) return "civio.process";
  return "civio.unspecified";
}

export function civioProcessStateFromEvent(
  eventType: CivioEventType,
): CivioProcessState {
  if (eventType === "civio.process.started") return "STARTED";
  if (eventType === "civio.process.completed") return "COMPLETED";
  if (eventType === "civio.legal.ai.failed") return "FAILED";
  return "ACTIVE";
}
