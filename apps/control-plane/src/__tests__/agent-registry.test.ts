import { afterEach, describe, expect, it } from "vitest";
import {
  listRegisteredAgents,
  getRegisteredAgent,
  getAgentCapabilities,
  getRegistryStats,
  registerAgentInControl,
  getAgentRegistration,
  listAgentRegistrations,
  clearDynamicRegistrationsForTests,
} from "../services/agent-registry.js";

// ── Tests ────────────────────────────────────────────────────────────────

describe("Control Plane — Agent Registry", () => {
  // ── Registry completeness ──────────────────────────────────────────

  describe("registry completeness", () => {
    it("contains all 9 known agents", () => {
      const agents = listRegisteredAgents();
      expect(agents).toHaveLength(9);
    });

    it("includes every Phase 1a and 1b specialist", () => {
      const ids = listRegisteredAgents().map((a) => a.agentId);
      const expected = [
        "CODE_ENGINEER",
        "RESEARCHER",
        "ARCHITECT",
        "QA_ENGINEER",
        "DEVOPS",
        "PRODUCT_MANAGER",
        "DATA_ANALYST",
        "SECURITY",
        "LEGAL_MEDIA_COMMS",
      ];
      for (const id of expected) {
        expect(ids).toContain(id);
      }
    });

    it("every agent has a non-empty displayName and description", () => {
      for (const agent of listRegisteredAgents()) {
        expect(agent.displayName.length).toBeGreaterThan(0);
        expect(agent.description.length).toBeGreaterThan(0);
      }
    });

    it("every agent has an ACTIVE status", () => {
      for (const agent of listRegisteredAgents()) {
        expect(agent.status).toBe("ACTIVE");
      }
    });

    it("every agent explicitly denies secrets.read and audit.delete", () => {
      for (const agent of listRegisteredAgents()) {
        expect(agent.deniedCapabilities).toContain("secrets.read");
        expect(agent.deniedCapabilities).toContain("audit.delete");
        expect(agent.allowedCapabilities.length).toBeGreaterThan(0);
      }
    });
  });

  // ── Single agent lookup ────────────────────────────────────────────

  describe("getRegisteredAgent()", () => {
    it("returns the correct agent for CODE_ENGINEER", () => {
      const agent = getRegisteredAgent("CODE_ENGINEER");
      expect(agent).toBeDefined();
      expect(agent?.agentId).toBe("CODE_ENGINEER");
      expect(agent?.canWriteCode).toBe(true);
    });

    it("returns undefined for unknown agent", () => {
      expect(getRegisteredAgent("NONEXISTENT")).toBeUndefined();
    });

    it("RESEARCHER cannot write code", () => {
      const agent = getRegisteredAgent("RESEARCHER");
      expect(agent?.canWriteCode).toBe(false);
    });
  });

  // ── Capabilities ───────────────────────────────────────────────────

  describe("getAgentCapabilities()", () => {
    it("CODE_ENGINEER has RECORD.CREATE capability", () => {
      const caps = getAgentCapabilities("CODE_ENGINEER");
      expect(caps.some((c) => c.entityType === "RECORD" && c.action === "CREATE")).toBe(true);
    });

    it("RESEARCHER has DOCUMENT.READ capability", () => {
      const caps = getAgentCapabilities("RESEARCHER");
      expect(caps.some((c) => c.entityType === "DOCUMENT" && c.action === "READ")).toBe(true);
    });

    it("DEVOPS has CONFIGURATION.READ capability", () => {
      const caps = getAgentCapabilities("DEVOPS");
      expect(caps.some((c) => c.entityType === "CONFIGURATION" && c.action === "READ")).toBe(true);
    });

    it("SECURITY has no proposal-fabric capabilities", () => {
      const caps = getAgentCapabilities("SECURITY");
      expect(caps).toHaveLength(0);
    });

    it("unknown agent returns empty capabilities", () => {
      expect(getAgentCapabilities("NONEXISTENT")).toHaveLength(0);
    });

    it("READ-only agents have AUTO_LOG risk tier on their capabilities", () => {
      const readOnlyIds = ["RESEARCHER", "DEVOPS", "PRODUCT_MANAGER", "DATA_ANALYST"];
      for (const id of readOnlyIds) {
        const caps = getAgentCapabilities(id);
        for (const cap of caps) {
          expect(cap.riskTier).toBe("AUTO_LOG");
        }
      }
    });

    it("CREATE-capable agents have APPROVAL risk tier", () => {
      const createIds = ["CODE_ENGINEER", "ARCHITECT", "QA_ENGINEER"];
      for (const id of createIds) {
        const caps = getAgentCapabilities(id);
        const createCaps = caps.filter((c) => c.action === "CREATE");
        for (const cap of createCaps) {
          expect(cap.riskTier).toBe("APPROVAL");
        }
      }
    });
  });

  // ── Tool permissions ───────────────────────────────────────────────

  describe("tool permissions", () => {
    it("CODE_ENGINEER can use fs.write_file", () => {
      const agent = getRegisteredAgent("CODE_ENGINEER");
      expect(agent?.allowedTools).toContain("fs.write_file");
    });

    it("RESEARCHER cannot use fs.write_file", () => {
      const agent = getRegisteredAgent("RESEARCHER");
      expect(agent?.forbiddenTools).toContain("fs.write_file");
    });

    it("only CODE_ENGINEER has canWriteCode = true", () => {
      const codeWriters = listRegisteredAgents().filter((a) => a.canWriteCode);
      expect(codeWriters).toHaveLength(1);
      expect(codeWriters[0]?.agentId).toBe("CODE_ENGINEER");
    });
  });

  // ── Registry stats ─────────────────────────────────────────────────

  describe("getRegistryStats()", () => {
    it("returns correct total count", () => {
      const stats = getRegistryStats();
      expect(stats.totalAgents).toBe(9);
    });

    it("all agents are active", () => {
      const stats = getRegistryStats();
      expect(stats.activeAgents).toBe(9);
      expect(stats.suspendedAgents).toBe(0);
    });

    it("counts code-writing agents correctly", () => {
      const stats = getRegistryStats();
      expect(stats.codeWritingAgents).toBe(1);
    });

    it("counts read-only agents correctly", () => {
      const stats = getRegistryStats();
      // RESEARCHER, DEVOPS, PRODUCT_MANAGER, DATA_ANALYST have only READ caps
      // SECURITY, LEGAL_MEDIA_COMMS have no caps (they pass the .every check on empty)
      expect(stats.readOnlyAgents).toBeGreaterThanOrEqual(4);
    });
  });

  // ── Dynamic Registration ────────────────────────────────────────────────

  describe("registerAgentInControl()", () => {
    afterEach(() => {
      clearDynamicRegistrationsForTests();
    });

    it("registers a specialist agent and returns a record with CONTROL_REGISTERED status", () => {
      const record = registerAgentInControl({
        agentId: "SECURITY",
        registrationSource: "STATIC_CATALOG",
        ownerId: null,
        evidence: "test evidence",
        registeredBy: "test-suite",
      });
      expect(record.agentId).toBe("SECURITY");
      expect(record.status).toBe("CONTROL_REGISTERED");
      expect(record.registrationSource).toBe("STATIC_CATALOG");
      expect(record.ownerId).toBeNull();
      expect(record.idempotencyKey).toBe("SECURITY");
      expect(record.registeredAt).toBeTruthy();
    });

    it("is idempotent — repeat registration returns same record", () => {
      const first = registerAgentInControl({
        agentId: "CODE_ENGINEER",
        registrationSource: "STATIC_CATALOG",
        ownerId: null,
        evidence: "first call",
        registeredBy: "test-suite",
      });
      const second = registerAgentInControl({
        agentId: "CODE_ENGINEER",
        registrationSource: "STATIC_CATALOG",
        ownerId: null,
        evidence: "second call — should be ignored",
        registeredBy: "test-suite",
      });
      expect(second.registeredAt).toBe(first.registeredAt);
      expect(second.evidence).toBe(first.evidence);
    });

    it("registers PSA with owner-scoped identity", () => {
      const ownerId = "owner-abc-123";
      const record = registerAgentInControl({
        agentId: `psa:${ownerId}`,
        registrationSource: "PSA_OWNER",
        ownerId,
        evidence: "PSA created for owner",
        registeredBy: "atlas-api-psa-init",
      });
      expect(record.agentId).toBe(`psa:${ownerId}`);
      expect(record.ownerId).toBe(ownerId);
      expect(record.registrationSource).toBe("PSA_OWNER");
      expect(record.idempotencyKey).toContain(ownerId);
    });

    it("owner isolation — PSA owner A != owner B", () => {
      const ownerA = "owner-aaa";
      const ownerB = "owner-bbb";
      const recA = registerAgentInControl({
        agentId: `psa:${ownerA}`,
        registrationSource: "PSA_OWNER",
        ownerId: ownerA,
        evidence: "owner A",
        registeredBy: "test",
      });
      const recB = registerAgentInControl({
        agentId: `psa:${ownerB}`,
        registrationSource: "PSA_OWNER",
        ownerId: ownerB,
        evidence: "owner B",
        registeredBy: "test",
      });
      expect(recA.idempotencyKey).not.toBe(recB.idempotencyKey);
      expect(recA.agentId).not.toBe(recB.agentId);
    });

    it("deterministic PSA identity — same ownerId always same agentId", () => {
      const ownerId = "stable-owner";
      const first = registerAgentInControl({
        agentId: `psa:${ownerId}`,
        registrationSource: "PSA_OWNER",
        ownerId,
        evidence: "first",
        registeredBy: "test",
      });
      clearDynamicRegistrationsForTests();
      const second = registerAgentInControl({
        agentId: `psa:${ownerId}`,
        registrationSource: "PSA_OWNER",
        ownerId,
        evidence: "second",
        registeredBy: "test",
      });
      // Same agentId formula
      expect(first.agentId).toBe(second.agentId);
      expect(first.agentId).toBe(`psa:${ownerId}`);
    });
  });

  describe("getAgentRegistration()", () => {
    afterEach(() => {
      clearDynamicRegistrationsForTests();
    });

    it("returns undefined for unregistered agent", () => {
      expect(getAgentRegistration("NONEXISTENT")).toBeUndefined();
    });

    it("returns registration after registerAgentInControl", () => {
      registerAgentInControl({
        agentId: "RESEARCHER",
        registrationSource: "STATIC_CATALOG",
        ownerId: null,
        evidence: "test",
        registeredBy: "test",
      });
      const rec = getAgentRegistration("RESEARCHER");
      expect(rec).toBeDefined();
      expect(rec?.status).toBe("CONTROL_REGISTERED");
    });

    it("returns correct PSA registration with ownerId lookup", () => {
      const ownerId = "owner-xyz";
      registerAgentInControl({
        agentId: `psa:${ownerId}`,
        registrationSource: "PSA_OWNER",
        ownerId,
        evidence: "test",
        registeredBy: "test",
      });
      const rec = getAgentRegistration(`psa:${ownerId}`, ownerId);
      expect(rec).toBeDefined();
      expect(rec?.ownerId).toBe(ownerId);
    });
  });

  describe("listAgentRegistrations()", () => {
    afterEach(() => {
      clearDynamicRegistrationsForTests();
    });

    it("returns empty array when nothing is registered", () => {
      expect(listAgentRegistrations()).toHaveLength(0);
    });

    it("returns all registered agents", () => {
      registerAgentInControl({
        agentId: "SECURITY",
        registrationSource: "STATIC_CATALOG",
        ownerId: null,
        evidence: "e",
        registeredBy: "t",
      });
      registerAgentInControl({
        agentId: "LEGAL_MEDIA_COMMS",
        registrationSource: "STATIC_CATALOG",
        ownerId: null,
        evidence: "e",
        registeredBy: "t",
      });
      expect(listAgentRegistrations()).toHaveLength(2);
    });

    it("no duplicates — idempotent registration does not add extra entries", () => {
      for (let i = 0; i < 3; i++) {
        registerAgentInControl({
          agentId: "CODE_ENGINEER",
          registrationSource: "STATIC_CATALOG",
          ownerId: null,
          evidence: "e",
          registeredBy: "t",
        });
      }
      expect(listAgentRegistrations()).toHaveLength(1);
    });
  });
});
