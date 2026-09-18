import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { applicationConnectorSigningString } from "@atlas/shared";
import {
  readApplicationConnectorHmacHeaders,
  verifyApplicationConnectorSignature,
} from "./application-connector-hmac.js";

const SECRET = "civio-connector-test-secret-32b!!";

describe("application connector HMAC", () => {
  it("accepts generic connector headers", () => {
    const rawBody = '{"applicationId":"civio"}';
    const timestamp = "1700000000000";
    const nonce = "aabbccddeeff0011";
    const signature = createHmac("sha256", SECRET)
      .update(applicationConnectorSigningString(timestamp, nonce, rawBody), "utf8")
      .digest("hex");
    expect(
      verifyApplicationConnectorSignature({
        secret: SECRET,
        rawBody,
        timestamp,
        nonce,
        signature,
        now: 1700000000000,
      }),
    ).toEqual({ ok: true });
    expect(
      readApplicationConnectorHmacHeaders({
        "x-atlas-connector-timestamp": timestamp,
        "x-atlas-connector-nonce": nonce,
        "x-atlas-connector-signature": signature,
      }),
    ).toEqual({ timestamp, nonce, signature });
  });

  it("accepts Civio HMAC headers as an alias", () => {
    const headers = readApplicationConnectorHmacHeaders({
      "x-atlas-civio-timestamp": "1",
      "x-atlas-civio-nonce": "aa",
      "x-atlas-civio-signature": "sig",
    });
    expect(headers.timestamp).toBe("1");
    expect(headers.nonce).toBe("aa");
    expect(headers.signature).toBe("sig");
  });
});
