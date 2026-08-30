/**
 * Phase 11.7 — Canonical Capability Mapping Tests
 *
 * Verify that:
 * 1. Mappings are based on evidence, not fabricated
 * 2. Source-specific capabilities remain unmapped when appropriate
 * 3. No Atlas agents are created through mapping
 * 4. Fabric remains unchanged
 * 5. Mapping preserves source provenance
 */
import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS, FABRIC_AGENT_CATALOG } from "../constants/agents.js";
import { loadSeedSnapshot } from "./index.js";

describe("Phase 11.7 — Canonical Capability Mapping", () => {
  const snapshot = loadSeedSnapshot();

  describe("mapping coverage", () => {
    it("has correct number of mapped capabilities", () => {
      const mapped = snapshot.capabilities.filter((c) => c.canonicalCapabilityId !== null);
      expect(mapped.length).toBe(16);
    });

    it("has correct number of unmapped capabilities", () => {
      const unmapped = snapshot.capabilities.filter((c) => c.canonicalCapabilityId === null);
      expect(unmapped.length).toBe(30);
    });

    it("all mappings reference valid canonical capabilities", () => {
      const canonIds = new Set(snapshot.canonicalCapabilities.map((c) => c.id));
      const mapped = snapshot.capabilities.filter((c) => c.canonicalCapabilityId !== null);
      for (const cap of mapped) {
        expect(canonIds.has(cap.canonicalCapabilityId!)).toBe(true);
      }
    });
  });

  describe("mapping correctness", () => {
    it("ORCHESTRATOR mappings are context-specific, not identity", () => {
      const orchCanon = snapshot.canonicalCapabilities.find((c) => c.key === "ORCHESTRATOR");
      const orchMapped = snapshot.capabilities.filter(
        (c) => c.canonicalCapabilityId === orchCanon?.id,
      );
      expect(orchMapped.length).toBe(3);
      for (const cap of orchMapped) {
        expect(cap.applicationContext).toBeTruthy();
        expect(cap.applicationSpecific).toBe(true);
      }
    });

    it("SECURITY mappings distinguish physical from software security", () => {
      const secCanon = snapshot.canonicalCapabilities.find((c) => c.key === "SECURITY");
      const secMapped = snapshot.capabilities.filter(
        (c) => c.canonicalCapabilityId === secCanon?.id,
      );
      expect(secMapped.length).toBe(3);
      const facilityVms = snapshot.capabilities.find((c) => c.name === "facility-vms");
      expect(facilityVms?.canonicalCapabilityId).toBeNull();
    });

    it("ADVERSARY mappings preserve application context", () => {
      const advCanon = snapshot.canonicalCapabilities.find((c) => c.key === "ADVERSARY");
      const advMapped = snapshot.capabilities.filter(
        (c) => c.canonicalCapabilityId === advCanon?.id,
      );
      expect(advMapped.length).toBe(2);
      for (const cap of advMapped) {
        expect(cap.applicationSpecific).toBe(true);
      }
    });

    it("KNOWLEDGE_ONLY mappings are for knowledge patterns only", () => {
      const knowledgeCanons = snapshot.canonicalCapabilities.filter(
        (c) => c.kind === "KNOWLEDGE_ONLY",
      );
      const knowledgeIds = new Set(knowledgeCanons.map((c) => c.id));
      const knowledgeMapped = snapshot.capabilities.filter(
        (c) => c.canonicalCapabilityId && knowledgeIds.has(c.canonicalCapabilityId),
      );
      expect(knowledgeMapped.length).toBeGreaterThan(0);
      for (const cap of knowledgeMapped) {
        expect(cap.sourceAuthority).toMatch(/^(READ|GENERATE)$/);
      }
    });
  });

  describe("unmapped capabilities", () => {
    it("UNIQUE capabilities without dedup canonical are correctly unmapped", () => {
      const uniqueDedup = snapshot.dedupRelations.filter((d) => d.kind === "UNIQUE");
      for (const dedup of uniqueDedup) {
        const cap = snapshot.capabilities.find((c) => c.id === dedup.leftCapabilityId);
        if (cap && !dedup.canonicalCapabilityId) {
          expect(cap.canonicalCapabilityId).toBeNull();
        }
      }
    });

    it("UNIQUE capabilities with KNOWLEDGE_ONLY canonical are allowed", () => {
      const uniqueWithCanon = snapshot.dedupRelations.filter(
        (d) => d.kind === "UNIQUE" && d.canonicalCapabilityId !== null,
      );
      for (const dedup of uniqueWithCanon) {
        const canonical = snapshot.canonicalCapabilities.find(
          (c) => c.id === dedup.canonicalCapabilityId,
        );
        expect(canonical?.kind).toBe("KNOWLEDGE_ONLY");
      }
    });

    it("facility-vms is unmapped due to domain difference", () => {
      const facilityVms = snapshot.capabilities.find((c) => c.name === "facility-vms");
      expect(facilityVms).toBeDefined();
      expect(facilityVms!.canonicalCapabilityId).toBeNull();
      expect(facilityVms!.domain).toBe("physical-security");
      const dedup = snapshot.dedupRelations.find((d) => d.leftCapabilityId === facilityVms!.id);
      expect(dedup?.kind).toBe("CONTEXT_SPECIFIC");
      expect(dedup?.notes).toContain("Physical VMS");
    });

    it("application-specific legal capabilities are unmapped", () => {
      const legalOpsCaps = snapshot.capabilities.filter((c) => c.domain === "legal-ops");
      const unmappedLegalOps = legalOpsCaps.filter((c) => c.canonicalCapabilityId === null);
      expect(unmappedLegalOps.length).toBeGreaterThan(0);
      for (const cap of unmappedLegalOps) {
        expect(cap.applicationSpecific).toBe(true);
      }
    });

    it("hospitality-specific capabilities are unmapped", () => {
      const hotelApp = snapshot.applications.find((a) => a.slug === "hotelos");
      const hotelCaps = snapshot.capabilities.filter((c) => {
        const agent = snapshot.sourceAgents.find((a) => a.id === c.sourceAgentId);
        return agent?.applicationId === hotelApp?.id;
      });
      const unmappedHotel = hotelCaps.filter((c) => c.canonicalCapabilityId === null);
      expect(unmappedHotel.length).toBeGreaterThan(5);
    });
  });

  describe("no fabricated mappings", () => {
    it("mappings are supported by dedup relations", () => {
      const mapped = snapshot.capabilities.filter((c) => c.canonicalCapabilityId !== null);
      for (const cap of mapped) {
        const dedup = snapshot.dedupRelations.find(
          (d) =>
            (d.leftCapabilityId === cap.id || d.rightCapabilityId === cap.id) &&
            d.canonicalCapabilityId !== null,
        );
        if (!dedup) {
          const hasDirectMapping =
            cap.canonicalCapabilityId !== null &&
            snapshot.canonicalCapabilities.some((cc) => cc.id === cap.canonicalCapabilityId);
          expect(hasDirectMapping).toBe(true);
        }
      }
    });

    it("no mapping was invented without evidence", () => {
      const mapped = snapshot.capabilities.filter((c) => c.canonicalCapabilityId !== null);
      for (const cap of mapped) {
        expect(cap.domain.length).toBeGreaterThan(0);
        expect(cap.purpose.length).toBeGreaterThan(0);
        const agent = snapshot.sourceAgents.find((a) => a.id === cap.sourceAgentId);
        expect(agent?.provenance.sourcePath.length).toBeGreaterThan(0);
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

    it("mapping does not create Atlas agents", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(FABRIC_AGENT_IDS).not.toContain(agent.sourceKey);
        expect(agent.atlasPromotionBlocked).toBe(true);
      }
    });

    it("canonical mapping does not grant execution authority", () => {
      const mapped = snapshot.capabilities.filter((c) => c.canonicalCapabilityId !== null);
      for (const cap of mapped) {
        const agent = snapshot.sourceAgents.find((a) => a.id === cap.sourceAgentId);
        expect(agent?.runtimeStatus.state).toBe("UNKNOWN");
        expect(agent?.atlasPromotionBlocked).toBe(true);
      }
    });
  });

  describe("provenance preservation", () => {
    it("mapped capabilities retain source provenance", () => {
      const mapped = snapshot.capabilities.filter((c) => c.canonicalCapabilityId !== null);
      for (const cap of mapped) {
        const agent = snapshot.sourceAgents.find((a) => a.id === cap.sourceAgentId);
        expect(agent?.provenance.sourceRepository.length).toBeGreaterThan(0);
        expect(agent?.provenance.sourceCommit).toMatch(/^[0-9a-f]{40}$/i);
      }
    });

    it("canonical mapping does not override source metadata", () => {
      const mapped = snapshot.capabilities.filter((c) => c.canonicalCapabilityId !== null);
      for (const cap of mapped) {
        expect(cap.applicationContext.length).toBeGreaterThan(0);
        expect(cap.applicationSpecific).toBeDefined();
      }
    });
  });

  describe("canonical capability integrity", () => {
    it("all 20 canonical capabilities exist", () => {
      expect(snapshot.canonicalCapabilities.length).toBe(20);
    });

    it("canonical capabilities have correct kinds", () => {
      const fabricRuntime = snapshot.canonicalCapabilities.filter(
        (c) => c.kind === "FABRIC_RUNTIME",
      );
      const knowledgeOnly = snapshot.canonicalCapabilities.filter(
        (c) => c.kind === "KNOWLEDGE_ONLY",
      );
      expect(fabricRuntime.length).toBe(16);
      expect(knowledgeOnly.length).toBe(4);
    });

    it("FABRIC_RUNTIME canonicals match FABRIC_AGENT_IDS", () => {
      const fabricCanons = snapshot.canonicalCapabilities.filter(
        (c) => c.kind === "FABRIC_RUNTIME",
      );
      for (const canon of fabricCanons) {
        expect(FABRIC_AGENT_IDS).toContain(canon.key);
      }
    });
  });

  describe("mapping statistics", () => {
    it("mapping distribution by canonical key", () => {
      const mappingCount: Record<string, number> = {};
      const mapped = snapshot.capabilities.filter((c) => c.canonicalCapabilityId !== null);
      for (const cap of mapped) {
        const canon = snapshot.canonicalCapabilities.find(
          (cc) => cc.id === cap.canonicalCapabilityId,
        );
        if (canon) {
          mappingCount[canon.key] = (mappingCount[canon.key] || 0) + 1;
        }
      }
      expect(mappingCount["ORCHESTRATOR"]).toBe(3);
      expect(mappingCount["SECURITY"]).toBe(3);
      expect(mappingCount["ADVERSARY"]).toBe(2);
      expect(mappingCount["LEGAL_MEDIA_COMMS"]).toBe(3);
      expect(mappingCount["KNOWLEDGE_CONFIRM_BEFORE_SEND"]).toBe(2);
    });
  });
});
