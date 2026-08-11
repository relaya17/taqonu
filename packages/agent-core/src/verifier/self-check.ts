export interface VerificationChecklist {
  readonly usedRepositoryState: boolean;
  readonly usedRelevantMemory: boolean;
  readonly distinguishedFactFromInference: boolean;
  readonly verifiedExternalClaims: boolean;
  readonly detectedConflicts: boolean;
  readonly citedExternalClaims: boolean;
  readonly noSecretsExposed: boolean;
  readonly withinAuthorization: boolean;
}

export interface VerificationResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly checklist: VerificationChecklist;
}

export function verifyAgentResponse(
  checklist: VerificationChecklist,
): VerificationResult {
  const failures: string[] = [];

  if (!checklist.distinguishedFactFromInference) {
    failures.push("Did not distinguish fact from inference");
  }
  if (!checklist.noSecretsExposed) {
    failures.push("Potential secret exposure");
  }
  if (!checklist.withinAuthorization) {
    failures.push("Proposed action beyond authorization");
  }
  if (checklist.verifiedExternalClaims && !checklist.citedExternalClaims) {
    failures.push("External claims missing citations");
  }

  return {
    passed: failures.length === 0,
    failures,
    checklist,
  };
}
