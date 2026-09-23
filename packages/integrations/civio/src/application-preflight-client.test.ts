import { describe, expect, it } from "vitest";
import {
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationConnectorSigningString,
  applicationPreflightResponseSchema,
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

  it("CTRL-016: response schema still parses a legacy body and an echoed declaration", () => {
    const legacy = {
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      decision: "ALLOW" as const,
      executed: false as const,
      reason: "allowed",
      requestId: "req-1",
      applicationId: "civio",
      agentId: null,
      tenantId: "tenant-a",
      projectId: "project-a",
      operation: "civio.legal.query",
      operationClass: "GOVERNED_DECISION" as const,
      unavailablePolicy: "FAIL_OPEN" as const,
      approvalRequestId: null,
      killSwitchCategory: null,
      decisionId: "decision-1",
    };
    expect(applicationPreflightResponseSchema.parse(legacy).declaredCompletionPath).toBeUndefined();
    expect(
      applicationPreflightResponseSchema.parse({
        ...legacy,
        declaredCompletionPath: "LOCAL_COMPLETION_PATH",
      }).declaredCompletionPath,
    ).toBe("LOCAL_COMPLETION_PATH");
  });
});
