/**
 * Atlas HTTP adapter for `@atlas/synthetic-universe`.
 *
 * Governed-execution review (Phase 4): synthetic business mutations
 * (customer/deal/invoice) are not ToolPolicy tools. Routing them through
 * `executeGovernedAction` would require new tool registrations and a second
 * executor inside the tool runtime. That is out of scope. Authorization
 * remains `authorizeEntityAction` inside the package; this adapter adds
 * session auth, TEST-* enforcement, and canonical NDJSON audit persistence.
 *
 * Control Plane: TEST-* tenants are not CP managed applications. No gateway
 * handoff is used.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  AtlasError,
  canonicalizeJson,
  type AuthUser,
  type GovernanceDecision,
} from "@atlas/shared";
import {
  SandboxPolicyError,
  SyntheticUniverse,
  resolveRegisteredScenario,
  runClosedLoop,
  type ClosedLoopResult,
  type ScenarioEvidence,
  type ScenarioVerdict,
} from "@atlas/synthetic-universe";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import { persistGovernanceDecision } from "./governance-decision.js";

export interface SyntheticScenarioRunResponse {
  readonly runId: string;
  readonly scenarioId: string;
  readonly tenantId: string;
  readonly verdict: ScenarioVerdict;
  readonly evidenceId: string;
  readonly process: ScenarioEvidence["process"];
  readonly assertions: ScenarioEvidence["assertions"];
  readonly events: readonly string[];
  readonly failures: readonly string[];
  readonly simulations: readonly string[];
  readonly auditEntryCount: number;
  readonly realExternalExecuted: false;
}

export function runSyntheticScenarioForAtlas(input: {
  readonly user: AuthUser;
  readonly scenarioId: string;
  readonly tenantId: string;
}): SyntheticScenarioRunResponse {
  let scenario;
  try {
    scenario = resolveRegisteredScenario(input.scenarioId, input.tenantId);
  } catch (error) {
    throw asAtlasError(error);
  }

  const universe = new SyntheticUniverse();
  let result;
  try {
    result = universe.run(scenario);
  } catch (error) {
    throw asAtlasError(error);
  }

  const evidence = result.evidence;
  persistCanonicalAudit({
    user: input.user,
    evidence,
    verdict: result.verdict,
  });

  return {
    runId: evidence.runId,
    scenarioId: evidence.scenarioId,
    tenantId: evidence.tenantId,
    verdict: result.verdict,
    evidenceId: evidence.runId,
    process: evidence.process,
    assertions: evidence.assertions,
    events: evidence.events.map((event) => event.name),
    failures: evidence.failures,
    simulations: evidence.simulations,
    auditEntryCount: evidence.audit.length + 1,
    realExternalExecuted: false,
  };
}

function persistCanonicalAudit(input: {
  readonly user: AuthUser;
  readonly evidence: ScenarioEvidence;
  readonly verdict: ScenarioVerdict;
}): void {
  for (const entry of input.evidence.audit) {
    appendUnifiedAuditEntry({
      ...entry,
      actorId: input.user.id,
      actorKind: "USER",
      ownerId: input.user.id,
      agentId: input.evidence.agent,
      input: {
        ...(entry.input ?? {}),
        tenantId: input.evidence.tenantId,
        scenarioId: input.evidence.scenarioId,
        runId: input.evidence.runId,
        evidenceId: input.evidence.runId,
      },
    });
  }
  appendUnifiedAuditEntry({
    type: "synthetic.scenario.run",
    toolName: null,
    entityType: "RECORD",
    action: "EXECUTE",
    actorId: input.user.id,
    actorKind: "USER",
    agentId: input.evidence.agent,
    ownerId: input.user.id,
    reason: `Synthetic scenario ${input.evidence.scenarioId} verdict ${input.verdict}`,
    intent: "synthetic_universe",
    policy: "synthetic.sandbox",
    risk: "LOW",
    approval: "NOT_REQUIRED",
    decision: input.verdict === "DENIED" ? "DENY" : "ALLOW",
    input: {
      tenantId: input.evidence.tenantId,
      scenarioId: input.evidence.scenarioId,
      runId: input.evidence.runId,
      evidenceId: input.evidence.runId,
      expectedProcess: [...input.evidence.process.expected],
      actualProcess: [...input.evidence.process.actual],
    },
    output: {
      verdict: input.verdict,
      realExternalExecuted: false,
      assertionFailures: input.evidence.assertions
        .filter((row) => !row.passed)
        .map((row) => row.name),
    },
    result:
      input.verdict === "VERIFIED" || input.verdict === "CONTAINED"
        ? "SUCCESS"
        : input.verdict === "DENIED"
          ? "FAILURE"
          : "PARTIAL",
    verificationVerdict:
      input.verdict === "VERIFIED" || input.verdict === "CONTAINED"
        ? "VERIFIED"
        : input.verdict === "DENIED"
          ? "BLOCKED"
          : "FAILED",
    correlationId: input.evidence.runId,
  });
}

export interface SyntheticClosedLoopResponse {
  readonly tenantId: string;
  readonly scenarioId: string;
  readonly loopVerdict: ClosedLoopResult["loopVerdict"];
  readonly diagnosis: ClosedLoopResult["diagnosis"];
  readonly plan: ClosedLoopResult["plan"];
  readonly governance: ClosedLoopResult["governance"];
  readonly governanceDecisionId: string | null;
  readonly failure: {
    readonly runId: string;
    readonly verdict: ScenarioVerdict;
    readonly process: ScenarioEvidence["process"];
    readonly failures: readonly string[];
  };
  readonly recovery: {
    readonly recovered: boolean;
    readonly explanation: string;
    readonly runId: string | null;
    readonly verdict: ScenarioVerdict | null;
    readonly remediatingScenarioId: string | null;
  };
  readonly realExternalExecuted: false;
}

export function runSyntheticClosedLoopForAtlas(input: {
  readonly user: AuthUser;
  readonly scenarioId: string;
  readonly tenantId: string;
}): SyntheticClosedLoopResponse {
  let scenario;
  try {
    scenario = resolveRegisteredScenario(input.scenarioId, input.tenantId);
  } catch (error) {
    throw asAtlasError(error);
  }

  let loop: ClosedLoopResult;
  try {
    loop = runClosedLoop({ scenario });
  } catch (error) {
    throw asAtlasError(error);
  }

  persistCanonicalAudit({
    user: input.user,
    evidence: loop.failureRun.evidence,
    verdict: loop.failureRun.verdict,
  });
  if (loop.recoveryRun) {
    persistCanonicalAudit({
      user: input.user,
      evidence: loop.recoveryRun.evidence,
      verdict: loop.recoveryRun.verdict,
    });
  }

  const governanceDecision = persistClosedLoopGovernance({
    user: input.user,
    scenarioId: scenario.id,
    tenantId: scenario.tenantId,
    loop,
  });

  appendUnifiedAuditEntry({
    type: "synthetic.closed_loop",
    toolName: null,
    entityType: loop.governance?.entityType ?? "RECORD",
    action: "EXECUTE",
    actorId: input.user.id,
    actorKind: "USER",
    agentId: loop.failureRun.evidence.agent,
    ownerId: input.user.id,
    reason: `Synthetic closed loop ${scenario.id} verdict ${loop.loopVerdict}`,
    intent: "synthetic_universe",
    policy: "synthetic.sandbox",
    risk: "LOW",
    approval: "NOT_REQUIRED",
    decision: loop.loopVerdict === "BLOCKED" ? "DENY" : "ALLOW",
    input: {
      tenantId: scenario.tenantId,
      scenarioId: scenario.id,
      failureRunId: loop.failureRun.evidence.runId,
      remediatingScenarioId: loop.plan?.remediatingScenarioId ?? null,
      diagnosisClass: loop.diagnosis.failureClass,
    },
    output: {
      loopVerdict: loop.loopVerdict,
      recovered: loop.recovery.recovered,
      realExternalExecuted: false,
      governanceDecisionId: governanceDecision?.id ?? null,
    },
    result:
      loop.loopVerdict === "RECOVERED" || loop.loopVerdict === "ALREADY_VERIFIED"
        ? "SUCCESS"
        : loop.loopVerdict === "BLOCKED"
          ? "FAILURE"
          : "PARTIAL",
    verificationVerdict:
      loop.loopVerdict === "RECOVERED" || loop.loopVerdict === "ALREADY_VERIFIED"
        ? "VERIFIED"
        : loop.loopVerdict === "BLOCKED"
          ? "BLOCKED"
          : "FAILED",
    correlationId: loop.failureRun.evidence.runId,
  });

  return {
    tenantId: scenario.tenantId,
    scenarioId: scenario.id,
    loopVerdict: loop.loopVerdict,
    diagnosis: loop.diagnosis,
    plan: loop.plan,
    governance: loop.governance,
    governanceDecisionId: governanceDecision?.id ?? null,
    failure: {
      runId: loop.failureRun.evidence.runId,
      verdict: loop.failureRun.verdict,
      process: loop.failureRun.evidence.process,
      failures: loop.failureRun.evidence.failures,
    },
    recovery: {
      recovered: loop.recovery.recovered,
      explanation: loop.recovery.explanation,
      runId: loop.recoveryRun?.evidence.runId ?? null,
      verdict: loop.recoveryRun?.verdict ?? null,
      remediatingScenarioId: loop.plan?.remediatingScenarioId ?? null,
    },
    realExternalExecuted: false,
  };
}

function persistClosedLoopGovernance(input: {
  readonly user: AuthUser;
  readonly scenarioId: string;
  readonly tenantId: string;
  readonly loop: ClosedLoopResult;
}): GovernanceDecision | null {
  if (process.env.ATLAS_SKIP_AUDIT_LOG === "1") return null;
  const loop = input.loop;
  const stage =
    loop.loopVerdict === "BLOCKED"
      ? "AUTHORIZATION"
      : loop.loopVerdict === "FAILED"
        ? "EXECUTION"
        : "EXECUTION";
  const status =
    loop.loopVerdict === "BLOCKED"
      ? "DENIED"
      : loop.loopVerdict === "FAILED"
        ? "FAILED"
        : loop.loopVerdict === "ALREADY_VERIFIED" && !loop.governance
          ? "EXECUTED"
          : "EXECUTED";
  const artifactHash = createHash("sha256")
    .update(
      canonicalizeJson({
        tenantId: input.tenantId,
        scenarioId: input.scenarioId,
        remediatingScenarioId: loop.plan?.remediatingScenarioId ?? null,
        failureClass: loop.diagnosis.failureClass,
        loopVerdict: loop.loopVerdict,
      }),
    )
    .digest("hex");

  return persistGovernanceDecision({
    schemaVersion: "1.0.0",
    recordType: "governance.decision",
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    expiresAt: null,
    decision: loop.loopVerdict === "BLOCKED" ? "DENY" : "ALLOW",
    stage,
    status,
    actor: {
      principalId: input.user.id,
      kind: "USER",
      ownerId: input.user.id,
      projectId: null,
      applicationId: null,
      agentId: loop.failureRun.evidence.agent,
    },
    operation: "synthetic.closed_loop.remediate",
    resource: {
      entityType: loop.governance?.entityType ?? "RECORD",
      action: loop.governance?.action ?? "EXECUTE",
      artifactHash,
    },
    policy: {
      authority: "DEFAULT_ENTITY_POLICIES",
      version: null,
      result:
        loop.governance?.decision === "DENY"
          ? "DENIED"
          : loop.governance?.decision === "ALLOW"
            ? "ALLOWED"
            : "NOT_EVALUATED",
      reason: loop.governance?.reason ?? loop.recovery.explanation,
      riskTier: "LOW_RISK_WRITE",
      requiresApproval: false,
    },
    risk: {
      status: "EVALUATED",
      score: 5,
      rawBucket: "AUTO",
      effectiveBucket: "AUTO",
      factors: ["synthetic_sandbox", "test_tenant_only"],
      floors: {
        untrustedSource: false,
        automationActor: false,
        delegation: false,
      },
    },
    approval: {
      required: false,
      requestId: null,
      status: "NOT_REQUIRED",
    },
    correlation: { requestId: loop.failureRun.evidence.runId },
    provenance: {
      sourceOrigin: "system",
      sourceTrustLevel: "trusted",
      authorityScope: "synthetic.sandbox",
      agentTrustLevel: "LAB",
      delegationHopCount: 0,
    },
    execution: {
      status:
        loop.loopVerdict === "BLOCKED" || loop.loopVerdict === "ALREADY_VERIFIED"
          ? loop.loopVerdict === "BLOCKED"
            ? "NOT_RUN"
            : "NOT_RUN"
          : loop.recovery.recovered
            ? "EXECUTED"
            : "FAILED",
      result:
        loop.loopVerdict === "BLOCKED"
          ? "NOT_RUN"
          : loop.recovery.recovered
            ? "SUCCESS"
            : loop.loopVerdict === "ALREADY_VERIFIED"
              ? "NOT_RUN"
              : "FAILURE",
      reason: loop.recovery.explanation,
    },
  });
}

function asAtlasError(error: unknown): AtlasError {
  if (error instanceof AtlasError) return error;
  if (error instanceof SandboxPolicyError) {
    return new AtlasError("VALIDATION_ERROR", error.message, { statusCode: 400 });
  }
  return new AtlasError(
    "INTERNAL_ERROR",
    error instanceof Error ? error.message : "Synthetic scenario failed",
    { statusCode: 500 },
  );
}
