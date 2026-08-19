import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as memory.test.ts / events.test.ts).
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-evidence-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

// Same stubbing mechanism as memory.test.ts / connections.test.ts: spread
// the real `@atlas/agent-core` module and only stub `authorizeEntityAction`
// so individual tests can force a DENIED decision.
const authorizeEntityActionMock = vi.fn();
vi.mock("@atlas/agent-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/agent-core")>();
  return {
    ...actual,
    authorizeEntityAction: (
      ...args: Parameters<typeof actual.authorizeEntityAction>
    ) => authorizeEntityActionMock(...args) ?? actual.authorizeEntityAction(...args),
  };
});

const { registerEvidenceRoutes } = await import("./evidence.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

function signedInUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "caller@example.com",
    displayName: "Caller",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const validPayload = {
  source: "unit-test",
  sourceType: "USER" as const,
  excerpt: "Something observed.",
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerEvidenceRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  authorizeEntityActionMock.mockReset();
});

describe("GET /api/v1/evidence auth", () => {
  it("401s when not signed in (security fix — this route was previously fully public)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/evidence" });
    expect(res.statusCode).toBe(401);
  });

  it("200s for any signed-in caller (backs the regular user's own PersonalDesk dashboard, not admin-only)", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({ method: "GET", url: "/api/v1/evidence" });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/v1/evidence auth", () => {
  it("401s when not signed in (security fix — anonymous evidence injection was previously possible)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("201s for a signed-in caller", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      payload: validPayload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().source).toBe("unit-test");
  });

  it("403s when the Policy Engine denies DOCUMENT.CREATE (entity-policy gate wiring)", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      payload: validPayload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/test-forced denial/);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "DOCUMENT",
      "CREATE",
      expect.objectContaining({ mode: "WRITE" }),
    );
  });
});
