import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectDependencyAdvisories } from "./deps.js";

describe("detectDependencyAdvisories lockfile lookup", () => {
  it("finishes quickly on a large lockfile that would ReDoS nested .*\\n matchers", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-deps-redos-"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: { semver: "7.0.0" },
      }),
      "utf8",
    );
    const poison = Array.from({ length: 12_000 }, () => "a".repeat(80)).join("\n");
    writeFileSync(
      join(root, "pnpm-lock.yaml"),
      `lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies:\n      semver:\n        specifier: 7.0.0\n        version: 7.0.0\n\npackages:\n\n${poison}\n  semver@7.0.0:\n    engines: {node: '>=10'}\n`,
      "utf8",
    );
    const started = Date.now();
    const findings = detectDependencyAdvisories(root);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(Array.isArray(findings)).toBe(true);
  });
});
