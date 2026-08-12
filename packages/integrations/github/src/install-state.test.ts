import { describe, expect, it } from "vitest";
import { signGitHubInstallState, verifyGitHubInstallState } from "./install-state.js";

describe("GitHub install state token", () => {
  const secret = "super-secret-cookie-key-at-least-32-chars";

  it("round-trips projectId and locale", () => {
    const state = signGitHubInstallState({
      secret,
      projectId: "11111111-1111-4111-8111-111111111111",
      locale: "en",
    });

    const decoded = verifyGitHubInstallState({ state, secret });
    expect(decoded?.projectId).toBe("11111111-1111-4111-8111-111111111111");
    expect(decoded?.locale).toBe("en");
  });

  it("supports a null projectId (account-level install)", () => {
    const state = signGitHubInstallState({ secret, locale: "he" });
    const decoded = verifyGitHubInstallState({ state, secret });
    expect(decoded?.projectId).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const state = signGitHubInstallState({ secret, projectId: "abc" });
    const [encoded, signature] = state.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ projectId: "evil", locale: null, nonce: "x", issuedAt: 0 }),
    ).toString("base64url");
    const tampered = `${tamperedPayload}.${signature}`;
    expect(verifyGitHubInstallState({ state: tampered, secret })).toBeNull();
    void encoded;
  });

  it("rejects a token signed with a different secret", () => {
    const state = signGitHubInstallState({ secret: "secret-a-at-least-32-characters", projectId: "abc" });
    expect(
      verifyGitHubInstallState({ state, secret: "secret-b-at-least-32-characters" }),
    ).toBeNull();
  });

  it("rejects malformed state strings", () => {
    expect(verifyGitHubInstallState({ state: "not-a-valid-token", secret })).toBeNull();
    expect(verifyGitHubInstallState({ state: "", secret })).toBeNull();
  });

  it("rejects an expired token", () => {
    const issuedAt = new Date("2026-08-12T00:00:00Z");
    const state = signGitHubInstallState({ secret, projectId: "abc", now: issuedAt });
    const later = new Date(issuedAt.getTime() + 20 * 60 * 1000); // +20 minutes
    expect(
      verifyGitHubInstallState({ state, secret, maxAgeSeconds: 900, now: later }),
    ).toBeNull();
  });

  it("accepts a token within the max age window", () => {
    const issuedAt = new Date("2026-08-12T00:00:00Z");
    const state = signGitHubInstallState({ secret, projectId: "abc", now: issuedAt });
    const later = new Date(issuedAt.getTime() + 5 * 60 * 1000); // +5 minutes
    expect(
      verifyGitHubInstallState({ state, secret, maxAgeSeconds: 900, now: later }),
    ).not.toBeNull();
  });
});
