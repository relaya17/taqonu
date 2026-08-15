import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSecuritySpecialistViaSentinel } from "./security-sentinel-dispatch.js";

describe("runSecuritySpecialistViaSentinel", () => {
  it("returns null when no workspace is bound", () => {
    expect(
      runSecuritySpecialistViaSentinel({
        request: "review auth",
        projectId: null,
      }),
    ).toBeNull();
  });

  it("publishes OBSERVED Sentinel findings instead of a stub", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-sec-dispatch-"));
    writeFileSync(
      join(root, "leak.ts"),
      'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n',
      "utf8",
    );
    const run = runSecuritySpecialistViaSentinel({
      request: "security review",
      workspaceRoot: root,
    });
    expect(run).not.toBeNull();
    expect(run?.agentId).toBe("SECURITY");
    expect(run?.epistemicState).toBe("OBSERVED");
    expect(run?.summary).toMatch(/Sentinel/);
    expect(run?.claims.some((c) => c.includes("WRITE=forbidden"))).toBe(true);
  });
});
