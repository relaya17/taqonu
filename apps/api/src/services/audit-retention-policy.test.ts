import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setAuditLogPathForTests } from "./audit-log.js";
import {
  MEMORY_TTL_KIND,
  OPERATIONAL_TTL_KIND,
  PRODUCT_AUDIT_RETENTION_KIND,
  evaluateProductAuditRetention,
  isMemoryTtlProductRetention,
  isOperationalTtlProductRetention,
  productAuditRetentionEnabled,
  refuseDestructiveCanonicalAuditRetention,
} from "./audit-retention-policy.js";

describe("R20 product audit retention", () => {
  afterEach(() => {
    setAuditLogPathForTests(null);
  });

  it("keeps operational nonce/decision TTL and R10 memory TTL out of this policy", () => {
    expect(isOperationalTtlProductRetention()).toBe(false);
    expect(isMemoryTtlProductRetention()).toBe(false);
    expect(OPERATIONAL_TTL_KIND).toBe("OPERATIONAL_TTL_NOT_PRODUCT_RETENTION");
    expect(MEMORY_TTL_KIND).toBe("R10_MEMORY_TTL_NOT_R20");
    expect(PRODUCT_AUDIT_RETENTION_KIND).toBe("PRODUCT_AUDIT_RETENTION");
  });

  it("retains every subject while offsite is not configured", () => {
    const nowMs = Date.parse("2026-09-23T18:00:00.000Z");
    const result = evaluateProductAuditRetention({
      offsiteStatus: "OFFSITE_NOT_CONFIGURED",
      retentionDays: 30,
      nowMs,
      subjects: [
        { id: "old", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "new", createdAt: "2026-09-23T00:00:00.000Z" },
      ],
    });
    expect(productAuditRetentionEnabled("OFFSITE_NOT_CONFIGURED")).toBe(false);
    expect(result.action).toBe("RETAIN_ALL");
    expect(result.applied).toBe(false);
    expect(result.expiredIds).toEqual([]);
    expect(result.retainedIds).toEqual(["old", "new"]);
  });

  it("retains every subject when offsite is rejected", () => {
    const result = evaluateProductAuditRetention({
      offsiteStatus: "REJECTED",
      retentionDays: 1,
      nowMs: Date.parse("2026-09-23T18:00:00.000Z"),
      subjects: [{ id: "old", createdAt: "2020-01-01T00:00:00.000Z" }],
    });
    expect(result.action).toBe("RETAIN_ALL");
    expect(result.expiredIds).toEqual([]);
  });

  it("identifies expired disposable subjects only after offsite VERIFIED", () => {
    const nowMs = Date.parse("2026-09-23T00:00:00.000Z");
    const result = evaluateProductAuditRetention({
      offsiteStatus: "VERIFIED",
      retentionDays: 30,
      nowMs,
      subjects: [
        { id: "expired", createdAt: "2026-08-01T00:00:00.000Z" },
        { id: "kept", createdAt: "2026-09-20T00:00:00.000Z" },
      ],
    });
    expect(result.action).toBe("IDENTIFY_EXPIRED");
    expect(result.applied).toBe(false);
    expect(result.expiredIds).toEqual(["expired"]);
    expect(result.retainedIds).toEqual(["kept"]);
  });

  it("retains all when offsite is VERIFIED but retentionDays is not a positive integer", () => {
    const result = evaluateProductAuditRetention({
      offsiteStatus: "VERIFIED",
      retentionDays: null,
      subjects: [{ id: "a", createdAt: "2020-01-01T00:00:00.000Z" }],
    });
    expect(result.action).toBe("RETAIN_ALL");
    expect(result.expiredIds).toEqual([]);
  });

  it("refuses destructive apply against the canonical audit path", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-r20-canonical-"));
    const canonical = join(dir, "audit.ndjson");
    setAuditLogPathForTests(canonical);
    const refused = refuseDestructiveCanonicalAuditRetention({});
    expect(refused.applied).toBe(false);
    expect(refused.deleted).toBe(0);
    expect(refused.reason).toMatch(/canonical audit path/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses destructive purge even on a disposable path", () => {
    const refused = refuseDestructiveCanonicalAuditRetention({
      targetPath: join(tmpdir(), "disposable-audit.ndjson"),
    });
    expect(refused.applied).toBe(false);
    expect(refused.deleted).toBe(0);
    expect(refused.reason).toMatch(/not implemented/);
  });
});
