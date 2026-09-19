import { describe, expect, it } from "vitest";
import {
  STUDIO_MAX_OPEN_FILES,
  addOpenStudioFile,
  anyStudioBufferDirty,
  closeOpenStudioFile,
  markStudioFileSaved,
  mergeStudioFileFromDisk,
  studioBufferIsDirty,
  studioFileBaseName,
} from "./studio-workspace";

describe("studio open files", () => {
  it("adds unique paths and evicts oldest past the cap", () => {
    let open: string[] = [];
    for (let i = 0; i < STUDIO_MAX_OPEN_FILES + 2; i += 1) {
      open = addOpenStudioFile(open, `f${i}.ts`);
    }
    expect(open).toHaveLength(STUDIO_MAX_OPEN_FILES);
    expect(open[0]).toBe("f2.ts");
    expect(addOpenStudioFile(open, "f3.ts")).toEqual(open);
  });

  it("closes the active file onto a neighbor", () => {
    const closed = closeOpenStudioFile(["a.ts", "b.ts", "c.ts"], "b.ts");
    expect(closed.open).toEqual(["a.ts", "c.ts"]);
    expect(closed.nextActive).toBe("a.ts");
    expect(closeOpenStudioFile(["only.ts"], "only.ts").nextActive).toBeNull();
  });
});

describe("studio buffers", () => {
  it("keeps unsaved drafts when disk content changes", () => {
    const first = mergeStudioFileFromDisk({}, "a.ts", "one");
    expect(studioBufferIsDirty(first.buffers["a.ts"])).toBe(false);
    const edited = {
      "a.ts": { draft: "two", saved: "one" },
    };
    const disk = mergeStudioFileFromDisk(edited, "a.ts", "three");
    expect(disk.diskChangedWhileDirty).toBe(true);
    expect(disk.buffers["a.ts"]).toEqual({ draft: "two", saved: "three" });
    expect(studioBufferIsDirty(disk.buffers["a.ts"])).toBe(true);
  });

  it("reloads from disk when the buffer is clean", () => {
    const reloaded = mergeStudioFileFromDisk(
      { "a.ts": { draft: "one", saved: "one" } },
      "a.ts",
      "fresh",
    );
    expect(reloaded.diskChangedWhileDirty).toBe(false);
    expect(reloaded.buffers["a.ts"]).toEqual({ draft: "fresh", saved: "fresh" });
  });

  it("marks saved after a successful write", () => {
    const saved = markStudioFileSaved(
      { "a.ts": { draft: "two", saved: "one" } },
      "a.ts",
    );
    expect(studioBufferIsDirty(saved["a.ts"])).toBe(false);
    expect(anyStudioBufferDirty(saved)).toBe(false);
  });

  it("uses the last path segment as the tab label", () => {
    expect(studioFileBaseName("apps/web/lib/studio.ts")).toBe("studio.ts");
  });
});
