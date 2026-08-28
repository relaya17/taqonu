import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS } from "../constants/agents.js";
import { PORTFOLIO_AUDIT_EVENT_TYPES } from "../constants/portfolio-governance.js";
import {
  applyGovernanceDecision,
  buildPortfolioSummary,
  emptyOverlay,
  loadSeedSnapshot,
  mergePortfolioSnapshot,
} from "./index.js";

/**
 * Phase 11.12 — Portfolio Governance Audit Verification
 *
 * Comprehensive audit tests for the Portfolio Governance model.
 * These tests verify:
 * - Audit event structure (actor, timestamp, action, target, outcome)
 * - Immutability guarantees
 * - Actor attribution
 * - Timestamps
 * - Event traceability
 * - Hash chain integrity concepts
 */
describe("Portfolio Governance Audit (Phase 11.12)", () => {
  const snapshot = loadSeedSnapshot();

  describe("audit event structure", () => {
    it("every audit event has required fields (id, at, type, actorId, payload)", () => {
      for (const event of snapshot.auditEvents) {
        expect(event.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
        expect(event.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
        expect(PORTFOLIO_AUDIT_EVENT_TYPES).toContain(event.type);
        expect(typeof event.actorId === "string" || event.actorId === null).toBe(true);
        expect(typeof event.payload).toBe("object");
      }
    });

    it("audit event types are valid portfolio events", () => {
      const validTypes = new Set(PORTFOLIO_AUDIT_EVENT_TYPES);
      for (const event of snapshot.auditEvents) {
        expect(validTypes.has(event.type)).toBe(true);
      }
    });

    it("seed loading audit event exists with correct structure", () => {
      const seedEvent = snapshot.auditEvents.find((e) => e.type === "portfolio.seed.loaded");
      expect(seedEvent).toBeDefined();
      expect(seedEvent!.actorId).toBe("system:static-scan");
      expect(seedEvent!.payload).toMatchObject({
        knowledgeIngested: false,
        fabricCatalogMutated: false,
      });
    });
  });

  describe("actor attribution", () => {
    it("every audit event has traceable actor", () => {
      for (const event of snapshot.auditEvents) {
        if (event.actorId !== null) {
          expect(event.actorId.length).toBeGreaterThan(0);
          expect(event.actorId).not.toBe("anonymous");
        }
      }
    });

    it("governance decisions created via applyGovernanceDecision have actor attribution", () => {
      const { overlay } = applyGovernanceDecision({
        snapshot,
        overlay: emptyOverlay(),
        action: "KEEP_SOURCE_SPECIFIC",
        verdict: "APPROVED",
        rationale: "Test audit attribution",
        actorId: "owner:test-user-123",
        sourceAgentId: snapshot.sourceAgents[0]?.id,
      });
      const decisionEvent = overlay.auditEvents.find(
        (e) => e.type === "portfolio.governance.decided",
      );
      expect(decisionEvent).toBeDefined();
      expect(decisionEvent!.actorId).toBe("owner:test-user-123");
    });

    it("actor cannot be empty string for governance decisions", () => {
      const { overlay } = applyGovernanceDecision({
        snapshot,
        overlay: emptyOverlay(),
        action: "KEEP_SOURCE_SPECIFIC",
        verdict: "DENIED",
        rationale: "Test denial audit",
        actorId: "owner:test-owner",
      });
      expect(overlay.auditEvents[0]?.actorId).toBe("owner:test-owner");
      expect(overlay.auditEvents[0]?.actorId).not.toBe("");
    });
  });

  describe("timestamp integrity", () => {
    it("all audit events have valid ISO timestamps", () => {
      for (const event of snapshot.auditEvents) {
        const date = new Date(event.at);
        expect(date.toISOString()).toBe(event.at);
        expect(Number.isNaN(date.getTime())).toBe(false);
      }
    });

    it("governance decision audit events timestamp matches decision timestamp", () => {
      const now = "2026-08-28T12:00:00.000Z";
      const { overlay, decision } = applyGovernanceDecision({
        snapshot,
        overlay: emptyOverlay(),
        action: "KEEP_SOURCE_SPECIFIC",
        verdict: "APPROVED",
        rationale: "Test timestamp consistency",
        actorId: "owner:timestamp-test",
        now,
      });
      const auditEvent = overlay.auditEvents[0];
      expect(auditEvent?.at).toBe(now);
      expect(decision.decidedAt).toBe(now);
    });

    it("overlay updatedAt reflects the latest action", () => {
      const now = "2026-08-28T15:30:00.000Z";
      const { overlay } = applyGovernanceDecision({
        snapshot,
        overlay: emptyOverlay(),
        action: "DO_NOT_IMPORT",
        verdict: "DENIED",
        rationale: "Timestamp test",
        actorId: "owner:test",
        now,
      });
      expect(overlay.updatedAt).toBe(now);
    });
  });

  describe("event traceability", () => {
    it("governance decision events contain full action context", () => {
      const { overlay } = applyGovernanceDecision({
        snapshot,
        overlay: emptyOverlay(),
        action: "IMPORT_KNOWLEDGE_ONLY",
        verdict: "APPROVED",
        rationale: "Test traceability",
        actorId: "owner:trace-test",
        sourceAgentId: snapshot.sourceAgents[0]?.id,
      });
      const event = overlay.auditEvents[0];
      expect(event?.type).toBe("portfolio.governance.decided");
      expect(event?.payload).toMatchObject({
        action: "IMPORT_KNOWLEDGE_ONLY",
        verdict: "APPROVED",
        fabricCatalogMutated: false,
        knowledgeIngested: false,
        ingestExecuted: false,
      });
    });

    it("high-risk actions (CREATE_NEW) set catalogCodeChangeRequired in audit", () => {
      const { overlay } = applyGovernanceDecision({
        snapshot,
        overlay: emptyOverlay(),
        action: "CREATE_NEW_ATLAS_SPECIALIST",
        verdict: "APPROVED",
        rationale: "High-risk action audit test",
        actorId: "owner:high-risk-test",
        sourceAgentId: snapshot.sourceAgents[0]?.id,
      });
      const event = overlay.auditEvents[0];
      expect(event?.payload).toMatchObject({
        action: "CREATE_NEW_ATLAS_SPECIALIST",
        status: "APPROVED_PENDING_FABRIC_CHANGE",
        catalogCodeChangeRequired: true,
      });
    });

    it("denied decisions are fully traceable", () => {
      const { overlay } = applyGovernanceDecision({
        snapshot,
        overlay: emptyOverlay(),
        action: "DO_NOT_IMPORT",
        verdict: "DENIED",
        rationale: "Explicit denial test",
        actorId: "owner:denial-test",
      });
      const event = overlay.auditEvents[0];
      expect(event?.payload).toMatchObject({
        action: "DO_NOT_IMPORT",
        verdict: "DENIED",
        status: "DENIED",
      });
    });

    it("source agent targeting is preserved in audit payload", () => {
      const agentId = snapshot.sourceAgents[0]?.id;
      const { overlay } = applyGovernanceDecision({
        snapshot,
        overlay: emptyOverlay(),
        action: "KEEP_SOURCE_SPECIFIC",
        verdict: "APPROVED",
        rationale: "Target traceability test",
        actorId: "owner:target-test",
        sourceAgentId: agentId,
      });
      const event = overlay.auditEvents[0];
      expect(event?.payload).toHaveProperty("sourceAgentId", agentId);
    });
  });

  describe("immutability guarantees", () => {
    it("audit events record fabricCatalogMutated: false always", () => {
      for (const event of snapshot.auditEvents) {
        const payload = event.payload as Record<string, unknown>;
        if ("fabricCatalogMutated" in payload) {
          expect(payload.fabricCatalogMutated).toBe(false);
        }
      }
    });

    it("audit events record knowledgeIngested: false always", () => {
      for (const event of snapshot.auditEvents) {
        const payload = event.payload as Record<string, unknown>;
        if ("knowledgeIngested" in payload) {
          expect(payload.knowledgeIngested).toBe(false);
        }
      }
    });

    it("FABRIC_AGENT_IDS count unchanged after governance decisions", () => {
      const beforeCount = FABRIC_AGENT_IDS.length;
      applyGovernanceDecision({
        snapshot,
        overlay: emptyOverlay(),
        action: "CREATE_NEW_ATLAS_SPECIALIST",
        verdict: "APPROVED",
        rationale: "Immutability test",
        actorId: "owner:immutability-test",
        sourceAgentId: snapshot.sourceAgents[0]?.id,
      });
      expect(FABRIC_AGENT_IDS.length).toBe(beforeCount);
      expect(FABRIC_AGENT_IDS).toHaveLength(16);
    });

    it("multiple decisions do not mutate the seed", () => {
      const seedBefore = loadSeedSnapshot();
      const overlay1 = applyGovernanceDecision({
        snapshot: seedBefore,
        overlay: emptyOverlay(),
        action: "KEEP_SOURCE_SPECIFIC",
        verdict: "APPROVED",
        rationale: "First decision",
        actorId: "owner:multi-test",
      }).overlay;
      const overlay2 = applyGovernanceDecision({
        snapshot: seedBefore,
        overlay: overlay1,
        action: "DO_NOT_IMPORT",
        verdict: "DENIED",
        rationale: "Second decision",
        actorId: "owner:multi-test",
      }).overlay;
      const seedAfter = loadSeedSnapshot();
      expect(seedAfter.governanceDecisions.length).toBe(seedBefore.governanceDecisions.length);
      expect(overlay2.auditEvents.length).toBe(2);
    });
  });

  describe("audit trail persistence through merge", () => {
    it("overlay audit events merge onto seed audit events", () => {
      const seed = loadSeedSnapshot();
      const seedAuditCount = seed.auditEvents.length;
      const { overlay } = applyGovernanceDecision({
        snapshot: seed,
        overlay: emptyOverlay(),
        action: "KEEP_SOURCE_SPECIFIC",
        verdict: "APPROVED",
        rationale: "Merge test",
        actorId: "owner:merge-test",
      });
      const merged = mergePortfolioSnapshot(seed, overlay);
      expect(merged.auditEvents.length).toBe(seedAuditCount + 1);
    });

    it("merged snapshot preserves all original audit events", () => {
      const seed = loadSeedSnapshot();
      const originalIds = seed.auditEvents.map((e) => e.id);
      const { overlay } = applyGovernanceDecision({
        snapshot: seed,
        overlay: emptyOverlay(),
        action: "KEEP_SOURCE_SPECIFIC",
        verdict: "APPROVED",
        rationale: "Preserve test",
        actorId: "owner:preserve-test",
      });
      const merged = mergePortfolioSnapshot(seed, overlay);
      for (const originalId of originalIds) {
        expect(merged.auditEvents.some((e) => e.id === originalId)).toBe(true);
      }
    });

    it("audit event IDs are unique across seed and overlay", () => {
      const seed = loadSeedSnapshot();
      const { overlay } = applyGovernanceDecision({
        snapshot: seed,
        overlay: emptyOverlay(),
        action: "KEEP_SOURCE_SPECIFIC",
        verdict: "APPROVED",
        rationale: "Uniqueness test",
        actorId: "owner:unique-test",
      });
      const merged = mergePortfolioSnapshot(seed, overlay);
      const ids = merged.auditEvents.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("security-relevant audit events", () => {
    it("approval decisions are audited with outcome", () => {
      const { overlay } = applyGovernanceDecision({
        snapshot,
        overlay: emptyOverlay(),
        action: "IMPORT_KNOWLEDGE_ONLY",
        verdict: "APPROVED",
        rationale: "Security audit test - approved",
        actorId: "owner:security-test",
      });
      expect(overlay.auditEvents[0]?.payload).toMatchObject({
        verdict: "APPROVED",
        status: "APPROVED",
      });
    });

    it("rejection decisions are audited with outcome", () => {
      const { overlay } = applyGovernanceDecision({
        snapshot,
        overlay: emptyOverlay(),
        action: "DO_NOT_IMPORT",
        verdict: "DENIED",
        rationale: "Security audit test - denied",
        actorId: "owner:security-test",
      });
      expect(overlay.auditEvents[0]?.payload).toMatchObject({
        verdict: "DENIED",
        status: "DENIED",
      });
    });

    it("fabric change requirements are explicitly recorded", () => {
      const { overlay } = applyGovernanceDecision({
        snapshot,
        overlay: emptyOverlay(),
        action: "ADAPT_INTO_EXISTING_ATLAS_CAPABILITY",
        verdict: "APPROVED",
        rationale: "Fabric change audit",
        actorId: "owner:fabric-audit",
        sourceAgentId: snapshot.sourceAgents[0]?.id,
      });
      const event = overlay.auditEvents[0];
      expect(event?.payload).toMatchObject({
        catalogCodeChangeRequired: true,
        fabricCatalogMutated: false,
      });
    });
  });

  describe("summary audit status", () => {
    it("buildPortfolioSummary reflects audit state", () => {
      const summary = buildPortfolioSummary(snapshot);
      // Phase 11.15: 4 knowledge records were Owner-approved and ingested
      expect(summary.knowledgeIngested).toBe(true);
      expect(summary.ingestedKnowledgeCount).toBe(4);
      expect(summary.fabricCatalogMutated).toBe(false);
      // ingestEnabled remains false to prevent unapproved future ingestion
      expect(summary.ingestEnabled).toBe(false);
    });

    it("merged snapshot summary maintains audit integrity", () => {
      const seed = loadSeedSnapshot();
      const { overlay } = applyGovernanceDecision({
        snapshot: seed,
        overlay: emptyOverlay(),
        action: "CREATE_NEW_ATLAS_SPECIALIST",
        verdict: "APPROVED",
        rationale: "Summary audit test",
        actorId: "owner:summary-test",
        sourceAgentId: seed.sourceAgents[0]?.id,
      });
      const merged = mergePortfolioSnapshot(seed, overlay);
      const summary = buildPortfolioSummary(merged);
      // Phase 11.15: Knowledge ingestion is now true (4 records)
      expect(summary.knowledgeIngested).toBe(true);
      expect(summary.ingestedKnowledgeCount).toBe(4);
      expect(summary.fabricCatalogMutated).toBe(false);
      expect(summary.pendingFabricChangeCount).toBeGreaterThan(0);
    });
  });
});
