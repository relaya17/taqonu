/**
 * Verification-informed recommendations.
 * Intelligence may recommend. It must not execute, approve, or mutate policy.
 */
export interface VerificationLessonInput {
  readonly requestId?: string;
  readonly verificationVerdict?: string | null;
  readonly regressionVerdict?: string | null;
  readonly result?: string | null;
}

export interface VerificationLesson {
  readonly title: string;
  readonly evidence: string;
  readonly recommendation: string;
  readonly executes: false;
  readonly autoApply: false;
}

export interface VerificationLearningReport {
  readonly generatedAt: string;
  readonly inspected: number;
  readonly failedVerification: number;
  readonly regressionFailed: number;
  readonly lessons: readonly VerificationLesson[];
}

function lesson(
  title: string,
  evidence: string,
  recommendation: string,
): VerificationLesson {
  return { title, evidence, recommendation, executes: false, autoApply: false };
}

export function recommendFromVerificationHistory(
  entries: readonly VerificationLessonInput[],
): VerificationLearningReport {
  const failedVerification = entries.filter(
    (entry) => entry.verificationVerdict === "FAILED",
  ).length;
  const regressionFailed = entries.filter(
    (entry) => entry.regressionVerdict === "FAILED",
  ).length;
  const lessons: VerificationLesson[] = [];
  if (failedVerification > 0) {
    lessons.push(
      lesson(
        "Verification failures are present",
        `failedVerification=${failedVerification}`,
        "Keep the bound expected observations. Do not treat executed as verified.",
      ),
    );
  }
  if (regressionFailed > 0) {
    lessons.push(
      lesson(
        "Regression FAILED overrode verification",
        `regressionFailed=${regressionFailed}`,
        "Restore the missing baseline observation before claiming VERIFIED.",
      ),
    );
  }
  if (lessons.length === 0) {
    lessons.push(
      lesson(
        "No verification-failure lessons in the inspected window",
        `inspected=${entries.length}`,
        "Continue using evaluateWorldState. Intelligence still does not execute.",
      ),
    );
  }
  return {
    generatedAt: new Date().toISOString(),
    inspected: entries.length,
    failedVerification,
    regressionFailed,
    lessons,
  };
}

export interface OutcomeSignalInput {
  readonly result?: string | null;
  readonly verificationVerdict?: string | null;
  readonly agentId?: string | null;
}

export interface OutcomeQualityReport {
  readonly generatedAt: string;
  readonly inspected: number;
  readonly executedSuccess: number;
  readonly deniedOrFailed: number;
  readonly verified: number;
  readonly successRate: number | null;
  readonly confidence: number;
  readonly byAgent: readonly { readonly agentId: string; readonly count: number }[];
  readonly recommendation: string;
  readonly executes: false;
  readonly autoApply: false;
  readonly mutatesGovernance: false;
}

/**
 * Read-only quality signals over historical audit outcomes.
 * Scores recommend. They never grant privileges or mutate governance.
 */
export function scoreHistoricalOutcomes(
  entries: readonly OutcomeSignalInput[],
): OutcomeQualityReport {
  const executedSuccess = entries.filter((entry) => entry.result === "SUCCESS").length;
  const deniedOrFailed = entries.filter(
    (entry) => entry.result === "FAILURE" || entry.result === "DENIED",
  ).length;
  const verified = entries.filter((entry) => entry.verificationVerdict === "VERIFIED").length;
  const decided = executedSuccess + deniedOrFailed;
  const successRate = decided === 0 ? null : executedSuccess / decided;
  const confidence = Math.min(1, decided / 20);
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.agentId) continue;
    counts.set(entry.agentId, (counts.get(entry.agentId) ?? 0) + 1);
  }
  const byAgent = [...counts.entries()]
    .map(([agentId, count]) => ({ agentId, count }))
    .sort((a, b) => b.count - a.count);
  return {
    generatedAt: new Date().toISOString(),
    inspected: entries.length,
    executedSuccess,
    deniedOrFailed,
    verified,
    successRate,
    confidence,
    byAgent,
    recommendation:
      "Quality signals are observational. Do not auto-approve, auto-quarantine, or change policy from this score.",
    executes: false,
    autoApply: false,
    mutatesGovernance: false,
  };
}
