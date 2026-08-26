import { describe, expect, it } from "vitest";
import { AtlasError } from "@atlas/shared";
import { assertLlmEgressAllowed, assertEgressAllowed } from "./egress-gate.js";

describe("assertLlmEgressAllowed", () => {
  it("allows echo/local processing of project code", () => {
    expect(() =>
      assertLlmEgressAllowed({
        provider: "echo",
        purpose: "llm.agent",
      }),
    ).not.toThrow();
  });

  it("denies secret data class to openai", () => {
    expect(() =>
      assertLlmEgressAllowed({
        provider: "openai",
        purpose: "llm.agent",
        dataClass: "SECRET",
      }),
    ).toThrow(AtlasError);
  });

  it("denies full-repository cloud egress", () => {
    expect(() =>
      assertLlmEgressAllowed({
        provider: "anthropic",
        purpose: "llm.agent",
        fullRepository: true,
      }),
    ).toThrow(/Full-repository/);
  });
});

describe("assertEgressAllowed", () => {
  it("allows internal telemetry of agent traces", () => {
    expect(() =>
      assertEgressAllowed({
        dataClass: "PROJECT_PRIVATE",
        destination: "atlas_internal",
        operation: "TELEMETRY",
        purpose: "control-plane.bridge",
      }),
    ).not.toThrow();
  });

  it("denies webhook of secrets", () => {
    expect(() =>
      assertEgressAllowed({
        dataClass: "SECRET",
        destination: "webhook",
        operation: "WEBHOOK",
        purpose: "integrations.webhook",
      }),
    ).toThrow(AtlasError);
  });
});
