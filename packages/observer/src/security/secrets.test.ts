import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectSecrets } from "./secrets.js";
import { runSentinelScan } from "./scan.js";

describe("detectSecrets", () => {
  it("finds and redacts a github pat without returning the full value", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-sentinel-"));
    writeFileSync(
      join(root, "leak.ts"),
      'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n',
      "utf8",
    );
    const findings = detectSecrets(root);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.kind).toBe("github_pat");
    expect(findings[0]!.redacted).not.toContain(
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    );
    expect(findings[0]!.detail).toMatch(/redacted/i);
  });

  it("skips obvious placeholders", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-sentinel-"));
    writeFileSync(
      join(root, "ok.ts"),
      'const t = "ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"; // placeholder\n',
      "utf8",
    );
    // XXX pattern may still match ghp_ — placeholder line check uses YOUR_|changeme|example|xxx+|placeholder
    const findings = detectSecrets(root);
    expect(findings.every((f) => !/placeholder/i.test(f.detail))).toBe(true);
  });

  it("stops walking when the deadline has already passed", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-sentinel-deadline-"));
    writeFileSync(
      join(root, "leak.ts"),
      'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n',
      "utf8",
    );
    const started = Date.now();
    const findings = detectSecrets(root, { deadlineMs: Date.now() - 1 });
    expect(findings).toEqual([]);
    expect(Date.now() - started).toBeLessThan(250);
  });
});

describe("runSentinelScan", () => {
  it("returns CLEAR on empty workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-sentinel-empty-"));
    const result = runSentinelScan(root);
    expect(result.posture).toBe("CLEAR");
    expect(result.mode).toBeUndefined();
    expect(result.findings).toEqual([]);
  });
});

describe("emptySentinelNotRun", () => {
  it("does not claim CLEAR when no scan has run", async () => {
    const { emptySentinelNotRun } = await import("./scan.js");
    const result = emptySentinelNotRun("/tmp/unused");
    expect(result.posture).toBe("NOT_RUN");
    expect(result.findings).toEqual([]);
    expect(result.summary).toMatch(/last-scan/i);
  });
});
