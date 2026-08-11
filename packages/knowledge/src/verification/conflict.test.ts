import { describe, expect, it } from "vitest";
import { detectConflict } from "./conflict.js";

describe("detectConflict", () => {
  it("prefers newer higher-authority claim without merging", () => {
    const result = detectConflict(
      {
        id: "a",
        statement: "Feature X exists",
        authorityWeight: 1,
        at: new Date("2026-05-01"),
      },
      {
        id: "b",
        statement: "Feature X was deprecated",
        authorityWeight: 1,
        at: new Date("2026-08-01"),
      },
      true,
    );

    expect(result.conflicted).toBe(true);
    expect(result.preferredClaimId).toBe("b");
  });
});
