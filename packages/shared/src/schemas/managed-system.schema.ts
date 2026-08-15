import { z } from "zod";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";
import { portfolioVerdictHintSchema } from "./portfolio.schema.js";

/** Atlas layers — not an AI coding assistant. */
export const ATLAS_CONTROL_LAYERS = [
  "TRUTH",
  "EVIDENCE",
  "GOVERNANCE",
  "INTELLIGENCE",
  "AUTOMATION_CONTROL",
] as const;

export const atlasControlLayerSchema = z.enum(ATLAS_CONTROL_LAYERS);

/** Outside-in observe loop. ACT is last and always gated. */
export const CONTROL_LOOP_PHASES = [
  "DISCOVER",
  "UNDERSTAND",
  "VERIFY",
  "ACT",
] as const;

export const controlLoopPhaseSchema = z.enum(CONTROL_LOOP_PHASES);

export const ACT_STEPS = [
  "RECOMMENDATION",
  "RISK_CLASSIFICATION",
  "POLICY",
  "APPROVAL",
  "EXECUTION",
  "VERIFICATION",
  "EVIDENCE",
] as const;

export const actStepSchema = z.enum(ACT_STEPS);

export const MANAGED_SYSTEM_KINDS = [
  "CUSTOMER",
  "LAB",
  "ATLAS_SELF",
] as const;

export const managedSystemKindSchema = z.enum(MANAGED_SYSTEM_KINDS);

export const MANAGED_SYSTEM_FACETS = [
  "identity",
  "repositories",
  "environments",
  "services",
  "databases",
  "integrations",
  "deployments",
  "workers",
  "jobs",
  "apis",
  "secretsMetadata",
  "policies",
  "evidence",
  "risks",
  "decisions",
  "incidents",
  "health",
] as const;

export const managedSystemFacetSchema = z.enum(MANAGED_SYSTEM_FACETS);

export const SYSTEM_POSTURES = ["CLEAR", "WATCH", "BLOCKED", "UNKNOWN"] as const;

export const systemPostureSchema = z.enum(SYSTEM_POSTURES);

/** Well-known id — Atlas audits itself (DEF-000). */
export const ATLAS_SELF_SYSTEM_ID = "00000000-0000-4000-8000-def000000000";

export const managedSystemFacetStateSchema = z.object({
  facet: managedSystemFacetSchema,
  observed: z.boolean(),
  count: z.number().int().min(0).default(0),
  epistemicState: epistemicStateSchema,
  note: z.string().max(500).optional(),
});

export const managedSystemSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  kind: managedSystemKindSchema,
  posture: systemPostureSchema,
  verdictHint: portfolioVerdictHintSchema,
  summary: z.string().max(500),
  evidenceCoverage: z.number().min(0).max(100).nullable(),
  criticalGaps: z.number().int().min(0),
  mediumRisks: z.number().int().min(0),
  workspaceRoot: z.string().nullable(),
  facets: z.array(managedSystemFacetStateSchema),
  selfManaged: z.boolean(),
  loopPhase: controlLoopPhaseSchema,
  actEligible: z.boolean(),
  asOf: isoDateTimeSchema,
  epistemicState: epistemicStateSchema,
});

export const systemInvariantSchema = z.object({
  id: z.string().min(1).max(80),
  statement: z.string().min(1).max(500),
  domain: z.enum([
    "FINANCIAL",
    "SECURITY",
    "DATA",
    "AVAILABILITY",
    "WORKFLOW",
    "GOVERNANCE",
  ]),
  requiredEvidence: z.array(z.string().min(1).max(80)).min(1),
  approvalRequired: z.boolean(),
});

export const systemContractSchema = z.object({
  systemId: uuidSchema,
  identity: z.string().min(1).max(200),
  architecture: z.string().max(2000).nullable(),
  dependencies: z.array(z.string().min(1).max(120)).default([]),
  criticalWorkflows: z.array(z.string().min(1).max(200)).default([]),
  financialInvariants: z.array(systemInvariantSchema).default([]),
  securityPolicies: z.array(z.string().min(1).max(200)).default([]),
  dataBoundaries: z.array(z.string().min(1).max(200)).default([]),
  slos: z.array(z.string().min(1).max(200)).default([]),
  recoveryObjectives: z.array(z.string().min(1).max(200)).default([]),
  approvalPolicies: z.array(z.string().min(1).max(200)).default([]),
  evidenceRequirements: z.array(z.string().min(1).max(200)).default([]),
  epistemicState: z.enum(["PROPOSED", "CONFIRMED", "INFERRED"]),
  updatedAt: isoDateTimeSchema,
});

export const invariantCheckResultSchema = z.object({
  id: z.string().min(1).max(80),
  statement: z.string().min(1).max(500),
  status: z.enum(["PASS", "FAIL", "UNKNOWN"]),
  missingEvidence: z.array(z.string().min(1).max(80)),
  presentEvidence: z.array(z.string().min(1).max(80)),
});

export const systemContractVerificationSchema = z.object({
  systemId: uuidSchema,
  overall: z.enum(["PASS", "FAIL", "UNKNOWN"]),
  results: z.array(invariantCheckResultSchema),
  asOf: isoDateTimeSchema,
});

export const systemContractWriteSchema = systemContractSchema
  .omit({ systemId: true, updatedAt: true })
  .partial();

export const managedSystemDetailSchema = z.object({
  system: managedSystemSchema,
  contract: systemContractSchema,
  verification: systemContractVerificationSchema,
});

export const managedSystemListSchema = z.object({
  items: z.array(managedSystemSchema),
  atlasSelfIncluded: z.boolean(),
  asOf: isoDateTimeSchema,
  epistemicState: z.enum(["INFERRED", "OBSERVED", "UNKNOWN"]),
  note: z.string().max(2000),
});

export type AtlasControlLayer = z.infer<typeof atlasControlLayerSchema>;
export type ControlLoopPhase = z.infer<typeof controlLoopPhaseSchema>;
export type ActStep = z.infer<typeof actStepSchema>;
export type ManagedSystemKind = z.infer<typeof managedSystemKindSchema>;
export type ManagedSystemFacet = z.infer<typeof managedSystemFacetSchema>;
export type SystemPosture = z.infer<typeof systemPostureSchema>;
export type ManagedSystem = z.infer<typeof managedSystemSchema>;
export type ManagedSystemFacetState = z.infer<
  typeof managedSystemFacetStateSchema
>;
export type SystemInvariant = z.infer<typeof systemInvariantSchema>;
export type SystemContract = z.infer<typeof systemContractSchema>;
export type InvariantCheckResult = z.infer<typeof invariantCheckResultSchema>;
export type SystemContractVerification = z.infer<
  typeof systemContractVerificationSchema
>;
export type SystemContractWrite = z.infer<typeof systemContractWriteSchema>;
export type ManagedSystemDetail = z.infer<typeof managedSystemDetailSchema>;
export type ManagedSystemList = z.infer<typeof managedSystemListSchema>;
