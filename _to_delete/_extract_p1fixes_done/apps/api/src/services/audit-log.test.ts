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
  appendUnifiedAuditEntry,
  AUDIT_GENESIS_HASH,
  countAuditLogLines,
  hashAuditPayload,
  listUnifiedAuditEntries,
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

describe("listUnifiedAuditEntries per-owner tagging (P1 fix)", () => {
  let dir: string;
  let logFile: string;
  const OWNER_A = "11111111-1111-4111-8111-111111111111";
  const OWNER_B = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `atlas-audit-owner-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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

  function unifiedEntry(ownerId: string | null | undefined, reason: string) {
    return {
      type: "patch.applied",
      actorId: "agent:ARCHITECT",
      actorKind: "AGENT" as const,
      reason,
      risk: "LOW" as const,
      approval: "APPROVED" as const,
      result: "SUCCESS" as const,
      ...(ownerId === undefined ? {} : { ownerId }),
    };
  }

  it("carries ownerId through on a resolvable-owner entry", () => {
    appendUnifiedAuditEntry(unifiedEntry(OWNER_A, "owner A action"));
    const [entry] = listUnifiedAuditEntries();
    expect(entry?.ownerId).toBe(OWNER_A);
  });

  it("filtering by ownerId returns only that tenant's entries", () => {
    appendUnifiedAuditEntry(unifiedEntry(OWNER_A, "owner A action 1"));
    appendUnifiedAuditEntry(unifiedEntry(OWNER_B, "owner B action"));
    appendUnifiedAuditEntry(unifiedEntry(OWNER_A, "owner A action 2"));

    const ownerAEntries = listUnifiedAuditEntries({ ownerId: OWNER_A });
    expect(ownerAEntries).toHaveLength(2);
    expect(ownerAEntries.every((e) => e.ownerId === OWNER_A)).toBe(true);

    const ownerBEntries = listUnifiedAuditEntries({ ownerId: OWNER_B });
    expect(ownerBEntries).toHaveLength(1);
    expect(ownerBEntries[0]?.reason).toBe("owner B action");
  });

  it("excludes null-ownerId (system-wide) entries when filtering by a specific ownerId", () => {
    appendUnifiedAuditEntry(unifiedEntry(OWNER_A, "owner A action"));
    appendUnifiedAuditEntry(unifiedEntry(null, "system-wide action"));

    const filtered = listUnifiedAuditEntries({ ownerId: OWNER_A });
    expect(filtered.map((e) => e.reason)).not.toContain("system-wide action");
  });

  it("includes null-ownerId entries when no ownerId filter is applied", () => {
    appendUnifiedAuditEntry(unifiedEntry(OWNER_A, "owner A action"));
    appendUnifiedAuditEntry(unifiedEntry(null, "system-wide action"));

    const all = listUnifiedAuditEntries();
    expect(all.map((e) => e.reason)).toContain("system-wide action");
    expect(all.map((e) => e.reason)).toContain("owner A action");
  });

  it("skips freeform appendAuditLogLine entries that don't parse as a UnifiedAuditEntry", () => {
    appendAuditLogLine({ type: "agent.run.completed", runId: "r1" });
    appendUnifiedAuditEntry(unifiedEntry(OWNER_A, "owner A action"));

    const all = listUnifiedAuditEntries();
    expect(all).toHaveLength(1);
    expect(all[0]?.reason).toBe("owner A action");
  });
});
