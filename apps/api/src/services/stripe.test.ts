import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AtlasError } from "@atlas/shared";
import { verifyStripeWebhookSignature } from "./stripe.js";

describe("verifyStripeWebhookSignature", () => {
  const secret = "whsec_test_secret";
  const payload = '{"type":"checkout.session.completed"}';

  it("accepts a valid signature", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`, "utf8")
      .digest("hex");
    expect(() =>
      verifyStripeWebhookSignature({
        payload,
        signatureHeader: `t=${timestamp},v1=${v1}`,
        secret,
      }),
    ).not.toThrow();
  });

  it("rejects a bad signature", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    expect(() =>
      verifyStripeWebhookSignature({
        payload,
        signatureHeader: `t=${timestamp},v1=deadbeef`,
        secret,
      }),
    ).toThrow(AtlasError);
  });
});
