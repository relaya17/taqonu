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
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetAutomationRulesForTests();
    try {
      rmSync(logDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("registerBuiltinAutomationRules() registers exactly the two built-in rule ids", () => {
    registerBuiltinAutomationRules();
    expect(listRegisteredAutomationRuleIds().sort()).toEqual([
      "gate-blocked-audit",
      "readiness-certificate-blockers-audit",
    ]);
  });

  it("registerBuiltinAutomationRules() is idempotent — a second call does not double-register or double-dispatch", async () => {
    registerBuiltinAutomationRules();
    registerBuiltinAutomationRules();
    expect(listRegisteredAutomationRuleIds().sort()).toEqual([
      "gate-blocked-audit",
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

  it("does not fire until registerBuiltinAutomationRules() has been called", async () => {
    appendDomainEvent({
      type: "gate.evaluated",
      payload: { graphId: "graph-4", statuses: { a: "BLOCKED" } },
    });
    await flush();

    expect(readAuditLogTail(10)).toHaveLength(0);
  });
});
