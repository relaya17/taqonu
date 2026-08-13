import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectAuthzRegressions } from "./authz-regression.js";
import { detectDependencyAdvisories } from "./deps.js";
import { isVersionBelow } from "./advisories.js";
import { verifySentinelFinding } from "./verify.js";

describe("isVersionBelow", () => {
  it("compares semver ranges", () => {
    expect(isVersionBelow("7.5.1", "7.5.2")).toBe(true);
    expect(isVersionBelow("7.5.2", "7.5.2")).toBe(false);
  });
});

describe("detectDependencyAdvisories", () => {
  it("flags allowlisted vulnerable declared versions", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-deps-"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: { semver: "7.5.1" },
      }),
      "utf8",
    );
    const findings = detectDependencyAdvisories(root);
    expect(findings.some((f) => f.packageName === "semver")).toBe(true);
  });
});

describe("detectAuthzRegressions", () => {
  it("detects lost guards against baseline", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-authz-"));
    mkdirSync(join(root, "src"), { recursive: true });
    const route = join(root, "src", "payment-route.ts");
    writeFileSync(
      route,
      `export function POST() { requireAuth(); charge(); }\n`,
      "utf8",
    );
    detectAuthzRegressions(root, { persistBaseline: true });
    writeFileSync(route, `export function POST() { charge(); }\n`, "utf8");
    const findings = detectAuthzRegressions(root, { persistBaseline: false });
    expect(findings.some((f) => f.id.includes("authz-lost-guard"))).toBe(true);
  });
});

describe("verifySentinelFinding", () => {
  it("verifies absence of unknown finding id", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-verify-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "t" }), "utf8");
    const result = verifySentinelFinding(root, "sentinel:missing-id");
    expect(result.verified).toBe(true);
    expect(result.stillPresent).toBe(false);
  });
});
