import { describe, expect, it } from "vitest";
import { classifyKind } from "./data-classification.js";
import { decideEgress, destinationFromLlmProvider } from "./egress-policy.js";

describe("decideEgress (ADR-021)", () => {
  it("denies secrets to cloud LLM providers", () => {
    const result = decideEgress({
      dataClass: classifyKind("credential"),
      destination: "openai",
      operation: "LLM_EGRESS",
      purpose: "llm.agent",
    });
    expect(result.decision).toBe("DENY");
  });

  it("denies full-repository cloud egress", () => {
    const result = decideEgress({
      dataClass: "PROJECT_PRIVATE",
      destination: "anthropic",
      operation: "LLM_EGRESS",
      purpose: "llm.agent",
      fullRepository: true,
    });
    expect(result.decision).toBe("DENY");
  });

  it("allows minimized project code to an approved provider", () => {
    const result = decideEgress({
      dataClass: "PROJECT_PRIVATE",
      destination: destinationFromLlmProvider("openai"),
      operation: "LLM_EGRESS",
      purpose: "llm.conversation",
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.requiresMinimize).toBe(true);
  });

  it("allows local/echo providers for tenant-private data", () => {
    expect(
      decideEgress({
        dataClass: "TENANT_PRIVATE",
        destination: destinationFromLlmProvider("echo"),
        operation: "LLM_EGRESS",
        purpose: "llm.agent",
      }).decision,
    ).toBe("ALLOW");
  });

  it("requires approval for non-public export", () => {
    expect(
      decideEgress({
        dataClass: "TENANT_PRIVATE",
        destination: "export",
        operation: "EXPORT",
        purpose: "owner.export",
      }).decision,
    ).toBe("REQUIRE_APPROVAL");
  });
});
