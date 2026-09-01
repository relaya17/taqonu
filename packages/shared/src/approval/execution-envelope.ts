import {
  CANONICALIZATION_VERSION,
  hashCanonicalJson,
} from "./canonicalization.js";
import {
  executionApprovalEnvelopeSchema,
  type ExecutionApprovalEnvelopeV1,
  type VerificationPlan,
} from "../schemas/execution-approval-envelope.schema.js";
import type { z } from "zod";

export type ExecutionCandidate = Omit<ExecutionApprovalEnvelopeV1, "envelopeHash">;

export type EnvelopeMatchResult =
  | Readonly<{ matched: true }>
  | Readonly<{ matched: false; field: string }>;

export type ToolArgsValidator = z.ZodType<unknown>;

function envelopeHashInput(envelope: ExecutionCandidate): Omit<ExecutionCandidate, "envelopeHash"> {
  return envelope;
}

export function computeToolArgsHash(toolArgs: unknown): string {
  return hashCanonicalJson(toolArgs);
}

export function computeVerificationPlanHash(plan: Omit<VerificationPlan, "verificationPlanHash">): string {
  return hashCanonicalJson(plan);
}

export function computeEnvelopeHash(envelope: ExecutionCandidate): string {
  return hashCanonicalJson(envelopeHashInput(envelope));
}

export function validateExecutionApprovalEnvelope(
  value: unknown,
  toolArgsValidator?: ToolArgsValidator,
): ExecutionApprovalEnvelopeV1 {
  const envelope = executionApprovalEnvelopeSchema.parse(value);
  toolArgsValidator?.parse(envelope.toolArgs);
  if (envelope.canonicalizationVersion !== CANONICALIZATION_VERSION) {
    throw new TypeError("Unsupported canonicalization version");
  }
  if (computeToolArgsHash(envelope.toolArgs) !== envelope.toolArgsHash) {
    throw new TypeError("toolArgsHash does not match canonical tool arguments");
  }
  const { verificationPlanHash, ...verificationPlan } = envelope.verificationPlan;
  if (computeVerificationPlanHash(verificationPlan) !== verificationPlanHash) {
    throw new TypeError("verificationPlanHash does not match verification plan");
  }
  const { envelopeHash, ...hashInput } = envelope;
  if (computeEnvelopeHash(hashInput) !== envelopeHash) {
    throw new TypeError("envelopeHash does not match immutable envelope");
  }
  return envelope;
}

export function createExecutionApprovalEnvelope(
  candidate: ExecutionCandidate,
  toolArgsValidator?: ToolArgsValidator,
): ExecutionApprovalEnvelopeV1 {
  toolArgsValidator?.parse(candidate.toolArgs);
  const toolArgsHash = computeToolArgsHash(candidate.toolArgs);
  const { verificationPlanHash: ignoredPlanHash, ...verificationPlan } = candidate.verificationPlan;
  void ignoredPlanHash;
  const completeCandidate: ExecutionCandidate = {
    ...candidate,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    toolArgsHash,
    verificationPlan: {
      ...verificationPlan,
      verificationPlanHash: computeVerificationPlanHash(verificationPlan),
    },
  };
  const envelope = { ...completeCandidate, envelopeHash: computeEnvelopeHash(completeCandidate) };
  return validateExecutionApprovalEnvelope(envelope, toolArgsValidator);
}

const MATCH_FIELDS = [
  "schemaVersion",
  "approvalId",
  "canonicalizationVersion",
  "requester",
  "proposedExecutingAgent",
  "operation",
  "action",
  "tool",
  "toolArgs",
  "toolArgsHash",
  "entity",
  "project",
  "tenant",
  "artifact",
  "verificationPlan",
  "policyDecision",
  "requestedAt",
  "expiresAt",
] as const;

export function matchExecutionCandidate(
  storedEnvelope: ExecutionApprovalEnvelopeV1,
  candidate: ExecutionCandidate,
  toolArgsValidator?: ToolArgsValidator,
): EnvelopeMatchResult {
  validateExecutionApprovalEnvelope(storedEnvelope, toolArgsValidator);
  toolArgsValidator?.parse(candidate.toolArgs);
  const expected = computeEnvelopeHash(candidate);
  if (expected !== storedEnvelope.envelopeHash) return { matched: false, field: "envelopeHash" };

  for (const field of MATCH_FIELDS) {
    if (hashCanonicalJson(storedEnvelope[field]) !== hashCanonicalJson(candidate[field])) {
      return { matched: false, field };
    }
  }
  return { matched: true };
}
