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
      offsiteDir: null,
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

  it("replicas a verified copy to a configured directory and records offsite true", () => {
    const offsiteDir = mkdtempSync(join(tmpdir(), "atlas-dr-offsite-"));
    const result = runCanonicalAuditRestoreDrill({
      sourcePath: join(sourceDir, "audit.ndjson"),
      drillDir,
      offsiteDir,
    });
    expect(result.ok).toBe(true);
    expect(result.offsite).toBe(true);
    expect(result.offsitePath).toBe(join(offsiteDir, "audit.ndjson"));
    expect(result.offsiteChecksum).toMatch(/^[a-f0-9]{64}$/);
    rmSync(offsiteDir, { recursive: true, force: true });
  });
});
