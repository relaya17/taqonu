/**
 * Portfolio Governance (ADR-022) — foundation enums and safety locks.
 *
 * This is NOT an Atlas execution registry. Fabric remains FABRIC_AGENT_CATALOG.
 * Source agents, source capabilities, knowledge, and source code are
 * observational planes. They never become Fabric agents, Atlas capabilities,
 * ingested knowledge, or copied runtime by existing in this model.
 */

export const PORTFOLIO_GOVERNANCE_VERSION = 1 as const;

/**
 * Distinct planes. A value in one plane is never silently another plane.
 * Tests assert this list stays complete.
 */
export const PORTFOLIO_ENTITY_PLANES = [
  "SOURCE_CODE",
  "KNOWLEDGE",
  "SOURCE_AGENT",
  "SOURCE_CAPABILITY",
  "CANONICAL_ATLAS_CAPABILITY",
  "PROVENANCE",
  "EVIDENCE",
  "RUNTIME_STATUS",
  "SOURCE_PERMISSIONS",
  "ATLAS_PERMISSIONS",
  "GOVERNANCE_DECISION",
  "AUDIT",
  "ATLAS_FABRIC_AGENT",
] as const;
export type PortfolioEntityPlane = (typeof PORTFOLIO_ENTITY_PLANES)[number];

export const PORTFOLIO_APPLICATION_ROLES = ["TARGET", "SOURCE"] as const;
export type PortfolioApplicationRole = (typeof PORTFOLIO_APPLICATION_ROLES)[number];

export const SOURCE_IMPLEMENTATION_CLASSES = [
  "DISCOVERED",
  "CATALOG_ONLY",
  "IDENTITY_CARD",
  "PROMPT",
  "STUB",
  "PARTIAL",
  "IMPLEMENTED",
  "REJECTED",
  "PLANNED",
  "UNKNOWN",
] as const;
export type SourceImplementationClass = (typeof SOURCE_IMPLEMENTATION_CLASSES)[number];

export const SOURCE_VERIFICATION_STATUSES = [
  "UNVERIFIED",
  "PARTIALLY_VERIFIED",
  "VERIFIED",
  "CONFLICTED",
  "NOT_VERIFIED",
] as const;
export type SourceVerificationStatus = (typeof SOURCE_VERIFICATION_STATUSES)[number];

export const SOURCE_RUNTIME_STATES = [
  "UNKNOWN",
  "OBSERVED_DOWN",
  "OBSERVED_UP",
  "NOT_PROBED",
] as const;
export type SourceRuntimeState = (typeof SOURCE_RUNTIME_STATES)[number];

export const SOURCE_PROBE_KINDS = ["NONE", "HEALTH_CHECK", "MANUAL"] as const;
export type SourceProbeKind = (typeof SOURCE_PROBE_KINDS)[number];

export const PORTFOLIO_SOURCE_TYPES = [
  "AGENT",
  "KNOWLEDGE",
  "TOOL",
  "PROMPT",
  "CATALOG",
  "TEST",
  "FACTORY",
  "IDENTITY_CARD",
  "SOURCE_CODE",
] as const;
export type PortfolioSourceType = (typeof PORTFOLIO_SOURCE_TYPES)[number];

export const SOURCE_AUTHORITY_KINDS = [
  "READ",
  "GENERATE",
  "WRITE_SOURCE",
  "EXTERNAL_SOURCE",
] as const;
export type SourceAuthorityKind = (typeof SOURCE_AUTHORITY_KINDS)[number];

/**
 * Atlas-side authorities observed from FABRIC_AGENT_CATALOG.
 * These are never copied from a source agent. WRITE_SOURCE is not in this set.
 */
export const ATLAS_PERMISSION_KINDS = [
  "READ_REPO",
  "READ_EVIDENCE",
  "WRITE_EVIDENCE",
  "PROPOSE_PATCH",
  "ORCHESTRATE",
  "JUDGE",
  "ESCALATE",
  "CALL_EXTERNAL",
] as const;
export type AtlasPermissionKind = (typeof ATLAS_PERMISSION_KINDS)[number];

/** Atlas never inherits source authority. */
export const ATLAS_AUTHORITY_INHERITANCE = "NONE" as const;

export const SOURCE_CAPABILITY_SCOPES = [
  "APPLICATION_SPECIFIC",
  "SHARED_CANDIDATE",
  "UNIQUE",
  "UNKNOWN",
] as const;
export type SourceCapabilityScope = (typeof SOURCE_CAPABILITY_SCOPES)[number];

/** Side-effect classification for capabilities (Phase 3). */
export const SOURCE_SIDE_EFFECT_KINDS = [
  "NONE",
  "STATE_MUTATION",
  "EXTERNAL_CALL",
  "FILE_WRITE",
  "DB_WRITE",
  "MESSAGING",
  "UNKNOWN",
] as const;
export type SourceSideEffectKind = (typeof SOURCE_SIDE_EFFECT_KINDS)[number];

/** External communication classification for capabilities (Phase 3). */
export const SOURCE_EXTERNAL_COMM_KINDS = [
  "NONE",
  "HTTP_CALL",
  "WEBHOOK",
  "EMAIL",
  "SMS",
  "CHAT",
  "UNKNOWN",
] as const;
export type SourceExternalCommKind = (typeof SOURCE_EXTERNAL_COMM_KINDS)[number];

export const GOVERNANCE_DECISION_ACTIONS = [
  "KEEP_SOURCE_SPECIFIC",
  "IMPORT_KNOWLEDGE_ONLY",
  "ADD_PROVENANCE",
  "ADAPT_INTO_EXISTING",
  "ADAPT_INTO_EXISTING_ATLAS_CAPABILITY",
  "CREATE_NEW_ATLAS_SPECIALIST",
  "DO_NOT_IMPORT",
  "ESCALATE",
] as const;
export type GovernanceDecisionAction = (typeof GOVERNANCE_DECISION_ACTIONS)[number];

export const GOVERNANCE_DECISION_STATUSES = [
  "PROPOSED",
  "APPROVED",
  "DENIED",
  "SUPERSEDED",
  "APPROVED_PENDING_FABRIC_CHANGE",
] as const;
export type GovernanceDecisionStatus = (typeof GOVERNANCE_DECISION_STATUSES)[number];

export const DEDUP_RELATION_KINDS = [
  "IDENTICAL",
  "FUNCTIONALLY_DUPLICATE",
  "SEMANTIC_OVERLAP",
  "COMPLEMENTARY",
  "CONTEXT_SPECIFIC",
  "UNIQUE",
  "CONFLICTING",
  "UNKNOWN",
] as const;
export type DedupRelationKind = (typeof DEDUP_RELATION_KINDS)[number];

export const PORTFOLIO_CONFLICT_STATUSES = [
  "OPEN",
  "ESCALATED",
  "UNRESOLVED",
  "CONTEXT_DEPENDENT",
  "BOTH_VALID",
] as const;
export type PortfolioConflictStatus = (typeof PORTFOLIO_CONFLICT_STATUSES)[number];

export const PORTFOLIO_AUDIT_EVENT_TYPES = [
  "portfolio.discovery",
  "portfolio.classification",
  "portfolio.deduplication",
  "portfolio.conflict",
  "portfolio.approval",
  "portfolio.rejection",
  "portfolio.escalation",
  "portfolio.ingestion_decision",
  "portfolio.governance.decided",
  "portfolio.seed.loaded",
] as const;
export type PortfolioAuditEventType = (typeof PORTFOLIO_AUDIT_EVENT_TYPES)[number];

export const PORTFOLIO_EVIDENCE_KINDS = [
  "SOURCE_CODE",
  "TEST",
  "DOCUMENT",
  "REGISTRY",
  "API_SCHEMA",
  "CONFIGURATION",
  "TOOL_REGISTRATION",
  "FACTORY_DEFINITION",
] as const;
export type PortfolioEvidenceKind = (typeof PORTFOLIO_EVIDENCE_KINDS)[number];

export const PORTFOLIO_EVIDENCE_AUTHORITY_RANKS = [
  "REPOSITORY_CODE",
  "AUTOMATED_VERIFIED_TEST",
  "ARCHITECTURE_DOCUMENT",
  "DEVELOPER_STATEMENT",
  "SOURCE_CODE",
  "TEST_FILE",
  "API_SCHEMA",
  "CONFIGURATION",
] as const;
export type PortfolioEvidenceAuthorityRank =
  (typeof PORTFOLIO_EVIDENCE_AUTHORITY_RANKS)[number];

/** Extractor identity for provenance (Phase 4). */
export const PORTFOLIO_EXTRACTORS = [
  "atlas-portfolio-discovery",
  "atlas-manual-entry",
  "source-registry-scan",
  "architecture-doc-scan",
] as const;
export type PortfolioExtractor = (typeof PORTFOLIO_EXTRACTORS)[number];

/** Original status in source repository (Phase 4). */
export const SOURCE_ORIGINAL_STATUSES = [
  "ACTIVE",
  "DEPRECATED",
  "EXPERIMENTAL",
  "PLANNED",
  "UNKNOWN",
] as const;
export type SourceOriginalStatus = (typeof SOURCE_ORIGINAL_STATUSES)[number];

export const DEFAULT_SOURCE_RUNTIME = {
  state: "UNKNOWN" as const,
  probeKind: "NONE" as const,
  probedAt: null,
};

export const PORTFOLIO_SAFETY_LOCKS = {
  ingestEnabled: false as const,
  sourceExecutionEnabled: false as const,
  probesEnabled: false as const,
  fabricCatalogWritableFromPortfolio: false as const,
  sourceWriteInheritance: "NONE" as const,
  siblingRepositoriesWritable: false as const,
  copySourceCodeIntoAtlas: false as const,
};

export type PortfolioSafetyLocks = typeof PORTFOLIO_SAFETY_LOCKS;

export function requiresOwnerAndCatalogChange(
  action: GovernanceDecisionAction,
): boolean {
  return (
    action === "CREATE_NEW_ATLAS_SPECIALIST" ||
    action === "ADAPT_INTO_EXISTING_ATLAS_CAPABILITY" ||
    action === "ADAPT_INTO_EXISTING"
  );
}

export function isSourceToAtlasPromotionAction(
  action: GovernanceDecisionAction,
): boolean {
  return requiresOwnerAndCatalogChange(action);
}
