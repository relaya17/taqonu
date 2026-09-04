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
