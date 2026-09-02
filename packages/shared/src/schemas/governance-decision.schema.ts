import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

const governanceDecisionStatusSchema = z.enum([
  "DENIED",
  "APPROVAL_REQUIRED",
  "FAILED",
  "EXECUTED",
]);

export const governanceDecisionSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  recordType: z.literal("governance.decision"),
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.nullable(),
  decision: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL"]),
  stage: z.enum(["AUTHORIZATION", "APPROVAL", "POLICY", "EXECUTION"]),
  status: governanceDecisionStatusSchema,
  actor: z.object({
    principalId: z.string().min(1),
    kind: z.enum(["USER", "AGENT", "SYSTEM"]),
    ownerId: z.string().min(1).nullable(),
    projectId: z.string().min(1).nullable(),
    applicationId: z.string().min(1).nullable(),
    agentId: z.string().min(1).nullable(),
  }),
  operation: z.string().min(1),
  resource: z.object({
    entityType: z.string().min(1),
    action: z.string().min(1),
    artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  policy: z.object({
    authority: z.literal("DEFAULT_ENTITY_POLICIES"),
    version: z.null(),
    result: z.enum([
      "NOT_EVALUATED",
      "ALLOWED",
      "DENIED",
      "APPROVAL_REQUIRED",
    ]),
    reason: z.string().min(1).nullable(),
    riskTier: z
      .enum(["READ_ONLY", "LOW_RISK_WRITE", "HIGH_RISK_WRITE", "DESTRUCTIVE"])
      .nullable(),
    requiresApproval: z.boolean().nullable(),
  }),
  risk: z.object({
    status: z.enum(["NOT_EVALUATED", "EVALUATED"]),
    score: z.number().min(0).max(100).nullable(),
    rawBucket: z.enum(["AUTO", "AUTO_LOG", "APPROVAL", "HUMAN_ONLY"]).nullable(),
    effectiveBucket: z.enum(["AUTO", "AUTO_LOG", "APPROVAL", "HUMAN_ONLY"]).nullable(),
    factors: z.array(z.string()),
    floors: z.object({
      untrustedSource: z.boolean(),
      automationActor: z.boolean(),
      delegation: z.boolean(),
    }),
  }),
  approval: z.object({
    required: z.boolean(),
    requestId: z.string().min(1).nullable(),
    status: z.enum(["NOT_REQUIRED", "REQUIRED", "CONSUMED", "REJECTED"]),
  }),
  correlation: z.object({
    requestId: z.string().min(1),
  }),
  provenance: z.object({
    sourceOrigin: z.enum(["user_message", "external_ingested", "system"]),
    sourceTrustLevel: z.enum(["trusted", "untrusted"]),
    authorityScope: z.string().min(1).nullable(),
    agentTrustLevel: z.enum(["FULL", "DELEGATED", "LAB"]).nullable(),
    delegationHopCount: z.number().int().min(0),
  }),
  execution: z.object({
    status: z.enum(["NOT_RUN", "FAILED", "EXECUTED"]),
    result: z.enum(["NOT_RUN", "FAILURE", "SUCCESS"]),
    reason: z.string().min(1).nullable(),
  }),
});

export type GovernanceDecision = z.infer<typeof governanceDecisionSchema>;
export type GovernanceDecisionInput = z.input<typeof governanceDecisionSchema>;
