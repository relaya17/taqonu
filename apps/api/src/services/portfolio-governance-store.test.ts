import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-pg-store-"));
const storePath = join(tmpDir, "store.json");
const overlayPath = join(tmpDir, "overlay.json");
process.env.ATLAS_STORE_PATH = storePath;
process.env.ATLAS_PORTFOLIO_GOVERNANCE_PATH = overlayPath;
process.env.ATLAS_SKIP_STORE_PERSIST = "0";

const { osStore } = await import("../store/os-store.js");
const { emptyOverlay, loadSeedSnapshot, FABRIC_AGENT_IDS } = await import("@atlas/shared");
const {
  loadPortfolioOverlay,
  savePortfolioOverlay,
  getPortfolioSnapshot,
  resetPortfolioOverlayForTests,
} = await import("./portfolio-governance-store.js");

describe("Phase 11.1 portfolio overlay persistence", () => {
  afterEach(() => {
    resetPortfolioOverlayForTests();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trips an empty overlay without claiming Fabric mutation", () => {
    osStore.ensureLoaded();
    const overlay = emptyOverlay("2026-08-28T00:00:00.000Z");
    savePortfolioOverlay(overlay);
    const loaded = loadPortfolioOverlay();
    expect(loaded.version).toBe(1);
    expect(loaded.governanceDecisions).toEqual([]);
    expect(loaded.auditEvents).toEqual([]);
    expect(loaded.governanceDecisions.every((d) => d.fabricCatalogMutated === false)).toBe(
      true,
    );
  });

  it("refuses to persist a mutated-catalog claim", () => {
    expect(() =>
      savePortfolioOverlay({
        version: 1,
        updatedAt: "2026-08-28T00:00:00.000Z",
        governanceDecisions: [
          {
            id: "a11c0000-0000-4000-a000-000000000099",
            action: "CREATE_NEW_ATLAS_SPECIALIST",
            status: "APPROVED",
            applicationId: null,
            sourceAgentId: null,
            capabilityId: null,
            rationale: "illegal mutation claim",
            decidedBy: "owner",
            decidedAt: "2026-08-28T00:00:00.000Z",
            fabricCatalogMutated: true as unknown as false,
            knowledgeIngested: false,
          },
        ],
        auditEvents: [],
      }),
    ).toThrow();
  });
});

describe("Phase 11.5 — Portfolio Persistence and Data Layer", () => {
  beforeEach(() => {
    osStore.ensureLoaded();
    resetPortfolioOverlayForTests();
  });

  afterEach(() => {
    resetPortfolioOverlayForTests();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("restart/recovery", () => {
    it("recovers full snapshot after simulated restart", () => {
      const overlayWithDecision = {
        version: 1 as const,
        updatedAt: "2026-08-28T12:00:00.000Z",
        governanceDecisions: [
          {
            id: "a11c0000-0000-4000-a000-000000000001",
            action: "ADAPT_INTO_EXISTING_ATLAS_CAPABILITY" as const,
            status: "APPROVED" as const,
            applicationId: null,
            sourceAgentId: "a11c0000-0000-4000-a000-000000000100",
            capabilityId: null,
            rationale: "Test mapping decision",
            decidedBy: "owner",
            decidedAt: "2026-08-28T12:00:00.000Z",
            fabricCatalogMutated: false as const,
            knowledgeIngested: false as const,
          },
        ],
        auditEvents: [
          {
            id: "a11c0000-0000-4000-a000-000000000002",
            at: "2026-08-28T12:00:00.000Z",
            type: "portfolio.governance.decided" as const,
            actorId: "owner",
            payload: { test: true },
          },
        ],
      };

      savePortfolioOverlay(overlayWithDecision);
      expect(existsSync(overlayPath)).toBe(true);

      osStore.forceReload?.() ?? osStore.ensureLoaded();

      const recoveredOverlay = loadPortfolioOverlay();
      expect(recoveredOverlay.governanceDecisions).toHaveLength(1);
      expect(recoveredOverlay.governanceDecisions[0].id).toBe(
        "a11c0000-0000-4000-a000-000000000001",
      );
      expect(recoveredOverlay.auditEvents).toHaveLength(1);
    });

    it("recovers merged snapshot with seed + overlay after restart", () => {
      const seed = loadSeedSnapshot();
      const seedDecisionCount = seed.governanceDecisions.length;

      const overlay = {
        version: 1 as const,
        updatedAt: "2026-08-28T12:00:00.000Z",
        governanceDecisions: [
          {
            id: "a11c0000-0000-4000-a000-000000000003",
            action: "IMPORT_KNOWLEDGE_ONLY" as const,
            status: "DENIED" as const,
            applicationId: null,
            sourceAgentId: null,
            capabilityId: null,
            rationale: "Knowledge ingest blocked as expected",
            decidedBy: "owner",
            decidedAt: "2026-08-28T12:00:00.000Z",
            fabricCatalogMutated: false as const,
            knowledgeIngested: false as const,
          },
        ],
        auditEvents: [],
      };

      savePortfolioOverlay(overlay);
      osStore.forceReload?.() ?? osStore.ensureLoaded();

      const snapshot = getPortfolioSnapshot();
      expect(snapshot.sourceAgents.length).toBe(54);
      expect(snapshot.capabilities.length).toBe(46);
      expect(snapshot.evidence.length).toBe(15);
      expect(snapshot.governanceDecisions).toHaveLength(seedDecisionCount + 1);
      const addedDecision = snapshot.governanceDecisions.find(
        (d) => d.id === "a11c0000-0000-4000-a000-000000000003",
      );
      expect(addedDecision).toBeDefined();
      expect(addedDecision!.status).toBe("DENIED");
    });

    it("recovers all seed entities correctly", () => {
      const seed = loadSeedSnapshot();
      const snapshot = getPortfolioSnapshot();

      expect(snapshot.applications.length).toBe(seed.applications.length);
      expect(snapshot.sourceAgents.length).toBe(seed.sourceAgents.length);
      expect(snapshot.capabilities.length).toBe(seed.capabilities.length);
      expect(snapshot.evidence.length).toBe(seed.evidence.length);
      expect(snapshot.canonicalCapabilities.length).toBe(seed.canonicalCapabilities.length);
      expect(snapshot.dedupRelations.length).toBe(seed.dedupRelations.length);
      expect(snapshot.conflicts.length).toBe(seed.conflicts.length);
      expect(snapshot.sourcePermissions.length).toBe(seed.sourcePermissions.length);
    });
  });

  describe("idempotency", () => {
    it("repeated persistence of same overlay does not create duplicates", () => {
      const overlay = {
        version: 1 as const,
        updatedAt: "2026-08-28T12:00:00.000Z",
        governanceDecisions: [
          {
            id: "a11c0000-0000-4000-a000-000000000010",
            action: "ADAPT_INTO_EXISTING_ATLAS_CAPABILITY" as const,
            status: "APPROVED" as const,
            applicationId: null,
            sourceAgentId: null,
            capabilityId: null,
            rationale: "Idempotency test",
            decidedBy: "owner",
            decidedAt: "2026-08-28T12:00:00.000Z",
            fabricCatalogMutated: false as const,
            knowledgeIngested: false as const,
          },
        ],
        auditEvents: [],
      };

      savePortfolioOverlay(overlay);
      savePortfolioOverlay(overlay);
      savePortfolioOverlay(overlay);

      const loaded = loadPortfolioOverlay();
      expect(loaded.governanceDecisions).toHaveLength(1);
    });

    it("upsert same seed snapshot multiple times produces consistent result", () => {
      const snap1 = getPortfolioSnapshot();
      const snap2 = getPortfolioSnapshot();
      const snap3 = getPortfolioSnapshot();

      expect(snap1.sourceAgents.length).toBe(snap2.sourceAgents.length);
      expect(snap2.sourceAgents.length).toBe(snap3.sourceAgents.length);
      expect(snap1.capabilities.length).toBe(snap3.capabilities.length);
    });
  });

  describe("relationship integrity", () => {
    it("capability → sourceAgent relationships survive persistence", () => {
      const snapshot = getPortfolioSnapshot();
      const agentIds = new Set(snapshot.sourceAgents.map((a) => a.id));

      for (const cap of snapshot.capabilities) {
        expect(agentIds.has(cap.sourceAgentId)).toBe(true);
      }
    });

    it("evidence → capability relationships survive persistence", () => {
      const snapshot = getPortfolioSnapshot();
      const capIds = new Set(snapshot.capabilities.map((c) => c.id));

      const linkedEvidence = snapshot.evidence.filter((e) => e.capabilityId !== null);
      for (const ev of linkedEvidence) {
        expect(capIds.has(ev.capabilityId!)).toBe(true);
      }
    });

    it("sourceAgent → application relationships survive persistence", () => {
      const snapshot = getPortfolioSnapshot();
      const appIds = new Set(snapshot.applications.map((a) => a.id));

      for (const agent of snapshot.sourceAgents) {
        expect(appIds.has(agent.applicationId)).toBe(true);
      }
    });

    it("provenance → application linkage survives persistence", () => {
      const snapshot = getPortfolioSnapshot();
      const appIds = new Set(snapshot.applications.map((a) => a.id));

      for (const agent of snapshot.sourceAgents) {
        expect(appIds.has(agent.provenance.sourceApplicationId!)).toBe(true);
      }
    });
  });

  describe("provenance preservation", () => {
    it("complete provenance survives persistence", () => {
      const snapshot = getPortfolioSnapshot();

      for (const agent of snapshot.sourceAgents) {
        const p = agent.provenance;
        expect(p.sourceRepository.length).toBeGreaterThan(0);
        expect(p.sourceBranch.length).toBeGreaterThan(0);
        expect(p.sourceCommit).toMatch(/^[0-9a-f]{40}$/i);
        expect(p.sourcePath.length).toBeGreaterThan(0);
        expect(p.sourceType.length).toBeGreaterThan(0);
        expect(p.extractor).toBe("atlas-portfolio-discovery");
        expect(["ACTIVE", "DEPRECATED", "EXPERIMENTAL", "PLANNED", "UNKNOWN"]).toContain(
          p.originalStatus,
        );
      }
    });

    it("40-character commit SHA is not truncated", () => {
      const snapshot = getPortfolioSnapshot();

      for (const agent of snapshot.sourceAgents) {
        expect(agent.provenance.sourceCommit.length).toBe(40);
      }
    });
  });

  describe("evidence preservation", () => {
    it("evidence records survive persistence with capabilityId intact", () => {
      const snapshot = getPortfolioSnapshot();

      expect(snapshot.evidence.length).toBe(15);
      const linked = snapshot.evidence.filter((e) => e.capabilityId !== null);
      expect(linked.length).toBe(9);
    });

    it("isRuntimeProbe remains false for all evidence", () => {
      const snapshot = getPortfolioSnapshot();

      for (const ev of snapshot.evidence) {
        expect(ev.isRuntimeProbe).toBe(false);
      }
    });
  });

  describe("runtime status independence", () => {
    it("all runtime states remain UNKNOWN after persistence", () => {
      const snapshot = getPortfolioSnapshot();

      for (const agent of snapshot.sourceAgents) {
        expect(agent.runtimeStatus.state).toBe("UNKNOWN");
        expect(agent.runtimeStatus.probeKind).toBe("NONE");
      }
    });

    it("evidence does not convert to runtime status", () => {
      const snapshot = getPortfolioSnapshot();

      const agentsWithEvidence = new Set(
        snapshot.evidence.filter((e) => e.sourceAgentId).map((e) => e.sourceAgentId),
      );

      for (const agentId of agentsWithEvidence) {
        const agent = snapshot.sourceAgents.find((a) => a.id === agentId);
        expect(agent?.runtimeStatus.state).toBe("UNKNOWN");
      }
    });
  });

  describe("Fabric isolation", () => {
    it("FABRIC_AGENT_IDS remains unchanged at 16", () => {
      expect(FABRIC_AGENT_IDS.length).toBe(16);
    });

    it("no SourceAgent becomes a FabricAgent through persistence", () => {
      const snapshot = getPortfolioSnapshot();

      for (const agent of snapshot.sourceAgents) {
        expect(FABRIC_AGENT_IDS).not.toContain(agent.sourceKey);
        expect(agent.atlasPromotionBlocked).toBe(true);
      }
    });

    it("governance decisions cannot claim fabricCatalogMutated=true", () => {
      expect(() =>
        savePortfolioOverlay({
          version: 1,
          updatedAt: "2026-08-28T12:00:00.000Z",
          governanceDecisions: [
            {
              id: "a11c0000-0000-4000-a000-000000000099",
              action: "CREATE_NEW_ATLAS_SPECIALIST",
              status: "APPROVED",
              applicationId: null,
              sourceAgentId: null,
              capabilityId: null,
              rationale: "illegal mutation claim",
              decidedBy: "owner",
              decidedAt: "2026-08-28T00:00:00.000Z",
              fabricCatalogMutated: true as unknown as false,
              knowledgeIngested: false,
            },
          ],
          auditEvents: [],
        }),
      ).toThrow();
    });
  });

  describe("permission isolation", () => {
    it("source permissions do not become Atlas permissions", () => {
      const snapshot = getPortfolioSnapshot();

      for (const perm of snapshot.sourcePermissions) {
        expect(perm.atlasInheritance).toBe("NONE");
      }
    });

    it("WRITE source permissions remain observational only", () => {
      const snapshot = getPortfolioSnapshot();
      const writePerms = snapshot.sourcePermissions.filter(
        (p) => p.sourceAuthority === "WRITE_SOURCE",
      );

      expect(writePerms.length).toBeGreaterThan(0);
      for (const perm of writePerms) {
        expect(perm.atlasInheritance).toBe("NONE");
      }
    });
  });

  describe("data completeness", () => {
    it("persists 54 SourceAgents", () => {
      const snapshot = getPortfolioSnapshot();
      expect(snapshot.sourceAgents.length).toBe(54);
    });

    it("persists 46 capability-bearing SourceAgents", () => {
      const snapshot = getPortfolioSnapshot();
      const agentsWithCaps = new Set(snapshot.capabilities.map((c) => c.sourceAgentId));
      expect(agentsWithCaps.size).toBe(46);
    });

    it("persists 46 capabilities", () => {
      const snapshot = getPortfolioSnapshot();
      expect(snapshot.capabilities.length).toBe(46);
    });

    it("persists 15 evidence records", () => {
      const snapshot = getPortfolioSnapshot();
      expect(snapshot.evidence.length).toBe(15);
    });

    it("persists 9 capability-linked evidence records", () => {
      const snapshot = getPortfolioSnapshot();
      const linked = snapshot.evidence.filter((e) => e.capabilityId !== null);
      expect(linked.length).toBe(9);
    });
  });
});
