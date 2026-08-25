import { describe, expect, it, beforeEach } from "vitest";
import {
  appendAuditEntry,
  listAuditEntries,
  getAuditEntryCount,
  listPolicies,
  getPolicyForAction,
  addApprovalRecord,
  listApprovalRecords,
  computeHealthMetrics,
  resetGovernanceStateForTests,
  type AuditEntry,
  type ApprovalRecord,
} from "../services/governance-state.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    seq: 1,
    timestamp: "2025-01-15T10:00:00.000Z",
    type: "test.action",
    actorId: "TEST_AGENT",
    actorKind: "AGENT",
    reason: "test reason",
    policy: "RECORD.CREATE",
    risk: "LOW",
    approval: "NOT_REQUIRED",
    result: "SUCCESS",
    ownerId: "user-1",
    projectId: "project-1",
    hash: "abc123",
    prevHash: "000000",
    ...overrides,
  };
}

function makeApprovalRecord(
  overrides: Partial<ApprovalRecord> = {},
): ApprovalRecord {
  return {
    id: "apr_test_001",
    agentId: "CODE_ENGINEER",
    entityType: "RECORD",
    action: "CREATE",
    status: "PENDING",
    decidedBy: null,
    createdAt: "2025-01-15T10:00:00.000Z",
    expiresAt: "2025-01-15T11:00:00.000Z",
    artifactHash: "hash123",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Control Plane — Governance State", () => {
  beforeEach(() => {
    resetGovernanceStateForTests();
  });

  // ── Audit Trail ────────────────────────────────────────────────────

  describe("audit trail", () => {
    it("starts empty", () => {
      expect(getAuditEntryCount()).toBe(0);
      expect(listAuditEntries()).toHaveLength(0);
    });

    it("appends and retrieves entries", () => {
      appendAuditEntry(makeAuditEntry({ seq: 1 }));
      appendAuditEntry(makeAuditEntry({ seq: 2 }));
      expect(getAuditEntryCount()).toBe(2);
    });

    it("returns entries newest-first", () => {
      appendAuditEntry(makeAuditEntry({ seq: 1, timestamp: "2025-01-15T09:00:00.000Z" }));
      appendAuditEntry(makeAuditEntry({ seq: 2, timestamp: "2025-01-15T10:00:00.000Z" }));
      appendAuditEntry(makeAuditEntry({ seq: 3, timestamp: "2025-01-15T11:00:00.000Z" }));
      const entries = listAuditEntries();
      expect(entries[0]?.seq).toBe(3);
      expect(entries[2]?.seq).toBe(1);
    });

    it("filters by actorId", () => {
      appendAuditEntry(makeAuditEntry({ actorId: "AGENT_A" }));
      appendAuditEntry(makeAuditEntry({ actorId: "AGENT_B" }));
      appendAuditEntry(makeAuditEntry({ actorId: "AGENT_A" }));
      const filtered = listAuditEntries({ actorId: "AGENT_A" });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.actorId === "AGENT_A")).toBe(true);
    });

    it("filters by risk level", () => {
      appendAuditEntry(makeAuditEntry({ risk: "LOW" }));
      appendAuditEntry(makeAuditEntry({ risk: "HIGH" }));
      appendAuditEntry(makeAuditEntry({ risk: "LOW" }));
      const highRisk = listAuditEntries({ risk: "HIGH" });
      expect(highRisk).toHaveLength(1);
    });

    it("filters by result", () => {
      appendAuditEntry(makeAuditEntry({ result: "SUCCESS" }));
      appendAuditEntry(makeAuditEntry({ result: "FAILURE" }));
      const failures = listAuditEntries({ result: "FAILURE" });
      expect(failures).toHaveLength(1);
      expect(failures[0]?.result).toBe("FAILURE");
    });

    it("filters by type (substring match)", () => {
      appendAuditEntry(makeAuditEntry({ type: "agent-fabric.dispatch.architect" }));
      appendAuditEntry(makeAuditEntry({ type: "approvals.consume.success" }));
      const dispatchEntries = listAuditEntries({ type: "dispatch" });
      expect(dispatchEntries).toHaveLength(1);
    });

    it("respects limit and offset", () => {
      for (let i = 1; i <= 10; i++) {
        appendAuditEntry(makeAuditEntry({ seq: i }));
      }
      const page1 = listAuditEntries({ limit: 3, offset: 0 });
      expect(page1).toHaveLength(3);
      expect(page1[0]?.seq).toBe(10); // newest first

      const page2 = listAuditEntries({ limit: 3, offset: 3 });
      expect(page2).toHaveLength(3);
      expect(page2[0]?.seq).toBe(7);
    });

    it("combines multiple filters", () => {
      appendAuditEntry(makeAuditEntry({ actorId: "A", risk: "HIGH", result: "FAILURE" }));
      appendAuditEntry(makeAuditEntry({ actorId: "A", risk: "LOW", result: "SUCCESS" }));
      appendAuditEntry(makeAuditEntry({ actorId: "B", risk: "HIGH", result: "FAILURE" }));
      const filtered = listAuditEntries({ actorId: "A", risk: "HIGH" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.result).toBe("FAILURE");
    });
  });

  // ── Policies ──────────────────────────────────────────────────────

  describe("policies", () => {
    it("returns at least 9 policy definitions", () => {
      const policies = listPolicies();
      expect(policies.length).toBeGreaterThanOrEqual(9);
    });

    it("READ actions are AUTO_LOG tier", () => {
      const readPolicies = listPolicies().filter((p) => p.action === "READ");
      for (const policy of readPolicies) {
        expect(policy.riskTier).toBe("AUTO_LOG");
        expect(policy.requiresApproval).toBe(false);
      }
    });

    it("CREATE actions require APPROVAL", () => {
      const createPolicies = listPolicies().filter((p) => p.action === "CREATE");
      for (const policy of createPolicies) {
        expect(policy.riskTier).toBe("APPROVAL");
        expect(policy.requiresApproval).toBe(true);
      }
    });

    it("DELETE is categorically BLOCKED", () => {
      const policy = getPolicyForAction("*", "DELETE");
      expect(policy).toBeDefined();
      expect(policy?.riskTier).toBe("BLOCK");
      expect(policy?.requiresApproval).toBe(false);
    });

    it("getPolicyForAction returns undefined for unknown pair", () => {
      expect(getPolicyForAction("UNKNOWN", "UNKNOWN")).toBeUndefined();
    });

    it("DOCUMENT.READ policy exists and is correct", () => {
      const policy = getPolicyForAction("DOCUMENT", "READ");
      expect(policy).toBeDefined();
      expect(policy?.riskTier).toBe("AUTO_LOG");
    });

    it("every policy has a non-empty description", () => {
      for (const policy of listPolicies()) {
        expect(policy.description.length).toBeGreaterThan(0);
      }
    });
  });

  // ── Approvals ─────────────────────────────────────────────────────

  describe("approvals", () => {
    it("starts empty", () => {
      expect(listApprovalRecords()).toHaveLength(0);
    });

    it("adds and retrieves approval records", () => {
      addApprovalRecord(makeApprovalRecord({ id: "apr_1" }));
      addApprovalRecord(makeApprovalRecord({ id: "apr_2" }));
      expect(listApprovalRecords()).toHaveLength(2);
    });

    it("filters by status", () => {
      addApprovalRecord(makeApprovalRecord({ id: "apr_1", status: "PENDING" }));
      addApprovalRecord(makeApprovalRecord({ id: "apr_2", status: "CONSUMED" }));
      const pending = listApprovalRecords({ status: "PENDING" });
      expect(pending).toHaveLength(1);
      expect(pending[0]?.id).toBe("apr_1");
    });

    it("filters by agentId", () => {
      addApprovalRecord(makeApprovalRecord({ id: "apr_1", agentId: "CODE_ENGINEER" }));
      addApprovalRecord(makeApprovalRecord({ id: "apr_2", agentId: "ARCHITECT" }));
      const ceApprovals = listApprovalRecords({ agentId: "CODE_ENGINEER" });
      expect(ceApprovals).toHaveLength(1);
    });

    it("returns records newest-first", () => {
      addApprovalRecord(makeApprovalRecord({ id: "apr_1", createdAt: "2025-01-15T09:00:00.000Z" }));
      addApprovalRecord(makeApprovalRecord({ id: "apr_2", createdAt: "2025-01-15T10:00:00.000Z" }));
      const records = listApprovalRecords();
      expect(records[0]?.id).toBe("apr_2");
    });
  });

  // ── Health Metrics ────────────────────────────────────────────────

  describe("health metrics", () => {
    it("returns zeroed metrics when empty", () => {
      const health = computeHealthMetrics();
      expect(health.totalExecutions).toBe(0);
      expect(health.successfulExecutions).toBe(0);
      expect(health.failedExecutions).toBe(0);
      expect(health.avgRiskScore).toBe(0);
    });

    it("counts successes and failures correctly", () => {
      appendAuditEntry(makeAuditEntry({ result: "SUCCESS" }));
      appendAuditEntry(makeAuditEntry({ result: "SUCCESS" }));
      appendAuditEntry(makeAuditEntry({ result: "FAILURE" }));
      const health = computeHealthMetrics();
      expect(health.totalExecutions).toBe(3);
      expect(health.successfulExecutions).toBe(2);
      expect(health.failedExecutions).toBe(1);
    });

    it("counts high risk entries", () => {
      appendAuditEntry(makeAuditEntry({ risk: "HIGH" }));
      appendAuditEntry(makeAuditEntry({ risk: "LOW" }));
      appendAuditEntry(makeAuditEntry({ risk: "HIGH" }));
      const health = computeHealthMetrics();
      expect(health.highRiskCount).toBe(2);
    });

    it("computes average risk score", () => {
      appendAuditEntry(makeAuditEntry({ risk: "LOW" }));   // score 10
      appendAuditEntry(makeAuditEntry({ risk: "HIGH" }));  // score 90
      const health = computeHealthMetrics();
      expect(health.avgRiskScore).toBe(50); // (10 + 90) / 2
    });

    it("tracks approval counts", () => {
      addApprovalRecord(makeApprovalRecord({ status: "PENDING" }));
      addApprovalRecord(makeApprovalRecord({ status: "CONSUMED" }));
      addApprovalRecord(makeApprovalRecord({ status: "EXPIRED" }));
      const health = computeHealthMetrics();
      expect(health.approvalsPending).toBe(1);
      expect(health.approvalsConsumed).toBe(1);
      expect(health.approvalsExpired).toBe(1);
    });

    it("uptimeMs is positive", () => {
      const health = computeHealthMetrics();
      expect(health.uptimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────

  describe("reset", () => {
    it("resetGovernanceStateForTests clears all state", () => {
      appendAuditEntry(makeAuditEntry());
      addApprovalRecord(makeApprovalRecord());
      expect(getAuditEntryCount()).toBe(1);
      expect(listApprovalRecords()).toHaveLength(1);

      resetGovernanceStateForTests();
      expect(getAuditEntryCount()).toBe(0);
      expect(listApprovalRecords()).toHaveLength(0);
    });
  });
});
