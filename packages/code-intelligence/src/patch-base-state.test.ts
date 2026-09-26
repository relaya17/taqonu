import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureBaseState,
  checkPatchApplicable,
  checkRollbackApplicable,
  sha256Text,
} from "./patch-engine.js";

/** Stage 5 (approved D3): base-state capture and stale-write protection. */
describe("patch base state", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ci-base-state-"));
    writeFileSync(join(root, "a.txt"), "A", "utf8");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("captures sha256 for existing files and null for absent ones", () => {
    const files = captureBaseState(root, [
      { path: "a.txt", action: "modify" as const },
      { path: "new.txt", action: "add" as const },
    ]);
    expect(files[0]?.baseSha256).toBe(sha256Text("A"));
    expect(files[1]?.baseSha256).toBeNull();
  });

  it("unchanged base: no conflicts", () => {
    expect(
      checkPatchApplicable(root, [
        { path: "a.txt", action: "modify", afterContent: "B", baseSha256: sha256Text("A") },
        { path: "new.txt", action: "add", afterContent: "N", baseSha256: null },
      ]),
    ).toEqual([]);
  });

  it("changed base, created file, missing base, add-over-existing, unsafe path, no content", () => {
    const reasons = checkPatchApplicable(root, [
      { path: "a.txt", action: "modify", afterContent: "B", baseSha256: sha256Text("OLD") },
      { path: "a.txt", action: "add", afterContent: "B", baseSha256: sha256Text("A") },
      { path: "a.txt", action: "modify", afterContent: "B" },
      { path: "../x.txt", action: "modify", afterContent: "B", baseSha256: null },
      { path: "a.txt", action: "modify", baseSha256: sha256Text("A") },
      { path: "gone.txt", action: "delete", baseSha256: null },
    ]).map((c) => c.reason);
    expect(reasons).toEqual([
      "file changed since the patch was proposed",
      "create would replace an existing file",
      "no recorded base state; propose the change again",
      "unsafe path",
      "no content to write",
      "delete target did not exist",
    ]);
  });

  it("rollback: allowed only while the file still holds what Apply wrote", () => {
    const files = [{ path: "a.txt", action: "modify" as const, afterContent: "A" }];
    const snapshot = [{ path: "a.txt", previousContent: "ORIGINAL" }];
    expect(checkRollbackApplicable(root, files, snapshot)).toEqual([]);
    writeFileSync(join(root, "a.txt"), "LATER EDIT", "utf8");
    expect(checkRollbackApplicable(root, files, snapshot)[0]?.reason).toBe(
      "file changed since the patch was applied",
    );
  });
});
