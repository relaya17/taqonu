import { describe, expect, it } from "vitest";
import { AtlasError } from "@atlas/shared";
import { assertLlmEgressAllowed } from "./egress-gate.js";

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
