import { describe, expect, it } from "vitest";
import { excerptsAppearContradictory } from "./retrieval-conflict.js";

describe("retrieval conflict helper", () => {
  it("does not invent a conflict from unrelated excerpts", () => {
    expect(
      excerptsAppearContradictory(
        "GitHub REST API overview documentation",
        "AuthZ defense in depth with RLS",
      ),
    ).toBe(false);
  });

  it("flags overlapping excerpts with an explicit never/always pair", () => {
    expect(
      excerptsAppearContradictory(
        "Rate limiting exists and is required for production APIs always.",
        "Rate limiting exists and is never required for production APIs.",
      ),
    ).toBe(true);
  });
});
