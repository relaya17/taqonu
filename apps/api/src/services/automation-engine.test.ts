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
