import { z } from "zod";
import { AI_PROVIDER_IDS } from "../constants/ai-providers.js";

/**
 * Professional Agent Marketplace is a distribution and access layer.
 * It does not execute, approve, bill, rent, purchase, or license agents.
 * Rental, purchase, and licensing commerce are intentionally absent.
 */

export const MARKETPLACE_EXECUTION_AUTHORITY_GRANTED = false as const;

const MARKETPLACE_ACTION_IDENTIFIERS = [
  "analyze",
  "plan",
  "generate",
  "fix",
  "refactor",
  "test",
  "secure",
  "optimize",
  "implement",
  "EXECUTE",
  "DISPATCH",
] as const;

export type MarketplaceAgentTokenDenial =
  | "MODEL_IDENTIFIER"
  | "ACTION_IDENTIFIER"
  | "RELEASE_IDENTIFIER"
  | "LISTING_IDENTIFIER"
  | "ENTITLEMENT_IDENTIFIER"
  | "PROVIDER_IDENTIFIER"
  | "PUBLISHER_IDENTIFIER";

function listed(agentId: string, values: readonly string[]): boolean {
  for (const value of values) {
    if (value === agentId) return true;
  }
  return false;
}

/** Rejects tokens that are not Agent identities. Profile admission is separate. */
export function classifyMarketplaceAgentToken(
  agentId: string,
): MarketplaceAgentTokenDenial | null {
  if (listed(agentId, AI_PROVIDER_IDS)) return "MODEL_IDENTIFIER";
  if (listed(agentId, MARKETPLACE_ACTION_IDENTIFIERS)) return "ACTION_IDENTIFIER";
  if (agentId.startsWith("rel_")) return "RELEASE_IDENTIFIER";
  if (agentId.startsWith("lst_")) return "LISTING_IDENTIFIER";
  if (agentId.startsWith("ent_")) return "ENTITLEMENT_IDENTIFIER";
  if (agentId.startsWith("prv_")) return "PROVIDER_IDENTIFIER";
  if (agentId.startsWith("pub_")) return "PUBLISHER_IDENTIFIER";
  return null;
}
export const MARKETPLACE_PERSONAL_MEMORY_OWNER = "USER" as const;

export const marketplaceEvidenceTierSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type MarketplaceEvidenceTier = z.infer<typeof marketplaceEvidenceTierSchema>;

export const marketplaceSubjectTypeSchema = z.enum([
  "USER",
  "TENANT",
  "APPLICATION",
  "ORGANIZATION",
]);
export type MarketplaceSubjectType = z.infer<typeof marketplaceSubjectTypeSchema>;

export const marketplaceAccountabilitySchema = z.object({
  userId: z.string().min(1).nullable(),
  providerId: z.string().min(1).nullable(),
  publisherId: z.string().min(1).nullable(),
  tenantId: z.string().min(1).nullable(),
  organizationId: z.string().min(1).nullable(),
  applicationId: z.string().min(1).nullable(),
  controlAuthority: z.literal("ATLAS_CONTROL"),
}).strict();
export type MarketplaceAccountability = z.infer<typeof marketplaceAccountabilitySchema>;

export const marketplaceProviderLayerSchema = z.enum([
  "AGENT_ORIGIN",
  "RELEASE_PARTY",
  "LISTING_DISTRIBUTION",
]);

export const marketplaceReleaseSchema = z.object({
  releaseId: z.string().min(1),
  agentId: z.string().min(1),
  versionLabel: z.string().min(1),
  status: z.enum(["DRAFT", "PUBLISHED"]),
  agentProviderId: z.string().min(1),
  releaseProviderId: z.string().min(1),
  capabilityRef: z.string().min(1).nullable(),
  claimText: z.string().nullable(),
  identityVerified: z.boolean(),
  governanceVerified: z.boolean(),
  operationalEvidenceRef: z.string().min(1).nullable(),
  evidenceTier: marketplaceEvidenceTierSchema,
  executionAuthorityGranted: z.literal(false),
  personalMemoryAccessGranted: z.literal(false),
}).strict();
export type MarketplaceRelease = z.infer<typeof marketplaceReleaseSchema>;

export const marketplaceListingSchema = z.object({
  listingId: z.string().min(1),
  releaseId: z.string().min(1),
  agentId: z.string().min(1),
  publisherId: z.string().min(1),
  listingProviderId: z.string().min(1),
  status: z.enum(["PUBLISHED", "UNPUBLISHED", "SUSPENDED"]),
  description: z.string(),
  claimText: z.string().nullable(),
  evidenceTier: marketplaceEvidenceTierSchema,
  executionAuthorityGranted: z.literal(false),
  personalMemoryAccessGranted: z.literal(false),
  approvalGranted: z.literal(false),
}).strict();
export type MarketplaceListing = z.infer<typeof marketplaceListingSchema>;

export const marketplaceEntitlementSchema = z.object({
  entitlementId: z.string().min(1),
  listingId: z.string().min(1),
  releaseId: z.string().min(1),
  agentId: z.string().min(1),
  subjectType: marketplaceSubjectTypeSchema,
  subjectId: z.string().min(1),
  issuerId: z.string().min(1),
  holderId: z.string().min(1),
  status: z.enum(["ACTIVE", "REVOKED", "RELINQUISHED", "SUSPENDED"]),
  executionAuthorityGranted: z.literal(false),
  approvalGranted: z.literal(false),
  personalMemoryAccessGranted: z.literal(false),
}).strict();
export type MarketplaceEntitlement = z.infer<typeof marketplaceEntitlementSchema>;

export const marketplaceAccessEvaluationSchema = z.object({
  entitlementId: z.string().min(1),
  accessGranted: z.boolean(),
  executionAuthorityGranted: z.literal(false),
  approvalBypass: z.literal(false),
  policyBypass: z.literal(false),
  riskBypass: z.literal(false),
  killSwitchBypass: z.literal(false),
  dispatchGranted: z.literal(false),
  nextGate: z.enum(["EXISTING_CONTROL_CHAIN", "DENIED"]),
  reason: z.string(),
}).strict();
export type MarketplaceAccessEvaluation = z.infer<
  typeof marketplaceAccessEvaluationSchema
>;

export function marketplaceIdsAreDistinct(input: {
  readonly agentId: string;
  readonly releaseId: string;
  readonly listingId: string;
  readonly publisherId: string;
  readonly providerId: string;
  readonly applicationId: string;
}): boolean {
  const ids = [
    input.agentId,
    input.releaseId,
    input.listingId,
    input.publisherId,
    input.providerId,
    input.applicationId,
  ];
  return new Set(ids).size === ids.length;
}

export function providerClaimWritesEpistemicState(): false {
  return false;
}

export function evidenceTierCeiling(input: {
  readonly identityVerified: boolean;
  readonly governanceVerified: boolean;
  readonly operationalEvidenceRef: string | null;
}): MarketplaceEvidenceTier {
  if (
    input.identityVerified &&
    input.governanceVerified &&
    input.operationalEvidenceRef !== null &&
    input.operationalEvidenceRef.length > 0
  ) {
    return 3;
  }
  if (input.identityVerified && input.governanceVerified) return 2;
  if (input.identityVerified) return 1;
  return 0;
}

export function cappedEvidenceTier(
  requested: MarketplaceEvidenceTier,
  ceiling: MarketplaceEvidenceTier,
): MarketplaceEvidenceTier {
  return requested <= ceiling ? requested : ceiling;
}

export interface MarketplaceEligibilityInput {
  readonly agentId: string;
  readonly professionalScope: boolean;
  readonly scopeDeclared: boolean;
  readonly provenance: string;
  readonly inFabricCatalog: boolean;
  readonly explicitMarketplaceProfessionalAgent: boolean;
  readonly releaseId: string | null;
  readonly releaseAgentId: string | null;
  readonly releasePublished: boolean;
  readonly agentProviderId: string | null;
  readonly publisherId: string | null;
  readonly requestedTier: MarketplaceEvidenceTier;
  readonly evidenceCeiling: MarketplaceEvidenceTier;
}

export function evaluateMarketplaceEligibility(
  input: MarketplaceEligibilityInput,
): { readonly eligible: boolean; readonly reasons: readonly string[]; readonly executionAuthorityGranted: false } {
  const reasons: string[] = [];
  if (!input.explicitMarketplaceProfessionalAgent) {
    reasons.push("EXPLICIT_MARKETPLACE_PROFESSIONAL_AGENT_REQUIRED");
  }
  if (!input.professionalScope) reasons.push("PROFESSIONAL_SCOPE_REQUIRED");
  if (!input.scopeDeclared) reasons.push("SCOPE_NOT_DECLARED");
  if (input.provenance.trim().length === 0) reasons.push("PROVENANCE_REQUIRED");
  if (input.releaseId === null || !input.releasePublished) reasons.push("PUBLISHED_RELEASE_REQUIRED");
  if (input.releaseId !== null && input.releaseId === input.agentId) reasons.push("RELEASE_ID_COLLIDES_WITH_AGENT");
  if (input.releaseAgentId !== input.agentId) reasons.push("RELEASE_AGENT_MISMATCH");
  if (input.agentProviderId === null || input.agentProviderId === input.agentId) {
    reasons.push("AGENT_PROVIDER_REQUIRED");
  }
  if (input.publisherId === null || input.publisherId === input.agentId) {
    reasons.push("PUBLISHER_REQUIRED");
  }
  if (input.requestedTier > input.evidenceCeiling) reasons.push("EVIDENCE_TIER_EXCEEDS_EVIDENCE");
  void input.inFabricCatalog;
  return {
    eligible: reasons.length === 0,
    reasons,
    executionAuthorityGranted: false,
  };
}

export function evaluateMarketplaceAccess(input: {
  readonly entitlementId: string;
  readonly entitlementActive: boolean;
  readonly listingPublished: boolean;
  readonly policyAllows: boolean;
  readonly riskAllows: boolean;
  readonly approvalSatisfied: boolean;
  readonly preflightCleared: boolean;
  readonly killSwitchActive: boolean;
}): MarketplaceAccessEvaluation {
  const denied = (reason: string): MarketplaceAccessEvaluation => ({
    entitlementId: input.entitlementId,
    accessGranted: false,
    executionAuthorityGranted: false,
    approvalBypass: false,
    policyBypass: false,
    riskBypass: false,
    killSwitchBypass: false,
    dispatchGranted: false,
    nextGate: "DENIED",
    reason,
  });
  if (!input.entitlementActive) return denied("ENTITLEMENT_INACTIVE");
  if (!input.listingPublished) return denied("LISTING_UNAVAILABLE");
  if (input.killSwitchActive) return denied("KILL_SWITCH_ACTIVE");
  if (!input.policyAllows) return denied("POLICY_DENY");
  if (!input.riskAllows) return denied("RISK_DENY");
  if (!input.approvalSatisfied) return denied("APPROVAL_REQUIRED");
  if (!input.preflightCleared) return denied("PREFLIGHT_REQUIRED");
  return {
    entitlementId: input.entitlementId,
    accessGranted: true,
    executionAuthorityGranted: false,
    approvalBypass: false,
    policyBypass: false,
    riskBypass: false,
    killSwitchBypass: false,
    dispatchGranted: false,
    nextGate: "EXISTING_CONTROL_CHAIN",
    reason: "ACCESS_MAY_ENTER_EXISTING_CONTROL_CHAIN",
  };
}
