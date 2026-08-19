import { describe, expect, it, vi } from "vitest";
import type { DomainEvent } from "@atlas/shared";
import { DomainEventBus } from "./event-bus.js";

// Each call gets its own default id (a monotonically-incrementing,
// UUID-shaped string) so that two `makeEvent()` calls are treated as two
// distinct events by DomainEventBus's id-based dedup unless a test
// explicitly overrides `id` to simulate a duplicate delivery.
let nextEventIdSuffix = 1;
function nextDefaultEventId(): string {
  const suffix = String(nextEventIdSuffix++).padStart(12, "0");
  return `00000000-0000-4000-8000-${suffix}`;
}

function makeEvent(type: DomainEvent["type"], overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: nextDefaultEventId(),
    type,
    occurredAt: "2026-01-01T00:00:00.000Z",
    ownerId: "00000000-0000-4000-8000-000000000001",
    projectId: null,
    correlationId: "00000000-0000-4000-8000-000000000002",
    causationId: null,
    epistemicState: "OBSERVED",
    payload: {},
    ...overrides,
  };
}

describe("DomainEventBus", () => {
  it("dispatches to a subscriber matching the exact event type", async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    bus.subscribe("patch.applied", handler);
    const event = makeEvent("patch.applied");
    const result = await bus.publish(event);
    expect(handler).toHaveBeenCalledWith(event);
    expect(result.handled).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("does not dispatch to a subscriber for a different exact type", async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    bus.subscribe("patch.proposed", handler);
    await bus.publish(makeEvent("patch.applied"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("dispatches namespace-wildcard subscriptions ('patch.*') to any matching type", async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    bus.subscribe("patch.*", handler);
    await bus.publish(makeEvent("patch.applied"));
    await bus.publish(makeEvent("patch.proposed"));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("a namespace wildcard for 'patch.' does not match an unrelated type like 'memory.created'", async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    bus.subscribe("patch.*", handler);
    await bus.publish(makeEvent("memory.created"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("the '*' wildcard dispatches to every event type", async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    bus.subscribe("*", handler);
    await bus.publish(makeEvent("patch.applied"));
    await bus.publish(makeEvent("decision.created"));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("dispatches to multiple independent subscribers for the same event", async () => {
    const bus = new DomainEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe("patch.applied", a);
    bus.subscribe("patch.applied", b);
    await bus.publish(makeEvent("patch.applied"));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops further dispatch to that handler", async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("patch.applied", handler);
    unsubscribe();
    await bus.publish(makeEvent("patch.applied"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("a throwing handler is isolated: reported in errors, does not stop other handlers", async () => {
    const bus = new DomainEventBus();
    const boom = vi.fn(() => {
      throw new Error("handler exploded");
    });
    const ok = vi.fn();
    bus.subscribe("patch.applied", boom);
    bus.subscribe("patch.applied", ok);
    const result = await bus.publish(makeEvent("patch.applied"));
    expect(ok).toHaveBeenCalledTimes(1);
    expect(result.handled).toBe(2);
    expect(result.errors).toHaveLength(1);
  });

  it("a rejecting async handler is isolated the same way as a throwing sync handler", async () => {
    const bus = new DomainEventBus();
    const asyncBoom = vi.fn(async () => {
      throw new Error("async handler exploded");
    });
    bus.subscribe("patch.applied", asyncBoom);
    const result = await bus.publish(makeEvent("patch.applied"));
    expect(result.errors).toHaveLength(1);
  });

  it("clear() removes every subscription", async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    bus.subscribe("*", handler);
    expect(bus.subscriptionCount).toBe(1);
    bus.clear();
    expect(bus.subscriptionCount).toBe(0);
    await bus.publish(makeEvent("patch.applied"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("publishing with no subscribers returns handled: 0 and does not throw", async () => {
    const bus = new DomainEventBus();
    const result = await bus.publish(makeEvent("patch.applied"));
    expect(result).toEqual({ handled: 0, errors: [], dispatched: true });
  });

  describe("dedup by event id", () => {
    it("publishing the exact same event object twice only dispatches to subscribers once", async () => {
      const bus = new DomainEventBus();
      const handler = vi.fn();
      bus.subscribe("patch.applied", handler);
      const event = makeEvent("patch.applied", { id: "11111111-1111-4111-8111-111111111111" });

      const first = await bus.publish(event);
      const second = await bus.publish(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(first).toEqual({ handled: 1, errors: [], dispatched: true });
      expect(second).toEqual({ handled: 0, errors: [], dispatched: false, reason: "duplicate" });
    });

    it("publishing a duplicate id built as a fresh object (not the same reference) is still deduped", async () => {
      const bus = new DomainEventBus();
      const handler = vi.fn();
      bus.subscribe("patch.applied", handler);
      const id = "22222222-2222-4222-8222-222222222222";

      await bus.publish(makeEvent("patch.applied", { id }));
      await bus.publish(makeEvent("patch.applied", { id, payload: { unrelated: true } }));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("publishing two different events (different ids) both dispatch normally", async () => {
      const bus = new DomainEventBus();
      const handler = vi.fn();
      bus.subscribe("patch.applied", handler);

      const a = await bus.publish(
        makeEvent("patch.applied", { id: "33333333-3333-4333-8333-333333333333" }),
      );
      const b = await bus.publish(
        makeEvent("patch.applied", { id: "44444444-4444-4444-8444-444444444444" }),
      );

      expect(handler).toHaveBeenCalledTimes(2);
      expect(a.dispatched).toBe(true);
      expect(b.dispatched).toBe(true);
    });

    it("evicts the oldest tracked id once the bound is exceeded, so a later duplicate of it dispatches again", async () => {
      const limit = 3;
      const bus = new DomainEventBus({ seenEventIdLimit: limit });
      const handler = vi.fn();
      bus.subscribe("patch.applied", handler);

      const ids = [
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
        "77777777-7777-4777-8777-777777777777",
        "88888888-8888-4888-8888-888888888888",
      ];

      // Publish limit+1 distinct events; the first id should be evicted once
      // the (limit+1)th distinct id pushes the tracked set past the bound.
      for (const id of ids) {
        await bus.publish(makeEvent("patch.applied", { id }));
      }
      expect(bus.seenEventIdCount).toBe(limit);

      handler.mockClear();
      // The oldest id (ids[0]) was evicted, so republishing it now dispatches
      // again instead of being deduped — proving the bound is real, not
      // decorative.
      const replay = await bus.publish(makeEvent("patch.applied", { id: ids[0] }));
      expect(replay.dispatched).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);

      // Meanwhile the most recently published id (ids[3]) is still tracked
      // and still deduped.
      handler.mockClear();
      const stillDupe = await bus.publish(makeEvent("patch.applied", { id: ids[3] }));
      expect(stillDupe.dispatched).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it("clear() also resets dedup state, so a previously-seen id dispatches again", async () => {
      const bus = new DomainEventBus();
      const handler = vi.fn();
      bus.subscribe("patch.applied", handler);
      const event = makeEvent("patch.applied", { id: "99999999-9999-4999-8999-999999999999" });

      await bus.publish(event);
      bus.clear();
      bus.subscribe("patch.applied", handler);
      handler.mockClear();
      const result = await bus.publish(event);

      expect(result.dispatched).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
