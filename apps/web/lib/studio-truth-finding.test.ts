import { describe, expect, it } from "vitest";
import { selectStudioTopTruthFinding } from "./studio-truth-finding";
import { studioRemediationIsGreen, formatPatchVerifyLabel } from "./studio-remediation-truth";

describe("selectStudioTopTruthFinding", () => {
  it("surfaces a real CRITICAL Sentinel secret over posture rollup", () => {
    const top = selectStudioTopTruthFinding([
      {
        id: "sentinel-posture",
        category: "SECURITY",
        riskBand: "CRITICAL",
      },
      {
        id: "sentinel:secret:leaked-credential.ts:aws_access_key:1",
        category: "SECURITY",
        riskBand: "CRITICAL",
      },
    ]);
    expect(top?.id).toBe("sentinel:secret:leaked-credential.ts:aws_access_key:1");
  });
});

describe("studioRemediationIsGreen", () => {
  it("never treats patch execution PASS as remediation PASS", () => {
    expect(
      studioRemediationIsGreen(true, {
        result: "NOT_FIXED",
        findingPresence: "STILL_PRESENT",
      }),
    ).toBe(false);
    expect(studioRemediationIsGreen(true, { result: "NOT_ATTEMPTED" })).toBe(
      false,
    );
    expect(studioRemediationIsGreen(true, { result: "FIXED" })).toBe(true);
  });
});

describe("formatPatchVerifyLabel", () => {
  it("never defaults a missing status to PASS", () => {
    expect(formatPatchVerifyLabel(undefined, true)).toBe("UNKNOWN");
    expect(formatPatchVerifyLabel(undefined, undefined)).toBe("UNKNOWN");
    expect(formatPatchVerifyLabel("PASS", true)).toBe("PASS");
    expect(formatPatchVerifyLabel(undefined, false)).toBe("FAIL");
  });
});
