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
 * Bound for `firedIdempotencyKeys` below — see that field's comment for why
 * a count-based FIFO (same strategy as `DomainEventBus`'s event-id dedup in
 * packages/agent-core/src/events/event-bus.ts) rather than a time window.
 * 1000 is generous headroom over any realistic burst of duplicate
 * redeliveries across however many rules are registered at once, while
 * keeping memory bounded (~tens of bytes per `"ruleId:eventId"` string).
 */
const DEFAULT_FIRED_IDEMPOTENCY_KEY_LIMIT = 1000;

/**
 * Bounded FIFO of `"${ruleId}:${event.id}"` idempotency keys whose `action`
 * has already fired. This is a *second, independent* dedup layer on top of
 * `DomainEventBus.publish()`'s event-id dedup (event-bus.ts): the bus layer
 * protects against the same event being *published* twice, but this layer
 * protects against the same *rule* running its action twice for the same
 * event even if the bus dispatched only once but the rule is (accidentally
 * or intentionally) subscribed more than once — e.g.
 * `registerBuiltinAutomationRules()` is documented as safe to call twice,
 * and a future caller could call `registerAutomationRule()` directly twice
 * for the same rule id without going through that guard. Without this layer,
 * two subscriptions for the same rule would each invoke `action` once per
 * event, double-firing side effects like `appendUnifiedAuditEntry`.
 *
 * `Map` (not `Set`) purely for its insertion-order iteration, used to evict
 * the oldest key in O(1) once the bound is exceeded — same pattern as
 * `DomainEventBus.seenEventIds`.
 */
const firedIdempotencyKeys = new Map<string, true>();
let firedIdempotencyKeyLimit = DEFAULT_FIRED_IDEMPOTENCY_KEY_LIMIT;

function idempotencyKey(ruleId: string, eventId: string): string {
  return `${ruleId}:${eventId}`;
}

/**
 * Returns `true` and marks the key as fired if this (rule, event) pair has
 * not fired before; returns `false` (action must be skipped) if it has.
 */
function claimIdempotencyKey(key: string): boolean {
  if (firedIdempotencyKeys.has(key)) return false;
  firedIdempotencyKeys.set(key, true);
  if (firedIdempotencyKeys.size > firedIdempotencyKeyLimit) {
    const oldest = firedIdempotencyKeys.keys().next().value;
    if (oldest !== undefined) firedIdempotencyKeys.delete(oldest);
  }
  return true;
}

/**
 * Subscribe a declarative `AutomationRule` onto the shared `domainEventBus`
 * singleton. The returned handler only invokes `rule.action` when
 * `rule.condition` is absent or returns true for the triggering event — the
 * bus itself only ever sees a single wrapped `DomainEventHandler` per rule.
 *
 * Idempotency: before invoking `action`, the handler derives
 * `"${rule.id}:${event.id}"` and claims it via `claimIdempotencyKey()`. If
 * that exact (rule, event) pair already fired, `action` is skipped — this is
 * the backstop described on `firedIdempotencyKeys` above, independent of
 * `DomainEventBus`'s own event-id dedup.
 *
 * Returns an unsubscribe function (delegating to `DomainEventBus.subscribe`'s
 * own unsubscribe), so callers can dynamically add/remove rules.
 */
export function registerAutomationRule(rule: AutomationRule): () => void {
  const handler: DomainEventHandler = (event) => {
    if (rule.condition && !rule.condition(event)) return;
    if (!claimIdempotencyKey(idempotencyKey(rule.id, event.id))) return;
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

/**
 * Test helper — forget every tracked rule id and every fired idempotency key
 * (does not touch the bus itself — callers that also want the bus's own
 * event-id dedup and subscriptions cleared should additionally call
 * `domainEventBus.clear()`, as `automation-rules.ts`'s
 * `resetAutomationRulesForTests()` already does).
 */
export function resetAutomationEngineForTests(): void {
  registeredRuleIds.clear();
  firedIdempotencyKeys.clear();
  firedIdempotencyKeyLimit = DEFAULT_FIRED_IDEMPOTENCY_KEY_LIMIT;
}

/**
 * Test helper — override the fired-idempotency-key bound so a test can prove
 * eviction behavior without publishing 1000+ events. Resets on the next
 * `resetAutomationEngineForTests()` call.
 */
export function setFiredIdempotencyKeyLimitForTests(limit: number): void {
  firedIdempotencyKeyLimit = limit;
}

/** Number of (rule, event) idempotency keys currently tracked — for tests/diagnostics. */
export function firedIdempotencyKeyCountForTests(): number {
  return firedIdempotencyKeys.size;
}
