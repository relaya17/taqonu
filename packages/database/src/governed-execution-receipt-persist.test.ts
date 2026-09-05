import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimGovernedExecutionReceipt,
  finalizeGovernedExecutionReceipt,
  type GovernedExecutionReceiptStoreEnv,
} from "./governed-execution-receipt-persist.js";
import type { ClaimGovernedExecutionInput } from "./repositories/governed-execution-receipt.js";

const sampleClaim: ClaimGovernedExecutionInput = {
  id: "55555555-5555-4555-8555-555555555555",
  idempotencyKey: "idem-key-persist-1",
  ownerId: null,
  projectId: null,
  entityType: "RECORD",
  action: "create",
  artifactHash: "artifact-hash-persist-1",
};

function serverRow(overrides: Record<string, unknown> = {}) {
  return {
    id: sampleClaim.id,
    idempotency_key: sampleClaim.idempotencyKey,
    owner_id: null,
    project_id: null,
    entity_type: sampleClaim.entityType,
    action: sampleClaim.action,
    artifact_hash: sampleClaim.artifactHash,
    status: "STARTED",
    outcome: null,
    started_at: "2026-09-05T00:00:00.000Z",
    finalized_at: null,
    created_at: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("claimGovernedExecutionReceipt", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns { ok: false, reason: NOT_CONFIGURED } without touching the network when Supabase is not live", async () => {
    const env: GovernedExecutionReceiptStoreEnv = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "replace-me",
    };
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const result = await claimGovernedExecutionReceipt(env, sampleClaim);

    expect(result).toEqual({ ok: false, reason: "NOT_CONFIGURED", error: null });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns { ok: true, claim: { kind: CLAIMED } } when the insert succeeds", async () => {
    const env: GovernedExecutionReceiptStoreEnv = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-that-is-long-enough",
    };
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify(serverRow()), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await claimGovernedExecutionReceipt(env, sampleClaim);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claim.kind).toBe("CLAIMED");
    }
  });

  it("returns { ok: false, reason: WRITE_FAILED } instead of throwing when the write errors", async () => {
    const env: GovernedExecutionReceiptStoreEnv = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-that-is-long-enough",
    };
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ message: "connection refused", code: "08006" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await claimGovernedExecutionReceipt(env, sampleClaim);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("WRITE_FAILED");
      expect(result.error).toBeTruthy();
    }
  });
});

describe("finalizeGovernedExecutionReceipt", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns { ok: false, reason: NOT_CONFIGURED } without touching the network when Supabase is not live", async () => {
    const env: GovernedExecutionReceiptStoreEnv = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "replace-me",
    };
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const result = await finalizeGovernedExecutionReceipt(env, {
      idempotencyKey: sampleClaim.idempotencyKey,
      status: "EXECUTED",
      outcome: { ok: true },
    });

    expect(result).toEqual({ ok: false, reason: "NOT_CONFIGURED", error: null });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns { ok: true, row } when the conditional update matches a STARTED row", async () => {
    const env: GovernedExecutionReceiptStoreEnv = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-that-is-long-enough",
    };
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify(serverRow({ status: "EXECUTED", outcome: { ok: true } })), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await finalizeGovernedExecutionReceipt(env, {
      idempotencyKey: sampleClaim.idempotencyKey,
      status: "EXECUTED",
      outcome: { ok: true },
    });

    expect(result).toEqual({
      ok: true,
      row: expect.objectContaining({ status: "EXECUTED" }),
    });
  });

  it("returns { ok: true, row: null } when nothing was in STARTED state to finalize", async () => {
    const env: GovernedExecutionReceiptStoreEnv = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-that-is-long-enough",
    };
    globalThis.fetch = vi.fn(async () => {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await finalizeGovernedExecutionReceipt(env, {
      idempotencyKey: sampleClaim.idempotencyKey,
      status: "EXECUTED",
      outcome: { ok: true },
    });

    expect(result).toEqual({ ok: true, row: null });
  });
});
