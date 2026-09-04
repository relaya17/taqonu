import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAuditLogLine, setAuditLogPathForTests } from "./audit-log.js";
import { runCanonicalAuditRestoreDrill } from "./disaster-recovery-drill.js";

describe("canonical audit restore drill", () => {
  let sourceDir: string;
  let drillDir: string;

  beforeEach(() => {
    sourceDir = mkdtempSync(join(tmpdir(), "atlas-dr-source-"));
    drillDir = mkdtempSync(join(tmpdir(), "atlas-dr-drill-"));
    setAuditLogPathForTests(join(sourceDir, "audit.ndjson"));
    appendAuditLogLine({ type: "agent.run.completed", runId: "r1" });
    appendAuditLogLine({ type: "agents.plan", planId: "p1" });
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(drillDir, { recursive: true, force: true });
  });

  it("proves a restored copy still verifies and does not claim offsite", () => {
    const result = runCanonicalAuditRestoreDrill({
      sourcePath: join(sourceDir, "audit.ndjson"),
      drillDir,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("VALID");
    expect(result.offsite).toBe(false);
    expect(result.checked).toBe(2);
    const receipt = JSON.parse(
      readFileSync(join(drillDir, "receipt.json"), "utf8"),
    ) as { offsite: boolean; status: string };
    expect(receipt.offsite).toBe(false);
    expect(receipt.status).toBe("VALID");
  });
});
