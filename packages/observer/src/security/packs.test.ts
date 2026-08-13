import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runSpecialistPacks } from "./packs.js";
import { runSentinelScan } from "./scan.js";

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("specialist packs", () => {
  it("flags dangerouslySetInnerHTML as web pack HIGH", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-packs-"));
    temps.push(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p" }));
    writeFileSync(
      join(dir, "src", "Widget.tsx"),
      `export function W({ html }: { html: string }) {\n  return <div dangerouslySetInnerHTML={{ __html: html }} />;\n}\n`,
    );
    const findings = runSpecialistPacks(dir);
    expect(findings.some((f) => f.pack === "web" && f.id.includes("xss"))).toBe(
      true,
    );
  });

  it("includes packs in Sentinel scan counts", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-packs-scan-"));
    temps.push(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p" }));
    writeFileSync(
      join(dir, "src", "evil.ts"),
      `export const bad = eval("1+1");\n`,
    );
    const scan = runSentinelScan(dir, { persist: false });
    expect(scan.counts.packs).toBeGreaterThan(0);
    expect(scan.packs.length).toBe(scan.counts.packs);
  });
});
