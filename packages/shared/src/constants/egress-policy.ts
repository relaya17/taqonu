import {
  type DataClass,
  type DataOperation,
  type EgressDecision,
  type EgressDestination,
} from "./data-classification.js";

export interface EgressPolicyInput {
  readonly dataClass: DataClass;
  readonly destination: EgressDestination;
  readonly operation: DataOperation;
  readonly purpose: string;
  readonly actorId?: string | null;
  /** Full-repository payloads are never the minimum necessary. */
  readonly fullRepository?: boolean;
}

export interface EgressPolicyResult {
  readonly decision: EgressDecision;
  readonly reason: string;
  readonly dataClass: DataClass;
  readonly destination: EgressDestination;
  readonly operation: DataOperation;
  readonly purpose: string;
  readonly requiresMinimize: boolean;
}

const APPROVED_CLOUD: ReadonlySet<EgressDestination> = new Set([
  "openai",
  "anthropic",
  "google",
  "groq",
  "deepseek",
]);

const INTERNAL_DEST: ReadonlySet<EgressDestination> = new Set([
  "atlas_internal",
  "local_llm",
]);

export function destinationFromLlmProvider(
  provider: string | null | undefined,
): EgressDestination {
  const raw = (provider ?? "").trim().toLowerCase();
  if (raw === "echo" || raw === "none" || raw === "") return "atlas_internal";
  if (raw === "ollama") return "local_llm";
  if (raw === "openai") return "openai";
  if (raw === "anthropic") return "anthropic";
  if (raw === "gemini" || raw === "google") return "google";
  if (raw === "groq") return "groq";
  if (raw === "deepseek") return "deepseek";
  return "unapproved_external";
}

/**
 * Controlled egress — not a promise that data "never leaves".
 * Secrets and system-critical material never go to an external processor.
 */
export function decideEgress(input: EgressPolicyInput): EgressPolicyResult {
  const base = {
    dataClass: input.dataClass,
    destination: input.destination,
    operation: input.operation,
    purpose: input.purpose,
  };

  if (input.dataClass === "SECRET" || input.dataClass === "SYSTEM_CRITICAL") {
    if (!INTERNAL_DEST.has(input.destination)) {
      return {
        ...base,
        decision: "DENY",
        reason: `${input.dataClass} must not leave Atlas (destination ${input.destination})`,
        requiresMinimize: false,
      };
    }
  }

  if (input.destination === "unapproved_external") {
    return {
      ...base,
      decision: "DENY",
      reason: "Destination is not an approved processor",
      requiresMinimize: false,
    };
  }

  if (input.operation === "LLM_EGRESS" && input.fullRepository === true) {
    return {
      ...base,
      decision: "DENY",
      reason: "Full-repository LLM egress is forbidden; send the minimum function/context",
      requiresMinimize: false,
    };
  }

  if (input.operation === "EXPORT" && input.dataClass !== "PUBLIC") {
    return {
      ...base,
      decision: "REQUIRE_APPROVAL",
      reason: "Non-public export requires operator/owner approval",
      requiresMinimize: true,
    };
  }

  if (
    input.operation === "LLM_EGRESS" &&
    APPROVED_CLOUD.has(input.destination) &&
    (input.dataClass === "PROJECT_PRIVATE" ||
      input.dataClass === "TENANT_PRIVATE" ||
      input.dataClass === "INTERNAL")
  ) {
    return {
      ...base,
      decision: "ALLOW",
      reason: "Approved cloud processor with minimize+redact+audit required",
      requiresMinimize: true,
    };
  }

  if (INTERNAL_DEST.has(input.destination)) {
    return {
      ...base,
      decision: "ALLOW",
      reason: "Internal or local destination",
      requiresMinimize: input.dataClass !== "PUBLIC",
    };
  }

  if (input.dataClass === "PUBLIC") {
    return {
      ...base,
      decision: "ALLOW",
      reason: "Public data class",
      requiresMinimize: false,
    };
  }

  return {
    ...base,
    decision: "DENY",
    reason: `No egress rule allows ${input.dataClass} → ${input.destination} for ${input.operation}`,
    requiresMinimize: false,
  };
}
