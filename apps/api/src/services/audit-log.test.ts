import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendAuditLogLine,
  AUDIT_GENESIS_HASH,
  countAuditLogLines,
  hashAuditPayload,
  readAuditLogTail,
  setAuditLogPathForTests,
} from "./audit-log.js";

describe("append-only audit log", () => {
  let dir: string;
  let logFile: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `atlas-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, "audit.ndjson");
    setAuditLogPathForTests(logFile);
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("appends hash-chained NDJSON lines and never truncates the file", () => {
    const a = appendAuditLogLine({ type: "agent.run.completed", runId: "r1" });
    expect(a.prevHash).toBe(AUDIT_GENESIS_HASH);
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);

    const b = appendAuditLogLine({ type: "agents.plan", planId: "p1" });
    expect(b.prevHash).toBe(a.hash);
    expect(b.hash).toBe(hashAuditPayload(a.hash, b.payload));

    const raw = readFileSync(logFile, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    expect(countAuditLogLines()).toBe(2);

    // Simulate many more appends — file keeps growing
    for (let i = 0; i < 5; i++) {
      appendAuditLogLine({ type: "conversation.message", n: i });
    }
    expect(countAuditLogLines()).toBe(7);
    expect(existsSync(logFile)).toBe(true);
  });

  it("continues the chain after process restart (tail hash from file)", () => {
    const first = appendAuditLogLine({ type: "agents.dispatch", id: "d1" });
    // Drop in-memory cache as if the process restarted
    setAuditLogPathForTests(logFile);
    const second = appendAuditLogLine({ type: "agent.run.completed", runId: "r2" });
    expect(second.prevHash).toBe(first.hash);
    const tail = readAuditLogTail(10);
    expect(tail).toHaveLength(2);
    expect(tail[1]?.prevHash).toBe(first.hash);
  });

  it("skips disk write when ATLAS_SKIP_AUDIT_LOG=1 but still returns chained record", () => {
    process.env.ATLAS_SKIP_AUDIT_LOG = "1";
    const rec = appendAuditLogLine({ type: "test.skip" });
    expect(rec.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(logFile)).toBe(false);
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
  });

  it("survives a corrupt last line by resetting chain to GENESIS", () => {
    writeFileSync(logFile, "{not-json\n", "utf8");
    setAuditLogPathForTests(logFile);
    const rec = appendAuditLogLine({ type: "recovery" });
    expect(rec.prevHash).toBe(AUDIT_GENESIS_HASH);
    expect(countAuditLogLines()).toBe(2);
  });
});
