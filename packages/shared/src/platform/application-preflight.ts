/**
 * Canonical Atlas application preflight contract.
 *
 * Post-action events are evidence. They are not permission to execute.
 * A governed application operation must call this before the model/tool runs.
 */

import { z } from "zod";

export const APPLICATION_PREFLIGHT_SCHEMA =
  "atlas.application-preflight.v1" as const;

export const APPLICATION_PREFLIGHT_PATH =
  "/api/v1/governance/application-preflight" as const;

export const ATLAS_CONNECTOR_TIMESTAMP_HEADER =
  "x-atlas-connector-timestamp" as const;
export const ATLAS_CONNECTOR_NONCE_HEADER = "x-atlas-connector-nonce" as const;
export const ATLAS_CONNECTOR_SIGNATURE_HEADER =
  "x-atlas-connector-signature" as const;

export const APPLICATION_PREFLIGHT_KNOWN_APPLICATIONS = [
  "civio",
  "caseflow",
  "hotelos",
  "brokeros",
  "lexstudy",
  "vantera",
] as const;
export type ApplicationPreflightKnownApplication =
  (typeof APPLICATION_PREFLIGHT_KNOWN_APPLICATIONS)[number];

export const APPLICATION_PREFLIGHT_SECRET_MIN_LENGTH = 32;
export const APPLICATION_PREFLIGHT_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

export function applicationConnectorSigningString(
  timestamp: string,
  nonce: string,
  rawBody: string,
): string {
  return `${timestamp}\n${nonce}\n${rawBody}`;
}

export const APPLICATION_PREFLIGHT_OPERATION_CLASSES = [
  "INFORMATIONAL",
  "GOVERNED_DECISION",
  "TOOL_ACTION",
  "HIGH_RISK",
] as const;
export type ApplicationPreflightOperationClass =
  (typeof APPLICATION_PREFLIGHT_OPERATION_CLASSES)[number];

export const APPLICATION_PREFLIGHT_DECISIONS = [
  "ALLOW",
  "DENY",
  "REQUIRE_APPROVAL",
  "KILLED",
  "INVALID",
  "OUT_OF_SCOPE",
] as const;
export type ApplicationPreflightDecision =
  (typeof APPLICATION_PREFLIGHT_DECISIONS)[number];

export const applicationPreflightRequestSchema = z.object({
  schemaVersion: z.literal(APPLICATION_PREFLIGHT_SCHEMA),
  applicationId: z.string().trim().min(1).max(64),
  applicationVersion: z.string().trim().min(1).max(64).optional(),
  tenantId: z.string().trim().min(1).max(128),
  projectId: z.string().trim().min(1).max(128),
  actorId: z.string().trim().min(1).max(200),
  actorKind: z.enum(["USER", "AGENT", "SYSTEM"]),
  /**
   * Application-owned runtime Agent ID when the caller actually has one
   * (e.g. HotelOS `agent.cio`). Optional because some hops only have an
   * operation label. Omit or send `null` — never derive from actorId,
   * operation, or a Fabric ID.
   */
  agentId: z.string().trim().min(1).max(200).nullable().optional(),
  operation: z.string().trim().min(1).max(200),
  operationClass: z.enum(APPLICATION_PREFLIGHT_OPERATION_CLASSES),
  risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  requestId: z.string().trim().min(1).max(128),
  idempotencyKey: z.string().trim().min(1).max(200),
  evidenceRefs: z.array(z.string().trim().min(1).max(256)).max(32).optional(),
  approvalId: z.string().uuid().optional(),
});
export type ApplicationPreflightRequest = z.infer<
  typeof applicationPreflightRequestSchema
>;

export const applicationPreflightResponseSchema = z.object({
  schemaVersion: z.literal(APPLICATION_PREFLIGHT_SCHEMA),
  decision: z.enum(APPLICATION_PREFLIGHT_DECISIONS),
  executed: z.literal(false),
  reason: z.string().min(1).max(2000),
  requestId: z.string().min(1).max(128),
  applicationId: z.string().min(1).max(64),
  agentId: z.string().min(1).max(200).nullable(),
  tenantId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  operation: z.string().min(1).max(200),
  operationClass: z.enum(APPLICATION_PREFLIGHT_OPERATION_CLASSES),
  unavailablePolicy: z.enum(["FAIL_CLOSED", "FAIL_OPEN"]),
  approvalRequestId: z.string().uuid().nullable(),
  killSwitchCategory: z.string().nullable(),
  decisionId: z.string().min(1).max(128),
});
export type ApplicationPreflightResponse = z.infer<
  typeof applicationPreflightResponseSchema
>;

/**
 * Normalize a caller-supplied application Agent ID.
 * Empty / omitted → `null`. Does not invent identity from actor or operation.
 */
export function applicationOwnedAgentId(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** Only ALLOW may proceed to the application model/tool. */
export function applicationPreflightAllowsExecution(
  decision: ApplicationPreflightDecision,
): boolean {
  return decision === "ALLOW";
}

/** Client/unavailable policy for the four existing operation classes only. */
export function unavailablePolicyForClass(
  operationClass: ApplicationPreflightOperationClass,
): "FAIL_CLOSED" | "FAIL_OPEN" {
  if (
    operationClass === "HIGH_RISK" ||
    operationClass === "TOOL_ACTION"
  ) {
    return "FAIL_CLOSED";
  }
  return "FAIL_OPEN";
}

/**
 * Integration contract for applications whose runtime is not in this workspace.
 * Do not treat this comment as implementation.
 *
 * LexStudy / Vantera (NOT ACCESSIBLE):
 * - POST /api/v1/governance/application-preflight
 * - HMAC ATLAS_<APP>_CONNECTOR_SECRET + tenant/project bind
 * - applicationId lexstudy | vantera
 * - DENY / REQUIRE_APPROVAL / KILLED / INVALID / OUT_OF_SCOPE must not execute
 * - Post-action events remain evidence only
 */

export function httpStatusForPreflightDecision(
  decision: ApplicationPreflightDecision,
): number {
  switch (decision) {
    case "ALLOW":
      return 200;
    case "REQUIRE_APPROVAL":
      return 202;
    case "INVALID":
      return 401;
    case "OUT_OF_SCOPE":
      return 403;
    case "DENY":
    case "KILLED":
      return 409;
    default:
      return 400;
  }
}
