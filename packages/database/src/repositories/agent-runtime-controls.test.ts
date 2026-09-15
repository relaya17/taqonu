import { describe, expect, it } from "vitest";
import {
  AgentRuntimeControlRepository,
  type AgentRuntimeControlRecord,
  type AgentRuntimeControlStore,
} from "./agent-runtime-controls.js";

/**
 * Minimum focused coverage for the durable Runtime Controls repository
 * layer (Step 4 Decision B). Backed by a plain in-memory implementation of
 * the same `AgentRuntimeControlStore` interface `AgentRuntimeControlRepository`
 * is constructed with in production (`AgentRuntimeControlRepository.fromSupabase`
 * wires the real Postgres-backed one) -- this exercises the repository
 * class's real public contract without depending on a live Supabase client,
 * mirroring how `LiveApprovalRequestRepository` is tested against an
 * injected client in `live-approval-requests.test.ts`.
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

function repositoryFromStore(store = createInMemoryAgentRuntimeControlStore()) {
  return { repository: new AgentRuntimeControlRepository(store), store };
}

function fixtureRecord(
  overrides: Partial<AgentRuntimeControlRecord> = {},
): AgentRuntimeControlRecord {
  return {
    agentId: "CODE_ENGINEER",
    status: "PAUSED",
    setBy: "owner-1",
    reason: "focused repository test",
    setAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    ...overrides,
  };
}

describe("AgentRuntimeControlRepository", () => {
  it("get: returns an existing record", async () => {
    const { repository } = repositoryFromStore();
    await repository.set(fixtureRecord());
    expect(await repository.get("CODE_ENGINEER")).toEqual(fixtureRecord());
  });

  it("get: returns null for a missing record", async () => {
    const { repository } = repositoryFromStore();
    expect(await repository.get("NO_SUCH_AGENT")).toBeNull();
  });

  it("set/upsert round-trips expiresAt: null unchanged", async () => {
    const { repository } = repositoryFromStore();
    const saved = await repository.set(fixtureRecord({ expiresAt: null }));
    expect(saved.expiresAt).toBeNull();
    expect((await repository.get("CODE_ENGINEER"))?.expiresAt).toBeNull();
  });

  it("set/upsert round-trips an expiresAt timestamp string unchanged", async () => {
    const { repository } = repositoryFromStore();
    const saved = await repository.set(
      fixtureRecord({ expiresAt: "2026-12-31T23:59:59.000Z" }),
    );
    expect(saved.expiresAt).toBe("2026-12-31T23:59:59.000Z");
    expect((await repository.get("CODE_ENGINEER"))?.expiresAt).toBe(
      "2026-12-31T23:59:59.000Z",
    );
  });

  it("clear removes the record", async () => {
    const { repository } = repositoryFromStore();
    await repository.set(fixtureRecord());
    await repository.clear("CODE_ENGINEER");
    expect(await repository.get("CODE_ENGINEER")).toBeNull();
  });
});
