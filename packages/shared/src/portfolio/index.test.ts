import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS } from "../constants/agents.js";
import {
  requiresOwnerAndCatalogChange,
} from "../constants/portfolio-governance.js";
import {
  applyGovernanceDecision,
  allSourceRuntimesUnknownOrNotProbed,
  buildPortfolioSummary,
  emptyOverlay,
  loadSeedSnapshot,
  mergePortfolioSnapshot,
  noFabricCatalogMutation,
  noKnowledgeIngested,
  sourceWriteNeverInherited,
  verificationDistinctFromRuntime,
} from "./index.js";

describe("portfolio governance seed (Phase 11.1–11.3)", () => {
  const snapshot = loadSeedSnapshot();

  it("has six applications, Atlas TARGET, siblings SOURCE", () => {
    expect(snapshot.applications).toHaveLength(6);
    const atlas = snapshot.applications.find((a) => a.slug === "atlas");
    expect(atlas?.role).toBe("TARGET");
    expect(
      snapshot.applications.filter((a) => a.role === "SOURCE").map((a) => a.slug),
    ).toEqual(["vantera", "hotelos", "caseflow", "brokeros", "lexstudy"]);
  });

  it("records full provenance: repo, branch, 40-char SHA, path, type, extractedAt", () => {
    for (const agent of snapshot.sourceAgents) {
      const p = agent.provenance;
      expect(p.sourceRepository.length).toBeGreaterThan(0);
      expect(p.sourceBranch.length).toBeGreaterThan(0);
      expect(p.sourceCommit).toMatch(/^[0-9a-f]{40}$/i);
      expect(p.sourcePath.length).toBeGreaterThan(0);
      expect(p.sourceType.length).toBeGreaterThan(0);
      expect(p.extractedAt).toBe(snapshot.extractedAt);
    }
  });

  it("defaults every source runtime to UNKNOWN / NOT_PROBED and never probed", () => {
    expect(allSourceRuntimesUnknownOrNotProbed(snapshot)).toBe(true);
  });

  it("keeps source verification independent of runtime status", () => {
    expect(verificationDistinctFromRuntime(snapshot)).toBe(true);
    const verified = snapshot.sourceAgents.filter((a) => a.verificationStatus === "VERIFIED");
    expect(verified.length).toBeGreaterThan(0);
    for (const agent of verified) {
      expect(agent.runtimeStatus.state).toBe("UNKNOWN");
    }
  });

  it("never inherits source WRITE / secrets / external authority into Atlas", () => {
    expect(sourceWriteNeverInherited(snapshot)).toBe(true);
    expect(snapshot.sourcePermissions.every((p) => p.atlasInheritance === "NONE")).toBe(true);
    expect(
      snapshot.sourcePermissions.some((p) => p.sourceAuthority === "WRITE_SOURCE"),
    ).toBe(true);
  });

  it("blocks promotion of every source agent and does not add them to Fabric IDs", () => {
    for (const agent of snapshot.sourceAgents) {
      expect(agent.atlasPromotionBlocked).toBe(true);
      expect(FABRIC_AGENT_IDS).not.toContain(agent.sourceKey);
    }
  });

  it("maps capabilities and records dedup/conflicts before any ingest", () => {
    expect(snapshot.capabilities.length).toBeGreaterThan(0);
    expect(snapshot.dedupRelations.length).toBeGreaterThan(0);
    expect(snapshot.conflicts.length).toBeGreaterThan(0);
    expect(snapshot.canonicalCapabilities.filter((c) => c.kind === "FABRIC_RUNTIME")).toHaveLength(
      FABRIC_AGENT_IDS.length,
    );
    expect(noKnowledgeIngested(snapshot)).toBe(true);
    expect(noFabricCatalogMutation(snapshot)).toBe(true);
  });

  it("extracts semantic capability fields per Phase 3 (domain, tools, sideEffects, etc.)", () => {
    for (const cap of snapshot.capabilities) {
      expect(cap.domain.length).toBeGreaterThan(0);
      expect(cap.purpose.length).toBeGreaterThan(0);
      expect(Array.isArray(cap.tools)).toBe(true);
      expect(Array.isArray(cap.sideEffects)).toBe(true);
      expect(Array.isArray(cap.externalCommunication)).toBe(true);
      expect(typeof cap.externalAuthority).toBe("boolean");
      expect(Array.isArray(cap.dependencies)).toBe(true);
    }
  });

  it("distinguishes capability domains — agent.security (physical) ≠ SECURITY (software)", () => {
    const vms = snapshot.capabilities.find((c) => c.name === "facility-vms");
    const sentinel = snapshot.capabilities.find((c) => c.name === "platform-sentinel");
    expect(vms).toBeDefined();
    expect(sentinel).toBeDefined();
    expect(vms!.domain).toBe("physical-security");
    expect(sentinel!.domain).toBe("platform-security");
    expect(vms!.canonicalCapabilityId).toBeNull();
    expect(sentinel!.canonicalCapabilityId).not.toBeNull();
    expect(vms!.externalAuthority).toBe(true);
    expect(sentinel!.externalAuthority).toBe(false);
  });

  it("captures side effects and external communication accurately", () => {
    const chatTools = snapshot.capabilities.find((c) => c.name === "resident-chat-tools");
    expect(chatTools).toBeDefined();
    expect(chatTools!.sideEffects).toContain("STATE_MUTATION");
    expect(chatTools!.sideEffects).toContain("DB_WRITE");
    expect(chatTools!.externalCommunication).toEqual([]);
    const preview = snapshot.capabilities.find((c) => c.name === "preview-not-send");
    expect(preview).toBeDefined();
    expect(preview!.sideEffects).toEqual([]);
    expect(preview!.externalCommunication).toEqual([]);
  });

  it("records tools and dependencies for each capability", () => {
    const invoiceDraft = snapshot.capabilities.find((c) => c.name === "invoice-draft-no-invent");
    expect(invoiceDraft).toBeDefined();
    expect(invoiceDraft!.tools).toContain("getDeal");
    expect(invoiceDraft!.tools).toContain("formatInvoice");
    expect(invoiceDraft!.dependencies).toContain("deals-store");
  });

  it("keeps seed governance decisions PROPOSED and non-executing", () => {
    expect(snapshot.governanceDecisions.every((d) => d.status === "PROPOSED")).toBe(true);
    expect(snapshot.governanceDecisions.every((d) => d.fabricCatalogMutated === false)).toBe(true);
    expect(snapshot.governanceDecisions.every((d) => d.knowledgeIngested === false)).toBe(true);
    expect(
      snapshot.governanceDecisions.some((d) => d.action === "CREATE_NEW_ATLAS_SPECIALIST"),
    ).toBe(false);
  });
});

describe("portfolio governance decisions (Phase 11.4)", () => {
  it("CREATE_NEW and ADAPT require a separate catalog change", () => {
    expect(requiresOwnerAndCatalogChange("CREATE_NEW_ATLAS_SPECIALIST")).toBe(true);
    expect(requiresOwnerAndCatalogChange("ADAPT_INTO_EXISTING_ATLAS_CAPABILITY")).toBe(true);
    expect(requiresOwnerAndCatalogChange("ADAPT_INTO_EXISTING")).toBe(true);
    expect(requiresOwnerAndCatalogChange("KEEP_SOURCE_SPECIFIC")).toBe(false);
    expect(requiresOwnerAndCatalogChange("IMPORT_KNOWLEDGE_ONLY")).toBe(false);
  });

  it("approving CREATE_NEW stays pending fabric change and never mutates the catalog", () => {
    const snapshot = loadSeedSnapshot();
    const { decision, overlay } = applyGovernanceDecision({
      snapshot,
      overlay: emptyOverlay(),
      action: "CREATE_NEW_ATLAS_SPECIALIST",
      verdict: "APPROVED",
      rationale: "Owner recorded intent only — catalog code change is separate",
      actorId: "owner-1",
      sourceAgentId: snapshot.sourceAgents[0]?.id,
    });
    expect(decision.status).toBe("APPROVED_PENDING_FABRIC_CHANGE");
    expect(decision.fabricCatalogMutated).toBe(false);
    expect(decision.knowledgeIngested).toBe(false);
    expect(FABRIC_AGENT_IDS).toHaveLength(16);
    expect(overlay.auditEvents[0]?.payload["ingestExecuted"]).toBe(false);
  });

  it("approving IMPORT_KNOWLEDGE_ONLY records intent without ingesting", () => {
    const snapshot = loadSeedSnapshot();
    const acc = snapshot.sourceAgents.find((a) => a.sourceKey === "ACCOUNTING_AGENT");
    const { decision } = applyGovernanceDecision({
      snapshot,
      overlay: emptyOverlay(),
      action: "IMPORT_KNOWLEDGE_ONLY",
      verdict: "APPROVED",
      rationale: "Portable do-not-invent rule — ingest not enabled this phase",
      actorId: "owner-1",
      sourceAgentId: acc?.id,
    });
    expect(decision.status).toBe("APPROVED");
    expect(decision.knowledgeIngested).toBe(false);
  });

  it("denied decisions stay auditable and do not ingest or mutate fabric", () => {
    const snapshot = loadSeedSnapshot();
    const { decision } = applyGovernanceDecision({
      snapshot,
      overlay: emptyOverlay(),
      action: "DO_NOT_IMPORT",
      verdict: "DENIED",
      rationale: "Owner rejected this framing — keep observing",
      actorId: "owner-1",
    });
    expect(decision.status).toBe("DENIED");
    expect(decision.fabricCatalogMutated).toBe(false);
    expect(decision.knowledgeIngested).toBe(false);
  });

  it("merges overlay decisions onto the immutable seed", () => {
    const seed = loadSeedSnapshot();
    const { overlay, decision } = applyGovernanceDecision({
      snapshot: seed,
      overlay: emptyOverlay(),
      action: "KEEP_SOURCE_SPECIFIC",
      verdict: "APPROVED",
      rationale: "Keep BrokerOS specialists in BrokerOS",
      actorId: "owner-1",
    });
    const merged = mergePortfolioSnapshot(seed, overlay);
    expect(merged.governanceDecisions.some((d) => d.id === decision.id)).toBe(true);
    expect(merged.sourceAgents).toHaveLength(seed.sourceAgents.length);
    expect(buildPortfolioSummary(merged).ingestEnabled).toBe(false);
    expect(buildPortfolioSummary(merged).executionRegistry).toBe("FABRIC_AGENT_CATALOG");
  });
});
