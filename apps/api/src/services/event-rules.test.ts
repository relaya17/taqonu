import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as the route integration tests).
const tmpDir = join(
  tmpdir(),
  `atlas-event-rules-${Date.now()}-${Math.random().toString(16).slice(2)}`,
);
mkdirSync(tmpDir, { recursive: true });
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { appendDomainEvent } = await import("./memory-pipeline.js");
const { registerEventRules, resetEventRulesForTests } = await import(
  "./event-rules.js"
);
const { readAuditLogTail, setAuditLogPathForTests } = await import(
  "./audit-log.js"
);

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("event rules: patch.applied -> unified audit entry", () => {
  let logDir: string;
  let logFile: string;

  beforeEach(() => {
    logDir = join(
      tmpdir(),
      `atlas-event-rules-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(logDir, { recursive: true });
    logFile = join(logDir, "audit.ndjson");
    setAuditLogPathForTests(logFile);
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetEventRulesForTests();
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetEventRulesForTests();
    try {
      rmSync(logDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("writes a standardized audit entry when a patch.applied event fires", async () => {
    registerEventRules();
    appendDomainEvent({
      type: "patch.applied",
      payload: { patchId: "patch-1", applied: ["src/a.ts"], skipped: [] },
    });
    await flush();

    const tail = readAuditLogTail(10);
    expect(tail).toHaveLength(1);
    expect(tail[0]?.type).toBe("patch.applied");
    const payload = tail[0]?.payload as Record<string, unknown>;
    expect(payload.actorKind).toBe("AGENT");
    expect(payload.risk).toBe("LOW");
    expect(payload.approval).toBe("APPROVED");
    expect(payload.result).toBe("SUCCESS");
    expect((payload.output as { applied: string[] }).applied).toEqual([
      "src/a.ts",
    ]);
  });

  it("escalates risk to MEDIUM when the patch had skipped files", async () => {
    registerEventRules();
    appendDomainEvent({
      type: "patch.applied",
      payload: { patchId: "patch-2", applied: [], skipped: ["src/b.ts"] },
    });
    await flush();

    const tail = readAuditLogTail(10);
    expect((tail[0]?.payload as { risk: string }).risk).toBe("MEDIUM");
  });

  it("does not write an audit entry for an unrelated event type", async () => {
    registerEventRules();
    appendDomainEvent({
      type: "memory.created",
      payload: { memoryId: "m1" },
    });
    await flush();

    expect(readAuditLogTail(10)).toHaveLength(0);
  });

  it("does not fire until registerEventRules() has been called", async () => {
    appendDomainEvent({
      type: "patch.applied",
      payload: { patchId: "patch-3", applied: [], skipped: [] },
    });
    await flush();

    expect(readAuditLogTail(10)).toHaveLength(0);
  });

  it("registerEventRules() is idempotent — a second call does not double-dispatch", async () => {
    registerEventRules();
    registerEventRules();
    appendDomainEvent({
      type: "patch.applied",
      payload: { patchId: "patch-4", applied: ["x"], skipped: [] },
    });
    await flush();

    expect(readAuditLogTail(10)).toHaveLength(1);
  });
});
