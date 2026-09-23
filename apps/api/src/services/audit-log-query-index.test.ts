import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendAuditLogLine,
  appendUnifiedAuditEntry,
  countAuditLogLines,
  getAuditQueryIndexStatsForTests,
  listUnifiedAuditEntries,
  pageUnifiedAuditEntries,
  pageUnifiedAuditIndex,
  setAuditLogPathForTests,
} from "./audit-log.js";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

function unified(ownerId: string, reason: string, actorId = "actor-a") {
  return {
    type: "patch.applied" as const,
    actorId,
    actorKind: "USER" as const,
    ownerId,
    reason,
    risk: "LOW" as const,
    approval: "NOT_REQUIRED" as const,
    result: "SUCCESS" as const,
  };
}

describe("R04 incremental audit query index", () => {
  let dir: string;
  let logFile: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `atlas-audit-index-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, "audit.ndjson");
    setAuditLogPathForTests(logFile);
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("lists unified entries without changing owner/actor isolation", () => {
    appendUnifiedAuditEntry(unified(OWNER_A, "a1"));
    appendUnifiedAuditEntry(unified(OWNER_B, "b1", "actor-b"));
    appendUnifiedAuditEntry(unified(OWNER_A, "a2"));
    expect(listUnifiedAuditEntries({ ownerId: OWNER_A }).map((e) => e.reason)).toEqual([
      "a1",
      "a2",
    ]);
    expect(listUnifiedAuditEntries({ actorId: "actor-b" })).toHaveLength(1);
    expect(listUnifiedAuditEntries({ limit: 1 })[0]?.reason).toBe("a2");
  });

  it("does not re-parse the file on a second query with no new writes", () => {
    for (let i = 0; i < 8; i += 1) {
      appendUnifiedAuditEntry(unified(OWNER_A, `row-${i}`));
    }
    listUnifiedAuditEntries();
    const afterFirst = getAuditQueryIndexStatsForTests();
    expect(afterFirst.unifiedCount).toBe(8);
    expect(afterFirst.linesParsed).toBeGreaterThan(0);

    listUnifiedAuditEntries({ ownerId: OWNER_A, limit: 3 });
    const afterSecond = getAuditQueryIndexStatsForTests();
    expect(afterSecond.linesParsed).toBe(afterFirst.linesParsed);
    expect(afterSecond.unifiedCount).toBe(8);
  });

  it("catch-up parses only newly appended lines", () => {
    appendUnifiedAuditEntry(unified(OWNER_A, "seed"));
    listUnifiedAuditEntries();
    const afterSeed = getAuditQueryIndexStatsForTests();

    appendUnifiedAuditEntry(unified(OWNER_A, "new-1"));
    appendUnifiedAuditEntry(unified(OWNER_A, "new-2"));
    const listed = listUnifiedAuditEntries();
    const afterCatchUp = getAuditQueryIndexStatsForTests();

    expect(listed.map((e) => e.reason)).toEqual(["seed", "new-1", "new-2"]);
    expect(afterCatchUp.linesParsed - afterSeed.linesParsed).toBe(2);
    expect(afterCatchUp.rebuilds).toBe(afterSeed.rebuilds);
  });

  it("sees an external append without rebuilding the prefix", () => {
    const first = appendUnifiedAuditEntry(unified(OWNER_A, "local"));
    listUnifiedAuditEntries();
    const afterLocal = getAuditQueryIndexStatsForTests();

    const external = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      at: "2026-09-23T00:00:00.000Z",
      type: "patch.applied",
      prevHash: first.hash,
      hash: "b".repeat(64),
      payload: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        at: "2026-09-23T00:00:00.000Z",
        type: "patch.applied",
        actorId: "actor-ext",
        actorKind: "USER",
        ownerId: OWNER_B,
        reason: "external-append",
        risk: "LOW",
        approval: "NOT_REQUIRED",
        result: "SUCCESS",
        toolName: null,
        entityType: null,
        action: null,
        agentId: null,
        intent: null,
        policy: null,
        model: null,
        authority: null,
        approvalId: null,
        decision: null,
        input: {},
        output: {},
        artifactHash: null,
        verificationVerdict: null,
        regressionVerdict: null,
        delegationHopCount: null,
        blockedAt: null,
      },
    };
    appendFileSync(logFile, `${JSON.stringify(external)}\n`, "utf8");

    const listed = listUnifiedAuditEntries();
    const afterExternal = getAuditQueryIndexStatsForTests();
    expect(listed.map((e) => e.reason)).toEqual(["local", "external-append"]);
    expect(afterExternal.linesParsed - afterLocal.linesParsed).toBe(1);
    expect(afterExternal.rebuilds).toBe(afterLocal.rebuilds);
  });

  it("rebuilds when the file is replaced with a shorter log", () => {
    appendUnifiedAuditEntry(unified(OWNER_A, "old-1"));
    appendUnifiedAuditEntry(unified(OWNER_A, "old-2"));
    expect(listUnifiedAuditEntries()).toHaveLength(2);
    const afterGrow = getAuditQueryIndexStatsForTests();

    writeFileSync(logFile, "", "utf8");
    appendUnifiedAuditEntry(unified(OWNER_B, "replacement"));
    const listed = listUnifiedAuditEntries();
    const afterReplace = getAuditQueryIndexStatsForTests();

    expect(listed.map((e) => e.reason)).toEqual(["replacement"]);
    expect(afterReplace.rebuilds).toBeGreaterThan(afterGrow.rebuilds);
    expect(countAuditLogLines()).toBe(1);
  });

  it("pages by stable seq cursor without duplicates or skips", () => {
    for (let i = 0; i < 5; i += 1) {
      appendUnifiedAuditEntry(unified(OWNER_A, `p-${i}`));
    }
    const first = pageUnifiedAuditEntries({ limit: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.entries.map((e) => e.reason)).toEqual(["p-3", "p-4"]);
    expect(first.nextCursor).toMatch(/^\d+:[a-f0-9]{64}$/);

    const second = pageUnifiedAuditEntries({
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.entries.map((e) => e.reason)).toEqual(["p-1", "p-2"]);

    const third = pageUnifiedAuditEntries({
      limit: 2,
      cursor: second.nextCursor ?? undefined,
    });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.entries.map((e) => e.reason)).toEqual(["p-0"]);
    expect(third.nextCursor).toBeNull();

    const seen = [
      ...first.entries,
      ...second.entries,
      ...third.entries,
    ].map((e) => e.reason);
    expect(seen).toEqual(["p-3", "p-4", "p-1", "p-2", "p-0"]);
    expect(new Set(seen).size).toBe(5);
  });

  it("export projection keeps the same hash as the append record", () => {
    const written = appendUnifiedAuditEntry(unified(OWNER_A, "hashed"));
    const paged = pageUnifiedAuditIndex({ limit: 10 });
    expect(paged.ok).toBe(true);
    if (!paged.ok) return;
    expect(paged.rows[0]?.hash).toBe(written.hash);
    expect(paged.rows[0]?.prevHash).toBe(written.prevHash);
  });

  it("rejects a forged or unknown cursor", () => {
    appendUnifiedAuditEntry(unified(OWNER_A, "only"));
    expect(pageUnifiedAuditEntries({ limit: 1, cursor: "not-a-cursor" }).ok).toBe(
      false,
    );
    expect(
      pageUnifiedAuditEntries({
        limit: 1,
        cursor: `99:${"c".repeat(64)}`,
      }).ok,
    ).toBe(false);
  });

  it("skips freeform lines and still indexes later unified rows", () => {
    appendAuditLogLine({ type: "agent.run.completed", runId: "r1" });
    appendUnifiedAuditEntry(unified(OWNER_A, "kept"));
    expect(listUnifiedAuditEntries()).toHaveLength(1);
    expect(countAuditLogLines()).toBe(2);
    expect(getAuditQueryIndexStatsForTests().lineCount).toBe(2);
  });
});
