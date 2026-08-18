import { describe, expect, it } from "vitest";
import { verifyAgentResponse, type VerificationChecklist } from "./self-check.js";

const passingChecklist: VerificationChecklist = {
  usedRepositoryState: true,
  usedRelevantMemory: true,
  distinguishedFactFromInference: true,
  verifiedExternalClaims: false,
  detectedConflicts: false,
  citedExternalClaims: false,
  noSecretsExposed: true,
  withinAuthorization: true,
};

describe("verifyAgentResponse", () => {
  it("passes a fully-compliant checklist", () => {
    const result = verifyAgentResponse(passingChecklist);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails when a potential secret was exposed", () => {
    const result = verifyAgentResponse({ ...passingChecklist, noSecretsExposed: false });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("Potential secret exposure");
  });

  it("fails when the action was outside authorization", () => {
    const result = verifyAgentResponse({ ...passingChecklist, withinAuthorization: false });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("Proposed action beyond authorization");
  });

  it("fails when fact was not distinguished from inference", () => {
    const result = verifyAgentResponse({
      ...passingChecklist,
      distinguishedFactFromInference: false,
    });
    expect(result.passed).toBe(false);
  });

  it("fails when external claims were verified but not cited", () => {
    const result = verifyAgentResponse({
      ...passingChecklist,
      verifiedExternalClaims: true,
      citedExternalClaims: false,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("External claims missing citations");
  });

  it("does not require citations when no external claims were verified", () => {
    const result = verifyAgentResponse({
      ...passingChecklist,
      verifiedExternalClaims: false,
      citedExternalClaims: false,
    });
    expect(result.passed).toBe(true);
  });
});
