import { remediatingScenarioId } from "./catalog.js";
import type { FailureDiagnosis } from "./diagnosis.js";
import type { ScenarioDefinition, SyntheticEntityKind } from "./types.js";
import type { EntityAction } from "@atlas/agent-core";

export interface RemediationStep {
  readonly action: string;
  readonly rationale: string;
}

export interface RemediationPlan {
  readonly recoverable: boolean;
  readonly remediatingScenarioId: string;
  readonly steps: readonly RemediationStep[];
  readonly authorizeKind: SyntheticEntityKind;
  readonly authorizeAction: EntityAction;
}

const DOMAIN_AUTHORITY: Readonly<
  Record<
    ScenarioDefinition["domain"],
    { readonly kind: SyntheticEntityKind; readonly action: EntityAction }
  >
> = {
  REALTY: { kind: "PAYMENT", action: "EXECUTE" },
  HOTEL: { kind: "RESERVATION", action: "UPDATE" },
  PROPERTY: { kind: "TASK", action: "UPDATE" },
  CRM: { kind: "DEAL", action: "UPDATE" },
};

export function planRemediation(
  diagnosis: FailureDiagnosis,
  scenario: ScenarioDefinition,
): RemediationPlan {
  const targetId = remediatingScenarioId(scenario);
  const authority = DOMAIN_AUTHORITY[scenario.domain];

  if (!diagnosis.detected) {
    return {
      recoverable: false,
      remediatingScenarioId: targetId,
      steps: [],
      authorizeKind: authority.kind,
      authorizeAction: authority.action,
    };
  }

  return {
    recoverable: true,
    remediatingScenarioId: targetId,
    steps: stepsFor(diagnosis, targetId),
    authorizeKind: authority.kind,
    authorizeAction: authority.action,
  };
}

function stepsFor(diagnosis: FailureDiagnosis, targetId: string): readonly RemediationStep[] {
  const replay: RemediationStep = {
    action: `replay:${targetId}`,
    rationale: `Re-run the healthy ${targetId} process without failure injection.`,
  };

  switch (diagnosis.failureClass) {
    case "INVOICE_API_UNAVAILABLE":
    case "DATABASE_TIMEOUT":
    case "WORKFLOW_INTERRUPTED":
      return [
        {
          action: "clear_injection",
          rationale: "Remove the controlled failure so the invoice path can proceed.",
        },
        replay,
      ];
    case "WRONG_AGENT_ASSIGNMENT":
      return [
        {
          action: "reassign_generated_agent",
          rationale: "Assign the generated TEST-* agent instead of TEST-AGENT-WRONG.",
        },
        replay,
      ];
    case "REQUIRED_FIELD_MISSING":
      return [
        {
          action: "supply_required_fields",
          rationale: "Create the customer with displayName present.",
        },
        replay,
      ];
    case "DUPLICATE_TRANSACTION":
      return [
        {
          action: "drop_duplicate_transaction",
          rationale: "Replay without the injected duplicate transaction.",
        },
        replay,
      ];
    case "UNAUTHORIZED_ACTOR":
      return [
        {
          action: "switch_actor_synthetic_operator",
          rationale: "Re-run as SYNTHETIC_OPERATOR; UNAUTHORIZED_AGENT remains denied.",
        },
        replay,
      ];
    case "INVALID_STATE_TRANSITION":
    case "MISSING_PROCESS_TRANSITION":
      return [
        {
          action: "complete_missing_payment",
          rationale: "Simulate payment, then complete the deal.",
        },
        replay,
      ];
    case "STALE_STATE":
      return [
        {
          action: "refresh_assignment_state",
          rationale: "Assign the agent without marking the deal stale.",
        },
        replay,
      ];
    case "EXTERNAL_WRITE_CONTAINED":
      return [
        {
          action: "keep_sandbox_containment",
          rationale: "Real external writes stay denied. Recover via simulated payment only.",
        },
        replay,
      ];
    case "NONE":
      return [];
    default: {
      const _never: never = diagnosis.failureClass;
      return [{ action: "unknown", rationale: String(_never) }];
    }
  }
}
