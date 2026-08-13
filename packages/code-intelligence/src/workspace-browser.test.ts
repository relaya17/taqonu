import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listWorkspaceTree,
  readWorkspaceFile,
  resolveUnderWorkspace,
} from "./workspace-browser.js";

describe("workspace-browser", () => {
  it("lists tree and skips node_modules", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-studio-"));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "src", "main.ts"), "console.log(1)\n");
    writeFileSync(join(root, "node_modules", "pkg", "x.js"), "secret");

    const listed = listWorkspaceTree(root);
    expect(listed.readOnly).toBe(true);
    expect(listed.tree.children?.some((c) => c.name === "node_modules")).toBe(
      false,
    );
    expect(listed.tree.children?.some((c) => c.name === "src")).toBe(true);
  });

  it("reads text files and blocks path escape", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-studio-"));
    writeFileSync(join(root, "readme.md"), "# hi\n");
    const view = readWorkspaceFile(root, "readme.md");
    expect(view.readOnly).toBe(true);
    expect(view.content).toContain("# hi");
    expect(() => resolveUnderWorkspace(root, "../outside")).toThrow(
      /escapes/,
    );
  });

  it("skips symlinks in tree", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-studio-"));
    writeFileSync(join(root, "real.txt"), "ok");
    try {
      symlinkSync(join(root, "real.txt"), join(root, "link.txt"));
    } catch {
      // Windows without symlink privilege — skip assertion
      return;
    }
    const listed = listWorkspaceTree(root);
    expect(listed.tree.children?.some((c) => c.name === "link.txt")).toBe(
      false,
    );
    expect(listed.tree.children?.some((c) => c.name === "real.txt")).toBe(true);
  });
});
