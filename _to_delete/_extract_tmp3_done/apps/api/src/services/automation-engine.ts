import { domainEventBus } from "@atlas/agent-core";
import type { DomainEventHandler, DomainEventPattern } from "@atlas/agent-core";
import type { DomainEvent } from "@atlas/shared";

/**
 * Automation Engine — the generic trigger -> condition -> action plumbing
 * called for in the roadmap doc ("invoice.overdue -> notify -> escalate ->
 * audit"). This sits directly on top of the `DomainEventBus`
 * (packages/agent-core/src/events/event-bus.ts) and turns hand-written
 * one-off subscribers (like apps/api/src/services/event-rules.ts's single
 * `patch.applied` -> audit wiring) into declarative *data*: an
 * `AutomationRule` is a plain object describing which event triggers it
 * (`on`), an optional guard (`condition`), and what to do when both are
 * satisfied (`action`).
 *
 * This file is intentionally dependency-free of any specific rule's domain
 * knowledge — it does not know about audit logs, oracles, notifications, or
 * any other concrete action. Concrete built-in rules live in
 * `automation-rules.ts`, which imports this engine rather than the other way
 * around.
 */
export interface AutomationRule {
  /** Stable identifier, e.g. "gate-blocked-audit". Used for diagnostics/tests. */
  readonly id: string;
  /** Human-readable description of what this rule does and why. */
  readonly description: string;
  /** Which DomainEventType(s) trigger this rule — exact type, "*", or "ns.*". */
  readonly on: DomainEventPattern;
  /**
   * Optional guard evaluated against the triggering event. When present and
   * it returns false, `action` is skipped entirely. Absent means "always
   * run" (subject only to `on` matching).
   */
  readonly condition?: (event: DomainEvent) => boolean;
  /** The effect to run when `on` matches and `condition` (if any) passes. */
  readonly action: (event: DomainEvent) => void | Promise<void>;
}

const registeredRuleIds = new Set<string>();

/**
 * Subscribe a declarative `AutomationRule` onto the shared `domainEventBus`
 * singleton. The returned handler only invokes `rule.action` when
 * `rule.condition` is absent or returns true for the triggering event — the
 * bus itself only ever sees a single wrapped `DomainEventHandler` per rule.
 *
 * Returns an unsubscribe function (delegating to `DomainEventBus.subscribe`'s
 * own unsubscribe), so callers can dynamically add/remove rules.
 */
export function registerAutomationRule(rule: AutomationRule): () => void {
  const handler: DomainEventHandler = (event) => {
    if (rule.condition && !rule.condition(event)) return;
    return rule.action(event);
  };
  const unsubscribe = domainEventBus.subscribe(rule.on, handler);
  registeredRuleIds.add(rule.id);
  return () => {
    unsubscribe();
    registeredRuleIds.delete(rule.id);
  };
}

/**
 * Every automation rule id currently subscribed via `registerAutomationRule`
 * — for tests/diagnostics, so a test can assert exactly which rules are
 * active without reaching into `domainEventBus` internals.
 */
export function listRegisteredAutomationRuleIds(): string[] {
  return Array.from(registeredRuleIds);
}

/** Test helper — forget every tracked rule id (does not touch the bus itself). */
export function resetAutomationEngineForTests(): void {
  registeredRuleIds.clear();
}
