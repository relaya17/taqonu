import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

// Isolate the singleton osStore before it's ever imported/loaded.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-conversation-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

// Same mechanism used by memory.test.ts / projects.test.ts: stub
// `getRequestUser` (the function `requireUser`/`requireSignedInForWrite`
// ultimately calls) so a route test can simulate a signed-in caller without
// a real Supabase/local session cookie.
const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

const { registerConversationRoutes } = await import("./conversation.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");

function signedInUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "owner@example.com",
    displayName: "Owner",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const ownerA = signedInUser();
const ownerB = signedInUser({
  id: "33333333-3333-4333-8333-333333333333",
  email: "other@example.com",
});

function seedGlobalMemory(ownerId: string, statement: string) {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  osStore.addMemory({
    id: crypto.randomUUID(),
    ownerId,
    type: "LESSON",
    projectId: null,
    statement,
    reason: ["seed"],
    status: "ACTIVE",
    confidence: 0.9,
    category: "GENERATED_REASONING",
    epistemicState: "OBSERVED",
    observationMode: "OBSERVED",
    source: "seed",
    sourceType: "SYSTEM",
    sourceId: null,
    evidence: [],
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "seed",
    scope: "GLOBAL",
    priority: "MEDIUM",
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerConversationRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("POST /api/v1/conversation/message", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/conversation/message",
      payload: { message: "hello there" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("a signed-in caller only ever sees their own tenant's memory content, never another tenant's", async () => {
    seedGlobalMemory(ownerA.id, "distinctivephrase owner-A private lesson");
    seedGlobalMemory(ownerB.id, "distinctivephrase owner-B private lesson");

    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/conversation/message",
      payload: { message: "tell me about distinctivephrase" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    const statements = body.memoryContext.items.map(
      (m: { statement: string }) => m.statement,
    );
    expect(statements).toContain("distinctivephrase owner-A private lesson");
    expect(statements).not.toContain("distinctivephrase owner-B private lesson");
  });

  it("a different signed-in caller only sees their own memory, confirming isolation both ways", async () => {
    getRequestUser.mockReturnValue(ownerB);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/conversation/message",
      payload: { message: "tell me about distinctivephrase" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    const statements = body.memoryContext.items.map(
      (m: { statement: string }) => m.statement,
    );
    expect(statements).toContain("distinctivephrase owner-B private lesson");
    expect(statements).not.toContain("distinctivephrase owner-A private lesson");
  });

  it("201s for a signed-in caller with a normal message on the free included provider", async () => {
    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/conversation/message",
      payload: { message: "what is the current project status?" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.messageId).toBeDefined();
    expect(body.threadId).toBeDefined();
    expect(body.catalog.id).toBe("arletos-included");
  });
});

describe("GET /api/v1/conversation/threads/:threadId", () => {
  it("returns an (empty) thread without requiring auth — informational read", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/conversation/threads/44444444-4444-4444-8444-444444444444",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });
});
