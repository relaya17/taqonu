import { describe, expect, it } from "vitest";
import {
  isGitBranchResult,
  isGitDiffResult,
  isGitStatusResult,
  parseGitBranchName,
  parseGitPorcelain,
  porcelainKind,
} from "./studio-git-status";

describe("parseGitPorcelain", () => {
  it("maps XY codes to kinds and rename targets", () => {
    const parsed = parseGitPorcelain(
      [
        " M README.md",
        "?? tmp/note.txt",
        "A  src/new.ts",
        "D  old.ts",
        "R  src/a.ts -> src/b.ts",
        "",
      ].join("\n"),
    );
    expect(parsed).toEqual([
      { path: "README.md", xy: " M", kind: "modified" },
      { path: "tmp/note.txt", xy: "??", kind: "untracked" },
      { path: "src/new.ts", xy: "A ", kind: "added" },
      { path: "old.ts", xy: "D ", kind: "deleted" },
      { path: "src/b.ts", xy: "R ", kind: "renamed" },
    ]);
  });

  it("does not treat vitest output as git status", () => {
    expect(isGitStatusResult({ commandId: "vitest.run", stdout: " M a.ts" })).toBe(
      false,
    );
    expect(isGitStatusResult({ commandId: "git.status", stdout: "" })).toBe(true);
    expect(porcelainKind("??")).toBe("untracked");
  });

  it("distinguishes branch and diff command results", () => {
    expect(isGitBranchResult({ commandId: "git.branch" })).toBe(true);
    expect(isGitDiffResult({ commandId: "git.diff" })).toBe(true);
    expect(isGitBranchResult({ commandId: "git.status" })).toBe(false);
    expect(parseGitBranchName("main\n")).toBe("main");
  });
});
