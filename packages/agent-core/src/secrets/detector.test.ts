import { describe, expect, it } from "vitest";
import { detectSecrets, redactSecrets } from "./detector.js";

describe("secret detector", () => {
  it("detects GitHub personal access tokens", () => {
    const findings = detectSecrets("token=ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(findings.some((f) => f.name === "github_token")).toBe(true);
  });

  it("redacts private keys", () => {
    const text = "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----";
    expect(redactSecrets(text)).toContain("[REDACTED_SECRET]");
  });
});
