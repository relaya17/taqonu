import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatchFiles, proposePatch, rollbackPatchFiles } from "./patch-engine.js";

describe("proposePatch / applyPatchFiles", () => {
  it("proposes a modify when an existing matching file is named", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-patch-mod-"));
    writeFileSync(join(root, "hello.ts"), "export const greeting = 'hello';\n", "utf8");
    const proposal = proposePatch({
      workspaceRoot: root,
      mode: "refactor",
      userRequest: "hello.ts: change the greeting export comment",
    });
    expect(proposal.filesChanged.some((f) => f.path === "hello.ts" && f.action === "modify")).toBe(
      true,
    );
  });

  it("proposes and applies a delete for an explicit delete instruction", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-patch-del-"));
    writeFileSync(join(root, "disposable.ts"), "export const gone = true;\n", "utf8");
    const proposal = proposePatch({
      workspaceRoot: root,
      mode: "refactor",
      userRequest: "delete disposable.ts because it is a sandbox marker",
    });
    const del = proposal.filesChanged.find((f) => f.path === "disposable.ts");
    expect(del?.action).toBe("delete");
    const applied = applyPatchFiles(root, proposal.filesChanged);
    expect(applied.applied).toContain("disposable.ts");
    expect(existsSync(join(root, "disposable.ts"))).toBe(false);
  });

  it("applies a modify and leaves unrelated files in place", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-patch-apply-mod-"));
    writeFileSync(join(root, "hello.ts"), "export const greeting = 'hello';\n", "utf8");
    writeFileSync(join(root, "keep.ts"), "export const keep = true;\n", "utf8");
    const proposal = proposePatch({
      workspaceRoot: root,
      mode: "refactor",
      userRequest: "hello.ts: annotate the greeting export",
    });
    const result = applyPatchFiles(root, proposal.filesChanged);
    expect(result.applied).toContain("hello.ts");
    expect(readFileSync(join(root, "hello.ts"), "utf8")).toContain("ATLAS-PATCH");
    expect(readFileSync(join(root, "keep.ts"), "utf8")).toBe("export const keep = true;\n");
  });

  it("uses focusPath even when the request text starts with Focus file:", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-patch-focus-"));
    writeFileSync(
      join(root, "leaked-credential.ts"),
      "export const accessKeyId = 'AKIA0000000000000001';\n",
      "utf8",
    );
    const proposal = proposePatch({
      workspaceRoot: root,
      mode: "fix",
      focusPath: "leaked-credential.ts",
      userRequest:
        "Focus file: leaked-credential.ts\n\nRemove the hard-coded AWS access key assignment.",
    });
    expect(
      proposal.filesChanged.some(
        (f) => f.path === "leaked-credential.ts" && f.action === "modify",
      ),
    ).toBe(true);
  });

  it("does not emit a comment-only secure patch", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-patch-secure-comment-"));
    writeFileSync(
      join(root, "leaked-credential.ts"),
      "export const accessKeyId = 'AKIA0000000000000001';\n",
      "utf8",
    );
    const proposal = proposePatch({
      workspaceRoot: root,
      mode: "secure",
      focusPath: "leaked-credential.ts",
      userRequest: "Remove the hard-coded AWS access key assignment.",
    });
    expect(proposal.filesChanged).toEqual([]);
  });
});

describe("rollbackPatchFiles contract", () => {
  it("removes files that did not exist before apply (previousContent null)", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-rb-add-"));
    writeFileSync(join(root, "keep.txt"), "untouched\n", "utf8");
    const applied = applyPatchFiles(root, [
      { path: "added.txt", action: "add", summary: "add", afterContent: "new\n" },
    ]);
    expect(existsSync(join(root, "added.txt"))).toBe(true);
    expect(applied.rollbackSnapshot).toEqual([{ path: "added.txt", previousContent: null }]);
    const restored = rollbackPatchFiles(root, applied.rollbackSnapshot);
    expect(restored).toEqual(["added.txt"]);
    expect(existsSync(join(root, "added.txt"))).toBe(false);
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("untouched\n");
  });

  it("rewrites modified files and restores deleted files; leaves unrelated files", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-rb-mix-"));
    writeFileSync(join(root, "edit.txt"), "before\n", "utf8");
    writeFileSync(join(root, "gone.txt"), "was-here\n", "utf8");
    writeFileSync(join(root, "keep.txt"), "untouched\n", "utf8");
    const applied = applyPatchFiles(root, [
      { path: "edit.txt", action: "modify", summary: "edit", afterContent: "after\n" },
      { path: "gone.txt", action: "delete", summary: "delete" },
    ]);
    expect(readFileSync(join(root, "edit.txt"), "utf8")).toBe("after\n");
    expect(existsSync(join(root, "gone.txt"))).toBe(false);
    const restored = rollbackPatchFiles(root, applied.rollbackSnapshot);
    expect(restored.sort()).toEqual(["edit.txt", "gone.txt"]);
    expect(readFileSync(join(root, "edit.txt"), "utf8")).toBe("before\n");
    expect(readFileSync(join(root, "gone.txt"), "utf8")).toBe("was-here\n");
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("untouched\n");
  });

  it("skips path traversal entries", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-rb-trav-"));
    writeFileSync(join(root, "ok.txt"), "ok\n", "utf8");
    const restored = rollbackPatchFiles(root, [
      { path: "../escape.txt", previousContent: "nope\n" },
    ]);
    expect(restored).toEqual([]);
    expect(readFileSync(join(root, "ok.txt"), "utf8")).toBe("ok\n");
  });
});
