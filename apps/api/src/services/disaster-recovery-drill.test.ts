import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAuditLogLine, setAuditLogPathForTests } from "./audit-log.js";
import { runCanonicalAuditRestoreDrill, restoreCanonicalAuditFromReplica } from "./disaster-recovery-drill.js";

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

  it("restores from the replica into an isolated directory and never overwrites canonical", () => {
    const offsiteDir = mkdtempSync(join(tmpdir(), "atlas-dr-offsite-"));
    const restoreDir = mkdtempSync(join(tmpdir(), "atlas-dr-restore-"));
    const drilled = runCanonicalAuditRestoreDrill({
      sourcePath: join(sourceDir, "audit.ndjson"),
      drillDir,
      offsiteDir,
    });
    expect(drilled.offsitePath).toBeTruthy();
    const restored = restoreCanonicalAuditFromReplica({
      replicaPath: drilled.offsitePath as string,
      restoreDir,
    });
    expect(restored.ok).toBe(true);
    expect(restored.status).toBe("VALID");
    expect(restored.overwrittenCanonical).toBe(false);
    expect(restored.restoredPath).toBe(join(restoreDir, "audit.ndjson"));
    expect(readFileSync(join(sourceDir, "audit.ndjson"), "utf8")).toBe(
      readFileSync(restored.restoredPath, "utf8"),
    );
    rmSync(offsiteDir, { recursive: true, force: true });
    rmSync(restoreDir, { recursive: true, force: true });
  });

  it("refuses to restore a missing replica", () => {
    const restoreDir = mkdtempSync(join(tmpdir(), "atlas-dr-restore-missing-"));
    const restored = restoreCanonicalAuditFromReplica({
      replicaPath: join(restoreDir, "absent.ndjson"),
      restoreDir,
    });
    expect(restored.ok).toBe(false);
    expect(restored.overwrittenCanonical).toBe(false);
    rmSync(restoreDir, { recursive: true, force: true });
  });

  it("refuses a tampered replica and still does not overwrite canonical", () => {
    const offsiteDir = mkdtempSync(join(tmpdir(), "atlas-dr-offsite-bad-"));
    const restoreDir = mkdtempSync(join(tmpdir(), "atlas-dr-restore-bad-"));
    const drilled = runCanonicalAuditRestoreDrill({
      sourcePath: join(sourceDir, "audit.ndjson"),
      drillDir,
      offsiteDir,
    });
    appendFileSync(drilled.offsitePath as string, "{not-a-valid-audit-line}\n", "utf8");
    const restored = restoreCanonicalAuditFromReplica({
      replicaPath: drilled.offsitePath as string,
      restoreDir,
    });
    expect(restored.ok).toBe(false);
    expect(restored.overwrittenCanonical).toBe(false);
    expect(readFileSync(join(sourceDir, "audit.ndjson"), "utf8")).not.toContain(
      "not-a-valid-audit-line",
    );
    rmSync(offsiteDir, { recursive: true, force: true });
    rmSync(restoreDir, { recursive: true, force: true });
  });
});
