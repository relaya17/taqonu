import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as apps/api/src/services/event-rules.test.ts).
const tmpDir = join(
  tmpdir(),
  `atlas-automation-rules-${Date.now()}-${Math.random().toString(16).slice(2)}`,
);
mkdirSync(tmpDir, { recursive: true });
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { appendDomainEvent } = await import("./memory-pipeline.js");
const { listRegisteredAutomationRuleIds } = await import("./automation-engine.js");
const { registerBuiltinAutomationRules, resetAutomationRulesForTests } = await import(
  "./automation-rules.js"
);
const { readAuditLogTail, setAuditLogPathForTests } = await import(
  "./audit-log.js"
);
const { resetApprovalsForTests, listApprovalRequests } = await import(
  "./approvals.js"
);

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("built-in automation rules", () => {
  let logDir: string;
  let logFile: string;

  beforeEach(() => {
    logDir = join(
      tmpdir(),
      `atlas-automation-rules-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(logDir, { recursive: true });
    logFile = join(logDir, "audit.ndjson");
    setAuditLogPathForTests(logFile);
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetAutomationRulesForTests();
    resetApprovalsForTests();
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetAutomationRulesForTests();
    resetApprovalsForTests();
    try {
      rmSync(logDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("registerBuiltinAutomationRules() registers exactly the three built-in rule ids", () => {
    registerBuiltinAutomationRules();
    expect(listRegisteredAutomationRuleIds().sort()).toEqual([
      "gate-blocked-audit",
      "gate-persistent-block-case",
      "readiness-certificate-blockers-audit",
    ]);
  });

  it("registerBuiltinAutomationRules() is idempotent — a second call does not double-register or double-dispatch", async () => {
    registerBuiltinAutomationRules();
    registerBuiltinAutomationRules();
    expect(listRegisteredAutomationRuleIds().sort()).toEqual([
      "gate-blocked-audit",
      "gate-persistent-block-case",
      "readiness-certificate-blockers-audit",
    ]);

    appendDomainEvent({
      type: "gate.evaluated",
      payload: {
        graphId: "graph-1",
        summary: "one blocked node",
        statuses: { "release-gate": "BLOCKED" },
      },
    });
    await flush();

    expect(readAuditLogTail(10)).toHaveLength(1);
  });

  describe("gate-blocked-audit: gate.evaluated -> HIGH-risk audit entry", () => {
    it("writes a HIGH-risk audit entry when a gate node is BLOCKED", async () => {
      registerBuiltinAutomationRules();
      appendDomainEvent({
        type: "gate.evaluated",
        projectId: null,
        payload: {
          graphId: "graph-1",
          summary: "release blocked",
          statuses: { "unresolved-conflicts": "BLOCKED", "patch-safety": "PASS" },
        },
      });
      await flush();

      const tail = readAuditLogTail(10);
      expect(tail).toHaveLength(1);
      expect(tail[0]?.type).toBe("gate.evaluated");
      const payload = tail[0]?.payload as Record<string, unknown>;
      expect(payload.risk).toBe("HIGH");
      expect(payload.approval).toBe("PENDING");
      expect(payload.result).toBe("FAILURE");
      expect(
        (payload.output as { blockedNodeIds: string[] }).blockedNodeIds,
      ).toEqual(["unresolved-conflicts"]);
    });

    it("threads payload.actorId and event.causationId into the audit entry when present", async () => {
      registerBuiltinAutomationRules();
      appendDomainEvent({
        type: "gate.evaluated",
        projectId: null,
        causationId: "22222222-2222-2222-2222-222222222222",
        payload: {
          graphId: "graph-1a",
          summary: "release blocked",
          statuses: { "unresolved-conflicts": "BLOCKED" },
          actorId: "user-7",
        },
      });
      await flush();

      const tail = readAuditLogTail(10);
      expect(tail[0]?.payload.actorId).toBe("user-7");
      expect(tail[0]?.payload.causationId).toBe(
        "22222222-2222-2222-2222-222222222222",
      );
    });

    it("falls back to a null actorId when the payload has none — no auth guard on this route today", async () => {
      registerBuiltinAutomationRules();
      appendDomainEvent({
        type: "gate.evaluated",
        payload: {
          graphId: "graph-1b",
          summary: "release blocked",
          statuses: { "unresolved-conflicts": "BLOCKED" },
        },
      });
      await flush();

      const tail = readAuditLogTail(10);
      expect(tail[0]?.payload.actorId).toBeNull();
    });

    it("writes a HIGH-risk audit entry when a gate node has FAILed", async () => {
      registerBuiltinAutomationRules();
      appendDomainEvent({
        type: "gate.evaluated",
        payload: {
          graphId: "graph-2",
          summary: "release blocked",
          statuses: { "dangerous-patches": "FAIL" },
        },
      });
      await flush();

      expect(readAuditLogTail(10)).toHaveLength(1);
    });

    it("does not write an audit entry when every gate node passes or is waived", async () => {
      registerBuiltinAutomationRules();
      appendDomainEvent({
        type: "gate.evaluated",
        payload: {
          graphId: "graph-3",
          summary: "all clear",
          statuses: { "patch-safety": "PASS", "legacy-check": "WAIVED" },
        },
      });
      await flush();

      expect(readAuditLogTail(10)).toHaveLength(0);
    });
  });

  describe("readiness-certificate-blockers-audit: evaluation.completed -> CRITICAL-risk audit entry", () => {
    it("writes a CRITICAL-risk audit entry when a readiness certificate has blockers", async () => {
      registerBuiltinAutomationRules();
      appendDomainEvent({
        type: "evaluation.completed",
        projectId: null,
        payload: {
          kind: "production-readiness-certificate",
          certificateId: "cert-1",
          overallScore: 42,
          blockers: 2,
          unknownClaims: 1,
        },
      });
      await flush();

      const tail = readAuditLogTail(10);
      expect(tail).toHaveLength(1);
      expect(tail[0]?.type).toBe("evaluation.completed");
      const payload = tail[0]?.payload as Record<string, unknown>;
      expect(payload.risk).toBe("CRITICAL");
      expect(payload.approval).toBe("PENDING");
      expect(payload.result).toBe("FAILURE");
      expect((payload.output as { blockers: number }).blockers).toBe(2);
    });

    it("threads payload.actorId and event.causationId into the audit entry when present", async () => {
      registerBuiltinAutomationRules();
      appendDomainEvent({
        type: "evaluation.completed",
        projectId: null,
        causationId: "33333333-3333-3333-3333-333333333333",
        payload: {
          kind: "production-readiness-certificate",
          certificateId: "cert-1a",
          overallScore: 42,
          blockers: 2,
          unknownClaims: 1,
          actorId: "user-9",
        },
      });
      await flush();

      const tail = readAuditLogTail(10);
      expect(tail[0]?.payload.actorId).toBe("user-9");
      expect(tail[0]?.payload.causationId).toBe(
        "33333333-3333-3333-3333-333333333333",
      );
    });

    it("falls back to a null actorId when the payload has none — no auth guard on this route today", async () => {
      registerBuiltinAutomationRules();
      appendDomainEvent({
        type: "evaluation.completed",
        payload: {
          kind: "production-readiness-certificate",
          certificateId: "cert-1b",
          overallScore: 42,
          blockers: 2,
          unknownClaims: 1,
        },
      });
      await flush();

      const tail = readAuditLogTail(10);
      expect(tail[0]?.payload.actorId).toBeNull();
    });

    it("does not write an audit entry when the readiness certificate has zero blockers", async () => {
      registerBuiltinAutomationRules();
      appendDomainEvent({
        type: "evaluation.completed",
        payload: {
          kind: "production-readiness-certificate",
          certificateId: "cert-2",
          overallScore: 95,
          blockers: 0,
          unknownClaims: 0,
        },
      });
      await flush();

      expect(readAuditLogTail(10)).toHaveLength(0);
    });

    it("does not fire for an unrelated evaluation.completed kind (e.g. kernel.run)", async () => {
      registerBuiltinAutomationRules();
      appendDomainEvent({
        type: "evaluation.completed",
        payload: { kind: "kernel.run", id: "run-1", judge: "reject" },
      });
      await flush();

      expect(readAuditLogTail(10)).toHaveLength(0);
    });
  });

  describe("gate-persistent-block-case: gate.evaluated -> AUTOMATION-actor CASE.CREATE via dispatchAgentAction", () => {
    const CASE_CREATE_TYPE = "automation.gate-persistent-block.case.create";

    function evaluateBlocked(graphId: string, blockedNodeId = "release-gate") {
      appendDomainEvent({
        type: "gate.evaluated",
        payload: {
          graphId,
          summary: "release blocked",
          statuses: { [blockedNodeId]: "BLOCKED" },
        },
      });
    }

    function evaluateClean(graphId: string) {
      appendDomainEvent({
        type: "gate.evaluated",
        payload: {
          graphId,
          summary: "all clear",
          statuses: { "patch-safety": "PASS" },
        },
      });
    }

    it("real end-to-end: on the 3rd consecutive blocked evaluation of the same graph, dispatches a real AUTOMATION CASE.CREATE that lands on APPROVAL_REQUIRED (never AUTO/AUTO_LOG) and creates a real, retrievable approval request", async () => {
      registerBuiltinAutomationRules();

      evaluateBlocked("graph-streak-1");
      await flush();
      evaluateBlocked("graph-streak-1");
      await flush();
      evaluateBlocked("graph-streak-1");
      await flush();

      const tail = readAuditLogTail(20);
      const dispatchEntries = tail.filter((r) => r.type === CASE_CREATE_TYPE);
      // Fires exactly once — on the 3rd blocked evaluation, not the 1st or 2nd.
      expect(dispatchEntries).toHaveLength(1);

      const dispatchPayload = dispatchEntries[0]?.payload as Record<string, unknown>;
      // The automation-CRUD floor (agent-dispatch-guard.ts) guarantees an
      // AUTOMATION-actor CREATE can never resolve AUTO/AUTO_LOG — asserting
      // the real outcome here, produced by the real trigger -> condition ->
      // dispatchAgentAction pipeline, is what actually proves the floor
      // holds end-to-end rather than only under a synthetic unit test.
      expect(dispatchPayload.approval).toBe("PENDING");
      expect(dispatchPayload.result).toBe("PARTIAL");
      expect(dispatchPayload.risk).toBe("HIGH");
      expect(dispatchPayload.policy).toBe("CASE.CREATE");
      const dispatchOutput = dispatchPayload.output as { approvalRequestId?: string };
      expect(typeof dispatchOutput.approvalRequestId).toBe("string");

      const pending = listApprovalRequests("PENDING");
      const approval = pending.find((r) => r.id === dispatchOutput.approvalRequestId);
      expect(approval).toBeDefined();
      expect(approval?.entityType).toBe("CASE");
      expect(approval?.action).toBe("CREATE");
      expect(approval?.status).toBe("PENDING");
      // No live human in the loop (a bare AUTOMATION actor) — requestedBy
      // must be the automation's own identity, never a fabricated user id.
      expect(approval?.requestedBy).toBe("automation-engine.gate-persistent-block");
      expect(approval?.context?.bucket).toBe("APPROVAL");
      expect(approval?.context?.actorKind).toBe("AUTOMATION");

      // Rule 1 (gate-blocked-audit) still independently fires on all 3
      // blocked evaluations — this rule's action is additive, not a
      // replacement for the existing audit-only rule.
      expect(tail.filter((r) => r.type === "gate.evaluated")).toHaveLength(3);
    });

    it("does not fire before the streak reaches 3 consecutive blocked evaluations, and a clean evaluation in between resets the streak", async () => {
      registerBuiltinAutomationRules();

      evaluateBlocked("graph-streak-2");
      await flush();
      evaluateBlocked("graph-streak-2");
      await flush();
      expect(
        readAuditLogTail(20).filter((r) => r.type === CASE_CREATE_TYPE),
      ).toHaveLength(0);

      // Streak resets: this clean evaluation means the *next* blocked
      // evaluation is only streak=1, not streak=3.
      evaluateClean("graph-streak-2");
      await flush();
      evaluateBlocked("graph-streak-2");
      await flush();

      expect(
        readAuditLogTail(20).filter((r) => r.type === CASE_CREATE_TYPE),
      ).toHaveLength(0);
      expect(listApprovalRequests("PENDING")).toHaveLength(0);
    });

    it("tracks streaks independently per graphId — a different graph's blocked count never contributes to another graph's streak", async () => {
      registerBuiltinAutomationRules();

      evaluateBlocked("graph-streak-3a");
      await flush();
      evaluateBlocked("graph-streak-3b");
      await flush();
      evaluateBlocked("graph-streak-3a");
      await flush();

      expect(
        readAuditLogTail(20).filter((r) => r.type === CASE_CREATE_TYPE),
      ).toHaveLength(0);
    });
  });

  it("does not fire until registerBuiltinAutomationRules() has been called", async () => {
    appendDomainEvent({
      type: "gate.evaluated",
      payload: { graphId: "graph-4", statuses: { a: "BLOCKED" } },
    });
    await flush();

    expect(readAuditLogTail(10)).toHaveLength(0);
  });
});
