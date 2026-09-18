import { describe, expect, it } from "vitest";
import {
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationConnectorSigningString,
} from "@atlas/shared";
import { signApplicationConnectorRequest } from "./application-preflight-client.js";

describe("application preflight client", () => {
  it("signs the canonical connector HMAC string", () => {
    const rawBody = JSON.stringify({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "civio",
    });
    const signed = signApplicationConnectorRequest({
      secret: "civio-connector-test-secret-32b!!",
      rawBody,
      timestamp: "1700000000000",
      nonce: "aabbccddeeff0011",
    });
    expect(signed.headers["x-atlas-connector-timestamp"]).toBe("1700000000000");
    expect(signed.headers["x-atlas-connector-nonce"]).toBe("aabbccddeeff0011");
    expect(signed.signature).toHaveLength(64);
    expect(applicationConnectorSigningString("1700000000000", "aabbccddeeff0011", rawBody)).toContain(
      rawBody,
    );
  });
});
