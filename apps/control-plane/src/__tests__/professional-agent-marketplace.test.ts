import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";
import { PERSONAL_SUPERVISING_AGENT_CLASS } from "@atlas/shared";
import { listAuditEntries, resetGovernanceStateForTests } from "../services/governance-state.js";
import { getRegisteredAgent, listRegisteredAgents } from "../services/agent-registry.js";
import {
  getControlAgentProfile,
  listControlAgentProfiles,
  unprovenCaseflowAgent,
} from "../services/agent-identity-profile.js";
import {
  createDraftRelease,
  entitlementCanApprove,
  evaluateEntitlementAccess,
  getMarketplaceRelease,
  inspectMarketplaceEligibility,
  issueEntitlement,
  listMarketplaceEntitlements,
  listMarketplaceListings,
  listingCanDispatch,
  marketplaceEvidenceForListing,
  marketplaceTransfersPersonalMemory,
  mutatePublishedRelease,
  organizationRuntimeIdentityExists,
  personalMemoryOwnerRemainsUser,
  publishRelease,
  publisherCanExecuteAgent,
  registerProvider,
  registerPublisher,
  requestListingPublication,
  resetProfessionalMarketplaceForTests,
  revokeEntitlement,
  unpublishListing,
  updateListingProvider,
} from "../services/professional-agent-marketplace.js";
import { createApiRouter } from "../routes/api.js";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

const AGENT = "CODE_ENGINEER";

function gates(open: boolean): {
  policyAllows: boolean;
  riskAllows: boolean;
  approvalSatisfied: boolean;
} {
  return { policyAllows: open, riskAllows: open, approvalSatisfied: open };
}

function publishReadyAgent(): {
  publisherId: string;
  agentProviderId: string;
  releaseProviderId: string;
  listingProviderId: string;
  releaseId: string;
} {
  const publisherId = registerPublisher().publisherId;
  const agentProviderId = registerProvider().providerId;
  const releaseProviderId = registerProvider().providerId;
  const listingProviderId = registerProvider().providerId;
  const draft = createDraftRelease({
    agentId: AGENT,
    versionLabel: "1.0.0",
    agentProviderId,
    releaseProviderId,
    capabilityRef: "fabric-code",
    claimText: "provider claims this is verified",
    identityVerified: true,
    governanceVerified: true,
    operationalEvidenceRef: "evidence-ref-1",
  });
  if (!draft.ok) throw new Error(draft.reason);
  const published = publishRelease(draft.value.releaseId);
  if (!published.ok) throw new Error(published.reason);
  return {
    publisherId,
    agentProviderId,
    releaseProviderId,
    listingProviderId,
    releaseId: published.value.releaseId,
  };
}

beforeEach(() => {
  resetProfessionalMarketplaceForTests();
  resetGovernanceStateForTests();
});

describe("professional agent marketplace", () => {
  it("keeps agent, release, listing, publisher, provider, and application ids distinct", () => {
    const ready = publishReadyAgent();
    const published = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: ready.listingProviderId,
      requestingSubjectType: "PUBLISHER",
      requestingSubjectId: ready.publisherId,
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "control listing",
      claimText: "provider claims this is verified",
      ...gates(true),
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    const profile = getControlAgentProfile("FABRIC", AGENT);
    expect(profile?.applicationId).toBe("def-000");
    const ids = [
      published.value.agentId,
      published.value.releaseId,
      published.value.listingId,
      published.value.publisherId,
      published.value.listingProviderId,
      profile?.applicationId,
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(published.value.executionAuthorityGranted).toBe(false);
  });

  it("publishes only with control authorization and writes an audit record", () => {
    const ready = publishReadyAgent();
    const denied = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: ready.listingProviderId,
      requestingSubjectType: "AGENT",
      requestingSubjectId: AGENT,
      controlAuthorized: false,
      controlAuthorizerId: AGENT,
      description: "self publish",
      claimText: null,
      ...gates(true),
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.reason).toBe("CONTROL_AUTHORIZATION_REQUIRED");
    expect(listMarketplaceListings()).toHaveLength(0);
    const authorized = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: ready.listingProviderId,
      requestingSubjectType: "AGENT",
      requestingSubjectId: AGENT,
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "authorized listing",
      claimText: null,
      ...gates(true),
    });
    expect(authorized.ok).toBe(true);
    const audits = listAuditEntries({ type: "marketplace.publication" });
    expect(audits.some((entry) => entry.result === "DENIED")).toBe(true);
    expect(audits.some((entry) => entry.result === "AUTHORIZED")).toBe(true);
  });

  it("does not overload ownerId and does not transfer personal memory", () => {
    const ready = publishReadyAgent();
    const published = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: ready.listingProviderId,
      requestingSubjectType: "USER",
      requestingSubjectId: "user-1",
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "listing",
      claimText: null,
      ...gates(true),
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect("ownerId" in published.value).toBe(false);
    expect(published.value.personalMemoryAccessGranted).toBe(false);
    expect(personalMemoryOwnerRemainsUser()).toBe("USER");
    expect(marketplaceTransfersPersonalMemory()).toBe(false);
    expect(published.value.publisherId).not.toBe("user-1");
    expect(ready.agentProviderId).not.toBe("user-1");
  });

  it("allows multiple listings for one agent without deleting the agent or mutating the other listing", () => {
    const ready = publishReadyAgent();
    const first = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: ready.listingProviderId,
      requestingSubjectType: "PUBLISHER",
      requestingSubjectId: ready.publisherId,
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "first",
      claimText: null,
      ...gates(true),
    });
    const second = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: registerProvider().providerId,
      requestingSubjectType: "PUBLISHER",
      requestingSubjectId: ready.publisherId,
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "second",
      claimText: null,
      ...gates(true),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.listingId).not.toBe(second.value.listingId);
    expect(first.value.agentId).toBe(AGENT);
    expect(second.value.agentId).toBe(AGENT);
    const unpublished = unpublishListing({
      listingId: first.value.listingId,
      actorId: ready.publisherId,
    });
    expect(unpublished.ok).toBe(true);
    expect(getControlAgentProfile("FABRIC", AGENT)?.agentId).toBe(AGENT);
    expect(listMarketplaceListings().find((item) => item.listingId === second.value.listingId)?.status).toBe("PUBLISHED");
    expect(listMarketplaceListings().find((item) => item.listingId === second.value.listingId)?.description).toBe("second");
  });

  it("keeps a published release immutable and creates a new release for a new version", () => {
    const ready = publishReadyAgent();
    const before = getMarketplaceRelease(ready.releaseId);
    const mutated = mutatePublishedRelease(ready.releaseId, "9.9.9");
    expect(mutated.ok).toBe(false);
    expect(getMarketplaceRelease(ready.releaseId)?.versionLabel).toBe(before?.versionLabel);
    const next = createDraftRelease({
      agentId: AGENT,
      versionLabel: "2.0.0",
      agentProviderId: ready.agentProviderId,
      releaseProviderId: ready.releaseProviderId,
      capabilityRef: null,
      claimText: null,
      identityVerified: true,
      governanceVerified: false,
      operationalEvidenceRef: null,
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value.releaseId).not.toBe(ready.releaseId);
    expect(next.value.agentId).toBe(AGENT);
    expect(next.value.releaseId).not.toBe(AGENT);
    expect(getMarketplaceRelease(ready.releaseId)?.versionLabel).toBe("1.0.0");
  });

  it("does not change the agent provider when the listing provider changes", () => {
    const ready = publishReadyAgent();
    const published = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: ready.listingProviderId,
      requestingSubjectType: "PUBLISHER",
      requestingSubjectId: ready.publisherId,
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "provider layers",
      claimText: null,
      ...gates(true),
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    const replacement = registerProvider().providerId;
    const updated = updateListingProvider(published.value.listingId, replacement);
    expect(updated.ok).toBe(true);
    expect(getMarketplaceRelease(ready.releaseId)?.agentProviderId).toBe(ready.agentProviderId);
    expect(getMarketplaceRelease(ready.releaseId)?.releaseProviderId).toBe(ready.releaseProviderId);
    if (!updated.ok) return;
    expect(updated.value.listingProviderId).toBe(replacement);
  });

  it("does not let a publisher execute, approve, or read personal memory", () => {
    expect(publisherCanExecuteAgent()).toBe(false);
    expect(entitlementCanApprove()).toBe(false);
    expect(listingCanDispatch()).toBe(false);
    const ready = publishReadyAgent();
    const published = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: ready.listingProviderId,
      requestingSubjectType: "PUBLISHER",
      requestingSubjectId: ready.publisherId,
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "publisher listing",
      claimText: null,
      ...gates(true),
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.value.executionAuthorityGranted).toBe(false);
    expect(published.value.approvalGranted).toBe(false);
    expect(published.value.personalMemoryAccessGranted).toBe(false);
    expect(published.value.publisherId).not.toBe(AGENT);
  });

  it("does not treat professional scope or fabric catalog presence as eligibility", () => {
    const profile = getControlAgentProfile("FABRIC", AGENT);
    expect(profile?.professionalScope).toBe(true);
    const withoutRelease = inspectMarketplaceEligibility({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: null,
      publisherId: null,
    });
    expect(withoutRelease.eligible).toBe(false);
    expect(withoutRelease.executionAuthorityGranted).toBe(false);
    const blocked = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: "rel_missing",
      publisherId: registerPublisher().publisherId,
      listingProviderId: registerProvider().providerId,
      requestingSubjectType: "PUBLISHER",
      requestingSubjectId: "publisher",
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "too early",
      claimText: null,
      ...gates(true),
    });
    expect(blocked.ok).toBe(false);
  });

  it("keeps provider claims out of verified and observed evidence", () => {
    const draft = createDraftRelease({
      agentId: AGENT,
      versionLabel: "claim-only",
      agentProviderId: registerProvider().providerId,
      releaseProviderId: registerProvider().providerId,
      capabilityRef: null,
      claimText: "VERIFIED OBSERVED",
      identityVerified: false,
      governanceVerified: false,
      operationalEvidenceRef: null,
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.value.evidenceTier).toBe(0);
    expect(draft.value.claimText).toBe("VERIFIED OBSERVED");
    expect(JSON.stringify(draft.value)).not.toContain("\"epistemicState\"");
    const publishedRelease = publishRelease(draft.value.releaseId);
    expect(publishedRelease.ok).toBe(true);
    const publisherId = registerPublisher().publisherId;
    const listing = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: draft.value.releaseId,
      publisherId,
      listingProviderId: registerProvider().providerId,
      requestingSubjectType: "PUBLISHER",
      requestingSubjectId: publisherId,
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "marketplace description is not evidence",
      claimText: "VERIFIED OBSERVED",
      ...gates(true),
    });
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    expect(listing.value.evidenceTier).toBe(0);
    const evidence = marketplaceEvidenceForListing(listing.value.listingId);
    expect(evidence?.epistemicStateAssigned).toBe(false);
    expect(evidence?.claimText).toBe("VERIFIED OBSERVED");
    expect(evidence?.evidenceTier).toBe(0);
  });

  it("caps evidence at the tier supported by existing evidence references", () => {
    const draft = createDraftRelease({
      agentId: AGENT,
      versionLabel: "identity-only",
      agentProviderId: registerProvider().providerId,
      releaseProviderId: registerProvider().providerId,
      capabilityRef: null,
      claimText: "claim",
      identityVerified: true,
      governanceVerified: false,
      operationalEvidenceRef: "should-not-raise-tier-alone",
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.value.evidenceTier).toBe(1);
    const published = publishRelease(draft.value.releaseId);
    expect(published.ok).toBe(true);
    const publisherId = registerPublisher().publisherId;
    const listing = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: draft.value.releaseId,
      publisherId,
      listingProviderId: registerProvider().providerId,
      requestingSubjectType: "PUBLISHER",
      requestingSubjectId: publisherId,
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "capped",
      claimText: "claim",
      ...gates(true),
    });
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    expect(listing.value.evidenceTier).toBe(1);
    expect(marketplaceEvidenceForListing(listing.value.listingId)?.epistemicStateAssigned).toBe(false);
  });

  it("isolates typed entitlement subjects and revokes without deleting the agent or memory", () => {
    const ready = publishReadyAgent();
    const listing = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: ready.listingProviderId,
      requestingSubjectType: "PUBLISHER",
      requestingSubjectId: ready.publisherId,
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "entitlement listing",
      claimText: null,
      ...gates(true),
    });
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    const user = issueEntitlement({
      listingId: listing.value.listingId,
      subjectType: "USER",
      subjectId: "user-subject",
      issuerId: "issuer-1",
      holderId: "user-subject",
    });
    const application = issueEntitlement({
      listingId: listing.value.listingId,
      subjectType: "APPLICATION",
      subjectId: "app-subject",
      issuerId: "issuer-1",
      holderId: "app-subject",
    });
    const organization = issueEntitlement({
      listingId: listing.value.listingId,
      subjectType: "ORGANIZATION",
      subjectId: "org-subject-not-a-runtime",
      issuerId: "issuer-1",
      holderId: "org-subject-not-a-runtime",
    });
    expect(user.ok && application.ok && organization.ok).toBe(true);
    if (!user.ok || !application.ok || !organization.ok) return;
    expect(user.value.subjectId).not.toBe(application.value.subjectId);
    expect(organizationRuntimeIdentityExists()).toBe(false);
    expect(user.value.executionAuthorityGranted).toBe(false);
    expect(user.value.approvalGranted).toBe(false);
    expect(user.value.personalMemoryAccessGranted).toBe(false);
    expect(revokeEntitlement({
      entitlementId: user.value.entitlementId,
      actorId: ready.publisherId,
      actorRole: "PUBLISHER",
    }).ok).toBe(false);
    const revoked = revokeEntitlement({
      entitlementId: user.value.entitlementId,
      actorId: "issuer-1",
      actorRole: "ISSUER",
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value.status).toBe("REVOKED");
    expect(getControlAgentProfile("FABRIC", AGENT)).toBeDefined();
    expect(listMarketplaceEntitlements().some((item) => item.entitlementId === user.value.entitlementId)).toBe(true);
    expect(application.value.status).toBe("ACTIVE");
  });

  it("sends access through existing control gates and never grants execution", () => {
    const ready = publishReadyAgent();
    const listing = requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: ready.listingProviderId,
      requestingSubjectType: "PUBLISHER",
      requestingSubjectId: ready.publisherId,
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "access",
      claimText: null,
      ...gates(true),
    });
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    const entitlement = issueEntitlement({
      listingId: listing.value.listingId,
      subjectType: "TENANT",
      subjectId: "tenant-1",
      issuerId: "issuer-1",
      holderId: "tenant-1",
    });
    expect(entitlement.ok).toBe(true);
    if (!entitlement.ok) return;
    const open = evaluateEntitlementAccess({
      entitlementId: entitlement.value.entitlementId,
      policyAllows: true,
      riskAllows: true,
      approvalSatisfied: true,
      preflightCleared: true,
      killSwitchActive: false,
    });
    expect(open.accessGranted).toBe(true);
    expect(open.executionAuthorityGranted).toBe(false);
    expect(open.dispatchGranted).toBe(false);
    expect(open.approvalBypass).toBe(false);
    expect(open.policyBypass).toBe(false);
    expect(open.riskBypass).toBe(false);
    expect(open.killSwitchBypass).toBe(false);
    expect(open.nextGate).toBe("EXISTING_CONTROL_CHAIN");
    expect(evaluateEntitlementAccess({
      entitlementId: entitlement.value.entitlementId,
      ...gates(true),
      policyAllows: false,
      preflightCleared: true,
      killSwitchActive: false,
    }).reason).toBe("POLICY_DENY");
    expect(evaluateEntitlementAccess({
      entitlementId: entitlement.value.entitlementId,
      policyAllows: true,
      riskAllows: false,
      approvalSatisfied: true,
      preflightCleared: true,
      killSwitchActive: false,
    }).reason).toBe("RISK_DENY");
    expect(evaluateEntitlementAccess({
      entitlementId: entitlement.value.entitlementId,
      policyAllows: true,
      riskAllows: true,
      approvalSatisfied: false,
      preflightCleared: true,
      killSwitchActive: false,
    }).reason).toBe("APPROVAL_REQUIRED");
    expect(evaluateEntitlementAccess({
      entitlementId: entitlement.value.entitlementId,
      policyAllows: true,
      riskAllows: true,
      approvalSatisfied: true,
      preflightCleared: false,
      killSwitchActive: false,
    }).reason).toBe("PREFLIGHT_REQUIRED");
    expect(evaluateEntitlementAccess({
      entitlementId: entitlement.value.entitlementId,
      policyAllows: true,
      riskAllows: true,
      approvalSatisfied: true,
      preflightCleared: true,
      killSwitchActive: true,
    }).reason).toBe("KILL_SWITCH_ACTIVE");
  });

  it("does not create an execution-registry agent, a caseflow agent id, or commerce records", () => {
    const before = listRegisteredAgents().length;
    const ready = publishReadyAgent();
    requestListingPublication({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: ready.listingProviderId,
      requestingSubjectType: "PROVIDER",
      requestingSubjectId: ready.agentProviderId,
      controlAuthorized: true,
      controlAuthorizerId: ready.agentProviderId,
      description: "provider bypass",
      claimText: null,
      ...gates(true),
    });
    const fabricated = requestListingPublication({
      agentId: "fabricated-agent",
      identitySource: "APPLICATION",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: ready.listingProviderId,
      requestingSubjectType: "PUBLISHER",
      requestingSubjectId: ready.publisherId,
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "fake",
      claimText: null,
      ...gates(true),
    });
    expect(fabricated.ok).toBe(false);
    expect(listRegisteredAgents()).toHaveLength(before);
    expect(getRegisteredAgent(ready.releaseId)).toBeUndefined();
    expect(unprovenCaseflowAgent().agentId).toBeNull();
    expect(unprovenCaseflowAgent().applicationId).toBe("caseflow");
    expect(getControlAgentProfile("PSA", PERSONAL_SUPERVISING_AGENT_CLASS)?.personalScope).toBe(true);
    expect(listControlAgentProfiles().filter((profile) => profile.identitySource === "FABRIC")).toHaveLength(16);
    expect(listRegisteredAgents()).toHaveLength(9);
    const source = readFileSync(
      new URL("../services/professional-agent-marketplace.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/checkout|payout|subscription|rentalDuration|purchaseAgent/);
  });

  it("exposes publication through the control API", async () => {
    const ready = publishReadyAgent();
    const router = createApiRouter();
    const payload = JSON.stringify({
      agentId: AGENT,
      identitySource: "FABRIC",
      releaseId: ready.releaseId,
      publisherId: ready.publisherId,
      listingProviderId: ready.listingProviderId,
      requestingSubjectType: "PUBLISHER",
      requestingSubjectId: ready.publisherId,
      controlAuthorized: true,
      controlAuthorizerId: "ATLAS_CONTROL",
      description: "api listing",
      claimText: null,
      ...gates(true),
    });
    const req = new Readable({
      read() {
        this.push(payload);
        this.push(null);
      },
    }) as IncomingMessage;
    req.method = "POST";
    req.url = "/api/v1/marketplace/listings/publish";
    req.headers = { host: "localhost:3100", "content-type": "application/json" };
    const data = { statusCode: 0, body: "" };
    const res = {
      writeHead(status: number) {
        data.statusCode = status;
        return res;
      },
      setHeader() {
        return res;
      },
      end(body?: string) {
        if (body) data.body = body;
        return res;
      },
      headersSent: false,
    } as unknown as ServerResponse;
    await router.handle(req, res);
    expect(data.statusCode).toBe(201);
    const parsed: unknown = JSON.parse(data.body);
    expect(parsed).toMatchObject({
      ok: true,
      value: { executionAuthorityGranted: false, agentId: AGENT },
    });
  });
});
