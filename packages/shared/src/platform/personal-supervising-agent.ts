/**
 * Personal Supervising Agent — distinct agent class, not a Fabric specialist.
 *
 * `psa:<ownerId>` is a stable identifier only. Authorization is the explicit
 * owner / tenant / project / application scope, never the id string alone.
 */

import { z } from "zod";
import { FABRIC_AGENT_IDS } from "../constants/agents.js";
import { AGENT_RUNTIME_CONTROLS } from "../constants/operating-cycle.js";
import { isoDateTimeSchema, uuidSchema } from "../schemas/common.schema.js";

export const PERSONAL_SUPERVISING_AGENT_CLASS =
  "PERSONAL_SUPERVISING_AGENT" as const;

export const PERSONAL_SUPERVISING_AGENT_PATH =
  "/api/v1/supervising-agent" as const;

export const PSA_STABLE_ID_PREFIX = "psa:" as const;

export const psaLifecycleStatusSchema = z.enum([
  "ACTIVE",
  "PAUSED",
  "DISABLED",
  "REVOKED",
  "DEGRADED",
]);
export type PsaLifecycleStatus = z.infer<typeof psaLifecycleStatusSchema>;

export const psaAuthorizationScopeSchema = z.object({
  ownerId: uuidSchema,
  tenantId: z.string().trim().min(1).max(128),
  projectIds: z.array(z.string().trim().min(1).max(128)).max(64),
  applicationIds: z.array(z.string().trim().min(1).max(128)).max(64),
});
export type PsaAuthorizationScope = z.infer<typeof psaAuthorizationScopeSchema>;

export const psaAttentionRecordSchema = z.object({
  id: uuidSchema,
  kind: z.enum(["recommendation", "escalation"]),
  reason: z.string().trim().min(1).max(2000),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  applicationId: z.string().trim().min(1).max(128).nullable(),
  processId: z.string().trim().min(1).max(128).nullable(),
  eventId: z.string().trim().min(1).max(128).nullable(),
  decision: z.string().trim().min(1).max(64).nullable(),
  risk: z.string().trim().min(1).max(64).nullable(),
  evidenceRefs: z.array(z.string().trim().min(1).max(256)).max(32),
  executed: z.literal(false),
  createdAt: isoDateTimeSchema,
});
export type PsaAttentionRecord = z.infer<typeof psaAttentionRecordSchema>;

export const personalSupervisingAgentRecordSchema = z.object({
  agentClass: z.literal(PERSONAL_SUPERVISING_AGENT_CLASS),
  agentId: z.string().trim().min(1).max(200),
  scope: psaAuthorizationScopeSchema,
  status: psaLifecycleStatusSchema,
  createdAt: isoDateTimeSchema,
  lastActivityAt: isoDateTimeSchema,
  recommendations: z.array(psaAttentionRecordSchema).max(200),
  escalations: z.array(psaAttentionRecordSchema).max(200),
});
export type PersonalSupervisingAgentRecord = z.infer<
  typeof personalSupervisingAgentRecordSchema
>;

export function personalSupervisingAgentId(ownerId: string): string {
  return `${PSA_STABLE_ID_PREFIX}${ownerId}`;
}

export function isPersonalSupervisingAgentId(value: string): boolean {
  return value.startsWith(PSA_STABLE_ID_PREFIX) && value.length > PSA_STABLE_ID_PREFIX.length;
}

export function isFabricSpecialistId(value: string): boolean {
  return (FABRIC_AGENT_IDS as readonly string[]).includes(value);
}

/** Stable id is never sufficient authorization by itself. */
export function scopeAllows(
  scope: PsaAuthorizationScope,
  record: {
    readonly tenantId?: string | null;
    readonly projectId?: string | null;
    readonly applicationId?: string | null;
  },
): boolean {
  if (record.tenantId != null && record.tenantId !== scope.tenantId) {
    return false;
  }
  if (
    record.projectId != null &&
    record.projectId.length > 0 &&
    !scope.projectIds.includes(record.projectId)
  ) {
    return false;
  }
  if (
    record.applicationId != null &&
    record.applicationId.length > 0 &&
    !scope.applicationIds.includes(record.applicationId)
  ) {
    return false;
  }
  return true;
}

/** Later ensure/observe calls may not expand the persisted authorization scope. */
export function presentedScopeWithin(
  stored: PsaAuthorizationScope,
  presented: {
    readonly tenantId: string;
    readonly projectIds: readonly string[];
    readonly applicationIds: readonly string[];
  },
): boolean {
  if (presented.tenantId !== stored.tenantId) return false;
  if (presented.projectIds.some((id) => !stored.projectIds.includes(id))) {
    return false;
  }
  if (presented.applicationIds.some((id) => !stored.applicationIds.includes(id))) {
    return false;
  }
  return true;
}

export function assertNotFabricCatalogId(agentClass: string): boolean {
  return (
    agentClass === PERSONAL_SUPERVISING_AGENT_CLASS &&
    !(FABRIC_AGENT_IDS as readonly string[]).includes(agentClass)
  );
}

export const PSA_RUNTIME_CONTROLS = AGENT_RUNTIME_CONTROLS;
