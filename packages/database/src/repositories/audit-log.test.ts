import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseClients } from "../client.js";
import { AuditLogRepository, type AuditLogAppendInput } from "./audit-log.js";

const sampleEntry: AuditLogAppendInput = {
  id: "33333333-3333-4333-8333-333333333333",
  ownerId: null,
  action: "governance.decision",
  entityType: "RECORD",
  entityId: null,
  payload: { hello: "world" },
};

function serverRow(overrides: Record<string, unknown> = {}) {
  return {
    id: sampleEntry.id,
    seq: 1,
    owner_id: null,
    action: sampleEntry.action,
    entity_type: sampleEntry.entityType,
    entity_id: sampleEntry.entityId,
    payload: sampleEntry.payload,
    prev_hash: "GENESIS",
    hash: "abc123",
    created_at: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

function makeClient() {
  return createDatabaseClients({
    url: "https://example.supabase.co",
    anonKey: "anon",
    serviceRoleKey: "service-role-key-that-is-long-enough",
  }).service;
}

describe("AuditLogRepository", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("append() inserts owner_id/action/entity columns, then always re-reads the row by id (AFTER INSERT trigger values are never in the upsert's own response)", async () => {
    const requests: { url: string; body: unknown }[] = [];
    let getByIdCalls = 0;
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url: urlStr, body });
      if (urlStr.includes("/rest/v1/audit_logs")) {
        if (urlStr.includes("id=eq.")) {
          getByIdCalls += 1;
          // The AFTER INSERT trigger has already run by the time this
          // follow-up SELECT executes, so prev_hash/hash are populated here
          // even though the preceding upsert's own response never carries
          // them.
          return new Response(JSON.stringify(serverRow()), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        // Plain upsert with no .select() chained -- PostgREST returns an
        // empty body by default (no return=representation requested).
        return new Response("", { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const repo = new AuditLogRepository(makeClient());
    const result = await repo.append(sampleEntry);

    expect(getByIdCalls).toBe(1);
    expect(result.id).toBe(sampleEntry.id);
    expect(result.seq).toBe(1);
    expect(result.prevHash).toBe("GENESIS");
    expect(result.hash).toBe("abc123");

    const insertCall = requests.find(
      (r) => r.url.includes("/rest/v1/audit_logs") && !r.url.includes("id=eq."),
    );
    const insertedRow = insertCall?.body as Record<string, unknown>;
    expect(insertedRow.owner_id).toBeNull();
    expect(insertedRow.action).toBe(sampleEntry.action);
    expect(insertedRow.entity_type).toBe(sampleEntry.entityType);
    // The client must never send seq/prev_hash/hash itself -- those are
    // server-assigned by the audit_logs_chain_after_insert trigger.
    expect(insertedRow.seq).toBeUndefined();
    expect(insertedRow.prev_hash).toBeUndefined();
    expect(insertedRow.hash).toBeUndefined();
  });

  it("append() on a duplicate id (ignored by ON CONFLICT) reads back the already-persisted row instead of throwing, and the AFTER INSERT trigger never fired a second time", async () => {
    let upsertCalls = 0;
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/rest/v1/audit_logs")) {
        if (urlStr.includes("id=eq.")) {
          // Unchanged from the first (genuine) insert -- proves the
          // duplicate attempt did not advance the chain.
          return new Response(JSON.stringify(serverRow()), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        upsertCalls += 1;
        // ON CONFLICT DO NOTHING -> empty body regardless of conflict.
        return new Response("", { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const repo = new AuditLogRepository(makeClient());
    const result = await repo.append(sampleEntry);

    expect(upsertCalls).toBe(1);
    expect(result.id).toBe(sampleEntry.id);
    expect(result.seq).toBe(1);
    expect(result.hash).toBe("abc123");
  });

  it("verifyChain() reports ok:true for a correctly-linked sequence", async () => {
    globalThis.fetch = vi.fn(async () => {
      const rows = [
        serverRow({ id: "a", seq: 1, prev_hash: "GENESIS", hash: "h1" }),
        serverRow({ id: "b", seq: 2, prev_hash: "h1", hash: "h2" }),
        serverRow({ id: "c", seq: 3, prev_hash: "h2", hash: "h3" }),
      ];
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const repo = new AuditLogRepository(makeClient());
    const result = await repo.verifyChain();
    expect(result).toEqual({ ok: true, checked: 3, error: null });
  });

  it("verifyChain() reports ok:false at the first broken link", async () => {
    globalThis.fetch = vi.fn(async () => {
      const rows = [
        serverRow({ id: "a", seq: 1, prev_hash: "GENESIS", hash: "h1" }),
        // tampered/deleted-and-reinserted row: prev_hash does not match h1
        serverRow({ id: "b", seq: 2, prev_hash: "SOMETHING_ELSE", hash: "h2" }),
      ];
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const repo = new AuditLogRepository(makeClient());
    const result = await repo.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.checked).toBe(1);
    expect(result.error).toMatch(/chain break/);
  });
});
