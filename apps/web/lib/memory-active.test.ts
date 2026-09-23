import { describe, expect, it } from "vitest";
import { isActiveMemory } from "./memory-active";

describe("isActiveMemory", () => {
  it("keeps ACTIVE rows and hides SUPERSEDED ones", () => {
    expect(isActiveMemory({ status: "ACTIVE" })).toBe(true);
    expect(isActiveMemory({ status: "SUPERSEDED" })).toBe(false);
  });

  it("hides ACTIVE rows whose validUntil has passed", () => {
    expect(
      isActiveMemory({
        status: "ACTIVE",
        validUntil: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).toBe(false);
    expect(
      isActiveMemory({
        status: "ACTIVE",
        validUntil: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toBe(true);
  });
});
