import { SandboxPolicyError } from "./policy.js";
import { SyntheticTenantManager } from "./tenant.js";
import { SyntheticStore } from "./store.js";
import { SyntheticDataGenerator } from "./generator.js";
import { SyntheticEventStream } from "./events.js";
import { SyntheticAuditSink, syntheticRunIds } from "./audit.js";
import { authorizeSyntheticAction } from "./authorization.js";
import { attemptRealExternal, simulateExternal } from "./simulation.js";
import { evaluateAssertions } from "./assertions.js";
import { buildEvidence, type ScenarioEvidence } from "./evidence.js";
import type {
  FailureInjectionId,
  ProcessVerification,
  ScenarioDefinition,
  ScenarioStepName,
  ScenarioVerdict,
  SyntheticActorId,
  SyntheticEntity,
  SyntheticEntityKind,
} from "./types.js";

export interface ScenarioRunResult {
  readonly evidence: ScenarioEvidence;
  readonly verdict: ScenarioVerdict;
}

export class SyntheticUniverse {
  readonly tenants = new SyntheticTenantManager();
  readonly store = new SyntheticStore();
  readonly generator = new SyntheticDataGenerator();
  readonly events = new SyntheticEventStream();
  readonly audit = new SyntheticAuditSink();

  run(scenario: ScenarioDefinition): ScenarioRunResult {
    const tenant = this.tenants.isSynthetic(scenario.tenantId)
      ? this.tenants.get(scenario.tenantId)
      : this.tenants.create(scenario.tenantId);
    this.store.isolate(tenant.tenantId);
    const ids = syntheticRunIds(scenario.id, tenant.tenantId);
    const actorId = resolveActor(scenario);
    const actions: string[] = [];
    const toolCalls: string[] = [];
    const authDecisions: string[] = [];
    const failures: string[] = [];
    const simulations: string[] = [];
    const processActual: string[] = [];
    let interrupted = false;

    const ctx: StepContext = {
      universe: this,
      tenantId: tenant.tenantId,
      runId: ids.runId,
      ownerId: ids.ownerId,
      correlationId: ids.correlationId,
      actorId,
      failure: scenario.failureInjection,
      actions,
      toolCalls,
      authDecisions,
      failures,
      simulations,
      processActual,
    };

    this.audit.recordAction({
      tenantId: tenant.tenantId,
      runId: ids.runId,
      actorId,
      ownerId: ids.ownerId,
      correlationId: ids.correlationId,
      type: "synthetic.scenario.started",
      reason: `Scenario ${scenario.id} started`,
      decision: "ALLOW",
      result: "SUCCESS",
      extra: { scenarioId: scenario.id, failure: scenario.failureInjection ?? null },
    });

    if (scenario.failureInjection === "TEST-002") {
      this.store.injectDatabaseTimeout();
    }

    for (const step of scenario.steps) {
      if (interrupted) break;
      if (scenario.failureInjection === "TEST-006" && step === "create_invoice") {
        interrupted = true;
        failures.push("Workflow interrupted halfway before create_invoice (TEST-006)");
        this.events.emit({
          name: "WorkflowInterrupted",
          tenantId: tenant.tenantId,
          runId: ids.runId,
          payload: { at: step },
        });
        break;
      }
      if (scenario.failureInjection === "TEST-001" && step === "create_invoice") {
        failures.push("Invoice API unavailable (TEST-001)");
        this.events.emit({
          name: "InvoiceApiUnavailable",
          tenantId: tenant.tenantId,
          runId: ids.runId,
        });
        break;
      }
      try {
        applyStep(step, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(message);
        this.audit.recordAction({
          tenantId: tenant.tenantId,
          runId: ids.runId,
          actorId,
          ownerId: ids.ownerId,
          correlationId: ids.correlationId,
          type: "synthetic.step.failed",
          reason: message,
          decision: error instanceof SandboxPolicyError ? "DENY" : "ALLOW",
          result: "FAILURE",
          extra: { step },
        });
        if (step === "attempt_real_payment" || step === "attempt_real_email") {
          // Containment: continue so simulation can still be recorded if present.
          continue;
        }
        if (scenario.failureInjection) break;
        throw error;
      }
    }

    if (scenario.failureInjection === "TEST-005") {
      const invoice = this.store.findByKind(tenant.tenantId, "INVOICE");
      if (invoice) {
        failures.push("Duplicate transaction (TEST-005)");
        this.events.emit({
          name: "DuplicateTransaction",
          tenantId: tenant.tenantId,
          runId: ids.runId,
          entityId: invoice.id,
        });
      }
    }

    const assertions = evaluateAssertions({
      tenantId: tenant.tenantId,
      store: this.store,
      events: this.events,
      audit: this.audit,
      names: scenario.assertions,
    });
    const process = verifyProcess(scenario.expectedProcess, processActual);
    const verdict = decideVerdict(scenario, assertions, process, failures);

    this.audit.recordAction({
      tenantId: tenant.tenantId,
      runId: ids.runId,
      actorId,
      ownerId: ids.ownerId,
      correlationId: ids.correlationId,
      type: "synthetic.scenario.completed",
      reason: `Scenario ${scenario.id} verdict ${verdict}`,
      decision: verdict === "DENIED" ? "DENY" : "ALLOW",
      result: verdict === "VERIFIED" || verdict === "CONTAINED" ? "SUCCESS" : "PARTIAL",
      extra: { verdict, failures },
    });

    const evidence = buildEvidence({
      scenarioId: scenario.id,
      tenantId: tenant.tenantId,
      runId: ids.runId,
      agent: actorId,
      timestamp: "2026-09-04T00:00:00.000Z",
      actions,
      toolCalls,
      authorizationDecisions: authDecisions,
      events: this.events.list(tenant.tenantId),
      stateTransitions: processActual,
      failures,
      assertions,
      finalState: this.store.snapshot(tenant.tenantId),
      process,
      verdict,
      audit: this.audit.list(),
      simulations,
    });

    return { evidence, verdict };
  }
}

interface StepContext {
  readonly universe: SyntheticUniverse;
  readonly tenantId: string;
  readonly runId: string;
  readonly ownerId: string;
  readonly correlationId: string;
  readonly actorId: SyntheticActorId;
  readonly failure: FailureInjectionId | undefined;
  readonly actions: string[];
  readonly toolCalls: string[];
  readonly authDecisions: string[];
  readonly failures: string[];
  readonly simulations: string[];
  readonly processActual: string[];
}

function resolveActor(scenario: ScenarioDefinition): SyntheticActorId {
  if (scenario.failureInjection === "TEST-007") return "UNAUTHORIZED_AGENT";
  if (scenario.actorId === "UNAUTHORIZED_AGENT") return "UNAUTHORIZED_AGENT";
  return "SYNTHETIC_OPERATOR";
}

function authorizeKind(
  ctx: StepContext,
  kind: SyntheticEntityKind,
  action: "CREATE" | "UPDATE" | "EXECUTE" | "READ",
  toolName: string,
): boolean {
  const trace = authorizeSyntheticAction({
    kind,
    action,
    actorId: ctx.actorId,
  });
  ctx.authDecisions.push(`${trace.entityType}.${trace.action}:${trace.decision}`);
  ctx.toolCalls.push(toolName);
  ctx.universe.audit.recordAuthorization({
    tenantId: ctx.tenantId,
    runId: ctx.runId,
    actorId: ctx.actorId,
    ownerId: ctx.ownerId,
    correlationId: ctx.correlationId,
    trace,
    toolName,
  });
  if (trace.decision !== "ALLOWED") {
    ctx.failures.push(trace.reason);
    ctx.universe.events.emit({
      name: "AuthorizationDenied",
      tenantId: ctx.tenantId,
      runId: ctx.runId,
      payload: { reason: trace.reason, toolName },
    });
    return false;
  }
  return true;
}

function persist(
  ctx: StepContext,
  entity: SyntheticEntity,
  eventName: string,
  processLabel: string | null,
): void {
  ctx.universe.store.put(entity);
  ctx.actions.push(eventName);
  if (processLabel) ctx.processActual.push(processLabel);
  ctx.universe.events.emit({
    name: eventName,
    tenantId: ctx.tenantId,
    runId: ctx.runId,
    entityId: entity.id,
    payload: { status: entity.status, kind: entity.kind },
  });
}

function applyStep(step: ScenarioStepName, ctx: StepContext): void {
  const g = ctx.universe.generator;
  const store = ctx.universe.store;

  if (step === "attempt_real_payment") {
    ctx.universe.audit.recordAction({
      tenantId: ctx.tenantId,
      runId: ctx.runId,
      actorId: ctx.actorId,
      ownerId: ctx.ownerId,
      correlationId: ctx.correlationId,
      type: "synthetic.security.external_write_denied",
      reason: "Real external payment denied by sandbox policy",
      decision: "DENY",
      result: "FAILURE",
      extra: { channel: "payment" },
    });
    ctx.universe.events.emit({
      name: "ExternalWriteDenied",
      tenantId: ctx.tenantId,
      runId: ctx.runId,
      payload: { channel: "payment" },
    });
    attemptRealExternal("payment");
  }

  if (step === "attempt_real_email") {
    ctx.universe.audit.recordAction({
      tenantId: ctx.tenantId,
      runId: ctx.runId,
      actorId: ctx.actorId,
      ownerId: ctx.ownerId,
      correlationId: ctx.correlationId,
      type: "synthetic.security.external_write_denied",
      reason: "Real email denied by sandbox policy",
      decision: "DENY",
      result: "FAILURE",
      extra: { channel: "email" },
    });
    attemptRealExternal("email");
  }

  if (step === "unauthorized_protected_action") {
    authorizeKind(ctx, "INVOICE", "EXECUTE", "financial.execute");
    return;
  }

  if (ctx.failure === "TEST-004" && step === "create_customer") {
    throw new SandboxPolicyError(
      "REQUIRED_FIELD",
      "Required field missing: customer.displayName (TEST-004)",
    );
  }

  if (ctx.failure === "TEST-008" && step === "complete_deal") {
    throw new SandboxPolicyError(
      "INVALID_TRANSITION",
      "Invalid state transition: complete_deal before paid invoice (TEST-008)",
    );
  }

  switch (step) {
    case "create_customer": {
      if (!authorizeKind(ctx, "CUSTOMER", "CREATE", "synthetic.create_customer")) return;
      persist(
        ctx,
        g.entity({
          tenantId: ctx.tenantId,
          kind: "CUSTOMER",
          fields: { displayName: "Test Customer" },
        }),
        "CustomerCreated",
        "Customer",
      );
      return;
    }
    case "create_property": {
      if (!authorizeKind(ctx, "PROPERTY", "CREATE", "synthetic.create_property")) return;
      persist(
        ctx,
        g.entity({ tenantId: ctx.tenantId, kind: "PROPERTY", fields: { address: "1 Test St" } }),
        "PropertyCreated",
        "Property",
      );
      return;
    }
    case "create_lead": {
      if (!authorizeKind(ctx, "LEAD", "CREATE", "synthetic.create_lead")) return;
      const customer = store.findByKind(ctx.tenantId, "CUSTOMER");
      persist(
        ctx,
        g.entity({
          tenantId: ctx.tenantId,
          kind: "LEAD",
          relatedIds: customer ? { customerId: customer.id } : {},
        }),
        "LeadCreated",
        "Lead",
      );
      return;
    }
    case "create_deal": {
      if (!authorizeKind(ctx, "DEAL", "CREATE", "synthetic.create_deal")) return;
      const lead = store.findByKind(ctx.tenantId, "LEAD");
      persist(
        ctx,
        g.entity({
          tenantId: ctx.tenantId,
          kind: "DEAL",
          status: "open",
          relatedIds: lead ? { leadId: lead.id } : {},
        }),
        "DealCreated",
        "Deal",
      );
      return;
    }
    case "assign_agent": {
      if (!authorizeKind(ctx, "DEAL", "UPDATE", "synthetic.assign_agent")) return;
      const deal = store.findByKind(ctx.tenantId, "DEAL");
      const agent = g.entity({
        tenantId: ctx.tenantId,
        kind: "AGENT",
        fields: { role: "broker" },
      });
      store.put(agent);
      if (!deal) {
        throw new SandboxPolicyError("MISSING_DEAL", "No deal to assign");
      }
      if (ctx.failure === "TEST-009") {
        persist(
          ctx,
          { ...deal, status: "stale", assignedAgentId: agent.id },
          "AgentAssigned",
          "Agent Assignment",
        );
        ctx.failures.push("Stale state recorded on deal (TEST-009)");
        ctx.universe.events.emit({
          name: "StaleState",
          tenantId: ctx.tenantId,
          runId: ctx.runId,
          entityId: deal.id,
        });
        return;
      }
      const assignedId = ctx.failure === "TEST-003" ? "TEST-AGENT-WRONG" : agent.id;
      if (ctx.failure === "TEST-003") {
        ctx.failures.push("Wrong agent assignment (TEST-003)");
      }
      persist(
        ctx,
        { ...deal, assignedAgentId: assignedId },
        "AgentAssigned",
        "Agent Assignment",
      );
      return;
    }
    case "create_contract": {
      if (!authorizeKind(ctx, "CONTRACT", "CREATE", "synthetic.create_contract")) return;
      const deal = store.findByKind(ctx.tenantId, "DEAL");
      persist(
        ctx,
        g.entity({
          tenantId: ctx.tenantId,
          kind: "CONTRACT",
          relatedIds: deal ? { dealId: deal.id } : {},
        }),
        "ContractCreated",
        "Contract",
      );
      return;
    }
    case "create_invoice": {
      if (!authorizeKind(ctx, "INVOICE", "CREATE", "synthetic.create_invoice")) return;
      const deal = store.findByKind(ctx.tenantId, "DEAL");
      persist(
        ctx,
        g.entity({
          tenantId: ctx.tenantId,
          kind: "INVOICE",
          status: "pending",
          relatedIds: deal ? { dealId: deal.id } : {},
          fields: { amount: 1000 },
        }),
        "InvoiceCreated",
        "Invoice",
      );
      return;
    }
    case "simulate_payment": {
      if (!authorizeKind(ctx, "PAYMENT", "EXECUTE", "synthetic.simulate_payment")) return;
      const sim = simulateExternal({
        channel: "payment",
        tenantId: ctx.tenantId,
        runId: ctx.runId,
        events: ctx.universe.events,
        entityId: store.findByKind(ctx.tenantId, "INVOICE")?.id ?? null,
      });
      ctx.simulations.push(sim.message);
      const invoice = store.findByKind(ctx.tenantId, "INVOICE");
      if (invoice) {
        persist(ctx, { ...invoice, status: "paid" }, "PaymentStateUpdated", "Payment");
      }
      persist(
        ctx,
        g.entity({
          tenantId: ctx.tenantId,
          kind: "PAYMENT",
          status: "simulated",
          relatedIds: invoice ? { invoiceId: invoice.id } : {},
        }),
        "PaymentSimulated",
        invoice ? null : "Payment",
      );
      return;
    }
    case "complete_deal": {
      if (!authorizeKind(ctx, "DEAL", "UPDATE", "synthetic.complete_deal")) return;
      const deal = store.findByKind(ctx.tenantId, "DEAL");
      const invoice = store.findByKind(ctx.tenantId, "INVOICE");
      if (!deal) throw new SandboxPolicyError("MISSING_DEAL", "No deal to complete");
      if (invoice && invoice.status !== "paid") {
        throw new SandboxPolicyError(
          "INVALID_TRANSITION",
          "Cannot complete deal while invoice is not paid",
        );
      }
      persist(ctx, { ...deal, status: "completed" }, "DealCompleted", "Completed");
      return;
    }
    case "create_reservation": {
      if (!authorizeKind(ctx, "RESERVATION", "CREATE", "synthetic.create_reservation")) return;
      persist(
        ctx,
        g.entity({ tenantId: ctx.tenantId, kind: "RESERVATION", status: "held" }),
        "ReservationCreated",
        "Reservation",
      );
      return;
    }
    case "complete_reservation": {
      if (!authorizeKind(ctx, "RESERVATION", "UPDATE", "synthetic.complete_reservation")) {
        return;
      }
      const reservation = store.findByKind(ctx.tenantId, "RESERVATION");
      if (!reservation) {
        throw new SandboxPolicyError("MISSING_RESERVATION", "No reservation");
      }
      persist(
        ctx,
        { ...reservation, status: "completed" },
        "ReservationCompleted",
        "Completed",
      );
      return;
    }
    case "create_maintenance_request": {
      if (!authorizeKind(ctx, "MAINTENANCE", "CREATE", "synthetic.create_maintenance")) return;
      persist(
        ctx,
        g.entity({ tenantId: ctx.tenantId, kind: "MAINTENANCE", status: "open" }),
        "MaintenanceCreated",
        "Maintenance",
      );
      persist(
        ctx,
        g.entity({ tenantId: ctx.tenantId, kind: "TASK", status: "open" }),
        "TaskCreated",
        "Task",
      );
      return;
    }
    case "complete_task": {
      if (!authorizeKind(ctx, "TASK", "UPDATE", "synthetic.complete_task")) return;
      const task = store.findByKind(ctx.tenantId, "TASK");
      if (!task) throw new SandboxPolicyError("MISSING_TASK", "No task");
      persist(ctx, { ...task, status: "completed" }, "TaskCompleted", "Completed");
      return;
    }
    case "simulate_whatsapp": {
      if (!authorizeKind(ctx, "CUSTOMER", "READ", "synthetic.simulate_whatsapp")) return;
      const sim = simulateExternal({
        channel: "whatsapp",
        tenantId: ctx.tenantId,
        runId: ctx.runId,
        events: ctx.universe.events,
      });
      ctx.simulations.push(sim.message);
      return;
    }
    case "simulate_email": {
      const sim = simulateExternal({
        channel: "email",
        tenantId: ctx.tenantId,
        runId: ctx.runId,
        events: ctx.universe.events,
      });
      ctx.simulations.push(sim.message);
      return;
    }
    default: {
      const _never: never = step;
      throw new SandboxPolicyError("UNKNOWN_STEP", `Unknown step ${_never}`);
    }
  }
}

function verifyProcess(
  expected: readonly string[],
  actual: readonly string[],
): ProcessVerification {
  const missing = expected.find((label, index) => actual[index] !== label) ?? null;
  const failed = missing !== null || actual.length < expected.length;
  return {
    expected,
    actual,
    failed,
    missingTransition: failed ? missing ?? expected[actual.length] ?? "unknown" : null,
    explanation: failed
      ? `Process failure detected. Expected ${expected.join(" → ")}; actual ${actual.join(" → ") || "(empty)"}. Missing: ${missing ?? expected[actual.length] ?? "unknown"}.`
      : "Process matched expected transitions.",
  };
}

function decideVerdict(
  scenario: ScenarioDefinition,
  assertions: readonly { readonly passed: boolean }[],
  process: ProcessVerification,
  failures: readonly string[],
): ScenarioVerdict {
  if (scenario.failureInjection === "TEST-010") return "CONTAINED";
  if (scenario.failureInjection === "TEST-007" || scenario.actorId === "UNAUTHORIZED_AGENT") {
    return "DENIED";
  }
  if (scenario.failureInjection) return "INJECTED_FAILURE_DETECTED";
  if (process.failed || assertions.some((a) => !a.passed)) return "PROCESS_FAILURE";
  return "VERIFIED";
}
