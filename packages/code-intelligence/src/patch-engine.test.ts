import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatchFiles, proposePatch } from "./patch-engine.js";

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
