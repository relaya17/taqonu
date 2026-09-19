import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, studioPatchChangeSet } from "./studio-patch-diff";

describe("parseUnifiedDiff", () => {
  it("classifies additions, removals, and context", () => {
    const lines = parseUnifiedDiff(
      [
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,3 +1,4 @@",
        " keep",
        "-old",
        "+new",
        "+also",
      ].join("\n"),
    );
    expect(lines.map((l) => l.kind)).toEqual([
      "meta",
      "meta",
      "hunk",
      "ctx",
      "del",
      "add",
      "add",
    ]);
    expect(lines.find((l) => l.kind === "del")?.text).toBe("old");
    expect(lines.filter((l) => l.kind === "add").map((l) => l.text)).toEqual([
      "new",
      "also",
    ]);
  });
});

describe("studioPatchChangeSet", () => {
  it("builds a multi-file change set from the existing Patch model", () => {
    const set = studioPatchChangeSet([
      {
        path: "src/a.ts",
        action: "modify",
        summary: "rename",
        unifiedDiff: "@@\n-old\n+new\n",
      },
      {
        path: "src/b.ts",
        action: "add",
        summary: "create",
        afterContent: "export const ok = true;",
      },
      {
        path: "src/gone.ts",
        action: "delete",
        summary: "reserved",
      },
    ]);
    expect(set.files).toHaveLength(3);
    expect(set.files[0]?.action).toBe("modify");
    expect(set.files[1]?.action).toBe("add");
    expect(set.files[2]?.action).toBe("delete");
    expect(set.additions).toBeGreaterThan(0);
    expect(set.deletions).toBe(1);
    expect(set.files[1]?.lines.every((l) => l.kind === "add")).toBe(true);
    expect(set.files[2]?.lines).toEqual([]);
  });

  it("does not invent hunks for empty or incomplete Patch filesChanged", () => {
    expect(studioPatchChangeSet([])).toEqual({
      files: [],
      additions: 0,
      deletions: 0,
    });
    const incomplete = studioPatchChangeSet([
      { path: "src/empty.ts", action: "modify" },
    ]);
    expect(incomplete.files).toHaveLength(1);
    expect(incomplete.files[0]?.path).toBe("src/empty.ts");
    expect(incomplete.files[0]?.lines).toEqual([]);
    expect(incomplete.additions).toBe(0);
    expect(incomplete.deletions).toBe(0);
  });
});
