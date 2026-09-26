import { describe, expect, it } from "vitest";
import {
  canApplyStudioPatch,
  canApproveStudioPatch,
  canRollbackStudioPatch,
  deskPatchVerifyPath,
  nextStudioPatchStep,
  patchDecideAndExecutePath,
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

  it("points the second identity at the existing decide-and-execute routes", () => {
    expect(patchDecideAndExecutePath("patch-1", "apply")).toBe(
      "/api/v1/code/patches/patch-1/apply/decide-and-execute",
    );
    expect(patchDecideAndExecutePath("patch-1", "rollback")).toBe(
      "/api/v1/code/patches/patch-1/rollback/decide-and-execute",
    );
  });

  it("sends a Studio patch to the code verify route and an auto draft to the existing drafts route", () => {
    expect(
      deskPatchVerifyPath({
        id: "patch-1",
        createdBy: "atlas-code-intelligence",
        title: "Explain the file",
      }),
    ).toBe("/api/v1/code/patches/patch-1/verify");
    expect(
      deskPatchVerifyPath({
        id: "draft-1",
        createdBy: "atlas-auto-remediation",
        title: "AUTO_FIX: lint",
      }),
    ).toBe("/api/v1/remediation/drafts/draft-1/verify");
    expect(
      deskPatchVerifyPath({
        id: "draft-2",
        sourceIssueId: "finding-1",
        title: "linked finding",
      }),
    ).toBe("/api/v1/remediation/drafts/draft-2/verify");
  });

  it("allows Rollback only after Apply, never from PROPOSED", () => {
    expect(canRollbackStudioPatch("PROPOSED")).toBe(false);
    expect(canRollbackStudioPatch("APPROVED")).toBe(false);
    expect(canRollbackStudioPatch("APPLIED")).toBe(true);
    expect(canRollbackStudioPatch("VERIFIED")).toBe(true);
  });
});
