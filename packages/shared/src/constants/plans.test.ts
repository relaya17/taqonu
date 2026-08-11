import { describe, expect, it } from "vitest";
import { PLAN_CLOUD_LIMITS, PLAN_TIERS } from "./plans.js";

describe("freemium plan constants", () => {
  it("exposes free and pro tiers", () => {
    expect(PLAN_TIERS).toEqual(["free", "pro"]);
  });

  it("gives free fewer cloud slots than pro", () => {
    expect(PLAN_CLOUD_LIMITS.free).toBe(3);
    expect(PLAN_CLOUD_LIMITS.pro).toBe(100);
    expect(PLAN_CLOUD_LIMITS.free).toBeLessThan(PLAN_CLOUD_LIMITS.pro);
  });
});
