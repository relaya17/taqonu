import { describe, expect, it } from "vitest";
import {
  canApplyStudioPatch,
  canApproveStudioPatch,
  canCorrectStudioPatch,
  canRejectStudioPatch,
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
    // Stage 5 (G-2): a title prefix is presentation text, not provenance.
    expect(
      deskPatchVerifyPath({
        id: "human-1",
        createdBy: "11111111-1111-4111-8111-111111111111",
        title: "AUTO_FIX: typed by a human",
      }),
    ).toBe("/api/v1/code/patches/human-1/verify");
  });

  it("allows Rollback only after Apply, never from PROPOSED", () => {
    expect(canRollbackStudioPatch("PROPOSED")).toBe(false);
    expect(canRollbackStudioPatch("APPROVED")).toBe(false);
    expect(canRollbackStudioPatch("APPLIED")).toBe(true);
    expect(canRollbackStudioPatch("VERIFIED")).toBe(true);
  });

  // Stage 5 (D4): correction gate — only REJECTED patches can be superseded
  it("exposes correction action only for REJECTED patches", () => {
    // The correction button must only appear for REJECTED
    expect(canCorrectStudioPatch("REJECTED")).toBe(true);

    // All non-REJECTED statuses must be false
    expect(canCorrectStudioPatch("PROPOSED")).toBe(false);
    expect(canCorrectStudioPatch("DRAFT")).toBe(false);
    expect(canCorrectStudioPatch("EVALUATED")).toBe(false);
    expect(canCorrectStudioPatch("AWAITING_APPROVAL")).toBe(false);
    expect(canCorrectStudioPatch("APPROVED")).toBe(false);
    expect(canCorrectStudioPatch("APPLIED")).toBe(false);
    expect(canCorrectStudioPatch("VERIFIED")).toBe(false);
    expect(canCorrectStudioPatch("ROLLED_BACK")).toBe(false);
    expect(canCorrectStudioPatch(null)).toBe(false);
    expect(canCorrectStudioPatch(undefined)).toBe(false);
  });

  // Stage 5 (D4): ordinary non-REJECTED patches remain unaffected by correction gate
  it("does not affect reject gate or other gates for ordinary non-REJECTED patches", () => {
    // canRejectStudioPatch must continue to work as before
    expect(canRejectStudioPatch("DRAFT")).toBe(true);
    expect(canRejectStudioPatch("PROPOSED")).toBe(true);
    expect(canRejectStudioPatch("EVALUATED")).toBe(true);
    expect(canRejectStudioPatch("AWAITING_APPROVAL")).toBe(true);
    expect(canRejectStudioPatch("APPROVED")).toBe(true);
    // APPLIED, VERIFIED, ROLLED_BACK cannot be rejected
    expect(canRejectStudioPatch("APPLIED")).toBe(false);
    expect(canRejectStudioPatch("VERIFIED")).toBe(false);
    expect(canRejectStudioPatch("ROLLED_BACK")).toBe(false);
    // REJECTED itself cannot be rejected again
    expect(canRejectStudioPatch("REJECTED")).toBe(false);
  });

  // Stage 5 (D4): nextStudioPatchStep for REJECTED should route to review
  it("routes REJECTED status to review step", () => {
    expect(nextStudioPatchStep("REJECTED")).toBe("review");
  });
});
