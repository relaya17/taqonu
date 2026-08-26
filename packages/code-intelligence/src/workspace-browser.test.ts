import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listWorkspaceTree,
  readWorkspaceFile,
  resolveUnderWorkspace,
  writeWorkspaceFile,
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
    expect(view.readOnly).toBe(false);
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

  it("writes text files and blocks path escape", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-studio-write-"));
    const written = writeWorkspaceFile(root, "src/hello.ts", "export const n = 1;\n");
    expect(written.readOnly).toBe(false);
    expect(written.path).toBe("src/hello.ts");
    const view = readWorkspaceFile(root, "src/hello.ts");
    expect(view.content).toContain("export const n = 1");
    expect(() => writeWorkspaceFile(root, "../outside.ts", "nope")).toThrow(
      /escapes/,
    );
  });
});
