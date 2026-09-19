import { describe, expect, it } from "vitest";
import { DEV_CREDENTIALS, isDevLoginPrefill } from "./dev-credentials";

describe("DEV_CREDENTIALS", () => {
  it("never ships a password field in the client identity module", () => {
    expect("password" in DEV_CREDENTIALS).toBe(false);
    expect(JSON.stringify(DEV_CREDENTIALS)).not.toMatch(/password/i);
  });
});

describe("isDevLoginPrefill", () => {
  it("follows NODE_ENV from the test runner (never production)", () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(isDevLoginPrefill).toBe(true);
  });
});
