import { authorizeSyntheticAction } from "./authorization.js";
import { resolveRemediatingScenario } from "./catalog.js";
import { diagnoseFailure, type FailureDiagnosis } from "./diagnosis.js";
import { planRemediation, type RemediationPlan } from "./remediation.js";
import { SyntheticUniverse, type ScenarioRunResult } from "./runner.js";
import type { ScenarioDefinition, SyntheticActorId } from "./types.js";

export type ClosedLoopVerdict = "RECOVERED" | "ALREADY_VERIFIED" | "BLOCKED" | "FAILED";

export interface ClosedLoopGovernance {
  readonly decision: "ALLOW" | "DENY";
  readonly reason: string;
  readonly entityType: string;
  readonly action: string;
  readonly actorId: SyntheticActorId;
  readonly path: "synthetic.authorizeEntityAction";
}

export interface RecoveryVerification {
  readonly recovered: boolean;
  readonly explanation: string;
}

export interface ClosedLoopResult {
  readonly failureRun: ScenarioRunResult;
  readonly diagnosis: FailureDiagnosis;
  readonly plan: RemediationPlan | null;
  readonly governance: ClosedLoopGovernance | null;
  readonly recoveryRun: ScenarioRunResult | null;
  readonly recovery: RecoveryVerification;
  readonly loopVerdict: ClosedLoopVerdict;
}

/**
 * End-to-end synthetic verification loop.
 * Does not call executeGovernedAction or mutate FABRIC_AGENT_CATALOG.
 * Remediation is a sandbox re-run of the healthy registered scenario.
 */
export function runClosedLoop(input: {
  readonly scenario: ScenarioDefinition;
  readonly remediatingActorId?: SyntheticActorId;
}): ClosedLoopResult {
  const failureRun = new SyntheticUniverse().run(input.scenario);
  const diagnosis = diagnoseFailure(failureRun, input.scenario);

  if (!diagnosis.detected && failureRun.verdict === "VERIFIED") {
    return {
      failureRun,
      diagnosis,
      plan: null,
      governance: null,
      recoveryRun: null,
      recovery: {
        recovered: true,
        explanation: "Original process was already VERIFIED; no remediation executed.",
      },
      loopVerdict: "ALREADY_VERIFIED",
    };
  }

  const plan = planRemediation(diagnosis, input.scenario);
  const actorId = input.remediatingActorId ?? "SYNTHETIC_OPERATOR";
  const trace = authorizeSyntheticAction({
    kind: plan.authorizeKind,
    action: plan.authorizeAction,
    actorId,
  });
  const governance: ClosedLoopGovernance = {
    decision: trace.decision === "ALLOWED" ? "ALLOW" : "DENY",
    reason: trace.reason,
    entityType: trace.entityType,
    action: trace.action,
    actorId,
    path: "synthetic.authorizeEntityAction",
  };

  if (governance.decision !== "ALLOW" || !plan.recoverable) {
    return {
      failureRun,
      diagnosis,
      plan,
      governance,
      recoveryRun: null,
      recovery: {
        recovered: false,
        explanation:
          governance.decision !== "ALLOW"
            ? `Remediation blocked by entity policy: ${governance.reason}`
            : "Diagnosis is not recoverable.",
      },
      loopVerdict: "BLOCKED",
    };
  }

  const remediating = resolveRemediatingScenario(input.scenario);
  const recoveryRun = new SyntheticUniverse().run({
    ...remediating,
    actorId: actorId === "UNAUTHORIZED_AGENT" ? "UNAUTHORIZED_AGENT" : remediating.actorId,
  });
  const recovered = verifyRecovery(recoveryRun);

  return {
    failureRun,
    diagnosis,
    plan,
    governance,
    recoveryRun,
    recovery: {
      recovered,
      explanation: recovered
        ? `Healthy scenario ${remediating.id} re-ran VERIFIED after governance ALLOW.`
        : `Healthy re-run verdict ${recoveryRun.verdict}; recovery not proven.`,
    },
    loopVerdict: recovered ? "RECOVERED" : "FAILED",
  };
}

function verifyRecovery(run: ScenarioRunResult): boolean {
  return (
    run.verdict === "VERIFIED" &&
    run.evidence.process.failed === false &&
    run.evidence.assertions.every((row) => row.passed) &&
    !run.evidence.failures.some((row) => /real (payment|email|whatsapp)/i.test(row))
  );
}
