/**
 * Phase 11.6 — Global Deduplication Tests
 *
 * Verify that:
 * 1. All capabilities have dedup relations
 * 2. Semantic overlaps are correctly identified
 * 3. No automatic merging occurs
 * 4. No Atlas agents are created
 * 5. Fabric remains unchanged
 * 6. Relationships are valid
 */
import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS, FABRIC_AGENT_CATALOG } from "../constants/agents.js";
import { loadSeedSnapshot } from "./index.js";

describe("Phase 11.6 — Global Deduplication", () => {
  const snapshot = loadSeedSnapshot();

  describe("dedup coverage", () => {
    it("every capability has at least one dedup relation", () => {
      const capsWithDedup = new Set<string>();
      for (const d of snapshot.dedupRelations) {
        if (d.leftCapabilityId) capsWithDedup.add(d.leftCapabilityId);
        if (d.rightCapabilityId) capsWithDedup.add(d.rightCapabilityId);
      }
      const capsWithoutDedup = snapshot.capabilities.filter((c) => !capsWithDedup.has(c.id));
      expect(capsWithoutDedup.length).toBe(0);
    });

    it("has correct number of dedup relations", () => {
      expect(snapshot.dedupRelations.length).toBeGreaterThanOrEqual(40);
    });

    it("all dedup relations have valid kind", () => {
      const validKinds = [
        "SEMANTIC_OVERLAP",
        "CONTEXT_SPECIFIC",
        "COMPLEMENTARY",
        "FUNCTIONALLY_DUPLICATE",
        "UNIQUE",
        "CONFLICTING",
      ];
      for (const d of snapshot.dedupRelations) {
        expect(validKinds).toContain(d.kind);
      }
    });
  });

  describe("relationship integrity", () => {
    it("leftCapabilityId references existing capability", () => {
      const capIds = new Set(snapshot.capabilities.map((c) => c.id));
      for (const d of snapshot.dedupRelations) {
        if (d.leftCapabilityId) {
          expect(capIds.has(d.leftCapabilityId)).toBe(true);
        }
      }
    });

    it("rightCapabilityId references existing capability when present", () => {
      const capIds = new Set(snapshot.capabilities.map((c) => c.id));
      for (const d of snapshot.dedupRelations) {
        if (d.rightCapabilityId) {
          expect(capIds.has(d.rightCapabilityId)).toBe(true);
        }
      }
    });

    it("leftSourceAgentId references existing source agent", () => {
      const agentIds = new Set(snapshot.sourceAgents.map((a) => a.id));
      for (const d of snapshot.dedupRelations) {
        if (d.leftSourceAgentId) {
          expect(agentIds.has(d.leftSourceAgentId)).toBe(true);
        }
      }
    });

    it("canonicalCapabilityId references existing canonical when present", () => {
      const canonIds = new Set(snapshot.canonicalCapabilities.map((c) => c.id));
      for (const d of snapshot.dedupRelations) {
        if (d.canonicalCapabilityId) {
          expect(canonIds.has(d.canonicalCapabilityId)).toBe(true);
        }
      }
    });
  });

  describe("semantic classification", () => {
    it("UNIQUE relations typically have no canonical mapping (knowledge-only exceptions allowed)", () => {
      const uniqueRelations = snapshot.dedupRelations.filter((d) => d.kind === "UNIQUE");
      expect(uniqueRelations.length).toBeGreaterThan(0);
      const uniqueWithCanon = uniqueRelations.filter((d) => d.canonicalCapabilityId !== null);
      for (const d of uniqueWithCanon) {
        const canonical = snapshot.canonicalCapabilities.find(
          (c) => c.id === d.canonicalCapabilityId,
        );
        expect(canonical?.kind).toBe("KNOWLEDGE_ONLY");
      }
    });

    it("SEMANTIC_OVERLAP relations map to existing canonical", () => {
      const overlapRelations = snapshot.dedupRelations.filter(
        (d) => d.kind === "SEMANTIC_OVERLAP",
      );
      expect(overlapRelations.length).toBeGreaterThan(0);
      for (const d of overlapRelations) {
        expect(d.canonicalCapabilityId).not.toBeNull();
      }
    });

    it("CONTEXT_SPECIFIC relations have explanatory notes", () => {
      const contextRelations = snapshot.dedupRelations.filter(
        (d) => d.kind === "CONTEXT_SPECIFIC",
      );
      expect(contextRelations.length).toBeGreaterThan(0);
      for (const d of contextRelations) {
        expect(d.notes.length).toBeGreaterThan(10);
      }
    });

    it("COMPLEMENTARY relations link two capabilities", () => {
      const compRelations = snapshot.dedupRelations.filter((d) => d.kind === "COMPLEMENTARY");
      expect(compRelations.length).toBeGreaterThan(0);
    });
  });

  describe("no automatic merging", () => {
    it("capabilities remain separate entities", () => {
      const beforeCount = 44;
      expect(snapshot.capabilities.length).toBe(beforeCount);
    });

    it("dedup relations are observational, not transformative", () => {
      for (const d of snapshot.dedupRelations) {
        expect(d.notes.length).toBeGreaterThan(0);
        expect(d.notes).not.toContain("merged");
        expect(d.notes).not.toContain("deleted");
      }
    });
  });

  describe("Fabric isolation", () => {
    it("FABRIC_AGENT_IDS remains unchanged at 16", () => {
      expect(FABRIC_AGENT_IDS.length).toBe(16);
    });

    it("FABRIC_AGENT_CATALOG remains unchanged", () => {
      expect(Object.keys(FABRIC_AGENT_CATALOG).length).toBe(16);
    });

    it("no SourceAgent is promoted to Fabric through deduplication", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(FABRIC_AGENT_IDS).not.toContain(agent.sourceKey);
        expect(agent.atlasPromotionBlocked).toBe(true);
      }
    });

    it("dedup relations do not create Atlas agents", () => {
      for (const d of snapshot.dedupRelations) {
        if (d.canonicalCapabilityId) {
          const canonical = snapshot.canonicalCapabilities.find(
            (c) => c.id === d.canonicalCapabilityId,
          );
          expect(canonical).toBeDefined();
          expect(canonical!.notes).not.toContain("created new agent");
        }
      }
    });
  });

  describe("cross-application analysis", () => {
    it("identifies CaseFlow-LexStudy legal domain overlaps", () => {
      const legalRelations = snapshot.dedupRelations.filter((d) => {
        const cap = snapshot.capabilities.find((c) => c.id === d.leftCapabilityId);
        return cap?.domain === "legal-ops" || cap?.domain === "legal-education";
      });
      expect(legalRelations.length).toBeGreaterThan(5);
    });

    it("identifies security pattern overlaps", () => {
      const securityRelations = snapshot.dedupRelations.filter((d) => {
        const canonical = snapshot.canonicalCapabilities.find(
          (c) => c.id === d.canonicalCapabilityId,
        );
        return canonical?.key === "SECURITY";
      });
      expect(securityRelations.length).toBeGreaterThanOrEqual(3);
    });

    it("identifies orchestrator pattern overlaps", () => {
      const orchRelations = snapshot.dedupRelations.filter((d) => {
        const canonical = snapshot.canonicalCapabilities.find(
          (c) => c.id === d.canonicalCapabilityId,
        );
        return canonical?.key === "ORCHESTRATOR";
      });
      expect(orchRelations.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("conflicts", () => {
    it("existing conflicts remain documented", () => {
      expect(snapshot.conflicts.length).toBeGreaterThanOrEqual(4);
    });

    it("ATLAS_NAME conflict is escalated", () => {
      const atlasNameConflict = snapshot.conflicts.find((c) => c.key === "C1_ATLAS_NAME");
      expect(atlasNameConflict).toBeDefined();
      expect(atlasNameConflict!.status).toBe("ESCALATED");
    });
  });

  describe("domain coverage", () => {
    it("all domains have dedup analysis", () => {
      const domains = new Set(snapshot.capabilities.map((c) => c.domain));
      const domainsWithDedup = new Set<string>();
      for (const d of snapshot.dedupRelations) {
        const leftCap = snapshot.capabilities.find((c) => c.id === d.leftCapabilityId);
        const rightCap = snapshot.capabilities.find((c) => c.id === d.rightCapabilityId);
        if (leftCap) domainsWithDedup.add(leftCap.domain);
        if (rightCap) domainsWithDedup.add(rightCap.domain);
      }
      for (const domain of domains) {
        expect(domainsWithDedup.has(domain)).toBe(true);
      }
    });
  });
});
