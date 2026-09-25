import { describe, expect, it } from "vitest";
import {
  cappedEvidenceTier,
  evaluateMarketplaceAccess,
  evaluateMarketplaceEligibility,
  evidenceTierCeiling,
  marketplaceIdsAreDistinct,
  providerClaimWritesEpistemicState,
} from "./professional-agent-marketplace.js";

describe("marketplace pure decisions", () => {
  it("requires more than professional scope or fabric membership", () => {
    const decision = evaluateMarketplaceEligibility({
      agentId: "CODE_ENGINEER",
      professionalScope: true,
      scopeDeclared: true,
      provenance: "catalog",
      inFabricCatalog: true,
      explicitMarketplaceProfessionalAgent: false,
      releaseId: null,
      releaseAgentId: null,
      releasePublished: false,
      agentProviderId: null,
      publisherId: null,
      requestedTier: 0,
      evidenceCeiling: 0,
    });
    expect(decision.eligible).toBe(false);
    expect(decision.executionAuthorityGranted).toBe(false);
  });

  it("does not let a claim raise the evidence ceiling", () => {
    expect(providerClaimWritesEpistemicState()).toBe(false);
    expect(evidenceTierCeiling({
      identityVerified: false,
      governanceVerified: false,
      operationalEvidenceRef: null,
    })).toBe(0);
    expect(cappedEvidenceTier(3, 1)).toBe(1);
  });

  it("keeps access evaluation from granting dispatch", () => {
    const open = evaluateMarketplaceAccess({
      entitlementId: "ent_1",
      entitlementActive: true,
      listingPublished: true,
      policyAllows: true,
      riskAllows: true,
      approvalSatisfied: true,
      preflightCleared: true,
      killSwitchActive: false,
    });
    expect(open.accessGranted).toBe(true);
    expect(open.executionAuthorityGranted).toBe(false);
    expect(open.dispatchGranted).toBe(false);
    expect(marketplaceIdsAreDistinct({
      agentId: "CODE_ENGINEER",
      releaseId: "rel_1",
      listingId: "lst_1",
      publisherId: "pub_1",
      providerId: "prv_1",
      applicationId: "def-000",
    })).toBe(true);
  });
});
