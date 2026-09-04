import { SandboxPolicyError, assertSyntheticTenantId } from "./policy.js";
import { resolveDomain } from "./tenant.js";
import type { ScenarioDefinition } from "./types.js";

export const REAL_ESTATE_DEAL_COMPLETION: ScenarioDefinition = {
  id: "real-estate-deal-completion",
  tenantId: "TEST-REALTY",
  domain: "REALTY",
  actorId: "SYNTHETIC_OPERATOR",
  steps: [
    "create_customer",
    "create_property",
    "create_lead",
    "create_deal",
    "assign_agent",
    "create_contract",
    "create_invoice",
    "simulate_payment",
    "complete_deal",
  ],
  assertions: [
    "customer_exists",
    "property_exists",
    "deal_exists",
    "agent_assigned",
    "invoice_exists",
    "invoice_paid",
    "deal_completed",
    "payment_event_exists",
    "audit_trail_complete",
    "no_real_external",
  ],
  expectedProcess: [
    "Customer",
    "Property",
    "Lead",
    "Deal",
    "Agent Assignment",
    "Contract",
    "Invoice",
    "Payment",
    "Completed",
  ],
};

export const HOTEL_RESERVATION: ScenarioDefinition = {
  id: "hotel-reservation-completion",
  tenantId: "TEST-HOTEL",
  domain: "HOTEL",
  actorId: "SYNTHETIC_OPERATOR",
  steps: ["create_customer", "create_reservation", "simulate_payment", "complete_reservation"],
  assertions: [
    "customer_exists",
    "reservation_exists",
    "audit_trail_complete",
    "no_real_external",
  ],
  expectedProcess: ["Customer", "Reservation", "Payment", "Completed"],
};

export const PROPERTY_MAINTENANCE: ScenarioDefinition = {
  id: "property-maintenance-completion",
  tenantId: "TEST-PROPERTY",
  domain: "PROPERTY",
  actorId: "SYNTHETIC_OPERATOR",
  steps: ["create_property", "create_maintenance_request", "complete_task"],
  assertions: ["property_exists", "audit_trail_complete", "no_real_external"],
  expectedProcess: ["Property", "Maintenance", "Task", "Completed"],
};

export const CRM_LEAD_DEAL: ScenarioDefinition = {
  id: "crm-lead-to-deal",
  tenantId: "TEST-CRM",
  domain: "CRM",
  actorId: "SYNTHETIC_OPERATOR",
  steps: ["create_customer", "create_lead", "create_deal", "assign_agent"],
  assertions: [
    "customer_exists",
    "lead_exists",
    "deal_exists",
    "agent_assigned",
    "audit_trail_complete",
  ],
  expectedProcess: ["Customer", "Lead", "Deal", "Agent Assignment"],
};

export const ATLAS_SELF_TEST_UNAUTHORIZED: ScenarioDefinition = {
  id: "atlas-self-test-unauthorized",
  tenantId: "TEST-CRM",
  domain: "CRM",
  actorId: "UNAUTHORIZED_AGENT",
  steps: ["unauthorized_protected_action"],
  assertions: ["authorization_denied", "audit_trail_complete"],
  expectedProcess: [],
};

export const SANDBOX_CONTAINMENT_PAYMENT: ScenarioDefinition = {
  id: "sandbox-containment-payment",
  tenantId: "TEST-REALTY-001",
  domain: "REALTY",
  actorId: "SYNTHETIC_OPERATOR",
  failureInjection: "TEST-010",
  steps: ["create_customer", "create_invoice", "attempt_real_payment", "simulate_payment"],
  assertions: [
    "customer_exists",
    "invoice_exists",
    "invoice_paid",
    "payment_event_exists",
    "no_real_external",
    "audit_trail_complete",
  ],
  expectedProcess: ["Customer", "Invoice", "Payment"],
};

/** Registered incomplete process: invoice exists, required payment transition does not. */
export const REAL_ESTATE_DEAL_INCOMPLETE_PAYMENT: ScenarioDefinition = {
  id: "real-estate-deal-incomplete-payment",
  tenantId: "TEST-REALTY",
  domain: "REALTY",
  actorId: "SYNTHETIC_OPERATOR",
  steps: REAL_ESTATE_DEAL_COMPLETION.steps.filter(
    (step) => step !== "simulate_payment" && step !== "complete_deal",
  ),
  assertions: REAL_ESTATE_DEAL_COMPLETION.assertions,
  expectedProcess: REAL_ESTATE_DEAL_COMPLETION.expectedProcess,
};

export function failureScenario(
  id: ScenarioDefinition["failureInjection"] & string,
): ScenarioDefinition {
  const base = { ...REAL_ESTATE_DEAL_COMPLETION, tenantId: `TEST-REALTY-${id.slice(-3)}` };
  return { ...base, id: `failure-${id}`, failureInjection: id };
}

export const DOMAIN_SCENARIOS: readonly ScenarioDefinition[] = [
  REAL_ESTATE_DEAL_COMPLETION,
  HOTEL_RESERVATION,
  PROPERTY_MAINTENANCE,
  CRM_LEAD_DEAL,
];

const FAILURE_IDS = [
  "TEST-001",
  "TEST-002",
  "TEST-003",
  "TEST-004",
  "TEST-005",
  "TEST-006",
  "TEST-007",
  "TEST-008",
  "TEST-009",
  "TEST-010",
] as const;

export const REGISTERED_SCENARIOS: readonly ScenarioDefinition[] = [
  ...DOMAIN_SCENARIOS,
  ATLAS_SELF_TEST_UNAUTHORIZED,
  SANDBOX_CONTAINMENT_PAYMENT,
  REAL_ESTATE_DEAL_INCOMPLETE_PAYMENT,
  ...FAILURE_IDS.map((id) => failureScenario(id)),
];

const BY_ID = new Map(REGISTERED_SCENARIOS.map((row) => [row.id, row]));

export const SYNTHETIC_SCENARIO_RUN_PATH =
  "/api/v1/synthetic/scenarios/run" as const;

export const SYNTHETIC_SCENARIO_CLOSED_LOOP_PATH =
  "/api/v1/synthetic/scenarios/closed-loop" as const;

const HEALTHY_SCENARIO_BY_DOMAIN = {
  REALTY: REAL_ESTATE_DEAL_COMPLETION.id,
  HOTEL: HOTEL_RESERVATION.id,
  PROPERTY: PROPERTY_MAINTENANCE.id,
  CRM: CRM_LEAD_DEAL.id,
} as const;

/** Healthy counterpart used to re-run after an injected or process failure. */
export function remediatingScenarioId(scenario: ScenarioDefinition): string {
  return HEALTHY_SCENARIO_BY_DOMAIN[scenario.domain];
}

export function resolveRemediatingScenario(
  scenario: ScenarioDefinition,
): ScenarioDefinition {
  return resolveRegisteredScenario(remediatingScenarioId(scenario), scenario.tenantId);
}

export function resolveRegisteredScenario(
  scenarioId: string,
  tenantId: string,
): ScenarioDefinition {
  const found = BY_ID.get(scenarioId);
  if (!found) {
    throw new SandboxPolicyError(
      "UNKNOWN_SCENARIO",
      `Scenario "${scenarioId}" is not a registered synthetic scenario`,
    );
  }
  assertSyntheticTenantId(tenantId);
  const domain = resolveDomain(tenantId);
  if (domain !== found.domain) {
    throw new SandboxPolicyError(
      "DOMAIN_MISMATCH",
      `Tenant "${tenantId}" is ${domain}; scenario "${scenarioId}" is ${found.domain}`,
    );
  }
  return { ...found, tenantId };
}
