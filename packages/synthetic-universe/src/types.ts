import type { BusinessEntityType, EntityAction } from "@atlas/agent-core";
import type { SANDBOX_CONTROLS } from "./policy.js";

export type SyntheticDomain = "REALTY" | "HOTEL" | "PROPERTY" | "CRM";

export type SyntheticEntityKind =
  | "COMPANY"
  | "EMPLOYEE"
  | "AGENT"
  | "CUSTOMER"
  | "PROPERTY"
  | "LEAD"
  | "DEAL"
  | "CONTRACT"
  | "RESERVATION"
  | "MAINTENANCE"
  | "INVOICE"
  | "PAYMENT"
  | "TASK"
  | "EVENT";

export type SyntheticActorId = "SYNTHETIC_OPERATOR" | "UNAUTHORIZED_AGENT";

export interface SyntheticTenantRecord {
  readonly tenantId: string;
  readonly environment: "sandbox";
  readonly companyType: "synthetic";
  readonly realBusiness: false;
  readonly domain: SyntheticDomain;
  readonly externalCommunications: false;
  readonly realPayments: false;
  readonly externalWrites: false;
  readonly controls: typeof SANDBOX_CONTROLS;
}

export interface SyntheticEntity {
  readonly id: string;
  readonly kind: SyntheticEntityKind;
  readonly tenantId: string;
  readonly status: string;
  readonly assignedAgentId: string | null;
  readonly relatedIds: Readonly<Record<string, string>>;
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SyntheticEvent {
  readonly seq: number;
  readonly name: string;
  readonly at: string;
  readonly tenantId: string;
  readonly runId: string;
  readonly entityId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AuthorizationTrace {
  readonly entityType: BusinessEntityType;
  readonly action: EntityAction;
  readonly decision: "ALLOWED" | "DENIED" | "APPROVAL_REQUIRED";
  readonly reason: string;
  readonly actorId: SyntheticActorId;
}

export type ScenarioStepName =
  | "create_customer"
  | "create_property"
  | "create_lead"
  | "create_deal"
  | "assign_agent"
  | "create_contract"
  | "create_invoice"
  | "simulate_payment"
  | "complete_deal"
  | "create_reservation"
  | "complete_reservation"
  | "create_maintenance_request"
  | "complete_task"
  | "simulate_whatsapp"
  | "simulate_email"
  | "attempt_real_payment"
  | "attempt_real_email"
  | "unauthorized_protected_action";

export type AssertionName =
  | "customer_exists"
  | "property_exists"
  | "deal_exists"
  | "lead_exists"
  | "agent_assigned"
  | "invoice_exists"
  | "invoice_paid"
  | "deal_completed"
  | "reservation_exists"
  | "payment_event_exists"
  | "audit_trail_complete"
  | "authorization_denied"
  | "no_real_external";

export type FailureInjectionId =
  | "TEST-001"
  | "TEST-002"
  | "TEST-003"
  | "TEST-004"
  | "TEST-005"
  | "TEST-006"
  | "TEST-007"
  | "TEST-008"
  | "TEST-009"
  | "TEST-010";

export interface ScenarioDefinition {
  readonly id: string;
  readonly tenantId: string;
  readonly domain: SyntheticDomain;
  readonly actorId: SyntheticActorId;
  readonly steps: readonly ScenarioStepName[];
  readonly assertions: readonly AssertionName[];
  readonly failureInjection?: FailureInjectionId;
  readonly expectedProcess: readonly string[];
}

export interface AssertionResult {
  readonly name: AssertionName;
  readonly passed: boolean;
  readonly expected: string;
  readonly actual: string;
}

export interface ProcessVerification {
  readonly expected: readonly string[];
  readonly actual: readonly string[];
  readonly failed: boolean;
  readonly missingTransition: string | null;
  readonly explanation: string;
}

export type ScenarioVerdict =
  | "VERIFIED"
  | "PROCESS_FAILURE"
  | "DENIED"
  | "INJECTED_FAILURE_DETECTED"
  | "CONTAINED";
