import { describe, expect, it } from "vitest";
import { isActiveMemory } from "./memory-active";

describe("isActiveMemory", () => {
  it("keeps ACTIVE rows and hides SUPERSEDED ones", () => {
    expect(isActiveMemory({ status: "ACTIVE" })).toBe(true);
    expect(isActiveMemory({ status: "SUPERSEDED" })).toBe(false);
  });
});
