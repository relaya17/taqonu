import { afterEach, describe, expect, it, vi } from "vitest";
import type { Memory } from "@atlas/shared";
import { createDatabaseClients } from "../client.js";
import { MemoryRepository } from "./memories.js";

const sampleMemory: Memory = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "PREFERENCE",
  projectId: null,
  statement: "Prefer pnpm over npm for this workspace.",
  reason: ["classified:PREFERENCE:preference language"],
  status: "ACTIVE",
  confidence: 0.7,
  category: "DECISION_MEMORY",
  epistemicState: "PROPOSED",
  observationMode: "INFERRED",
  source: "ui",
  sourceType: "USER",
  sourceId: null,
  evidence: [],
  supersededBy: null,
  validFrom: null,
  validUntil: null,
  observedAt: null,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
  createdBy: "user",
  scope: "GLOBAL",
  priority: "MEDIUM",
};

describe("MemoryRepository", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("inserts owner_id and snake_case columns on create", async () => {
    const requests: { url: string; body: unknown }[] = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url: urlStr, body });
      if (urlStr.includes("/rest/v1/memories")) {
        // .single() expects a bare object, not an array, in the response body.
        return new Response(
          JSON.stringify({ ...toRow(sampleMemory), owner_id: "owner-1" }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const client = createDatabaseClients({
      url: "https://example.supabase.co",
      anonKey: "anon",
      serviceRoleKey: "service-role-key-that-is-long-enough",
    }).service;

    const repo = new MemoryRepository(client);
    const result = await repo.create(sampleMemory, "owner-1");

    expect(result.id).toBe(sampleMemory.id);
    expect(result.statement).toBe(sampleMemory.statement);

    const insertCall = requests.find((r) => r.url.includes("/rest/v1/memories"));
    expect(insertCall).toBeDefined();
    const insertedRow = insertCall?.body as Record<string, unknown>;
    expect(insertedRow.owner_id).toBe("owner-1");
    expect(insertedRow.epistemic_state).toBe("PROPOSED");
    expect(insertedRow.observation_mode).toBe("INFERRED");
    expect(insertedRow.created_by).toBe("user");
  });
});

function toRow(memory: Memory) {
  return {
    id: memory.id,
    owner_id: "owner-1",
    project_id: memory.projectId,
    type: memory.type,
    statement: memory.statement,
    reason: memory.reason,
    status: memory.status,
    confidence: memory.confidence,
    category: memory.category,
    epistemic_state: memory.epistemicState,
    observation_mode: memory.observationMode,
    source: memory.source,
    source_type: memory.sourceType,
    source_id: memory.sourceId,
    superseded_by: memory.supersededBy,
    valid_from: memory.validFrom,
    valid_until: memory.validUntil,
    observed_at: memory.observedAt,
    scope: memory.scope,
    priority: memory.priority,
    created_by: memory.createdBy,
    created_at: memory.createdAt,
    updated_at: memory.updatedAt,
  };
}
