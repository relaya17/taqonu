import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

// Isolate the singleton osStore + durable audit file before either is ever
// imported/loaded (same pattern as events.test.ts / graph.test.ts).
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-audit-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_AUDIT_LOG_PATH = join(tmpDir, "audit.ndjson");

// Same stubbing mechanism as events.test.ts: mock `getRequestUser` (the
// function `requireAdmin` ultimately calls) so this route test can simulate
// signed-in / admin callers without a real Supabase/local session cookie.
const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerAuditRoutes } = await import("./audit.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { appendUnifiedAuditEntry } = await import("../services/audit-log.js");

function makeUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    email: "admin@example.com",
    displayName: "Admin",
    role: "admin",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const adminUser = makeUser();
const regularUser = makeUser({
  id: "55555555-5555-4555-8555-555555555555",
  email: "user@example.com",
  role: "user",
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerAuditRoutes);

  appendUnifiedAuditEntry({
    type: "patch.applied",
    actorId: "actor-a",
    actorKind: "USER",
    reason: "test entry A",
    risk: "LOW",
    approval: "NOT_REQUIRED",
    result: "SUCCESS",
  });
  appendUnifiedAuditEntry({
    type: "patch.applied",
    actorId: "actor-b",
    actorKind: "AGENT",
    reason: "test entry B",
    risk: "MEDIUM",
    approval: "NOT_REQUIRED",
    result: "SUCCESS",
  });
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(adminUser);
});

describe("GET /api/v1/audit auth", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/audit" });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a signed-in non-admin user", async () => {
    getRequestUser.mockReturnValue(regularUser);
    const res = await app.inject({ method: "GET", url: "/api/v1/audit" });
    expect(res.statusCode).toBe(403);
  });

  it("200s for an admin caller", async () => {
    getRequestUser.mockReturnValue(adminUser);
    const res = await app.inject({ method: "GET", url: "/api/v1/audit" });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/v1/audit", () => {
  it("returns the unified subset alongside the legacy items ring", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/audit" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(Array.isArray(body.unified)).toBe(true);
    expect(body.unified.length).toBeGreaterThanOrEqual(2);
  });

  it("filters the unified subset by actorId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit?actorId=actor-a",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.unified.length).toBe(1);
    expect(body.unified[0].actorId).toBe("actor-a");
  });

  it("rejects a limit above the max", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit?limit=5000",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/v1/audit/cp-import", () => {
  const prevToken = process.env.ATLAS_CONTROL_PLANE_TOKEN;

  afterEach(() => {
    if (prevToken === undefined) delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    else process.env.ATLAS_CONTROL_PLANE_TOKEN = prevToken;
  });

  it("accepts the Control Plane service bearer and rejects anonymous", async () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "cp-audit-import-token";
    getRequestUser.mockReturnValue(null);
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/audit/cp-import",
      payload: { entries: [] },
    });
    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "POST",
      url: "/api/v1/audit/cp-import",
      headers: { authorization: "Bearer cp-audit-import-token" },
      payload: {
        entries: [
          {
            seq: 1,
            timestamp: "2026-09-04T00:00:00.000Z",
            type: "gateway.decision",
            actorId: "cp:service",
            actorKind: "SYSTEM",
            reason: "import",
            policy: "DOCUMENT.READ",
            risk: "LOW",
            approval: "NOT_REQUIRED",
            result: "SUCCESS",
            ownerId: "00000000-0000-4000-8000-def000000000",
            projectId: null,
            hash: "cp-hash-import-1",
            prevHash: "GENESIS",
          },
        ],
      },
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json().imported).toBe(1);
  });
});
