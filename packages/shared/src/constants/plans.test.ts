import { describe, expect, it } from "vitest";
import { PLAN_AXIS_LIMITS, PLAN_CLOUD_LIMITS, PLAN_TIERS } from "./plans.js";
import {
  PLATFORM_VERSION,
  PREFERRED_CUSTOMER_CLOUD,
  STORAGE_POLICY_VERSION,
} from "./platform.js";

describe("freemium plan constants (BYO customer cloud)", () => {
  it("exposes free and pro tiers", () => {
    expect(PLAN_TIERS).toEqual(["free", "pro"]);
  });

  it("does not give free Atlas-hosted evidence mirror slots", () => {
    expect(PLAN_CLOUD_LIMITS.free).toBe(0);
    expect(PLAN_CLOUD_LIMITS.pro).toBe(100);
    expect(PLAN_CLOUD_LIMITS.free).toBeLessThan(PLAN_CLOUD_LIMITS.pro);
  });

  it("meters product usage on free with lower ceilings than pro", () => {
    expect(PLAN_AXIS_LIMITS.free.evalRunsPerDay).toBeLessThan(
      PLAN_AXIS_LIMITS.pro.evalRunsPerDay,
    );
    expect(PLAN_AXIS_LIMITS.free.processAuditsPerDay).toBeLessThan(
      PLAN_AXIS_LIMITS.pro.processAuditsPerDay,
    );
    expect(PLAN_AXIS_LIMITS.free.agentMessagesPerDay).toBeLessThan(
      PLAN_AXIS_LIMITS.pro.agentMessagesPerDay,
    );
  });
});

describe("platform version sync", () => {
  it("pins preferred customer cloud to cloudflare", () => {
    expect(PREFERRED_CUSTOMER_CLOUD).toBe("cloudflare");
  });

  it("exposes semver-like platform + policy versions", () => {
    expect(PLATFORM_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(STORAGE_POLICY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
