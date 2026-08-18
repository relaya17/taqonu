import type { DomainEvent, DomainEventType } from "@atlas/shared";

/**
 * A subscription pattern: an exact DomainEventType ("patch.applied"), the
 * wildcard "*" (every event), or a namespace wildcard ("patch.*", matching
 * every type that starts with "patch.").
 */
export type DomainEventPattern = DomainEventType | "*" | `${string}.*`;

export type DomainEventHandler = (event: DomainEvent) => void | Promise<void>;

export interface DomainEventDispatchResult {
  readonly handled: number;
  readonly errors: readonly unknown[];
}

interface Subscription {
  readonly pattern: DomainEventPattern;
  readonly handler: DomainEventHandler;
}

function matches(pattern: DomainEventPattern, type: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -1); // "patch.*" -> "patch."
    return type.startsWith(prefix);
  }
  return pattern === type;
}

/**
 * In-process pub/sub for DomainEvents — the "Unified Event Layer" from the
 * Atlas Control Plane vision doc (recommended-build-order step 2).
 *
 * This intentionally sits *on top of* the pre-existing durable domain-event
 * log (`@atlas/shared` domainEventSchema + apps/api os-store
 * `appendDomainEvent`/`listDomainEvents`), rather than replacing it: that log
 * already gives an append-only, queryable history of ~20 real domain event
 * types across the codebase. What was missing was a *reactive* layer —
 * nothing ever subscribed to those events. `DomainEventBus.publish()` is the
 * piece that closes the loop: apps/api calls it right after an event is
 * durably recorded, so subscribers always react to committed history and
 * never to a write that might still fail.
 *
 * A single failing subscriber can never block another subscriber or the
 * publisher — errors are caught per-handler and returned, not thrown.
 */
export class DomainEventBus {
  private readonly subscriptions: Subscription[] = [];

  /** Register a handler for a pattern. Returns an unsubscribe function. */
  subscribe(pattern: DomainEventPattern, handler: DomainEventHandler): () => void {
    const sub: Subscription = { pattern, handler };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx !== -1) this.subscriptions.splice(idx, 1);
    };
  }

  /** Dispatch an event to every matching subscriber, in subscription order. */
  async publish(event: DomainEvent): Promise<DomainEventDispatchResult> {
    const matching = this.subscriptions.filter((sub) => matches(sub.pattern, event.type));
    const errors: unknown[] = [];
    for (const sub of matching) {
      try {
        await sub.handler(event);
      } catch (error) {
        errors.push(error);
      }
    }
    return { handled: matching.length, errors };
  }

  /** Number of active subscriptions — mainly for tests/diagnostics. */
  get subscriptionCount(): number {
    return this.subscriptions.length;
  }

  /** Test helper: drop every subscription. */
  clear(): void {
    this.subscriptions.length = 0;
  }
}

/**
 * Process-wide singleton. apps/api wires its single `appendDomainEvent()`
 * choke point (apps/api/src/services/memory-pipeline.ts) to call
 * `domainEventBus.publish()` right after the event is persisted, so every
 * one of the ~20 existing publish call sites across routes/services becomes
 * reactive for free — no call site needs to change.
 */
export const domainEventBus = new DomainEventBus();
