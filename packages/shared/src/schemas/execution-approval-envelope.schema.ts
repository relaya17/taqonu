import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);
const nonEmptyTextSchema = z.string().min(1).max(200);
const nullableArtifactSchema = z.object({
  artifactId: nonEmptyTextSchema.nullable(),
  artifactHash: sha256HexSchema.nullable(),
  hashAlgorithm: z.literal("sha256").nullable(),
  canonicalizationVersion: z.string().min(1).max(100).nullable(),
}).strict().superRefine((artifact, context) => {
  const allNull = artifact.artifactId === null && artifact.artifactHash === null && artifact.hashAlgorithm === null && artifact.canonicalizationVersion === null;
  const allPresent = artifact.artifactId !== null && artifact.artifactHash !== null && artifact.hashAlgorithm !== null && artifact.canonicalizationVersion !== null;
  if (!allNull && !allPresent) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Artifact fields must be all null or all present" });
  }
});

export const approvalRiskSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const approvalStateSchema = z.enum([
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "REVOKED",
  "EXPIRED",
  "FULFILLMENT_IN_PROGRESS",
  "FULFILLED",
  "CONSUMED_FAILED",
  "OUTCOME_UNKNOWN",
]);

export const verificationPlanSchema = z.object({
  version: z.string().min(1).max(100),
  expectedObservations: z.array(z.string().min(1).max(500)).max(32),
  baselineObservations: z.array(z.string().min(1).max(500)).max(32),
  verificationPlanHash: sha256HexSchema,
}).strict();

export const executionApprovalEnvelopeSchema = z.object({
  schemaVersion: z.literal("atlas.execution-approval-envelope/v1"),
  approvalId: uuidSchema,
  envelopeHash: sha256HexSchema,
  canonicalizationVersion: z.literal("atlas-c14n-json/v1"),
  requester: z.object({
    principalId: nonEmptyTextSchema,
    principalType: z.enum(["USER", "SERVICE"]),
    tenantId: nonEmptyTextSchema,
  }).strict(),
  proposedExecutingAgent: z.object({
    agentId: nonEmptyTextSchema,
    identityVersion: z.string().min(1).max(100),
  }).strict(),
  operation: nonEmptyTextSchema,
  action: nonEmptyTextSchema,
  tool: z.object({
    name: nonEmptyTextSchema,
    catalogVersion: z.string().min(1).max(100),
    argumentSchemaVersion: z.string().min(1).max(100),
  }).strict(),
  toolArgs: z.unknown(),
  toolArgsHash: sha256HexSchema,
  entity: z.object({
    type: nonEmptyTextSchema,
    id: nonEmptyTextSchema.nullable(),
  }).strict(),
  project: z.object({ projectId: nonEmptyTextSchema }).strict(),
  tenant: z.object({ tenantId: nonEmptyTextSchema }).strict(),
  artifact: nullableArtifactSchema,
  verificationPlan: verificationPlanSchema,
  policyDecision: z.object({
    policyVersion: z.string().min(1).max(100),
    riskLevel: approvalRiskSchema,
    disposition: z.literal("REQUIRES_APPROVAL"),
    decisionHash: sha256HexSchema,
  }).strict(),
  requestedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
}).strict().superRefine((envelope, context) => {
  if (envelope.requester.tenantId !== envelope.tenant.tenantId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["tenant", "tenantId"], message: "Requester and envelope tenant IDs must match" });
  }
  if (Date.parse(envelope.expiresAt) <= Date.parse(envelope.requestedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Expiration must be after request time" });
  }
});

export type ApprovalRisk = z.infer<typeof approvalRiskSchema>;
export type ApprovalState = z.infer<typeof approvalStateSchema>;
export type VerificationPlan = z.infer<typeof verificationPlanSchema>;
export type ExecutionApprovalEnvelopeV1 = z.infer<typeof executionApprovalEnvelopeSchema>;
