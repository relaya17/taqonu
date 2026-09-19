import { describe, expect, it } from "vitest";
import { replaceInStudioBuffer } from "./studio-buffer-replace";

describe("replaceInStudioBuffer", () => {
  it("replaces one occurrence in the draft buffer only", () => {
    expect(replaceInStudioBuffer("alpha beta alpha", "alpha", "γ", "one")).toEqual({
      next: "γ beta alpha",
      count: 1,
    });
  });

  it("replaces all occurrences and reports the count", () => {
    expect(replaceInStudioBuffer("alpha beta alpha", "alpha", "γ", "all")).toEqual({
      next: "γ beta γ",
      count: 2,
    });
  });

  it("does not invent matches for an empty find string", () => {
    expect(replaceInStudioBuffer("keep", "", "x", "all")).toEqual({
      next: "keep",
      count: 0,
    });
  });
});
