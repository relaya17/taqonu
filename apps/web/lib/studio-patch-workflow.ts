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
