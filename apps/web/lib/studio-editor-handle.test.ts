import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STUDIO_EDITOR_LINE_HEIGHT,
  findNextStudioMatch,
  studioEditorScrollTop,
} from "./studio-editor-handle";

describe("findNextStudioMatch", () => {
  const text = "alpha beta alpha gamma";

  it("finds the first match at or after the offset", () => {
    expect(findNextStudioMatch(text, "alpha", 0)).toBe(0);
    expect(findNextStudioMatch(text, "alpha", 1)).toBe(11);
  });

  it("wraps to the start once when nothing follows the offset", () => {
    expect(findNextStudioMatch(text, "alpha", 12)).toBe(0);
  });

  it("returns -1 when the needle is absent", () => {
    expect(findNextStudioMatch(text, "delta", 0)).toBe(-1);
  });
});

describe("studioEditorScrollTop", () => {
  it("keeps the previous scroll maths", () => {
    expect(studioEditorScrollTop(11, 40)).toBeCloseTo(10 * STUDIO_EDITOR_LINE_HEIGHT - 40);
    expect(studioEditorScrollTop(11, 60)).toBeCloseTo(10 * STUDIO_EDITOR_LINE_HEIGHT - 60);
  });

  it("never scrolls above the top", () => {
    expect(studioEditorScrollTop(1, 40)).toBe(0);
    expect(studioEditorScrollTop(2, 60)).toBe(0);
  });
});

describe("editor boundary", () => {
  const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

  it("keeps the studio page off the textarea DOM", () => {
    const page = read("../app/[locale]/studio/page.tsx");
    expect(page).not.toContain("data-studio-editor");
    expect(page).not.toContain("execCommand");
    expect(page).not.toContain("setSelectionRange");
    expect(page).not.toContain("HTMLTextAreaElement");
    expect(page).toContain("editorRef={editorRef}");
  });
});
