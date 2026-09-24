import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CONTROL_AGENT_IDENTITY_SOURCES,
  FABRIC_AGENT_IDS,
  cappedEvidenceTier,
  evaluateMarketplaceAccess,
  evaluateMarketplaceEligibility,
  evidenceTierCeiling,
  marketplaceAccountabilitySchema,
  marketplaceEntitlementSchema,
  marketplaceListingSchema,
  marketplaceReleaseSchema,
  marketplaceSubjectTypeSchema,
  type MarketplaceAccessEvaluation,
  type MarketplaceAccountability,
  type MarketplaceEntitlement,
  type MarketplaceEvidenceTier,
  type MarketplaceListing,
  type MarketplaceRelease,
  type MarketplaceSubjectType,
} from "@atlas/shared";
import { appendAuditEntry } from "./governance-state.js";
import {
  getControlAgentProfile,
} from "./agent-identity-profile.js";
import type { ControlAgentIdentitySource } from "@atlas/shared";

const releases = new Map<string, MarketplaceRelease>();
const listings = new Map<string, MarketplaceListing>();
const entitlements = new Map<string, MarketplaceEntitlement>();
const publishers = new Set<string>();

const identitySourceSchema = z.enum(CONTROL_AGENT_IDENTITY_SOURCES);

function inFabricCatalog(agentId: string): boolean {
  for (const id of FABRIC_AGENT_IDS) {
    if (id === agentId) return true;
  }
  return false;
}

const controlGateSchema = z.object({
  policyAllows: z.boolean(),
  riskAllows: z.boolean(),
  approvalSatisfied: z.boolean(),
  preflightCleared: z.boolean(),
  killSwitchActive: z.boolean(),
}).strict();

export const draftReleaseInputSchema = z.object({
  agentId: z.string().min(1),
  versionLabel: z.string().min(1),
  agentProviderId: z.string().min(1),
  releaseProviderId: z.string().min(1),
  capabilityRef: z.string().min(1).nullable(),
  claimText: z.string().nullable(),
  identityVerified: z.boolean(),
  governanceVerified: z.boolean(),
  operationalEvidenceRef: z.string().min(1).nullable(),
}).strict();

export const publicationInputSchema = z.object({
  agentId: z.string().min(1),
  identitySource: identitySourceSchema,
  releaseId: z.string().min(1),
  publisherId: z.string().min(1),
  listingProviderId: z.string().min(1),
  requestingSubjectType: z.enum(["USER", "AGENT", "PUBLISHER", "PROVIDER"]),
  requestingSubjectId: z.string().min(1),
  controlAuthorized: z.boolean(),
  controlAuthorizerId: z.string().min(1),
  description: z.string(),
  claimText: z.string().nullable(),
  policyAllows: z.boolean(),
  riskAllows: z.boolean(),
  approvalSatisfied: z.boolean(),
}).strict();

export const entitlementInputSchema = z.object({
  listingId: z.string().min(1),
  subjectType: marketplaceSubjectTypeSchema,
  subjectId: z.string().min(1),
  issuerId: z.string().min(1),
  holderId: z.string().min(1),
}).strict();

export type MarketplaceFailure = {
  readonly ok: false;
  readonly reason: string;
  readonly auditSeq: number | null;
};

export type MarketplaceSuccess<T> = {
  readonly ok: true;
  readonly value: T;
  readonly auditSeq: number | null;
};

function id(prefix: "rel" | "lst" | "ent" | "pub" | "prv"): string {
  return `${prefix}_${randomUUID()}`;
}

function audit(input: {
  readonly type: string;
  readonly actorId: string;
  readonly reason: string;
  readonly result: string;
  readonly policy: string;
  readonly risk: string;
  readonly approval: string;
}): number {
  return appendAuditEntry({
    timestamp: new Date().toISOString(),
    type: input.type,
    actorId: input.actorId,
    actorKind: "CONTROL",
    reason: input.reason,
    policy: input.policy,
    risk: input.risk,
    approval: input.approval,
    result: input.result,
    ownerId: "not-personal-memory-owner",
    projectId: null,
  }).seq;
}

export function resetProfessionalMarketplaceForTests(): void {
  releases.clear();
  listings.clear();
  entitlements.clear();
  publishers.clear();
}

export function personalMemoryOwnerRemainsUser(): "USER" {
  return "USER";
}

export function marketplaceTransfersPersonalMemory(): false {
  return false;
}

export function organizationRuntimeIdentityExists(): false {
  return false;
}

export function publisherCanExecuteAgent(): false {
  return false;
}

export function listingCanDispatch(): false {
  return false;
}

export function entitlementCanApprove(): false {
  return false;
}

export function registerPublisher(): { readonly publisherId: string } {
  const publisherId = id("pub");
  publishers.add(publisherId);
  return { publisherId };
}

export function registerProvider(): { readonly providerId: string } {
  return { providerId: id("prv") };
}

export function createDraftRelease(
  input: z.infer<typeof draftReleaseInputSchema>,
): MarketplaceSuccess<MarketplaceRelease> | MarketplaceFailure {
  const parsed = draftReleaseInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "INVALID_RELEASE", auditSeq: null };
  if (parsed.data.agentProviderId === parsed.data.agentId) {
    return { ok: false, reason: "PROVIDER_COLLIDES_WITH_AGENT", auditSeq: null };
  }
  const tier = evidenceTierCeiling({
    identityVerified: parsed.data.identityVerified,
    governanceVerified: parsed.data.governanceVerified,
    operationalEvidenceRef: parsed.data.operationalEvidenceRef,
  });
  const release = marketplaceReleaseSchema.parse({
    releaseId: id("rel"),
    agentId: parsed.data.agentId,
    versionLabel: parsed.data.versionLabel,
    status: "DRAFT",
    agentProviderId: parsed.data.agentProviderId,
    releaseProviderId: parsed.data.releaseProviderId,
    capabilityRef: parsed.data.capabilityRef,
    claimText: parsed.data.claimText,
    identityVerified: parsed.data.identityVerified,
    governanceVerified: parsed.data.governanceVerified,
    operationalEvidenceRef: parsed.data.operationalEvidenceRef,
    evidenceTier: tier,
    executionAuthorityGranted: false,
    personalMemoryAccessGranted: false,
  });
  releases.set(release.releaseId, release);
  return { ok: true, value: release, auditSeq: null };
}

export function publishRelease(
  releaseId: string,
): MarketplaceSuccess<MarketplaceRelease> | MarketplaceFailure {
  const current = releases.get(releaseId);
  if (!current) return { ok: false, reason: "RELEASE_NOT_FOUND", auditSeq: null };
  if (current.status === "PUBLISHED") {
    return { ok: true, value: current, auditSeq: null };
  }
  const published = marketplaceReleaseSchema.parse({ ...current, status: "PUBLISHED" });
  releases.set(releaseId, published);
  const seq = audit({
    type: "marketplace.release.publish",
    actorId: "ATLAS_CONTROL",
    reason: JSON.stringify({
      releaseId: published.releaseId,
      agentId: published.agentId,
      versionLabel: published.versionLabel,
      evidenceTier: published.evidenceTier,
      immutable: true,
    }),
    result: "PUBLISHED",
    policy: "ALLOW",
    risk: "ALLOW",
    approval: "SATISFIED",
  });
  return { ok: true, value: published, auditSeq: seq };
}

export function mutatePublishedRelease(
  releaseId: string,
  versionLabel: string,
): MarketplaceSuccess<MarketplaceRelease> | MarketplaceFailure {
  const current = releases.get(releaseId);
  if (!current) return { ok: false, reason: "RELEASE_NOT_FOUND", auditSeq: null };
  if (current.status === "PUBLISHED") {
    const seq = audit({
      type: "marketplace.release.mutate",
      actorId: "ATLAS_CONTROL",
      reason: JSON.stringify({ releaseId, versionLabel, mutated: false }),
      result: "DENIED",
      policy: "DENY",
      risk: "ALLOW",
      approval: "NOT_APPLICABLE",
    });
    return { ok: false, reason: "RELEASE_IMMUTABLE", auditSeq: seq };
  }
  const next = marketplaceReleaseSchema.parse({ ...current, versionLabel });
  releases.set(releaseId, next);
  return { ok: true, value: next, auditSeq: null };
}

export function getMarketplaceRelease(releaseId: string): MarketplaceRelease | null {
  return releases.get(releaseId) ?? null;
}

export function listMarketplaceReleases(): readonly MarketplaceRelease[] {
  return [...releases.values()];
}

function accountability(input: {
  readonly publisherId: string | null;
  readonly providerId: string | null;
  readonly applicationId: string | null;
}): MarketplaceAccountability {
  return marketplaceAccountabilitySchema.parse({
    userId: null,
    providerId: input.providerId,
    publisherId: input.publisherId,
    tenantId: null,
    organizationId: null,
    applicationId: input.applicationId,
    controlAuthority: "ATLAS_CONTROL",
  });
}

export function inspectMarketplaceEligibility(input: {
  readonly agentId: string;
  readonly identitySource: ControlAgentIdentitySource;
  readonly releaseId: string | null;
  readonly publisherId: string | null;
}): { readonly eligible: boolean; readonly reasons: readonly string[]; readonly executionAuthorityGranted: false } {
  const profile = getControlAgentProfile(input.identitySource, input.agentId);
  const release = input.releaseId ? releases.get(input.releaseId) ?? null : null;
  return evaluateMarketplaceEligibility({
    agentId: input.agentId,
    professionalScope: profile?.professionalScope === true,
    scopeDeclared: profile?.scopeEvidence === "DECLARED",
    provenance: profile?.provenance ?? "",
    inFabricCatalog: inFabricCatalog(input.agentId),
    releaseId: release?.releaseId ?? null,
    releaseAgentId: release?.agentId ?? null,
    releasePublished: release?.status === "PUBLISHED",
    agentProviderId: release?.agentProviderId ?? null,
    publisherId: input.publisherId,
    requestedTier: release?.evidenceTier ?? 0,
    evidenceCeiling: release
      ? evidenceTierCeiling({
          identityVerified: release.identityVerified,
          governanceVerified: release.governanceVerified,
          operationalEvidenceRef: release.operationalEvidenceRef,
        })
      : 0,
  });
}

export function requestListingPublication(
  input: z.infer<typeof publicationInputSchema>,
): MarketplaceSuccess<MarketplaceListing> | MarketplaceFailure {
  const parsed = publicationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID_PUBLICATION", auditSeq: null };
  }
  const body = parsed.data;
  const correlation = `mpub_${randomUUID()}`;
  const deny = (reason: string): MarketplaceFailure => {
    const seq = audit({
      type: "marketplace.publication",
      actorId: body.requestingSubjectId,
      reason: JSON.stringify({
        correlation,
        reason,
        requestingSubjectId: body.requestingSubjectId,
        requestingSubjectType: body.requestingSubjectType,
        agentId: body.agentId,
        releaseId: body.releaseId,
        listingId: null,
        controlAuthorized: body.controlAuthorized,
        controlAuthorizerId: body.controlAuthorizerId,
      }),
      result: "DENIED",
      policy: body.policyAllows ? "ALLOW" : "DENY",
      risk: body.riskAllows ? "ALLOW" : "DENY",
      approval: body.approvalSatisfied ? "SATISFIED" : "REQUIRED",
    });
    return { ok: false, reason, auditSeq: seq };
  };

  if (!body.controlAuthorized || body.controlAuthorizerId !== "ATLAS_CONTROL") {
    return deny("CONTROL_AUTHORIZATION_REQUIRED");
  }
  if (!publishers.has(body.publisherId) || body.publisherId === body.agentId) {
    return deny("PUBLISHER_REQUIRED");
  }
  const profile = getControlAgentProfile(body.identitySource, body.agentId);
  if (!profile) return deny("AGENT_IDENTITY_REQUIRED");
  const release = releases.get(body.releaseId);
  if (!release || release.status !== "PUBLISHED" || release.agentId !== body.agentId) {
    return deny("PUBLISHED_RELEASE_REQUIRED");
  }
  if (!body.policyAllows) return deny("POLICY_DENY");
  if (!body.riskAllows) return deny("RISK_DENY");
  if (!body.approvalSatisfied) return deny("APPROVAL_REQUIRED");
  const ceiling = evidenceTierCeiling({
    identityVerified: release.identityVerified,
    governanceVerified: release.governanceVerified,
    operationalEvidenceRef: release.operationalEvidenceRef,
  });
  const eligibility = evaluateMarketplaceEligibility({
    agentId: body.agentId,
    professionalScope: profile.professionalScope,
    scopeDeclared: profile.scopeEvidence === "DECLARED",
    provenance: profile.provenance,
    inFabricCatalog: inFabricCatalog(body.agentId),
    releaseId: release.releaseId,
    releaseAgentId: release.agentId,
    releasePublished: true,
    agentProviderId: release.agentProviderId,
    publisherId: body.publisherId,
    requestedTier: ceiling,
    evidenceCeiling: ceiling,
  });
  if (!eligibility.eligible) return deny(eligibility.reasons[0] ?? "INELIGIBLE");
  const listing = marketplaceListingSchema.parse({
    listingId: id("lst"),
    releaseId: release.releaseId,
    agentId: release.agentId,
    publisherId: body.publisherId,
    listingProviderId: body.listingProviderId,
    status: "PUBLISHED",
    description: body.description,
    claimText: body.claimText,
    evidenceTier: cappedEvidenceTier(ceiling, ceiling),
    executionAuthorityGranted: false,
    personalMemoryAccessGranted: false,
    approvalGranted: false,
  });
  listings.set(listing.listingId, listing);
  const seq = audit({
    type: "marketplace.publication",
    actorId: "ATLAS_CONTROL",
    reason: JSON.stringify({
      correlation,
      requestingSubjectId: body.requestingSubjectId,
      requestingSubjectType: body.requestingSubjectType,
      accountability: accountability({
        publisherId: body.publisherId,
        providerId: release.agentProviderId,
        applicationId: profile.applicationId,
      }),
      agentId: listing.agentId,
      releaseId: listing.releaseId,
      listingId: listing.listingId,
      authorization: "AUTHORIZED",
      evidenceTier: listing.evidenceTier,
      policyAllows: body.policyAllows,
      riskAllows: body.riskAllows,
      personalMemoryOwner: "USER",
    }),
    result: "AUTHORIZED",
    policy: "ALLOW",
    risk: "ALLOW",
    approval: "SATISFIED",
  });
  return { ok: true, value: listing, auditSeq: seq };
}

export function getMarketplaceListing(listingId: string): MarketplaceListing | null {
  return listings.get(listingId) ?? null;
}

export function listMarketplaceListings(): readonly MarketplaceListing[] {
  return [...listings.values()];
}

export function updateListingProvider(
  listingId: string,
  listingProviderId: string,
): MarketplaceSuccess<MarketplaceListing> | MarketplaceFailure {
  const current = listings.get(listingId);
  if (!current) return { ok: false, reason: "LISTING_NOT_FOUND", auditSeq: null };
  if (listingProviderId === current.agentId) {
    return { ok: false, reason: "PROVIDER_COLLIDES_WITH_AGENT", auditSeq: null };
  }
  const next = marketplaceListingSchema.parse({ ...current, listingProviderId });
  listings.set(listingId, next);
  const seq = audit({
    type: "marketplace.listing.provider",
    actorId: "ATLAS_CONTROL",
    reason: JSON.stringify({
      listingId,
      listingProviderId,
      agentProviderUnchanged: true,
    }),
    result: "UPDATED",
    policy: "ALLOW",
    risk: "ALLOW",
    approval: "NOT_APPLICABLE",
  });
  return { ok: true, value: next, auditSeq: seq };
}

export function unpublishListing(input: {
  readonly listingId: string;
  readonly actorId: string;
}): MarketplaceSuccess<MarketplaceListing> | MarketplaceFailure {
  const current = listings.get(input.listingId);
  if (!current) return { ok: false, reason: "LISTING_NOT_FOUND", auditSeq: null };
  const control = input.actorId === "ATLAS_CONTROL";
  const publisher = input.actorId === current.publisherId;
  if (!control && !publisher) return { ok: false, reason: "UNPUBLISH_UNAUTHORIZED", auditSeq: null };
  const next = marketplaceListingSchema.parse({
    ...current,
    status: control ? "SUSPENDED" : "UNPUBLISHED",
  });
  listings.set(input.listingId, next);
  const seq = audit({
    type: "marketplace.listing.lifecycle",
    actorId: input.actorId,
    reason: JSON.stringify({
      listingId: next.listingId,
      agentId: next.agentId,
      status: next.status,
      agentDeleted: false,
    }),
    result: next.status,
    policy: "ALLOW",
    risk: "ALLOW",
    approval: "NOT_APPLICABLE",
  });
  return { ok: true, value: next, auditSeq: seq };
}

export function issueEntitlement(
  input: z.infer<typeof entitlementInputSchema>,
): MarketplaceSuccess<MarketplaceEntitlement> | MarketplaceFailure {
  const parsed = entitlementInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "INVALID_ENTITLEMENT", auditSeq: null };
  const listing = listings.get(parsed.data.listingId);
  if (!listing || listing.status !== "PUBLISHED") {
    return { ok: false, reason: "LISTING_UNAVAILABLE", auditSeq: null };
  }
  if (parsed.data.subjectId === listing.agentId) {
    return { ok: false, reason: "SUBJECT_COLLIDES_WITH_AGENT", auditSeq: null };
  }
  const entitlement = marketplaceEntitlementSchema.parse({
    entitlementId: id("ent"),
    listingId: listing.listingId,
    releaseId: listing.releaseId,
    agentId: listing.agentId,
    subjectType: parsed.data.subjectType,
    subjectId: parsed.data.subjectId,
    issuerId: parsed.data.issuerId,
    holderId: parsed.data.holderId,
    status: "ACTIVE",
    executionAuthorityGranted: false,
    approvalGranted: false,
    personalMemoryAccessGranted: false,
  });
  entitlements.set(entitlement.entitlementId, entitlement);
  const seq = audit({
    type: "marketplace.entitlement.issue",
    actorId: entitlement.issuerId,
    reason: JSON.stringify({
      entitlementId: entitlement.entitlementId,
      subjectType: entitlement.subjectType,
      subjectId: entitlement.subjectId,
      agentId: entitlement.agentId,
      executionAuthorityGranted: false,
      personalMemoryAccessGranted: false,
    }),
    result: "ISSUED",
    policy: "ALLOW",
    risk: "ALLOW",
    approval: "NOT_APPLICABLE",
  });
  return { ok: true, value: entitlement, auditSeq: seq };
}

export function listMarketplaceEntitlements(): readonly MarketplaceEntitlement[] {
  return [...entitlements.values()];
}

export function revokeEntitlement(input: {
  readonly entitlementId: string;
  readonly actorId: string;
  readonly actorRole: "ISSUER" | "HOLDER" | "CONTROL" | "PUBLISHER";
}): MarketplaceSuccess<MarketplaceEntitlement> | MarketplaceFailure {
  const current = entitlements.get(input.entitlementId);
  if (!current) return { ok: false, reason: "ENTITLEMENT_NOT_FOUND", auditSeq: null };
  if (input.actorRole === "PUBLISHER") {
    return { ok: false, reason: "PUBLISHER_CANNOT_ERASE_ENTITLEMENT", auditSeq: null };
  }
  let status: MarketplaceEntitlement["status"] | null = null;
  if (input.actorRole === "ISSUER" && input.actorId === current.issuerId) status = "REVOKED";
  if (input.actorRole === "HOLDER" && input.actorId === current.holderId) status = "RELINQUISHED";
  if (input.actorRole === "CONTROL" && input.actorId === "ATLAS_CONTROL") status = "SUSPENDED";
  if (!status) return { ok: false, reason: "REVOCATION_UNAUTHORIZED", auditSeq: null };
  const next = marketplaceEntitlementSchema.parse({ ...current, status });
  entitlements.set(next.entitlementId, next);
  const seq = audit({
    type: "marketplace.entitlement.revocation",
    actorId: input.actorId,
    reason: JSON.stringify({
      entitlementId: next.entitlementId,
      agentId: next.agentId,
      status: next.status,
      agentDeleted: false,
      memoryDeleted: false,
    }),
    result: next.status,
    policy: "ALLOW",
    risk: "ALLOW",
    approval: "NOT_APPLICABLE",
  });
  return { ok: true, value: next, auditSeq: seq };
}

export function evaluateEntitlementAccess(input: {
  readonly entitlementId: string;
  readonly policyAllows: boolean;
  readonly riskAllows: boolean;
  readonly approvalSatisfied: boolean;
  readonly preflightCleared: boolean;
  readonly killSwitchActive: boolean;
}): MarketplaceAccessEvaluation {
  const parsed = controlGateSchema.safeParse({
    policyAllows: input.policyAllows,
    riskAllows: input.riskAllows,
    approvalSatisfied: input.approvalSatisfied,
    preflightCleared: input.preflightCleared,
    killSwitchActive: input.killSwitchActive,
  });
  const entitlement = entitlements.get(input.entitlementId);
  const listing = entitlement ? listings.get(entitlement.listingId) : undefined;
  if (!parsed.success || !entitlement) {
    return evaluateMarketplaceAccess({
      entitlementId: input.entitlementId,
      entitlementActive: false,
      listingPublished: false,
      policyAllows: false,
      riskAllows: false,
      approvalSatisfied: false,
      preflightCleared: false,
      killSwitchActive: true,
    });
  }
  const evaluation = evaluateMarketplaceAccess({
    entitlementId: entitlement.entitlementId,
    entitlementActive: entitlement.status === "ACTIVE",
    listingPublished: listing?.status === "PUBLISHED",
    policyAllows: parsed.data.policyAllows,
    riskAllows: parsed.data.riskAllows,
    approvalSatisfied: parsed.data.approvalSatisfied,
    preflightCleared: parsed.data.preflightCleared,
    killSwitchActive: parsed.data.killSwitchActive,
  });
  audit({
    type: "marketplace.access",
    actorId: entitlement.subjectId,
    reason: JSON.stringify({
      entitlementId: entitlement.entitlementId,
      listingId: entitlement.listingId,
      agentId: entitlement.agentId,
      nextGate: evaluation.nextGate,
      executionAuthorityGranted: false,
    }),
    result: evaluation.accessGranted ? "ACCESS_TO_CONTROL" : "DENIED",
    policy: parsed.data.policyAllows ? "ALLOW" : "DENY",
    risk: parsed.data.riskAllows ? "ALLOW" : "DENY",
    approval: parsed.data.approvalSatisfied ? "SATISFIED" : "REQUIRED",
  });
  return evaluation;
}

export function marketplaceEvidenceForListing(listingId: string): {
  readonly claimText: string | null;
  readonly description: string;
  readonly evidenceTier: MarketplaceEvidenceTier;
  readonly epistemicStateAssigned: false;
} | null {
  const listing = listings.get(listingId);
  if (!listing) return null;
  return {
    claimText: listing.claimText,
    description: listing.description,
    evidenceTier: listing.evidenceTier,
    epistemicStateAssigned: false,
  };
}

export type { MarketplaceSubjectType };
