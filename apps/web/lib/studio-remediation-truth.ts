export interface StudioFindingRemediation {
  readonly result: string;
  readonly verifyStatus?: string;
  readonly findingPresence?: string;
  readonly summary?: string;
}

/** Patch execution success is never a green remediation by itself. */
export function studioRemediationIsGreen(
  patchVerifyOk: boolean,
  remediation: StudioFindingRemediation | null | undefined,
): boolean {
  return patchVerifyOk && remediation?.result === "FIXED";
}

export function studioRemediationAlertSeverity(
  patchVerifyOk: boolean,
  remediation: StudioFindingRemediation | null | undefined,
): "success" | "warning" | "error" | "info" {
  if (!patchVerifyOk) return "error";
  if (!remediation || remediation.result === "NOT_ATTEMPTED") return "info";
  if (remediation.result === "FIXED") return "success";
  if (remediation.result === "NOT_FIXED" || remediation.result === "UNSUPPORTED") {
    return "warning";
  }
  return "info";
}

/** Missing verify status is UNKNOWN — never defaulted to PASS. */
export function formatPatchVerifyLabel(
  patchVerifyStatus: string | null | undefined,
  patchVerifyOk: boolean | null | undefined,
): "PASS" | "FAIL" | "UNKNOWN" {
  if (patchVerifyStatus === "PASS" || patchVerifyStatus === "FAIL") {
    return patchVerifyStatus;
  }
  if (patchVerifyOk === false) return "FAIL";
  return "UNKNOWN";
}
