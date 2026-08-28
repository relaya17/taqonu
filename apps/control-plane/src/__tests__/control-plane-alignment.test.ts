import { describe, expect, it, beforeEach } from "vitest";
import {
  FABRIC_AGENT_IDS,
  FABRIC_AGENT_CATALOG,
  loadSeedSnapshot,
  buildPortfolioSummary,
} from "@atlas/shared";
import { listRegisteredAgents } from "../services/agent-registry.js";
import { getFabricProjection } from "../services/fabric-projection.js";
import { getControlPlanePortfolioView } from "../services/portfolio-governance-view.js";
import { resetAgentRuntimeForTests } from "../services/agent-registry.js";

/**
 * Phase 11.10 — Control Plane Alignment Verification
 *
 * These tests verify that Portfolio Governance is correctly represented
 * inside the Control Plane without changing execution authority.
 */
describe("Control Plane alignment (Phase 11.10)", () => {
  beforeEach(() => {
    resetAgentRuntimeForTests();
  });

  describe("Portfolio data through Control Plane contracts", () => {
    it("1. Portfolio data is available through the correct Control Plane contracts", () => {
      const view = getControlPlanePortfolioView();
      expect(view.snapshot).toBeDefined();
      expect(view.summary).toBeDefined();
      expect(view.writeAuthority).toBe("ATLAS_API");
      expect(view.executionRegistry).toBe("FABRIC_AGENT_CATALOG");
      expect(view.notAnAgentRegistry).toBe(true);
      expect(view.observational).toBe(true);
    });

    it("2. Applications and SourceAgents remain source entities", () => {
      const view = getControlPlanePortfolioView();
      for (const app of view.snapshot.applications) {
        expect(app.role).toMatch(/^(SOURCE|TARGET)$/);
      }
      for (const agent of view.snapshot.sourceAgents) {
        expect(agent.atlasPromotionBlocked).toBe(true);
        expect(FABRIC_AGENT_IDS.includes(agent.sourceKey as never)).toBe(false);
      }
    });

    it("3. Capabilities remain observational/governance data", () => {
      const view = getControlPlanePortfolioView();
      for (const cap of view.snapshot.capabilities) {
        expect(cap.id).toBeDefined();
        expect(cap.sourceAgentId).toBeDefined();
        expect(cap.domain).toBeDefined();
        expect(cap.purpose).toBeDefined();
      }
      expect(view.summary.fabricCatalogMutated).toBe(false);
    });

    it("4. Canonical mappings remain non-executable", () => {
      const view = getControlPlanePortfolioView();
      for (const canon of view.snapshot.canonicalCapabilities) {
        expect(canon.id).toBeDefined();
        expect(canon.kind).toMatch(/^(FABRIC_RUNTIME|KNOWLEDGE_ONLY)$/);
      }
      for (const ref of view.snapshot.fabricAgentRefs) {
        expect(ref.executableViaPortfolioGovernance).toBe(false);
        expect(ref.isExecutionRegistry).toBe(false);
      }
      expect(view.summary.fabricRefsAreNotAnExecutionRegistry).toBe(true);
    });

    it("5. Governance decisions remain PROPOSED unless explicitly approved", () => {
      const view = getControlPlanePortfolioView();
      for (const decision of view.snapshot.governanceDecisions) {
        expect(["PROPOSED", "APPROVED", "APPROVED_PENDING_FABRIC_CHANGE", "DENIED"]).toContain(
          decision.status,
        );
        expect(decision.fabricCatalogMutated).toBe(false);
        expect(decision.knowledgeIngested).toBe(false);
      }
    });
  });

  describe("Fabric isolation", () => {
    it("6. Fabric remains isolated", () => {
      const projection = getFabricProjection();
      expect(projection.executionAuthority).toBe("FABRIC_AGENT_CATALOG");
      expect(projection.notAnExecutionRegistry).toBe(true);
    });

    it("7. Existing 16 Fabric Agent IDs remain unchanged", () => {
      expect(FABRIC_AGENT_IDS).toHaveLength(16);
      const projection = getFabricProjection();
      expect(projection.items).toHaveLength(16);
      expect(projection.items.map((i) => i.agentId)).toEqual([...FABRIC_AGENT_IDS]);
    });

    it("8. Portfolio data cannot mutate the Fabric registry", () => {
      const view = getControlPlanePortfolioView();
      expect(view.summary.fabricCatalogMutated).toBe(false);
      expect(view.executionRegistry).toBe("FABRIC_AGENT_CATALOG");
      expect(view.notAnAgentRegistry).toBe(true);
    });

    it("9. Portfolio data cannot create Atlas agents", () => {
      const legacy = listRegisteredAgents();
      expect(legacy).toHaveLength(9);
      const projection = getFabricProjection();
      expect(projection.items).toHaveLength(16);
      for (const item of projection.items) {
        expect(item.executionEnabledByThisProjection).toBe(false);
        expect(item.catalogStatus).toBe("LAB");
      }
    });
  });

  describe("Permission and runtime isolation", () => {
    it("10. Source permissions cannot become Atlas execution permissions", () => {
      const view = getControlPlanePortfolioView();
      expect(view.summary.sourceWriteNeverInherited).toBe(true);
      expect(view.summary.atlasPermissionsNeverFromSource).toBe(true);
      for (const perm of view.snapshot.sourcePermissions) {
        expect(perm.atlasInheritance).toBe("NONE");
      }
      for (const atlasPerm of view.snapshot.atlasPermissions) {
        expect(atlasPerm.inheritedFromSourceAgentId).toBeNull();
        expect(atlasPerm.source).toBe("FABRIC_CATALOG");
      }
    });

    it("11. Runtime remains UNKNOWN / NOT_PROBED", () => {
      const view = getControlPlanePortfolioView();
      expect(view.summary.allSourceRuntimesUnknown).toBe(true);
      expect(view.summary.sourceRuntimeDefault).toBe("UNKNOWN");
      for (const agent of view.snapshot.sourceAgents) {
        expect(["UNKNOWN", "NOT_PROBED"]).toContain(agent.runtimeStatus.state);
        expect(agent.runtimeStatus.probeKind).toBe("NONE");
        expect(agent.runtimeStatus.probedAt).toBeNull();
      }
    });

    it("12. Knowledge ingestion is Owner-controlled", () => {
      const view = getControlPlanePortfolioView();
      expect(view.summary.ingestEnabled).toBe(false); // Global ingest remains disabled
      expect(view.summary.knowledgeIngested).toBe(true); // Phase 11.15: 4 Owner-approved records
      expect(view.summary.ingestedKnowledgeCount).toBe(4);
    });
  });

  describe("UI and language contracts", () => {
    it("13. Control Plane Portfolio view has required summary fields", () => {
      const view = getControlPlanePortfolioView();
      expect(view.summary.applicationCount).toBeGreaterThan(0);
      expect(view.summary.sourceAgentCount).toBeGreaterThan(0);
      expect(view.summary.capabilityCount).toBeGreaterThan(0);
      expect(view.summary.proposedDecisionCount).toBeGreaterThanOrEqual(0);
      expect(view.summary.conflictCount).toBeGreaterThanOrEqual(0);
      expect(view.summary.dedupRelationCount).toBeGreaterThan(0);
    });

    it("14. Seed snapshot verifies architectural invariants", () => {
      const seed = loadSeedSnapshot();
      const summary = buildPortfolioSummary(seed);
      expect(summary.controlPlaneAgentDefinitionsAreNotExecution).toBe(true);
      expect(summary.executionRegistry).toBe("FABRIC_AGENT_CATALOG");
      expect(summary.verificationDistinctFromRuntime).toBe(true);
    });

    it("15. No structural breaking changes from Phase 11.9", () => {
      const view = getControlPlanePortfolioView();
      expect(view.snapshot.applications.length).toBe(6);
      expect(view.snapshot.sourceAgents.length).toBe(52);
      expect(view.snapshot.capabilities.length).toBe(44);
      expect(view.snapshot.canonicalCapabilities.length).toBe(20);
      expect(view.snapshot.dedupRelations.length).toBe(42);
      expect(view.snapshot.evidence.length).toBe(12);
      expect(view.snapshot.conflicts.length).toBe(4);
    });
  });

  describe("Safety boundaries", () => {
    it("FABRIC_AGENT_CATALOG remains immutable from Portfolio operations", () => {
      const catalogBefore = Object.keys(FABRIC_AGENT_CATALOG).sort();
      getControlPlanePortfolioView();
      const catalogAfter = Object.keys(FABRIC_AGENT_CATALOG).sort();
      expect(catalogAfter).toEqual(catalogBefore);
    });

    it("legacy Agent Registry remains separate from Portfolio projection", () => {
      const legacy = listRegisteredAgents();
      const view = getControlPlanePortfolioView();
      expect(legacy.length).toBe(9);
      expect(view.snapshot.sourceAgents.length).toBe(52);
      const legacyIds = legacy.map((a) => a.agentId);
      const sourceKeys = view.snapshot.sourceAgents.map((a) => a.sourceKey);
      for (const sourceKey of sourceKeys) {
        expect(legacyIds.includes(sourceKey)).toBe(false);
      }
    });
  });
});
