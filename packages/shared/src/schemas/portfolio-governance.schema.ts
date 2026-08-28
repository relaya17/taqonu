import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";
import { fabricAgentIdSchema } from "./agent-fabric.schema.js";
import {
  ATLAS_AUTHORITY_INHERITANCE,
  ATLAS_PERMISSION_KINDS,
  DEDUP_RELATION_KINDS,
  GOVERNANCE_DECISION_ACTIONS,
  GOVERNANCE_DECISION_STATUSES,
  PORTFOLIO_APPLICATION_ROLES,
  PORTFOLIO_AUDIT_EVENT_TYPES,
  PORTFOLIO_CONFLICT_STATUSES,
  PORTFOLIO_EVIDENCE_AUTHORITY_RANKS,
  PORTFOLIO_EVIDENCE_KINDS,
  PORTFOLIO_EXTRACTORS,
  PORTFOLIO_GOVERNANCE_VERSION,
  PORTFOLIO_SAFETY_LOCKS,
  PORTFOLIO_SOURCE_TYPES,
  SOURCE_AUTHORITY_KINDS,
  SOURCE_CAPABILITY_SCOPES,
  SOURCE_EXTERNAL_COMM_KINDS,
  SOURCE_IMPLEMENTATION_CLASSES,
  SOURCE_ORIGINAL_STATUSES,
  SOURCE_PROBE_KINDS,
  SOURCE_RUNTIME_STATES,
  SOURCE_SIDE_EFFECT_KINDS,
  SOURCE_VERIFICATION_STATUSES,
} from "../constants/portfolio-governance.js";

export const portfolioApplicationRoleSchema = z.enum(PORTFOLIO_APPLICATION_ROLES);
export const sourceImplementationClassSchema = z.enum(SOURCE_IMPLEMENTATION_CLASSES);
export const sourceVerificationStatusSchema = z.enum(SOURCE_VERIFICATION_STATUSES);
export const sourceRuntimeStateSchema = z.enum(SOURCE_RUNTIME_STATES);
export const sourceProbeKindSchema = z.enum(SOURCE_PROBE_KINDS);
export const portfolioSourceTypeSchema = z.enum(PORTFOLIO_SOURCE_TYPES);
export const sourceAuthorityKindSchema = z.enum(SOURCE_AUTHORITY_KINDS);
export const atlasPermissionKindSchema = z.enum(ATLAS_PERMISSION_KINDS);
export const sourceCapabilityScopeSchema = z.enum(SOURCE_CAPABILITY_SCOPES);
export const sourceSideEffectKindSchema = z.enum(SOURCE_SIDE_EFFECT_KINDS);
export const sourceExternalCommKindSchema = z.enum(SOURCE_EXTERNAL_COMM_KINDS);
export const governanceDecisionActionSchema = z.enum(GOVERNANCE_DECISION_ACTIONS);
export const governanceDecisionStatusSchema = z.enum(GOVERNANCE_DECISION_STATUSES);
export const dedupRelationKindSchema = z.enum(DEDUP_RELATION_KINDS);
export const portfolioConflictStatusSchema = z.enum(PORTFOLIO_CONFLICT_STATUSES);
export const portfolioAuditEventTypeSchema = z.enum(PORTFOLIO_AUDIT_EVENT_TYPES);
export const portfolioEvidenceKindSchema = z.enum(PORTFOLIO_EVIDENCE_KINDS);
export const portfolioEvidenceAuthorityRankSchema = z.enum(
  PORTFOLIO_EVIDENCE_AUTHORITY_RANKS,
);

export const portfolioSafetyLocksSchema = z.object({
  ingestEnabled: z.literal(false),
  sourceExecutionEnabled: z.literal(false),
  probesEnabled: z.literal(false),
  fabricCatalogWritableFromPortfolio: z.literal(false),
  sourceWriteInheritance: z.literal(ATLAS_AUTHORITY_INHERITANCE),
  siblingRepositoriesWritable: z.literal(false),
  copySourceCodeIntoAtlas: z.literal(false),
});

export const portfolioExtractorSchema = z.enum(PORTFOLIO_EXTRACTORS);
export const sourceOriginalStatusSchema = z.enum(SOURCE_ORIGINAL_STATUSES);

/**
 * Full provenance for any source-derived fact (Phase 4).
 * Every source capability must answer: "Where did this information come from, exactly?"
 */
export const portfolioProvenanceSchema = z.object({
  sourceApplicationId: uuidSchema.nullable().default(null),
  sourceRepository: z.string().min(1).max(300),
  sourceBranch: z.string().min(1).max(200),
  sourceCommit: z.string().regex(/^[0-9a-f]{40}$/i, "full commit SHA required"),
  sourcePath: z.string().min(1).max(500),
  sourcePackage: z.string().max(200).nullable(),
  sourceSymbol: z.string().max(200).nullable(),
  sourceType: portfolioSourceTypeSchema,
  extractedAt: isoDateTimeSchema,
  extractor: portfolioExtractorSchema.default("atlas-portfolio-discovery"),
  originalStatus: sourceOriginalStatusSchema.default("UNKNOWN"),
  atlasClassification: z.string().max(200).default(""),
  evidenceIds: z.array(uuidSchema).max(50).default([]),
});

export const portfolioRuntimeStatusSchema = z.object({
  state: sourceRuntimeStateSchema,
  probeKind: sourceProbeKindSchema,
  probedAt: isoDateTimeSchema.nullable(),
});

/** Source-application authority. Never becomes Atlas runtime authority. */
export const portfolioSourcePermissionSchema = z.object({
  id: uuidSchema,
  sourceAgentId: uuidSchema,
  sourceAuthority: sourceAuthorityKindSchema,
  description: z.string().min(1).max(500),
  atlasInheritance: z.literal(ATLAS_AUTHORITY_INHERITANCE),
});

/**
 * Atlas Fabric authority observed from FABRIC_AGENT_CATALOG.
 * inheritedFromSourceAgentId is always null — source WRITE cannot appear here.
 */
export const portfolioAtlasPermissionSchema = z.object({
  id: uuidSchema,
  fabricAgentId: fabricAgentIdSchema,
  atlasAuthority: atlasPermissionKindSchema,
  description: z.string().min(1).max(500),
  source: z.literal("FABRIC_CATALOG"),
  inheritedFromSourceAgentId: z.null(),
  grantedByPortfolio: z.literal(false),
});

/**
 * Evidence record (Phase 4).
 * Evidence is documentation of source claims. Evidence ≠ RuntimeStatus.
 * Documentation is evidence of a source claim.
 * Source tests are evidence of source implementation.
 * Neither means Atlas has verified the source in production.
 */
export const portfolioEvidenceSchema = z.object({
  id: uuidSchema,
  sourceAgentId: uuidSchema.nullable(),
  applicationId: uuidSchema.nullable(),
  capabilityId: uuidSchema.nullable().default(null),
  kind: portfolioEvidenceKindSchema,
  path: z.string().min(1).max(500),
  note: z.string().max(1000),
  authorityRank: portfolioEvidenceAuthorityRankSchema,
  extractedAt: isoDateTimeSchema.optional(),
  isRuntimeProbe: z.literal(false).default(false),
});

/** Pointer to source code. Bytes are never stored in Atlas. */
export const portfolioSourceCodeRecordSchema = z.object({
  id: uuidSchema,
  applicationId: uuidSchema,
  sourceAgentId: uuidSchema.nullable(),
  provenance: portfolioProvenanceSchema,
  copiedIntoAtlas: z.literal(false),
  bytesCopied: z.literal(0),
  note: z.string().max(1000),
});

/**
 * Knowledge record — captures portable patterns from source applications.
 * Ingestion requires explicit Owner approval via governance decision.
 * `ingestEnabled` remains `false` in PORTFOLIO_SAFETY_LOCKS to prevent
 * unapproved future ingestion. Individual records may have `ingested: true`
 * when explicitly approved by Owner.
 */
export const portfolioKnowledgeRecordSchema = z.object({
  id: uuidSchema,
  applicationId: uuidSchema,
  sourceAgentId: uuidSchema.nullable(),
  capabilityId: uuidSchema.nullable(),
  provenance: portfolioProvenanceSchema,
  title: z.string().min(1).max(200),
  summary: z.string().max(2000),
  ingested: z.boolean(),
  ingestEnabled: z.literal(false),
  governanceDecisionId: uuidSchema.nullable(),
});

export const portfolioApplicationSchema = z.object({
  id: uuidSchema,
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  role: portfolioApplicationRoleSchema,
  sourceRepository: z.string().min(1).max(300),
  sourceBranch: z.string().min(1).max(200),
  sourceCommit: z.string().regex(/^[0-9a-f]{40}$/i, "full commit SHA required"),
  managedSystemId: uuidSchema.nullable(),
  notes: z.string().max(2000),
});

export const portfolioSourceAgentSchema = z.object({
  id: uuidSchema,
  applicationId: uuidSchema,
  sourceKey: z.string().min(1).max(120),
  displayName: z.string().min(1).max(200),
  implementationClass: sourceImplementationClassSchema,
  verificationStatus: sourceVerificationStatusSchema,
  runtimeStatus: portfolioRuntimeStatusSchema,
  provenance: portfolioProvenanceSchema,
  purpose: z.string().min(1).max(1000),
  domain: z.string().min(1).max(120),
  atlasPromotionBlocked: z.literal(true),
  notes: z.string().max(2000),
});

/**
 * Source capability — not an Atlas capability. Phase 3 semantic extraction.
 * Never merged into Atlas Fabric without explicit Owner governance decision.
 *
 * readAccess/writeAccess are DESCRIPTIVE source-side information.
 * They do NOT become Atlas permissions. Atlas inheritance is always NONE.
 */
export const portfolioCapabilitySchema = z.object({
  id: uuidSchema,
  sourceAgentId: uuidSchema,
  name: z.string().min(1).max(120),
  purpose: z.string().min(1).max(1000),
  domain: z.string().min(1).max(120),
  inputs: z.string().max(500),
  outputs: z.string().max(500),
  tools: z.array(z.string().max(120)).max(50).default([]),
  sideEffects: z.array(sourceSideEffectKindSchema).max(10).default([]),
  readAccess: z.array(z.string().max(200)).max(20).default([]),
  writeAccess: z.array(z.string().max(200)).max(20).default([]),
  externalCommunication: z.array(sourceExternalCommKindSchema).max(10).default([]),
  externalAuthority: z.boolean().default(false),
  dependencies: z.array(z.string().max(200)).max(50).default([]),
  applicationContext: z.string().max(500).default(""),
  sourceAuthority: sourceAuthorityKindSchema,
  applicationSpecific: z.boolean(),
  scope: sourceCapabilityScopeSchema.default("UNKNOWN"),
  canonicalCapabilityId: uuidSchema.nullable(),
});

export const portfolioCanonicalCapabilitySchema = z.object({
  id: uuidSchema,
  key: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  kind: z.enum(["FABRIC_RUNTIME", "KNOWLEDGE_ONLY"]),
  fabricAgentId: fabricAgentIdSchema.nullable(),
  notes: z.string().max(1000),
});

/**
 * Reference to a Fabric specialist. Not executable through Portfolio Governance.
 * FABRIC_AGENT_CATALOG remains the only execution registry.
 */
export const portfolioFabricAgentRefSchema = z.object({
  fabricAgentId: fabricAgentIdSchema,
  catalogStatus: z.literal("LAB"),
  executableViaPortfolioGovernance: z.literal(false),
  isExecutionRegistry: z.literal(false),
});

export const portfolioDedupRelationSchema = z.object({
  id: uuidSchema,
  kind: dedupRelationKindSchema,
  leftCapabilityId: uuidSchema.nullable(),
  rightCapabilityId: uuidSchema.nullable(),
  leftSourceAgentId: uuidSchema.nullable(),
  rightSourceAgentId: uuidSchema.nullable().default(null),
  leftApplicationId: uuidSchema.nullable().default(null),
  rightApplicationId: uuidSchema.nullable().default(null),
  canonicalCapabilityId: uuidSchema.nullable(),
  notes: z.string().max(1000),
});

export const portfolioConflictSchema = z.object({
  id: uuidSchema,
  key: z.string().min(1).max(80),
  status: portfolioConflictStatusSchema,
  summary: z.string().min(1).max(1000),
  sourceAgentIds: z.array(uuidSchema).max(20),
  applicationIds: z.array(uuidSchema).max(20),
  canonicalCapabilityId: uuidSchema.nullable(),
});

export const portfolioGovernanceDecisionSchema = z.object({
  id: uuidSchema,
  action: governanceDecisionActionSchema,
  status: governanceDecisionStatusSchema,
  applicationId: uuidSchema.nullable(),
  sourceAgentId: uuidSchema.nullable(),
  capabilityId: uuidSchema.nullable(),
  rationale: z.string().min(1).max(2000),
  decidedBy: z.string().max(200).nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  fabricCatalogMutated: z.literal(false),
  knowledgeIngested: z.literal(false),
});

export const portfolioAuditEventSchema = z.object({
  id: uuidSchema,
  at: isoDateTimeSchema,
  type: portfolioAuditEventTypeSchema,
  actorId: z.string().max(200).nullable(),
  payload: z.record(z.unknown()),
});

export const portfolioGovernanceSnapshotSchema = z.object({
  version: z.literal(PORTFOLIO_GOVERNANCE_VERSION),
  extractedAt: isoDateTimeSchema,
  applications: z.array(portfolioApplicationSchema),
  sourceAgents: z.array(portfolioSourceAgentSchema),
  sourceCodeRecords: z.array(portfolioSourceCodeRecordSchema).default([]),
  knowledgeRecords: z.array(portfolioKnowledgeRecordSchema).default([]),
  /** Source capabilities. Not Atlas capabilities. */
  capabilities: z.array(portfolioCapabilitySchema),
  canonicalCapabilities: z.array(portfolioCanonicalCapabilitySchema),
  fabricAgentRefs: z.array(portfolioFabricAgentRefSchema).default([]),
  sourcePermissions: z.array(portfolioSourcePermissionSchema).default([]),
  atlasPermissions: z.array(portfolioAtlasPermissionSchema).default([]),
  evidence: z.array(portfolioEvidenceSchema),
  dedupRelations: z.array(portfolioDedupRelationSchema),
  conflicts: z.array(portfolioConflictSchema),
  governanceDecisions: z.array(portfolioGovernanceDecisionSchema),
  auditEvents: z.array(portfolioAuditEventSchema),
  safety: portfolioSafetyLocksSchema.default(PORTFOLIO_SAFETY_LOCKS),
});

export const portfolioGovernanceOverlaySchema = z.object({
  version: z.literal(PORTFOLIO_GOVERNANCE_VERSION),
  updatedAt: isoDateTimeSchema,
  governanceDecisions: z.array(portfolioGovernanceDecisionSchema),
  auditEvents: z.array(portfolioAuditEventSchema),
});

export const portfolioGovernanceDecisionRequestSchema = z.object({
  action: governanceDecisionActionSchema,
  verdict: z.enum(["APPROVED", "DENIED"]),
  rationale: z.string().min(8).max(2000),
  applicationId: uuidSchema.nullable().optional(),
  sourceAgentId: uuidSchema.nullable().optional(),
  capabilityId: uuidSchema.nullable().optional(),
});

export type PortfolioSafetyLocksParsed = z.infer<typeof portfolioSafetyLocksSchema>;
export type PortfolioProvenance = z.infer<typeof portfolioProvenanceSchema>;
export type PortfolioRuntimeStatus = z.infer<typeof portfolioRuntimeStatusSchema>;
export type PortfolioSourcePermission = z.infer<typeof portfolioSourcePermissionSchema>;
/** @deprecated Use PortfolioSourcePermission — kept for call-site migration. */
export type PortfolioPermission = PortfolioSourcePermission;
export type PortfolioAtlasPermission = z.infer<typeof portfolioAtlasPermissionSchema>;
export type PortfolioEvidence = z.infer<typeof portfolioEvidenceSchema>;
export type PortfolioSourceCodeRecord = z.infer<typeof portfolioSourceCodeRecordSchema>;
export type PortfolioKnowledgeRecord = z.infer<typeof portfolioKnowledgeRecordSchema>;
export type PortfolioApplication = z.infer<typeof portfolioApplicationSchema>;
export type PortfolioSourceAgent = z.infer<typeof portfolioSourceAgentSchema>;
export type PortfolioCapability = z.infer<typeof portfolioCapabilitySchema>;
export type PortfolioCanonicalCapability = z.infer<
  typeof portfolioCanonicalCapabilitySchema
>;
export type PortfolioFabricAgentRef = z.infer<typeof portfolioFabricAgentRefSchema>;
export type PortfolioDedupRelation = z.infer<typeof portfolioDedupRelationSchema>;
export type PortfolioConflict = z.infer<typeof portfolioConflictSchema>;
export type PortfolioGovernanceDecision = z.infer<
  typeof portfolioGovernanceDecisionSchema
>;
export type PortfolioAuditEvent = z.infer<typeof portfolioAuditEventSchema>;
export type PortfolioGovernanceSnapshot = z.infer<
  typeof portfolioGovernanceSnapshotSchema
>;
export type PortfolioGovernanceOverlay = z.infer<
  typeof portfolioGovernanceOverlaySchema
>;
export type PortfolioGovernanceDecisionRequest = z.infer<
  typeof portfolioGovernanceDecisionRequestSchema
>;

/** Backward-compatible alias — source permissions never become Atlas permissions. */
export const portfolioPermissionSchema = portfolioSourcePermissionSchema;
