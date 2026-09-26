export const STUDIO_PATCH_STEPS = [
  "inspect",
  "analyze",
  "propose",
  "review",
  "approve",
  "apply",
  "verify",
] as const;

export type StudioPatchStep = (typeof STUDIO_PATCH_STEPS)[number];

/** Map patch status to the next human action. Never skips approve. */
export function nextStudioPatchStep(status: string | null | undefined): StudioPatchStep {
  switch (status) {
    case "APPROVED":
      return "apply";
    case "APPLIED":
      return "verify";
    case "VERIFIED":
      return "verify";
    case "PROPOSED":
    case "EVALUATED":
    case "AWAITING_APPROVAL":
    case "DRAFT":
      return "approve";
    default:
      return status ? "review" : "propose";
  }
}

export function canApproveStudioPatch(status: string | null | undefined): boolean {
  return (
    status === "PROPOSED" ||
    status === "EVALUATED" ||
    status === "AWAITING_APPROVAL" ||
    status === "DRAFT"
  );
}

export function canApplyStudioPatch(status: string | null | undefined): boolean {
  return status === "APPROVED";
}

export function canVerifyStudioPatch(status: string | null | undefined): boolean {
  return status === "APPLIED" || status === "VERIFIED";
}

/** Same gate as POST /patches/:id/rollback — APPLIED or VERIFIED only. */
export function canRollbackStudioPatch(status: string | null | undefined): boolean {
  return status === "APPLIED" || status === "VERIFIED";
}

export function patchGovernedPath(
  id: string,
  action: "apply" | "rollback",
  approvalId?: string,
): string {
  const path = `/api/v1/code/patches/${id}/${action}`;
  return approvalId
    ? `${path}?approvalId=${encodeURIComponent(approvalId)}`
    : path;
}

/** Governed CODE_ENGINEER verify — not the auto-remediation draft endpoint. */
export function patchVerifyPath(id: string): string {
  return `/api/v1/code/patches/${id}/verify`;
}

/**
 * Same split the API already enforces. Governed patches use Studio's verify.
 * Auto-remediation drafts stay on the existing drafts verify. No third route.
 */
export function deskPatchVerifyPath(patch: {
  readonly id: string;
  readonly createdBy?: string | null;
  readonly sourceIssueId?: string | null;
  readonly title?: string | null;
}): string {
  const auto =
    patch.createdBy === "atlas-auto-remediation" ||
    patch.createdBy === "atlas-truth-remediation" ||
    Boolean(patch.sourceIssueId) ||
    (patch.title?.startsWith("AUTO_FIX:") ?? false) ||
    (patch.title?.startsWith("TRUTH_FIX:") ?? false);
  return auto
    ? `/api/v1/remediation/drafts/${patch.id}/verify`
    : patchVerifyPath(patch.id);
}

/** Existing live-human SoD route. The requester is denied by the server. */
export function patchDecideAndExecutePath(
  id: string,
  action: "apply" | "rollback",
): string {
  return `/api/v1/code/patches/${id}/${action}/decide-and-execute`;
}
