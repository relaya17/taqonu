import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyWorkspaceReplace, previewWorkspaceReplace } from "./workspace-replace.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("workspace replace", () => {
  it("previews exact matches and skips .env", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-replace-"));
    dirs.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "const token = 'alpha';\n");
    writeFileSync(join(root, "src", "b.ts"), "const other = 'alpha';\n");
    writeFileSync(join(root, ".env"), "alpha=secret\n");
    const preview = previewWorkspaceReplace(root, "alpha", "beta");
    expect(preview.items.map((row) => row.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(preview.items[0]?.nextPreview).toContain("beta");
    expect(preview.blocked.some((path) => path.includes(".env"))).toBe(true);
  });

  it("applies only selected files and never writes .env", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-replace-apply-"));
    dirs.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "const token = 'alpha';\n");
    writeFileSync(join(root, "src", "b.ts"), "const other = 'alpha';\n");
    writeFileSync(join(root, ".env"), "alpha=secret\n");
    const result = applyWorkspaceReplace(root, "alpha", "beta", ["src/a.ts", ".env"]);
    expect(result.written.map((row) => row.path)).toEqual(["src/a.ts"]);
    expect(result.skipped).toContain(".env");
    expect(readFileSync(join(root, "src", "a.ts"), "utf8")).toContain("beta");
    expect(readFileSync(join(root, "src", "b.ts"), "utf8")).toContain("alpha");
    expect(readFileSync(join(root, ".env"), "utf8")).toContain("alpha=secret");
  });
});
