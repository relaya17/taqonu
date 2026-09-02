import { describe, expect, it } from "vitest";
import {
  signCivioConnectorRequest,
  verifyCivioConnectorSignature,
} from "./hmac.js";

const SECRET = "civio-connector-test-secret-32b!!";

describe("Civio connector HMAC", () => {
  it("accepts a signature produced by the production signer", () => {
    const rawBody = '{"eventId":"evt-1"}';
    const signed = signCivioConnectorRequest({ secret: SECRET, rawBody });
    expect(
      verifyCivioConnectorSignature({
        secret: SECRET,
        rawBody,
        timestamp: signed.timestamp,
        nonce: signed.nonce,
        signature: signed.signature,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const signed = signCivioConnectorRequest({
      secret: SECRET,
      rawBody: '{"eventId":"evt-1"}',
    });
    const result = verifyCivioConnectorSignature({
      secret: SECRET,
      rawBody: '{"eventId":"evt-2"}',
      timestamp: signed.timestamp,
      nonce: signed.nonce,
      signature: signed.signature,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a short secret", () => {
    const result = verifyCivioConnectorSignature({
      secret: "too-short",
      rawBody: "{}",
      timestamp: String(Date.now()),
      nonce: "aabbccddeeff0011",
      signature: "00",
    });
    expect(result.ok).toBe(false);
  });
});
