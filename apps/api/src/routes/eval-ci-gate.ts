import type { FastifyInstance } from "fastify";
import { isWriteGateOpen } from "@atlas/shared";
import { detectSecrets, redactSecrets } from "@atlas/agent-core";
import { osStore } from "../store/os-store.js";

function runCiGate() {
  const sample =
    "api_key=sk_test_should_redact_abcdefghijklmnopqrstuvwxyz and ghp_abcdefghijklmnopqrstuvwxyz123456";
  const redacted = redactSecrets(sample);
  const secretsOk =
    detectSecrets(redacted).length === 0 &&
    redacted.includes("[REDACTED_SECRET]");

  const projects = osStore.listProjects();
  const hasEvidence = projects.some((p) => osStore.getEvidence(p.id).length > 0);

  /** Gate stays closed when required dimensions have not all passed. */
  const writeGateOpen = isWriteGateOpen([], [
    "SECURITY",
    "AUTHORIZATION",
    "EVIDENCE",
  ]);

  const checks = [
    {
      id: "secret_redaction",
      passed: secretsOk,
      blocking: true,
      note: secretsOk
        ? "Secret redaction golden OK"
        : "Secret redaction failed — block CI",
    },
    {
      id: "write_gate_closed",
      passed: !writeGateOpen,
      blocking: true,
      note: writeGateOpen
        ? "WRITE gate unexpectedly open without eval passes"
        : "WRITE gate closed without full eval suite pass",
    },
    {
      id: "evidence_present",
      passed: hasEvidence,
      blocking: false,
      note: hasEvidence
        ? "Evidence store non-empty"
        : "INSUFFICIENT_EVIDENCE — no project evidence yet (warn)",
    },
  ] as const;

  const blockingFailed = checks.filter((c) => c.blocking && !c.passed);
  const passed = blockingFailed.length === 0;

  return {
    gate: "atlas-ci-eval" as const,
    passed,
    exitCode: passed ? 0 : 1,
    checks: [...checks],
    epistemicState: hasEvidence
      ? ("INFERRED" as const)
      : ("INSUFFICIENT_EVIDENCE" as const),
    note: passed
      ? "CI gate green for blocking checks"
      : "CI gate red — fix blocking failures before merge",
    blockingFailed: blockingFailed.map((c) => c.id),
  };
}

/**
 * CI-oriented gate: exit-friendly JSON for GitHub Actions.
 * Blocking: secret redaction golden + WRITE gate closed by default.
 */
export async function registerEvalCiGateRoutes(
  app: FastifyInstance,
): Promise<void> {
  const handler = async (
    _request: unknown,
    reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  ) => {
    const result = runCiGate();
    osStore.appendAudit({
      type: "eval.ci_gate",
      passed: result.passed,
      blockingFailed: result.blockingFailed,
    });
    const statusCode = result.passed ? 200 : 422;
    return reply.status(statusCode).send(result);
  };

  app.post("/api/v1/eval/ci-gate", handler);
  app.get("/api/v1/eval/ci-gate", handler);
}

/** Pure helper for unit tests. */
export function evaluateCiGateForTests(): ReturnType<typeof runCiGate> {
  return runCiGate();
}
