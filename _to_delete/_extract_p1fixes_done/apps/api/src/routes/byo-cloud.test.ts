import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

/**
 * P0 fix: `byo-cloud.ts`'s connect/disconnect endpoints previously had NO
 * auth guard at all — `resolveCloudIdentity` alone does not throw for an
 * unauthenticated caller, it silently falls back to a stub owner id, so
 * anyone could mutate a customer cloud-binding config. This proves: (1) an
 * unauthenticated caller is now rejected, (2) the route genuinely enforces
 * whatever `authorizeEntityAction` decides, and (3) a properly authorized
 * caller still succeeds.
 */

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-byo-cloud-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const getRequestUser = vi.fn();

vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const authorizeEntityAction = vi.fn();

vi.mock("@atlas/agent-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/agent-core")>();
  return {
    ...actual,
    authorizeEntityAction: (
      ...args: Parameters<typeof actual.authorizeEntityAction>
    ) => authorizeEntityAction(...args) ?? actual.authorizeEntityAction(...args),
  };
});

const { registerByoCloudRoutes } = await import("./byo-cloud.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

let app: FastifyInstance;

function testUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    email: "customer@example.com",
    displayName: "Customer",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerByoCloudRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(testUser());
  authorizeEntityAction.mockReset();
  authorizeEntityAction.mockReturnValue(undefined);
});

describe("POST /api/v1/byo-cloud/cloudflare/connect", () => {
  it("401s for an unauthenticated caller (no auth guard previously existed here)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/byo-cloud/cloudflare/connect",
      payload: { provider: "cloudflare", accountLabel: "My Cloudflare" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s when the real authorizeEntityAction is engaged and denies the action", async () => {
    authorizeEntityAction.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/byo-cloud/cloudflare/connect",
      payload: { provider: "cloudflare", accountLabel: "My Cloudflare" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(res.json().error.message).toMatch(/test-forced denial/);
  });

  it("200s for a signed-in caller and connects the binding", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/byo-cloud/cloudflare/connect",
      payload: { provider: "cloudflare", accountLabel: "My Cloudflare" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("connected");
    expect(body.accountLabel).toBe("My Cloudflare");
  });
});

describe("POST /api/v1/byo-cloud/cloudflare/disconnect", () => {
  it("401s for an unauthenticated caller (no auth guard previously existed here)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/byo-cloud/cloudflare/disconnect",
      payload: { provider: "cloudflare" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s when the real authorizeEntityAction is engaged and denies the action", async () => {
    authorizeEntityAction.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/byo-cloud/cloudflare/disconnect",
      payload: { provider: "cloudflare" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("200s for a signed-in caller and disconnects the binding", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/byo-cloud/cloudflare/disconnect",
      payload: { provider: "cloudflare" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("disconnected");
  });
});
