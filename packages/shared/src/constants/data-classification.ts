/**
 * ADR-021 — classify before READ / STORE / RETRIEVE / LLM_EGRESS / EXPORT / LOG / AUDIT
 * and outbound WEBHOOK / EMAIL / TELEMETRY / PLUGIN / MESSAGING.
 * This is the vocabulary. Policy evaluation lives in egress-policy.ts.
 */
export const DATA_CLASSES = [
  "PUBLIC",
  "INTERNAL",
  "TENANT_PRIVATE",
  "PROJECT_PRIVATE",
  "SECRET",
  "SYSTEM_CRITICAL",
] as const;

export type DataClass = (typeof DATA_CLASSES)[number];

export const DATA_OPERATIONS = [
  "READ",
  "STORE",
  "RETRIEVE",
  "LLM_EGRESS",
  "EXPORT",
  "LOG",
  "AUDIT",
  "WEBHOOK",
  "EMAIL",
  "TELEMETRY",
  "PLUGIN",
  "MESSAGING",
] as const;

export type DataOperation = (typeof DATA_OPERATIONS)[number];

export const EGRESS_DESTINATIONS = [
  "atlas_internal",
  "local_llm",
  "openai",
  "anthropic",
  "google",
  "groq",
  "deepseek",
  "webhook",
  "export",
  "email",
  "telemetry",
  "plugin",
  "messaging",
  "unapproved_external",
] as const;

export type EgressDestination = (typeof EGRESS_DESTINATIONS)[number];

export const EGRESS_DECISIONS = ["ALLOW", "DENY", "REQUIRE_APPROVAL"] as const;
export type EgressDecision = (typeof EGRESS_DECISIONS)[number];

export function isDataClass(value: string): value is DataClass {
  return (DATA_CLASSES as readonly string[]).includes(value);
}

export function isEgressDestination(value: string): value is EgressDestination {
  return (EGRESS_DESTINATIONS as readonly string[]).includes(value);
}

export function classifyKind(
  kind:
    | "public_docs"
    | "source_code"
    | "evidence"
    | "memory"
    | "architecture"
    | "agent_trace"
    | "audit"
    | "secret"
    | "credential"
    | "platform_config",
): DataClass {
  switch (kind) {
    case "public_docs":
      return "PUBLIC";
    case "architecture":
      return "INTERNAL";
    case "source_code":
    case "evidence":
    case "memory":
    case "agent_trace":
      return "PROJECT_PRIVATE";
    case "audit":
      return "TENANT_PRIVATE";
    case "platform_config":
      return "SYSTEM_CRITICAL";
    case "secret":
    case "credential":
      return "SECRET";
  }
}
