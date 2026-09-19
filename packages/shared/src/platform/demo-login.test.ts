import { describe, expect, it } from "vitest";
import {
  evaluateProductionDemoLoginConfig,
  isAtlasDemoLoginEnabled,
} from "./demo-login.js";

describe("isAtlasDemoLoginEnabled", () => {
  it("is enabled outside production", () => {
    expect(isAtlasDemoLoginEnabled({ nodeEnv: "development" })).toBe(true);
    expect(isAtlasDemoLoginEnabled({ nodeEnv: "test" })).toBe(true);
    expect(isAtlasDemoLoginEnabled({ nodeEnv: "test", flag: "0" })).toBe(true);
  });

  it("never enables in production, even when the demo flag is 1", () => {
    expect(
      isAtlasDemoLoginEnabled({ nodeEnv: "production", flag: "1" }),
    ).toBe(false);
    expect(isAtlasDemoLoginEnabled({ nodeEnv: "production" })).toBe(false);
    expect(
      isAtlasDemoLoginEnabled({
        nodeEnv: "production",
        flag: "NEXT_PUBLIC_DEMO_LOGIN_ENABLED=1",
      }),
    ).toBe(false);
  });
});

describe("evaluateProductionDemoLoginConfig", () => {
  it("fails production + demo-login enabled", () => {
    const result = evaluateProductionDemoLoginConfig({
      nodeEnv: "production",
      flag: "1",
    });
    expect(result.ok).toBe(false);
    expect(result.evidence).toMatch(/forbidden/);
  });

  it("passes production + demo-login disabled", () => {
    expect(
      evaluateProductionDemoLoginConfig({ nodeEnv: "production", flag: "0" })
        .ok,
    ).toBe(true);
    expect(
      evaluateProductionDemoLoginConfig({ nodeEnv: "production" }).ok,
    ).toBe(true);
  });
});
