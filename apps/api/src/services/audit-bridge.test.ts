import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setAuditLogPathForTests, verifyAuditLogChain } from "./audit-log.js";
import {
  assertCpHashContinuity,
  importCpAuditBatch,
  type CpAuditEntry,
} from "./audit-bridge.js";

function entry(seq: number, hash: string, prevHash: string): CpAuditEntry {
  return {
    seq,
    timestamp: "2026-09-04T00:00:00.000Z",
    type: "gateway.decision",
    actorId: "cp:service",
    actorKind: "SYSTEM",
    reason: "test",
    policy: "DOCUMENT.READ",
    risk: "LOW",
    approval: "NOT_REQUIRED",
    result: "SUCCESS",
    ownerId: "00000000-0000-4000-8000-def000000000",
    projectId: null,
    hash,
    prevHash,
  };
}

describe("audit-bridge CP import", () => {
  beforeEach(() => {
    const dir = join(
      tmpdir(),
      `atlas-audit-bridge-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
  });

  it("merges CP hashes as provenance into the canonical API chain", () => {
    const first = importCpAuditBatch([
      entry(1, "cp-hash-1", "GENESIS"),
      entry(2, "cp-hash-2", "cp-hash-1"),
    ]);
    expect(first.imported).toBe(2);
    expect(first.records[0]?.payload["cpHash"]).toBe("cp-hash-1");
    expect(verifyAuditLogChain().status).toBe("VALID");
  });

  it("dedups by cpHash so a retry does not rewrite history", () => {
    const payload = [entry(1, "cp-hash-1", "GENESIS")];
    expect(importCpAuditBatch(payload).imported).toBe(1);
    const retry = importCpAuditBatch(payload);
    expect(retry.imported).toBe(0);
    expect(retry.skipped).toBe(1);
    expect(verifyAuditLogChain().status).toBe("VALID");
  });

  it("fail-closes a broken Control Plane hash sequence", () => {
    expect(() =>
      assertCpHashContinuity([
        entry(1, "cp-hash-1", "GENESIS"),
        entry(2, "cp-hash-2", "wrong-prev"),
      ]),
    ).toThrow(/hash break/);
    expect(() =>
      importCpAuditBatch([
        entry(1, "cp-hash-1", "GENESIS"),
        entry(2, "cp-hash-2", "wrong-prev"),
      ]),
    ).toThrow(/hash break/);
  });
});
