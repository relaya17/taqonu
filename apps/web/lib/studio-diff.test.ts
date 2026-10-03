import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, studioDiffChangedLines, studioDiffFileFor } from "./studio-diff";

const SAMPLE_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,4 +1,5 @@",
  " line one",
  "-old line two",
  "+new line two",
  "+added line three",
  " line four",
  "diff --git a/src/b.ts b/src/b.ts",
  "index 3333333..4444444 100644",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -10,2 +10,3 @@",
  " context",
  "+inserted",
  " trailing",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("parses hunks per file with new-file changed line numbers", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    expect(files).toHaveLength(2);
    const a = studioDiffFileFor(files, "src/a.ts");
    expect(a).not.toBeNull();
    expect(a!.hunks).toHaveLength(1);
    expect(a!.hunks[0]!.newStart).toBe(1);
    expect(a!.hunks[0]!.changedLines).toEqual([2, 3]);

    const b = studioDiffFileFor(files, "src/b.ts");
    expect(b).not.toBeNull();
    expect(b!.hunks[0]!.changedLines).toEqual([11]);
  });

  it("returns an empty list for an empty diff (no changes)", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("flattens and sorts changed lines for the gutter marker", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const a = studioDiffFileFor(files, "src/a.ts");
    expect(studioDiffChangedLines(a)).toEqual([2, 3]);
    expect(studioDiffChangedLines(null)).toEqual([]);
  });

  it("returns null for a file not present in the diff", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    expect(studioDiffFileFor(files, "src/missing.ts")).toBeNull();
  });
});
