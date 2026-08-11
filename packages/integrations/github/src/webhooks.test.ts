import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGitHubWebhookSignature } from "./webhooks.js";

describe("verifyGitHubWebhookSignature", () => {
  it("accepts a valid signature", () => {
    const payload = '{"action":"opened"}';
    const secret = "test-secret";
    const digest = createHmac("sha256", secret).update(payload).digest("hex");

    expect(() =>
      verifyGitHubWebhookSignature({
        payload,
        signatureHeader: `sha256=${digest}`,
        secret,
      }),
    ).not.toThrow();
  });

  it("rejects an invalid signature", () => {
    expect(() =>
      verifyGitHubWebhookSignature({
        payload: "{}",
        signatureHeader: "sha256=deadbeef",
        secret: "test-secret",
      }),
    ).toThrow(/Invalid GitHub webhook signature/);
  });
});
