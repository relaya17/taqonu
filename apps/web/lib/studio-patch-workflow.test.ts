import { describe, expect, it } from "vitest";
import {
  canApplyStudioPatch,
  canApproveStudioPatch,
  canRollbackStudioPatch,
  nextStudioPatchStep,
} from "./studio-patch-workflow";

describe("studio patch workflow gates", () => {
  it("never allows Apply before APPROVED", () => {
    expect(canApplyStudioPatch("PROPOSED")).toBe(false);
    expect(canApplyStudioPatch("AWAITING_APPROVAL")).toBe(false);
    expect(canApplyStudioPatch("APPROVED")).toBe(true);
    expect(nextStudioPatchStep("PROPOSED")).toBe("approve");
    expect(nextStudioPatchStep("APPROVED")).toBe("apply");
    expect(canApproveStudioPatch("APPROVED")).toBe(false);
  });

  it("allows Rollback only after Apply, never from PROPOSED", () => {
    expect(canRollbackStudioPatch("PROPOSED")).toBe(false);
    expect(canRollbackStudioPatch("APPROVED")).toBe(false);
    expect(canRollbackStudioPatch("APPLIED")).toBe(true);
    expect(canRollbackStudioPatch("VERIFIED")).toBe(true);
  });
});
