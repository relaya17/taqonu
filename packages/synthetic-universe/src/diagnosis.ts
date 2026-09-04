import type { ScenarioRunResult } from "./runner.js";
import type { FailureInjectionId, ScenarioDefinition, ScenarioVerdict } from "./types.js";

export type FailureClass =
  | "INVOICE_API_UNAVAILABLE"
  | "DATABASE_TIMEOUT"
  | "WRONG_AGENT_ASSIGNMENT"
  | "REQUIRED_FIELD_MISSING"
  | "DUPLICATE_TRANSACTION"
  | "WORKFLOW_INTERRUPTED"
  | "UNAUTHORIZED_ACTOR"
  | "INVALID_STATE_TRANSITION"
  | "STALE_STATE"
  | "EXTERNAL_WRITE_CONTAINED"
  | "MISSING_PROCESS_TRANSITION"
  | "NONE";

export interface FailureDiagnosis {
  readonly detected: boolean;
  readonly failureClass: FailureClass;
  readonly rootCause: string;
  readonly evidenceRefs: readonly string[];
  readonly injectionId: FailureInjectionId | null;
  readonly originalVerdict: ScenarioVerdict;
}

const INJECTION_CLASS: Readonly<Record<FailureInjectionId, FailureClass>> = {
  "TEST-001": "INVOICE_API_UNAVAILABLE",
  "TEST-002": "DATABASE_TIMEOUT",
  "TEST-003": "WRONG_AGENT_ASSIGNMENT",
  "TEST-004": "REQUIRED_FIELD_MISSING",
  "TEST-005": "DUPLICATE_TRANSACTION",
  "TEST-006": "WORKFLOW_INTERRUPTED",
  "TEST-007": "UNAUTHORIZED_ACTOR",
  "TEST-008": "INVALID_STATE_TRANSITION",
  "TEST-009": "STALE_STATE",
  "TEST-010": "EXTERNAL_WRITE_CONTAINED",
};

const INJECTION_CAUSE: Readonly<Record<FailureInjectionId, string>> = {
  "TEST-001": "Invoice API was unavailable before create_invoice.",
  "TEST-002": "Synthetic store timed out (injected database timeout).",
  "TEST-003": "Deal was assigned TEST-AGENT-WRONG instead of the generated agent.",
  "TEST-004": "Required customer.displayName was omitted.",
  "TEST-005": "A duplicate transaction was recorded after invoice creation.",
  "TEST-006": "Workflow was interrupted before create_invoice.",
  "TEST-007": "UNAUTHORIZED_AGENT was denied on a protected financial execute.",
  "TEST-008": "complete_deal was attempted before the invoice was paid.",
  "TEST-009": "Deal state was marked stale during agent assignment.",
  "TEST-010": "Real external payment was denied and contained by the sandbox.",
};

export function diagnoseFailure(
  run: ScenarioRunResult,
  scenario: ScenarioDefinition,
): FailureDiagnosis {
  if (scenario.actorId === "UNAUTHORIZED_AGENT" || run.verdict === "DENIED") {
    return {
      detected: true,
      failureClass: "UNAUTHORIZED_ACTOR",
      rootCause: INJECTION_CAUSE["TEST-007"],
      evidenceRefs: [
        `verdict:${run.verdict}`,
        ...run.evidence.authorizationDecisions.map((row) => `auth:${row}`),
        ...run.evidence.failures.map((row) => `failure:${row}`),
      ],
      injectionId: scenario.failureInjection ?? "TEST-007",
      originalVerdict: run.verdict,
    };
  }

  const injection = scenario.failureInjection ?? null;
  if (injection) {
    return {
      detected: true,
      failureClass: INJECTION_CLASS[injection],
      rootCause: INJECTION_CAUSE[injection],
      evidenceRefs: evidenceRefs(run, injection),
      injectionId: injection,
      originalVerdict: run.verdict,
    };
  }

  if (run.verdict === "VERIFIED") {
    return {
      detected: false,
      failureClass: "NONE",
      rootCause: "Process matched expected transitions and assertions.",
      evidenceRefs: [],
      injectionId: null,
      originalVerdict: run.verdict,
    };
  }

  const missing = run.evidence.process.missingTransition;
  const failedAssertions = run.evidence.assertions
    .filter((row) => !row.passed)
    .map((row) => row.name);

  return {
    detected: true,
    failureClass: "MISSING_PROCESS_TRANSITION",
    rootCause:
      run.evidence.process.explanation ||
      `Process failed. Missing: ${missing ?? "unknown"}. Failed assertions: ${failedAssertions.join(", ") || "none"}.`,
    evidenceRefs: [
      ...run.evidence.process.expected.map((label) => `expected:${label}`),
      ...run.evidence.process.actual.map((label) => `actual:${label}`),
      ...failedAssertions.map((name) => `assertion:${name}`),
    ],
    injectionId: null,
    originalVerdict: run.verdict,
  };
}

function evidenceRefs(run: ScenarioRunResult, injection: FailureInjectionId): string[] {
  const refs = [
    `verdict:${run.verdict}`,
    `injection:${injection}`,
    ...run.evidence.failures.map((row) => `failure:${row}`),
  ];
  if (run.evidence.process.failed && run.evidence.process.missingTransition) {
    refs.push(`missing:${run.evidence.process.missingTransition}`);
  }
  return refs;
}
