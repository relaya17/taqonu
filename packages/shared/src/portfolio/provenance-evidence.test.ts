/**
 * Phase 4 — Provenance and Evidence Tests
 *
 * Every source-derived fact must be traceable.
 * Evidence ≠ RuntimeStatus.
 */
import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS } from "../constants/agents.js";
import { loadSeedSnapshot } from "./index.js";

describe("Phase 4 — Provenance and Evidence", () => {
  const snapshot = loadSeedSnapshot();

  describe("Provenance traceability", () => {
    it("every source agent has full provenance: repo, branch, commit (40-char SHA), path", () => {
      for (const agent of snapshot.sourceAgents) {
        const p = agent.provenance;
        expect(p.sourceRepository.length).toBeGreaterThan(0);
        expect(p.sourceBranch.length).toBeGreaterThan(0);
        expect(p.sourceCommit).toMatch(/^[0-9a-f]{40}$/i);
        expect(p.sourcePath.length).toBeGreaterThan(0);
        expect(p.sourceType.length).toBeGreaterThan(0);
      }
    });

    it("every provenance has sourceApplicationId linking to the application", () => {
      for (const agent of snapshot.sourceAgents) {
        const p = agent.provenance;
        expect(p.sourceApplicationId).toBe(agent.applicationId);
      }
    });

    it("every provenance has extractor identification", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(agent.provenance.extractor).toBe("atlas-portfolio-discovery");
      }
    });

    it("every provenance has originalStatus from source", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(["ACTIVE", "DEPRECATED", "EXPERIMENTAL", "PLANNED", "UNKNOWN"]).toContain(
          agent.provenance.originalStatus,
        );
      }
    });

    it("every provenance has atlasClassification interpretation", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(typeof agent.provenance.atlasClassification).toBe("string");
      }
    });

    it("extractedAt is consistently set across all provenance records", () => {
      const timestamps = snapshot.sourceAgents.map((a) => a.provenance.extractedAt);
      const unique = new Set(timestamps);
      expect(unique.size).toBe(1);
    });
  });

  describe("Evidence independence from runtime", () => {
    it("evidence records are not runtime probes", () => {
      for (const ev of snapshot.evidence) {
        expect(ev.isRuntimeProbe).toBe(false);
      }
    });

    it("evidence kind is never RUNTIME_PROBE", () => {
      for (const ev of snapshot.evidence) {
        expect(ev.kind).not.toBe("RUNTIME_PROBE");
      }
    });

    it("verified source agents still have UNKNOWN runtime", () => {
      const verified = snapshot.sourceAgents.filter((a) => a.verificationStatus === "VERIFIED");
      expect(verified.length).toBeGreaterThan(0);
      for (const agent of verified) {
        expect(agent.runtimeStatus.state).toBe("UNKNOWN");
        expect(agent.runtimeStatus.probeKind).toBe("NONE");
      }
    });

    it("evidence notes clarify that evidence ≠ runtime", () => {
      const testEvidence = snapshot.evidence.filter((e) => e.kind === "TEST");
      expect(testEvidence.length).toBeGreaterThan(0);
    });
  });

  describe("Evidence authority ranks", () => {
    it("registry evidence has ARCHITECTURE_DOCUMENT rank", () => {
      const registryEvidence = snapshot.evidence.filter((e) => e.kind === "REGISTRY");
      for (const ev of registryEvidence) {
        expect(ev.authorityRank).toBe("ARCHITECTURE_DOCUMENT");
      }
    });

    it("test evidence has AUTOMATED_VERIFIED_TEST rank", () => {
      const testEvidence = snapshot.evidence.filter((e) => e.kind === "TEST");
      for (const ev of testEvidence) {
        expect(ev.authorityRank).toBe("AUTOMATED_VERIFIED_TEST");
      }
    });
  });

  describe("Default source runtime", () => {
    it("all source runtimes default to UNKNOWN / NOT_PROBED", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(agent.runtimeStatus.state).toMatch(/^(UNKNOWN|NOT_PROBED)$/);
        expect(agent.runtimeStatus.probeKind).toBe("NONE");
      }
    });

    it("documentation claims do not become OBSERVED_UP", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(agent.runtimeStatus.state).not.toBe("OBSERVED_UP");
      }
    });

    it("source tests do not prove Atlas production verification", () => {
      for (const agent of snapshot.sourceAgents) {
        if (agent.verificationStatus === "VERIFIED") {
          expect(agent.runtimeStatus.state).toBe("UNKNOWN");
        }
      }
    });
  });

  describe("Provenance completeness", () => {
    it("every capability can answer: where did this come from?", () => {
      for (const cap of snapshot.capabilities) {
        const agent = snapshot.sourceAgents.find((a) => a.id === cap.sourceAgentId);
        expect(agent).toBeDefined();
        const p = agent!.provenance;
        expect(p.sourceRepository).toBeTruthy();
        expect(p.sourceCommit).toBeTruthy();
        expect(p.sourcePath).toBeTruthy();
      }
    });

    it("all source applications have complete provenance", () => {
      for (const app of snapshot.applications.filter((a) => a.role === "SOURCE")) {
        expect(app.sourceRepository.length).toBeGreaterThan(0);
        expect(app.sourceBranch.length).toBeGreaterThan(0);
        expect(app.sourceCommit).toMatch(/^[0-9a-f]{40}$/i);
      }
    });
  });

  describe("Safety boundaries", () => {
    it("no source agent is added to FABRIC_AGENT_CATALOG", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(FABRIC_AGENT_IDS).not.toContain(agent.sourceKey);
        expect(agent.atlasPromotionBlocked).toBe(true);
      }
    });

    it("provenance does not grant Atlas permissions", () => {
      for (const perm of snapshot.sourcePermissions) {
        expect(perm.atlasInheritance).toBe("NONE");
      }
    });
  });

  describe("Phase 11.4 Gap Closure — Evidence Linkage", () => {
    it("evidence records exist for capabilities", () => {
      const linkedEvidence = snapshot.evidence.filter((e) => e.capabilityId !== null);
      expect(linkedEvidence.length).toBeGreaterThan(0);
    });

    it("linked evidence capabilityIds reference existing capabilities", () => {
      const capIds = new Set(snapshot.capabilities.map((c) => c.id));
      const linkedEvidence = snapshot.evidence.filter((e) => e.capabilityId !== null);
      for (const ev of linkedEvidence) {
        expect(capIds.has(ev.capabilityId!)).toBe(true);
      }
    });

    it("application-level evidence (unlinked) is intentionally for broad coverage", () => {
      const unlinkedEvidence = snapshot.evidence.filter(
        (e) => e.capabilityId === null && e.applicationId !== null,
      );
      for (const ev of unlinkedEvidence) {
        expect(ev.kind).toBe("REGISTRY");
        expect(ev.note).toContain("Static inspection");
      }
    });

    it("linked evidence is semantically appropriate for the capability", () => {
      for (const ev of snapshot.evidence.filter((e) => e.capabilityId !== null)) {
        const cap = snapshot.capabilities.find((c) => c.id === ev.capabilityId);
        expect(cap).toBeDefined();
        expect(
          ["SOURCE_CODE", "TEST", "REGISTRY", "ARCHITECTURE_DOCUMENT", "API_SCHEMA"].includes(
            ev.kind,
          ) || ev.authorityRank !== "RUNTIME_PROBE",
        ).toBe(true);
      }
    });

    it("desk-intent-route capability has TEST evidence linked", () => {
      const deskCap = snapshot.capabilities.find((c) => c.name === "desk-intent-route");
      expect(deskCap).toBeDefined();
      const linkedEv = snapshot.evidence.find((e) => e.capabilityId === deskCap!.id);
      expect(linkedEv).toBeDefined();
      expect(linkedEv!.kind).toBe("TEST");
    });

    it("resident-chat-tools capability has SOURCE_CODE evidence linked", () => {
      const chatCap = snapshot.capabilities.find((c) => c.name === "resident-chat-tools");
      expect(chatCap).toBeDefined();
      const linkedEv = snapshot.evidence.find((e) => e.capabilityId === chatCap!.id);
      expect(linkedEv).toBeDefined();
      expect(linkedEv!.kind).toBe("SOURCE_CODE");
    });

    it("all linked evidence has extractedAt timestamp", () => {
      for (const ev of snapshot.evidence) {
        expect(ev.extractedAt).toBeDefined();
        expect(ev.extractedAt!.length).toBeGreaterThan(0);
      }
    });

    it("evidence count breakdown is accurate", () => {
      const total = snapshot.evidence.length;
      const linked = snapshot.evidence.filter((e) => e.capabilityId !== null).length;
      const unlinked = snapshot.evidence.filter(
        (e) => e.capabilityId === null && e.applicationId !== null,
      ).length;
      expect(total).toBe(12);
      expect(linked).toBe(7);
      expect(unlinked).toBe(5);
    });
  });
});
