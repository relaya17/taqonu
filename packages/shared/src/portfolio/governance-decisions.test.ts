/**
 * Phase 11.8 — Governance Decisions Tests
 *
 * Verify that:
 * 1. All decisions remain PROPOSED until explicit Owner approval
 * 2. No automatic approval, merge, or promotion
 * 3. No Fabric modification
 * 4. No knowledge ingestion
 * 5. Owner-only decision authority
 */
import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS, FABRIC_AGENT_CATALOG } from "../constants/agents.js";
import {
  GOVERNANCE_DECISION_ACTIONS,
  GOVERNANCE_DECISION_STATUSES,
  requiresOwnerAndCatalogChange,
  isSourceToAtlasPromotionAction,
} from "../constants/portfolio-governance.js";
import { loadSeedSnapshot } from "./index.js";

describe("Phase 11.8 — Governance Decisions", () => {
  const snapshot = loadSeedSnapshot();

  describe("decision coverage", () => {
    it("has governance decisions for all mapped capabilities", () => {
      const mappedCaps = snapshot.capabilities.filter((c) => c.canonicalCapabilityId !== null);
      const capIdsWithDecisions = new Set(
        snapshot.governanceDecisions.filter((d) => d.capabilityId !== null).map((d) => d.capabilityId),
      );
      const missingDecisions = mappedCaps.filter((c) => !capIdsWithDecisions.has(c.id));
      expect(missingDecisions.length).toBe(0);
    });

    it("has correct number of governance decisions", () => {
      expect(snapshot.governanceDecisions.length).toBe(21);
    });

    it("covers all SOURCE applications", () => {
      const appIds = new Set(snapshot.governanceDecisions.map((d) => d.applicationId).filter(Boolean));
      const sourceApps = snapshot.applications.filter((a) => a.role === "SOURCE");
      for (const app of sourceApps) {
        expect(appIds.has(app.id)).toBe(true);
      }
    });

    it("atlas (TARGET) does not need governance decisions", () => {
      const atlasApp = snapshot.applications.find((a) => a.slug === "atlas");
      expect(atlasApp?.role).toBe("TARGET");
      const atlasDecisions = snapshot.governanceDecisions.filter((d) => d.applicationId === atlasApp?.id);
      expect(atlasDecisions.length).toBe(0);
    });
  });

  describe("no automatic approval", () => {
    it("all decisions are PROPOSED status", () => {
      for (const decision of snapshot.governanceDecisions) {
        expect(decision.status).toBe("PROPOSED");
      }
    });

    it("no decision has decidedBy set", () => {
      for (const decision of snapshot.governanceDecisions) {
        expect(decision.decidedBy).toBeNull();
      }
    });

    it("no decision has decidedAt set", () => {
      for (const decision of snapshot.governanceDecisions) {
        expect(decision.decidedAt).toBeNull();
      }
    });

    it("APPROVED status requires Owner approval", () => {
      const approvedDecisions = snapshot.governanceDecisions.filter((d) => d.status === "APPROVED");
      expect(approvedDecisions.length).toBe(0);
    });
  });

  describe("no Fabric modification", () => {
    it("all decisions have fabricCatalogMutated: false", () => {
      for (const decision of snapshot.governanceDecisions) {
        expect(decision.fabricCatalogMutated).toBe(false);
      }
    });

    it("FABRIC_AGENT_IDS remains unchanged at 16", () => {
      expect(FABRIC_AGENT_IDS.length).toBe(16);
    });

    it("FABRIC_AGENT_CATALOG remains unchanged", () => {
      expect(Object.keys(FABRIC_AGENT_CATALOG).length).toBe(16);
    });

    it("no source agent appears in FABRIC_AGENT_IDS", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(FABRIC_AGENT_IDS).not.toContain(agent.sourceKey);
      }
    });
  });

  describe("no knowledge ingestion", () => {
    it("all decisions have knowledgeIngested: false", () => {
      for (const decision of snapshot.governanceDecisions) {
        expect(decision.knowledgeIngested).toBe(false);
      }
    });

    it("safety locks prevent ingestion", () => {
      expect(snapshot.safety.ingestEnabled).toBe(false);
    });
  });

  describe("decision actions", () => {
    it("all actions are valid", () => {
      const validActions = new Set(GOVERNANCE_DECISION_ACTIONS);
      for (const decision of snapshot.governanceDecisions) {
        expect(validActions.has(decision.action)).toBe(true);
      }
    });

    it("promotion actions correctly require Owner + Catalog change", () => {
      expect(requiresOwnerAndCatalogChange("CREATE_NEW_ATLAS_SPECIALIST")).toBe(true);
      expect(requiresOwnerAndCatalogChange("ADAPT_INTO_EXISTING_ATLAS_CAPABILITY")).toBe(true);
      expect(requiresOwnerAndCatalogChange("ADAPT_INTO_EXISTING")).toBe(true);
      expect(requiresOwnerAndCatalogChange("KEEP_SOURCE_SPECIFIC")).toBe(false);
      expect(requiresOwnerAndCatalogChange("IMPORT_KNOWLEDGE_ONLY")).toBe(false);
      expect(requiresOwnerAndCatalogChange("ADD_PROVENANCE")).toBe(false);
    });

    it("no promotion actions are APPROVED", () => {
      const promotionDecisions = snapshot.governanceDecisions.filter((d) =>
        isSourceToAtlasPromotionAction(d.action),
      );
      for (const decision of promotionDecisions) {
        expect(decision.status).not.toBe("APPROVED");
      }
    });

    it("ESCALATE action used for CONFLICTING relations", () => {
      const escalated = snapshot.governanceDecisions.filter((d) => d.action === "ESCALATE");
      expect(escalated.length).toBeGreaterThan(0);
      for (const decision of escalated) {
        expect(decision.rationale).toContain("CONFLICTING");
      }
    });
  });

  describe("decision rationales", () => {
    it("all decisions have rationale", () => {
      for (const decision of snapshot.governanceDecisions) {
        expect(decision.rationale.length).toBeGreaterThan(10);
      }
    });

    it("Phase 11.8 decisions require Owner approval", () => {
      const phase118Decisions = snapshot.governanceDecisions.filter((d) =>
        d.rationale.includes("Requires Owner approval"),
      );
      expect(phase118Decisions.length).toBeGreaterThan(10);
    });
  });

  describe("decision by action type", () => {
    it("has KEEP_SOURCE_SPECIFIC decisions", () => {
      const keep = snapshot.governanceDecisions.filter((d) => d.action === "KEEP_SOURCE_SPECIFIC");
      expect(keep.length).toBe(4);
    });

    it("has ADD_PROVENANCE decisions", () => {
      const addProv = snapshot.governanceDecisions.filter((d) => d.action === "ADD_PROVENANCE");
      expect(addProv.length).toBe(10);
    });

    it("has IMPORT_KNOWLEDGE_ONLY decisions", () => {
      const importKnowledge = snapshot.governanceDecisions.filter(
        (d) => d.action === "IMPORT_KNOWLEDGE_ONLY",
      );
      expect(importKnowledge.length).toBe(4);
    });

    it("has DO_NOT_IMPORT decisions", () => {
      const doNotImport = snapshot.governanceDecisions.filter((d) => d.action === "DO_NOT_IMPORT");
      expect(doNotImport.length).toBe(2);
    });

    it("has ESCALATE decisions", () => {
      const escalate = snapshot.governanceDecisions.filter((d) => d.action === "ESCALATE");
      expect(escalate.length).toBe(1);
    });

    it("has no CREATE_NEW_ATLAS_SPECIALIST decisions", () => {
      const create = snapshot.governanceDecisions.filter(
        (d) => d.action === "CREATE_NEW_ATLAS_SPECIALIST",
      );
      expect(create.length).toBe(0);
    });
  });

  describe("source agent protection", () => {
    it("all source agents remain blocked from promotion", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(agent.atlasPromotionBlocked).toBe(true);
      }
    });

    it("source agents cannot be promoted through governance decisions alone", () => {
      const anyApproved = snapshot.governanceDecisions.some(
        (d) => d.status === "APPROVED" && isSourceToAtlasPromotionAction(d.action),
      );
      expect(anyApproved).toBe(false);
    });
  });

  describe("capability-decision linkage", () => {
    it("capability decisions reference valid capabilities", () => {
      const capIds = new Set(snapshot.capabilities.map((c) => c.id));
      for (const decision of snapshot.governanceDecisions) {
        if (decision.capabilityId) {
          expect(capIds.has(decision.capabilityId)).toBe(true);
        }
      }
    });

    it("ORCHESTRATOR capability decisions use ADD_PROVENANCE", () => {
      const orchCanon = snapshot.canonicalCapabilities.find((c) => c.key === "ORCHESTRATOR");
      const orchCaps = snapshot.capabilities.filter(
        (c) => c.canonicalCapabilityId === orchCanon?.id,
      );
      for (const cap of orchCaps) {
        const decision = snapshot.governanceDecisions.find((d) => d.capabilityId === cap.id);
        expect(decision?.action).toBe("ADD_PROVENANCE");
      }
    });

    it("KNOWLEDGE_ONLY canonical mappings use IMPORT_KNOWLEDGE_ONLY", () => {
      const knowledgeCanons = snapshot.canonicalCapabilities.filter(
        (c) => c.kind === "KNOWLEDGE_ONLY",
      );
      const knowledgeCanonIds = new Set(knowledgeCanons.map((c) => c.id));
      const knowledgeCaps = snapshot.capabilities.filter(
        (c) => c.canonicalCapabilityId && knowledgeCanonIds.has(c.canonicalCapabilityId),
      );
      for (const cap of knowledgeCaps) {
        const decision = snapshot.governanceDecisions.find((d) => d.capabilityId === cap.id);
        expect(decision?.action).toBe("IMPORT_KNOWLEDGE_ONLY");
      }
    });
  });

  describe("audit trail", () => {
    it("has audit event for seed loading", () => {
      const seedEvent = snapshot.auditEvents.find((e) => e.type === "portfolio.seed.loaded");
      expect(seedEvent).toBeDefined();
    });

    it("audit events record no mutations", () => {
      for (const event of snapshot.auditEvents) {
        if (event.payload && typeof event.payload === "object") {
          const payload = event.payload as Record<string, unknown>;
          if ("fabricCatalogMutated" in payload) {
            expect(payload.fabricCatalogMutated).toBe(false);
          }
          if ("knowledgeIngested" in payload) {
            expect(payload.knowledgeIngested).toBe(false);
          }
        }
      }
    });
  });

  describe("decision statuses", () => {
    it("only PROPOSED status is present", () => {
      const statuses = new Set(snapshot.governanceDecisions.map((d) => d.status));
      expect(statuses.size).toBe(1);
      expect(statuses.has("PROPOSED")).toBe(true);
    });

    it("APPROVED_PENDING_FABRIC_CHANGE not used without approval", () => {
      const pending = snapshot.governanceDecisions.filter(
        (d) => d.status === "APPROVED_PENDING_FABRIC_CHANGE",
      );
      expect(pending.length).toBe(0);
    });
  });
});
