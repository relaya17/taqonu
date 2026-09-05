import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseClients } from "../client.js";
import {
  GovernedExecutionReceiptRepository,
  type ClaimGovernedExecutionInput,
} from "./governed-execution-receipt.js";

const sampleClaim: ClaimGovernedExecutionInput = {
  id: "44444444-4444-4444-8444-444444444444",
  idempotencyKey: "idem-key-1",
  ownerId: null,
  projectId: null,
  entityType: "RECORD",
  action: "create",
  artifactHash: "artifact-hash-1",
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

function conflictResponse() {
  return new Response(
    JSON.stringify({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "governed_execution_receipts_idempotency_key_idx"',
      details: null,
      hint: null,
    }),
    { status: 409, headers: { "content-type": "application/json" } },
  );
}

function makeClient() {
  return createDatabaseClients({
    url: "https://example.supabase.co",
    anonKey: "anon",
    serviceRoleKey: "service-role-key-that-is-long-enough",
  }).service;
}

describe("GovernedExecutionReceiptRepository", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("claim() returns CLAIMED on a fresh idempotency_key (plain insert, no conflict)", async () => {
    const requests: { url: string; body: unknown }[] = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url: urlStr, body });
      return new Response(JSON.stringify(serverRow()), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const repo = new GovernedExecutionReceiptRepository(makeClient());
    const result = await repo.claim(sampleClaim);

    expect(result.kind).toBe("CLAIMED");
    if (result.kind !== "CLAIMED") throw new Error("unreachable");
    expect(result.row.status).toBe("STARTED");
    expect(result.row.idempotencyKey).toBe(sampleClaim.idempotencyKey);

    const insertBody = requests[0]?.body as Record<string, unknown>;
    expect(insertBody.status).toBe("STARTED");
    expect(insertBody.idempotency_key).toBe(sampleClaim.idempotencyKey);
    // A plain insert, never an upsert -- a real conflict must surface as an
    // error this repository can branch on, not be silently swallowed.
    expect(requests[0]?.url).not.toContain("on_conflict");
  });

  it("claim() returns ARTIFACT_MISMATCH when the idempotency_key is already claimed against a different artifact_hash", async () => {
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if ((init?.method ?? "GET") === "POST") return conflictResponse();
      // GET (getByIdempotencyKey) after the conflict
      expect(urlStr).toContain("idempotency_key=eq.");
      return new Response(
        JSON.stringify(serverRow({ artifact_hash: "a-completely-different-artifact" })),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const repo = new GovernedExecutionReceiptRepository(makeClient());
    const result = await repo.claim(sampleClaim);
    expect(result.kind).toBe("ARTIFACT_MISMATCH");
  });

  it("claim() returns REPLAY_EXECUTED when a durable receipt already reached EXECUTED for the same artifact", async () => {
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") return conflictResponse();
      return new Response(
        JSON.stringify(
          serverRow({
            status: "EXECUTED",
            outcome: { stage: "EXECUTION", status: "EXECUTED", output: "prior-result" },
            finalized_at: "2026-09-05T00:00:05.000Z",
          }),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const repo = new GovernedExecutionReceiptRepository(makeClient());
    const result = await repo.claim(sampleClaim);
    expect(result.kind).toBe("REPLAY_EXECUTED");
    if (result.kind !== "REPLAY_EXECUTED") throw new Error("unreachable");
    expect(result.row.outcome).toEqual({
      stage: "EXECUTION",
      status: "EXECUTED",
      output: "prior-result",
    });
  });

  it("claim() returns IN_FLIGHT_OUTCOME_UNKNOWN when a receipt for the same artifact is still STARTED (in flight or crashed)", async () => {
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") return conflictResponse();
      return new Response(JSON.stringify(serverRow({ status: "STARTED" })), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const repo = new GovernedExecutionReceiptRepository(makeClient());
    const result = await repo.claim(sampleClaim);
    expect(result.kind).toBe("IN_FLIGHT_OUTCOME_UNKNOWN");
  });

  it("claim() reclaims a FAILED receipt back to STARTED and returns CLAIMED, enabling a safe retry", async () => {
    let getCalls = 0;
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST") return conflictResponse();
      if (method === "PATCH") {
        // reclaimAfterFailure's conditional UPDATE succeeds.
        expect(urlStr).toContain("status=eq.FAILED");
        return new Response(JSON.stringify(serverRow({ status: "STARTED" })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      getCalls += 1;
      // First GET (inside claim(), before the reclaim attempt) sees FAILED.
      return new Response(JSON.stringify(serverRow({ status: "FAILED" })), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const repo = new GovernedExecutionReceiptRepository(makeClient());
    const result = await repo.claim(sampleClaim);
    expect(result.kind).toBe("CLAIMED");
    expect(getCalls).toBe(1);
  });

  it("finalize() performs a conditional STARTED -> EXECUTED update and returns the updated row", async () => {
    const requests: { url: string; body: unknown }[] = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url: urlStr, body });
      return new Response(
        JSON.stringify(serverRow({ status: "EXECUTED", outcome: { ok: true }, finalized_at: "2026-09-05T00:01:00.000Z" })),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const repo = new GovernedExecutionReceiptRepository(makeClient());
    const result = await repo.finalize({
      idempotencyKey: sampleClaim.idempotencyKey,
      status: "EXECUTED",
      outcome: { ok: true },
    });

    expect(result?.status).toBe("EXECUTED");
    expect(requests[0]?.url).toContain("status=eq.STARTED");
    expect(requests[0]?.url).toContain("idempotency_key=eq.");
  });

  it("finalize() returns null when nothing was in STARTED state (already finalized by another caller)", async () => {
    globalThis.fetch = vi.fn(async () => {
      // PostgREST returns 200 with an empty array when an UPDATE's WHERE
      // clause matches zero rows.
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const repo = new GovernedExecutionReceiptRepository(makeClient());
    const result = await repo.finalize({
      idempotencyKey: sampleClaim.idempotencyKey,
      status: "EXECUTED",
      outcome: { ok: true },
    });
    expect(result).toBeNull();
  });

  it("getByIdempotencyKey() returns null when no row exists", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const repo = new GovernedExecutionReceiptRepository(makeClient());
    const result = await repo.getByIdempotencyKey("does-not-exist");
    expect(result).toBeNull();
  });
});
