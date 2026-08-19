import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as apps/api/src/services/event-rules.test.ts).
const tmpDir = join(
  tmpdir(),
  `atlas-automation-engine-${Date.now()}-${Math.random().toString(16).slice(2)}`,
);
mkdirSync(tmpDir, { recursive: true });
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { appendDomainEvent } = await import("./memory-pipeline.js");
const { domainEventBus } = await import("@atlas/agent-core");
const {
  registerAutomationRule,
  listRegisteredAutomationRuleIds,
  resetAutomationEngineForTests,
  setFiredIdempotencyKeyLimitForTests,
  firedIdempotencyKeyCountForTests,
} = await import("./automation-engine.js");

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("automation engine: generic trigger -> condition -> action plumbing", () => {
  beforeEach(() => {
    domainEventBus.clear();
    resetAutomationEngineForTests();
  });

  afterEach(() => {
    domainEventBus.clear();
    resetAutomationEngineForTests();
  });

  it("fires the action when the pattern matches and condition is absent", async () => {
    const seen: string[] = [];
    registerAutomationRule({
      id: "always-fires",
      description: "fires on every memory.created",
      on: "memory.created",
      action: (event) => {
        seen.push(String((event.payload as { memoryId?: unknown }).memoryId));
      },
    });

    appendDomainEvent({ type: "memory.created", payload: { memoryId: "m1" } });
    await flush();

    expect(seen).toEqual(["m1"]);
  });

  it("fires the action when condition returns true", async () => {
    const seen: unknown[] = [];
    registerAutomationRule({
      id: "condition-true",
      description: "fires when skipped is non-empty",
      on: "patch.applied",
      condition: (event) =>
        Array.isArray((event.payload as { skipped?: unknown }).skipped) &&
        ((event.payload as { skipped: unknown[] }).skipped.length > 0),
      action: (event) => {
        seen.push(event.payload);
      },
    });

    appendDomainEvent({
      type: "patch.applied",
      payload: { patchId: "p1", applied: [], skipped: ["x"] },
    });
    await flush();

    expect(seen).toHaveLength(1);
  });

  it("does NOT fire the action when condition returns false", async () => {
    const seen: unknown[] = [];
    registerAutomationRule({
      id: "condition-false",
      description: "fires when skipped is non-empty",
      on: "patch.applied",
      condition: (event) =>
        Array.isArray((event.payload as { skipped?: unknown }).skipped) &&
        ((event.payload as { skipped: unknown[] }).skipped.length > 0),
      action: (event) => {
        seen.push(event.payload);
      },
    });

    appendDomainEvent({
      type: "patch.applied",
      payload: { patchId: "p2", applied: ["a"], skipped: [] },
    });
    await flush();

    expect(seen).toHaveLength(0);
  });

  it("unsubscribe stops the rule from firing and removes it from the registered id list", async () => {
    const seen: unknown[] = [];
    const unsubscribe = registerAutomationRule({
      id: "unsub-me",
      description: "test rule",
      on: "memory.created",
      action: (event) => {
        seen.push(event.payload);
      },
    });

    expect(listRegisteredAutomationRuleIds()).toContain("unsub-me");
    unsubscribe();
    expect(listRegisteredAutomationRuleIds()).not.toContain("unsub-me");

    appendDomainEvent({ type: "memory.created", payload: { memoryId: "m2" } });
    await flush();

    expect(seen).toHaveLength(0);
  });

  describe("idempotency: (rule, event) dedup backstop", () => {
    it("a rule registered twice (same rule id, two subscriptions) fires its action only once for one event", async () => {
      const calls: string[] = [];
      const rule = {
        id: "dup-rule",
        description: "registered twice on purpose",
        on: "memory.created" as const,
        action: (event: import("@atlas/shared").DomainEvent) => {
          calls.push(String((event.payload as { memoryId?: unknown }).memoryId));
        },
      };
      registerAutomationRule(rule);
      registerAutomationRule(rule);

      appendDomainEvent({ type: "memory.created", payload: { memoryId: "once-only" } });
      await flush();

      expect(calls).toEqual(["once-only"]);
    });

    it("a rule registered twice still fires once per DISTINCT event, not blocked entirely", async () => {
      const calls: string[] = [];
      const rule = {
        id: "dup-rule-distinct",
        description: "registered twice, fires per distinct event",
        on: "memory.created" as const,
        action: (event: import("@atlas/shared").DomainEvent) => {
          calls.push(String((event.payload as { memoryId?: unknown }).memoryId));
        },
      };
      registerAutomationRule(rule);
      registerAutomationRule(rule);

      appendDomainEvent({ type: "memory.created", payload: { memoryId: "first" } });
      await flush();
      appendDomainEvent({ type: "memory.created", payload: { memoryId: "second" } });
      await flush();

      expect(calls).toEqual(["first", "second"]);
    });

    it("independently of DomainEventBus's own event-id dedup, the same (rule, event) pair never double-fires the action", async () => {
      // Simulate the bus-level dedup being bypassed (e.g. a hypothetical
      // future caller that re-invokes a subscriber directly, or a second
      // rule subscription racing a retry) by registering the rule twice and
      // clearing the bus's own seen-id set before the duplicate delivery, so
      // this test isolates the automation-engine's OWN idempotency layer
      // rather than relying on the bus catching it first.
      const calls: string[] = [];
      const rule = {
        id: "dup-rule-bus-bypassed",
        description: "isolates the engine-level idempotency layer",
        on: "memory.created" as const,
        action: (event: import("@atlas/shared").DomainEvent) => {
          calls.push(String((event.payload as { memoryId?: unknown }).memoryId));
        },
      };
      registerAutomationRule(rule);

      const event = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "memory.created" as const,
        occurredAt: "2026-01-01T00:00:00.000Z",
        ownerId: "00000000-0000-4000-8000-000000000001",
        projectId: null,
        correlationId: "00000000-0000-4000-8000-000000000002",
        causationId: null,
        epistemicState: "OBSERVED" as const,
        payload: { memoryId: "bypassed" },
      };

      await domainEventBus.publish(event);
      domainEventBus.clearSeenEventIds(); // simulate the bus-level guard being absent
      await domainEventBus.publish(event);

      expect(calls).toEqual(["bypassed"]);
    });

    it("evicts the oldest fired idempotency key once the bound is exceeded", async () => {
      setFiredIdempotencyKeyLimitForTests(2);
      const calls: string[] = [];
      const rule = {
        id: "eviction-rule",
        description: "small bound to prove eviction",
        on: "memory.created" as const,
        action: (event: import("@atlas/shared").DomainEvent) => {
          calls.push(String((event.payload as { memoryId?: unknown }).memoryId));
        },
      };
      registerAutomationRule(rule);

      const baseEvent = {
        type: "memory.created" as const,
        occurredAt: "2026-01-01T00:00:00.000Z",
        ownerId: "00000000-0000-4000-8000-000000000001",
        projectId: null,
        correlationId: "00000000-0000-4000-8000-000000000002",
        causationId: null,
        epistemicState: "OBSERVED" as const,
      };
      const e1 = { ...baseEvent, id: "b0000000-0000-4000-8000-000000000001", payload: { memoryId: "e1" } };
      const e2 = { ...baseEvent, id: "b0000000-0000-4000-8000-000000000002", payload: { memoryId: "e2" } };
      const e3 = { ...baseEvent, id: "b0000000-0000-4000-8000-000000000003", payload: { memoryId: "e3" } };

      await domainEventBus.publish(e1);
      await domainEventBus.publish(e2);
      await domainEventBus.publish(e3);
      expect(firedIdempotencyKeyCountForTests()).toBe(2);

      // e1's key was evicted by e3 pushing the tracked set past the bound of
      // 2, so replaying e1 (with the bus's own dedup cleared, to isolate
      // this layer) fires the action again instead of being skipped —
      // proving the bound is real, not decorative.
      domainEventBus.clearSeenEventIds();
      calls.length = 0;
      await domainEventBus.publish(e1);
      expect(calls).toEqual(["e1"]);

      // Meanwhile e3's key is still tracked and still deduped.
      domainEventBus.clearSeenEventIds();
      calls.length = 0;
      await domainEventBus.publish(e3);
      expect(calls).toEqual([]);
    });
  });

  it("listRegisteredAutomationRuleIds reflects exactly the active rules", () => {
    expect(listRegisteredAutomationRuleIds()).toEqual([]);
    registerAutomationRule({
      id: "rule-a",
      description: "a",
      on: "*",
      action: () => {},
    });
    registerAutomationRule({
      id: "rule-b",
      description: "b",
      on: "*",
      action: () => {},
    });
    expect(listRegisteredAutomationRuleIds().sort()).toEqual(["rule-a", "rule-b"]);
  });
});
