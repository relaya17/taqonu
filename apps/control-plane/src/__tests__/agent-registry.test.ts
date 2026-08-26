import { describe, expect, it } from "vitest";
import {
  listRegisteredAgents,
  getRegisteredAgent,
  getAgentCapabilities,
  getRegistryStats,
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
});
