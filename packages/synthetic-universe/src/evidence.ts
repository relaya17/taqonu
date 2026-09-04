import type { UnifiedAuditEntryInput } from "@atlas/shared";
import type { SyntheticEvent } from "./types.js";
import type {
  AssertionResult,
  ProcessVerification,
  ScenarioVerdict,
  SyntheticEntity,
} from "./types.js";

export interface ScenarioEvidence {
  readonly scenarioId: string;
  readonly tenantId: string;
  readonly runId: string;
  readonly agent: string;
  readonly timestamp: string;
  readonly actions: readonly string[];
  readonly toolCalls: readonly string[];
  readonly authorizationDecisions: readonly string[];
  readonly events: readonly SyntheticEvent[];
  readonly stateTransitions: readonly string[];
  readonly failures: readonly string[];
  readonly assertions: readonly AssertionResult[];
  readonly finalState: Readonly<Record<string, SyntheticEntity>>;
  readonly process: ProcessVerification;
  readonly verdict: ScenarioVerdict;
  readonly audit: readonly UnifiedAuditEntryInput[];
  readonly simulations: readonly string[];
}

export function buildEvidence(input: ScenarioEvidence): ScenarioEvidence {
  return input;
}
