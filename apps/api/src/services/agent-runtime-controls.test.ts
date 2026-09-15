import { afterEach, describe, expect, it } from "vitest";
import {
  AgentRuntimeControlRepository,
  type AgentRuntimeControlRecord,
  type AgentRuntimeControlStore,
} from "@atlas/database";
import {
  clearAgentRuntimeControlStoreForTests,
  clearDurableAgentRuntimeStatus,
  configureAgentRuntimeControlStore,
  getDurableAgentRuntimeStatus,
  setDurableAgentRuntimeStatus,
} from "./agent-runtime-controls.js";

/**
 * Minimum focused coverage for the durable Runtime Controls service layer
 * (Step 4 Decision B), using the store-injection pattern the module itself
 * exposes for tests (`configureAgentRuntimeControlStore` /
 * `clearAgentRuntimeControlStoreForTests`), the same shape as `approvals.ts`'s
 * live approval store test seam. Every test configures its own store (or
 * explicitly clears it) so state never leaks between tests via the
 * module-level singleton.
 */
function createInMemoryAgentRuntimeControlStore(): AgentRuntimeControlStore {
  const rows = new Map<string, AgentRuntimeControlRecord>();
  return {
    async get(agentId) {
      return rows.get(agentId) ?? null;
    },
    async upsert(record) {
      rows.set(record.agentId, record);
      return record;
    },
    async clear(agentId) {
      rows.delete(agentId);
    },
  };
}

function configureFakeStore(): void {
  configureAgentRuntimeControlStore(
    new AgentRuntimeControlRepository(createInMemoryAgentRuntimeControlStore()),
  );
}

afterEach(() => {
  clearAgentRuntimeControlStoreForTests();
});

describe("setDurableAgentRuntimeStatus", () => {
  it("normalizes an omitted expiresAt to null", async () => {
    configureFakeStore();
    const saved = await setDurableAgentRuntimeStatus({
      agentId: "CODE_ENGINEER",
      status: "PAUSED",
      setBy: "owner-1",
      reason: "omitted expiresAt",
    });
    expect(saved.expiresAt).toBeNull();
  });

  it("normalizes an explicit null to null", async () => {
    configureFakeStore();
    const saved = await setDurableAgentRuntimeStatus({
      agentId: "CODE_ENGINEER",
      status: "PAUSED",
      setBy: "owner-1",
      reason: "explicit null expiresAt",
      expiresAt: null,
    });
    expect(saved.expiresAt).toBeNull();
  });
});

describe("getDurableAgentRuntimeStatus", () => {
  it("returns a non-expired record", async () => {
    configureFakeStore();
    await setDurableAgentRuntimeStatus({
      agentId: "CODE_ENGINEER",
      status: "QUARANTINED",
      setBy: "owner-1",
      reason: "future expiry",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const got = await getDurableAgentRuntimeStatus("CODE_ENGINEER");
    expect(got?.status).toBe("QUARANTINED");
  });

  it("treats an expired record as absent", async () => {
    configureFakeStore();
    await setDurableAgentRuntimeStatus({
      agentId: "CODE_ENGINEER",
      status: "QUARANTINED",
      setBy: "owner-1",
      reason: "past expiry",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await getDurableAgentRuntimeStatus("CODE_ENGINEER")).toBeNull();
  });
});

describe("clearDurableAgentRuntimeStatus", () => {
  it("removes the record", async () => {
    configureFakeStore();
    await setDurableAgentRuntimeStatus({
      agentId: "CODE_ENGINEER",
      status: "PAUSED",
      setBy: "owner-1",
      reason: "to be cleared",
    });
    await clearDurableAgentRuntimeStatus("CODE_ENGINEER");
    expect(await getDurableAgentRuntimeStatus("CODE_ENGINEER")).toBeNull();
  });
});

describe("no configured store and no production store available", () => {
  it("fails closed instead of silently succeeding or defaulting", async () => {
    clearAgentRuntimeControlStoreForTests();
    await expect(
      setDurableAgentRuntimeStatus({
        agentId: "CODE_ENGINEER",
        status: "PAUSED",
        setBy: "owner-1",
        reason: "no store configured",
      }),
    ).rejects.toThrow(/not configured/i);
  });
});
