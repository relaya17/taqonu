import { describe, expect, it, vi } from "vitest";
import type { DomainEvent } from "@atlas/shared";
import { DomainEventBus } from "./event-bus.js";

function makeEvent(type: DomainEvent["type"], overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: "00000000-0000-4000-8000-000000000000",
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
    expect(result).toEqual({ handled: 0, errors: [] });
  });
});
