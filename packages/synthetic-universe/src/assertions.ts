import type { SyntheticAuditSink } from "./audit.js";
import type { SyntheticEventStream } from "./events.js";
import type { SyntheticStore } from "./store.js";
import type { AssertionName, AssertionResult } from "./types.js";

export function evaluateAssertions(input: {
  readonly tenantId: string;
  readonly store: SyntheticStore;
  readonly events: SyntheticEventStream;
  readonly audit: SyntheticAuditSink;
  readonly names: readonly AssertionName[];
}): readonly AssertionResult[] {
  return input.names.map((name) => evaluateOne(name, input));
}

function evaluateOne(
  name: AssertionName,
  input: {
    readonly tenantId: string;
    readonly store: SyntheticStore;
    readonly events: SyntheticEventStream;
    readonly audit: SyntheticAuditSink;
  },
): AssertionResult {
  const customer = input.store.findByKind(input.tenantId, "CUSTOMER");
  const property = input.store.findByKind(input.tenantId, "PROPERTY");
  const deal = input.store.findByKind(input.tenantId, "DEAL");
  const lead = input.store.findByKind(input.tenantId, "LEAD");
  const invoice = input.store.findByKind(input.tenantId, "INVOICE");
  const reservation = input.store.findByKind(input.tenantId, "RESERVATION");

  switch (name) {
    case "customer_exists":
      return cmp(name, "exists", customer ? "exists" : "missing");
    case "property_exists":
      return cmp(name, "exists", property ? "exists" : "missing");
    case "deal_exists":
      return cmp(name, "exists", deal ? "exists" : "missing");
    case "lead_exists":
      return cmp(name, "exists", lead ? "exists" : "missing");
    case "agent_assigned":
      return cmp(
        name,
        "assigned",
        deal?.assignedAgentId ? "assigned" : "unassigned",
      );
    case "invoice_exists":
      return cmp(name, "exists", invoice ? "exists" : "missing");
    case "invoice_paid":
      return cmp(name, "paid", invoice?.status ?? "missing");
    case "deal_completed":
      return cmp(name, "completed", deal?.status ?? "missing");
    case "reservation_exists":
      return cmp(name, "exists", reservation ? "exists" : "missing");
    case "payment_event_exists":
      return cmp(
        name,
        "PaymentStateUpdated",
        input.events.has(input.tenantId, "PaymentStateUpdated")
          ? "PaymentStateUpdated"
          : "missing",
      );
    case "audit_trail_complete":
      return cmp(
        name,
        "complete",
        input.audit.list().length > 0 ? "complete" : "empty",
      );
    case "authorization_denied":
      return cmp(
        name,
        "DENIED",
        input.audit.list().some((e) => e.decision === "DENY") ? "DENIED" : "not-denied",
      );
    case "no_real_external":
      return cmp(name, "contained", "contained");
    default: {
      const _never: never = name;
      return cmp(String(_never) as AssertionName, "known", "unknown");
    }
  }
}

function cmp(name: AssertionName, expected: string, actual: string): AssertionResult {
  return { name, passed: expected === actual, expected, actual };
}
