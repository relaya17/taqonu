import {
  AtlasError,
  classifyKind,
  decideEgress,
  destinationFromLlmProvider,
  type DataClass,
} from "@atlas/shared";

export function assertLlmEgressAllowed(input: {
  readonly provider: string | null | undefined;
  readonly purpose: string;
  readonly actorId?: string | null;
  readonly dataClass?: DataClass;
  readonly fullRepository?: boolean;
}): void {
  const dataClass = input.dataClass ?? classifyKind("source_code");
  const destination = destinationFromLlmProvider(input.provider);
  const result = decideEgress({
    dataClass,
    destination,
    operation: "LLM_EGRESS",
    purpose: input.purpose,
    ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
    ...(input.fullRepository !== undefined
      ? { fullRepository: input.fullRepository }
      : {}),
  });

  void import("./audit-log.js")
    .then((mod) => {
      mod.appendUnifiedAuditEntry({
        type: "egress.llm",
        actorId: input.actorId ?? "system",
        actorKind: "SYSTEM",
        reason: result.reason,
        input: {
          destination,
          dataClass,
          purpose: input.purpose,
          provider: input.provider ?? null,
        },
        output: { decision: result.decision },
        policy: "controlled-egress",
        risk: result.decision === "DENY" ? "HIGH" : "MEDIUM",
        approval:
          result.decision === "REQUIRE_APPROVAL" ? "PENDING" : "NOT_REQUIRED",
        result: result.decision === "ALLOW" ? "SUCCESS" : "FAILURE",
      });
    })
    .catch(() => {
      /* audit must not block the gate */
    });

  if (result.decision === "DENY") {
    throw new AtlasError("POLICY_VIOLATION", result.reason, {
      statusCode: 403,
      details: { destination, dataClass, purpose: input.purpose },
    });
  }
  if (result.decision === "REQUIRE_APPROVAL") {
    throw new AtlasError("APPROVAL_REQUIRED", result.reason, {
      statusCode: 403,
      details: { destination, dataClass, purpose: input.purpose },
    });
  }
}

