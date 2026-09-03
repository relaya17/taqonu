/**
 * Control Plane → tenant API decision handoff.
 *
 * Authenticates the sender as Atlas Control Plane (SERVICE).
 * Does not authorize a tool/target/artifact — that is a separate
 * server-side binding check in apps/api.
 */

import { z } from "zod";

export const GOVERNED_LIFECYCLE_HANDOFF_SCHEMA =
  "atlas.governed-lifecycle-handoff/v1" as const;

export const GOVERNED_LIFECYCLE_HANDOFF_PATH =
  "/api/v1/governance/lifecycle/handoff" as const;

export const governedIdentitySchema = z.object({
  tenantId: z.string().trim().min(1).max(128),
  projectId: z.string().trim().min(1).max(128),
  applicationId: z.string().trim().min(1).max(128),
  processId: z.string().trim().min(1).max(128).nullable(),
  eventId: z.string().trim().min(1).max(128),
});
export type GovernedIdentity = z.infer<typeof governedIdentitySchema>;

export const governedHandoffDecisionSchema = z.object({
  decision: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL"]),
  reason: z.string().trim().min(1).max(2000),
  tenantId: z.string().trim().min(1).max(128),
  projectId: z.string().trim().min(1).max(128),
  applicationId: z.string().trim().min(1).max(128),
  processId: z.string().trim().min(1).max(128).nullable(),
  eventId: z.string().trim().min(1).max(128),
  eventType: z.string().trim().min(1).max(200),
  correlationId: z.string().trim().min(1).max(200),
  requestId: z.string().trim().min(1).max(200),
  policy: z.object({
    entityType: z.string().trim().min(1).max(100),
    action: z.string().trim().min(1).max(100),
    riskTier: z.string().trim().min(1).max(50),
  }),
});
export type GovernedHandoffDecision = z.infer<typeof governedHandoffDecisionSchema>;

export const governedTargetAssertionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("path"), value: z.string().min(1).max(1024) }),
  z.object({ kind: z.literal("query"), value: z.string().min(1).max(2048) }),
  z.object({ kind: z.literal("workspace"), value: z.literal(".") }),
]);

export const governedExecutionIntentSchema = z.object({
  toolName: z.string().trim().min(1).max(200),
  toolArgs: z.record(z.string(), z.unknown()),
  artifact: z.string().min(1).max(1_000_000),
  artifactHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  target: governedTargetAssertionSchema.optional(),
});
export type GovernedExecutionIntent = z.infer<typeof governedExecutionIntentSchema>;

export const governedLifecycleHandoffSchema = z.object({
  schemaVersion: z.literal(GOVERNED_LIFECYCLE_HANDOFF_SCHEMA),
  identity: governedIdentitySchema,
  decision: governedHandoffDecisionSchema,
  execution: governedExecutionIntentSchema.optional(),
  approvalRequestId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
export type GovernedLifecycleHandoff = z.infer<typeof governedLifecycleHandoffSchema>;

export function identitiesMatch(
  left: GovernedIdentity,
  right: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly applicationId: string;
    readonly processId: string | null;
    readonly eventId: string;
  },
): string | null {
  if (left.tenantId !== right.tenantId) {
    return "Handoff tenant does not match the governance decision";
  }
  if (left.projectId !== right.projectId) {
    return "Handoff project does not match the governance decision";
  }
  if (left.applicationId !== right.applicationId) {
    return "Handoff application does not match the governance decision";
  }
  if ((left.processId ?? null) !== (right.processId ?? null)) {
    return "Handoff process does not match the governance decision";
  }
  if (left.eventId !== right.eventId) {
    return "Handoff event does not match the governance decision";
  }
  return null;
}
