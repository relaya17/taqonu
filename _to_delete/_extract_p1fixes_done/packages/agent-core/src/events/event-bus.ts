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
  /**
   * `true` the first time this event `id` is dispatched; `false` when
   * `publish()` recognized the `id` as a duplicate within the dedup window
   * and skipped dispatch entirely (subscribers are not invoked a second
   * time). Absent from historical callers' expectations otherwise — every
   * existing field keeps its exact prior meaning, this is additive.
   */
  readonly dispatched: boolean;
  /** Set only when `dispatched` is `false`, explaining why. */
  readonly reason?: "duplicate";
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
 * Default size of the recently-seen-event-id dedup window (see
 * `DomainEventBus`'s `seenEventIds`). Chosen as a small, fixed bound rather
 * than a time window: a count-based FIFO is O(1) to check/insert/evict with
 * no timers or clock dependency, and 1000 in-flight/recent ids is generously
 * larger than any realistic burst of duplicate redeliveries (e.g. a webhook
 * retry storm) while staying well under a memory concern (each entry is a
 * ~36-byte UUID string). The tradeoff: a truly pathological gap between the
 * original publish and a very late duplicate redelivery (more than 1000
 * *other* events later) would not be caught by this layer — that's why
 * automation-engine.ts adds a second, independent (rule, event) dedup layer
 * as a backstop rather than relying solely on this one.
 */
const DEFAULT_SEEN_EVENT_ID_LIMIT = 1000;

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
 *
 * `publish()` also dedups by `event.id` against a bounded recently-seen
 * window (see `DEFAULT_SEEN_EVENT_ID_LIMIT`) so a duplicate redelivery of the
 * same event never dispatches to subscribers twice.
 */
export class DomainEventBus {
  private readonly subscriptions: Subscription[] = [];
  /**
   * Bounded FIFO of recently-published event ids, for dedup. `Map` (not
   * `Set`) only because it preserves insertion order the same way a `Set`
   * would — used purely as an ordered membership set; values are unused
   * placeholders. Insertion order is what lets `markSeen()` find and delete
   * the oldest id in O(1) via `.keys().next()`.
   */
  private readonly seenEventIds = new Map<string, true>();
  private readonly seenEventIdLimit: number;

  constructor(options: { readonly seenEventIdLimit?: number } = {}) {
    this.seenEventIdLimit = options.seenEventIdLimit ?? DEFAULT_SEEN_EVENT_ID_LIMIT;
  }

  /** Register a handler for a pattern. Returns an unsubscribe function. */
  subscribe(pattern: DomainEventPattern, handler: DomainEventHandler): () => void {
    const sub: Subscription = { pattern, handler };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx !== -1) this.subscriptions.splice(idx, 1);
    };
  }

  /**
   * Dispatch an event to every matching subscriber, in subscription order.
   *
   * Deduplicated by `event.id`: if this exact id was published within the
   * last `seenEventIdLimit` distinct ids, subscribers are NOT invoked again
   * — `publish()` returns `{ dispatched: false, reason: "duplicate", handled:
   * 0, errors: [] }` instead. This protects against a duplicate webhook
   * delivery or an at-least-once retry re-publishing the same committed
   * domain event and every subscriber (including automation rules) seeing it
   * twice.
   */
  async publish(event: DomainEvent): Promise<DomainEventDispatchResult> {
    if (this.seenEventIds.has(event.id)) {
      return { handled: 0, errors: [], dispatched: false, reason: "duplicate" };
    }
    this.markSeen(event.id);

    const matching = this.subscriptions.filter((sub) => matches(sub.pattern, event.type));
    const errors: unknown[] = [];
    for (const sub of matching) {
      try {
        await sub.handler(event);
      } catch (error) {
        errors.push(error);
      }
    }
    return { handled: matching.length, errors, dispatched: true };
  }

  private markSeen(id: string): void {
    this.seenEventIds.set(id, true);
    if (this.seenEventIds.size > this.seenEventIdLimit) {
      const oldest = this.seenEventIds.keys().next().value;
      if (oldest !== undefined) this.seenEventIds.delete(oldest);
    }
  }

  /** Number of active subscriptions — mainly for tests/diagnostics. */
  get subscriptionCount(): number {
    return this.subscriptions.length;
  }

  /** Number of event ids currently tracked for dedup — mainly for tests/diagnostics. */
  get seenEventIdCount(): number {
    return this.seenEventIds.size;
  }

  /** Test helper: drop every subscription and forget every tracked event id (full reset). */
  clear(): void {
    this.subscriptions.length = 0;
    this.seenEventIds.clear();
  }

  /** Test helper: forget every tracked event id only, leaving subscriptions intact. */
  clearSeenEventIds(): void {
    this.seenEventIds.clear();
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
