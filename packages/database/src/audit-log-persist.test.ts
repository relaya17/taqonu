import { afterEach, describe, expect, it, vi } from "vitest";
import { persistAuditLogToSupabase, type AuditLogStoreEnv } from "./audit-log-persist.js";
import type { AuditLogAppendInput } from "./repositories/audit-log.js";

const sampleEntry: AuditLogAppendInput = {
  id: "44444444-4444-4444-8444-444444444444",
  ownerId: null,
  action: "governance.decision",
  entityType: "RECORD",
  entityId: null,
  payload: { hello: "world" },
};

describe("persistAuditLogToSupabase", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns { ok: false, reason: NOT_CONFIGURED } without touching the network when Supabase is not live", async () => {
    const env: AuditLogStoreEnv = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "replace-me",
    };
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const result = await persistAuditLogToSupabase(env, sampleEntry);

    expect(result).toEqual({ ok: false, reason: "NOT_CONFIGURED", error: null });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns { ok: true, row } when the write succeeds", async () => {
    const env: AuditLogStoreEnv = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-that-is-long-enough",
    };
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
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
          },
        ]),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await persistAuditLogToSupabase(env, sampleEntry);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.id).toBe(sampleEntry.id);
      expect(result.row.hash).toBe("abc123");
    }
  });

  it("returns { ok: false, reason: WRITE_FAILED } instead of throwing when the request errors", async () => {
    const env: AuditLogStoreEnv = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-that-is-long-enough",
    };
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ message: "connection refused" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await persistAuditLogToSupabase(env, sampleEntry);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("WRITE_FAILED");
      expect(result.error).toBeTruthy();
    }
  });
});
