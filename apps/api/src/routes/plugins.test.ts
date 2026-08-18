import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser, PluginManifest } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-plugins-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

// Same stubbing mechanism as `apps/api/src/routes/agent-lifecycle.test.ts` /
// `apps/api/src/routes/admin-ops.test.ts`: mock `getRequestUser` from the
// identity-resolution service module so `requireAdmin` sees a fake signed-in
// user without needing real Supabase/local-session cookies.
const getRequestUser = vi.fn();

vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerPluginRoutes } = await import("./plugins.js");
const { resetPluginRegistryForTests } = await import("@atlas/agent-core");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

let app: FastifyInstance;

function adminUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "admin@example.com",
    displayName: "Admin",
    role: "admin",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

/**
 * Well-formed manifest body. `declaredTools` / `declaredEntityActions` use
 * only real, known values so `registerPlugin` actually succeeds — same
 * pairing already used by `packages/agent-core/src/plugins/plugin-lifecycle.test.ts`:
 *   - "github.getRepository" is a real `DEFAULT_TOOL_POLICIES` entry.
 *   - `{ entityType: "RECORD", action: "READ" }` is a real
 *     `DEFAULT_ENTITY_POLICIES` entry.
 */
function validManifestBody(
  overrides: Partial<PluginManifest> = {},
): Partial<PluginManifest> {
  return {
    id: "sample-plugin",
    name: "Sample Plugin",
    version: "1.0.0",
    description: "A sample plugin used for route tests.",
    author: "Test Author",
    declaredTools: ["github.getRepository"],
    declaredCapabilities: ["READ_REPO"],
    declaredEntityActions: [{ entityType: "RECORD", action: "READ" }],
    riskLevel: "LOW",
    ...overrides,
  };
}

async function registerViaApi(overrides: Partial<PluginManifest> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/v1/plugins",
    payload: validManifestBody(overrides),
  });
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerPluginRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(adminUser());
  resetPluginRegistryForTests();
});

afterEach(() => {
  resetPluginRegistryForTests();
});

describe("GET /api/v1/plugins", () => {
  it("is a public read that starts empty", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/plugins" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it("lists a plugin after registration", async () => {
    const reg = await registerViaApi();
    expect(reg.statusCode).toBe(201);

    const res = await app.inject({ method: "GET", url: "/api/v1/plugins" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBe(1);
    expect(body.items[0].id).toBe("sample-plugin");
  });

  it("filters by ?status=", async () => {
    await registerViaApi();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/plugins?status=PENDING_REVIEW",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBe(1);

    const noneApproved = await app.inject({
      method: "GET",
      url: "/api/v1/plugins?status=APPROVED",
    });
    expect(noneApproved.statusCode).toBe(200);
    expect(noneApproved.json().items).toEqual([]);
  });
});

describe("GET /api/v1/plugins/:id", () => {
  it("404s for an unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/plugins/does-not-exist",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns a registered plugin", async () => {
    await registerViaApi();
    const res = await app.inject({ method: "GET", url: "/api/v1/plugins/sample-plugin" });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("sample-plugin");
  });
});

describe("POST /api/v1/plugins", () => {
  it("403s for a non-admin", async () => {
    getRequestUser.mockReturnValue(adminUser({ role: "user" }));
    const res = await registerViaApi();
    expect(res.statusCode).toBe(403);
  });

  it("registers a valid manifest, forcing status to PENDING_REVIEW even if the body claims otherwise", async () => {
    const res = await registerViaApi({ status: "ENABLED" });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.plugin.status).toBe("PENDING_REVIEW");
    expect(body.plugin.id).toBe("sample-plugin");
  });

  it("400s an invalid manifest (bad kebab-case id) with an errors array", async () => {
    const res = await registerViaApi({ id: "NOT_KEBAB_CASE" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error.details.errors)).toBe(true);
    expect(body.error.details.errors.length).toBeGreaterThan(0);
  });

  it("400s a manifest declaring a tool with no matching DEFAULT_TOOL_POLICIES entry", async () => {
    const res = await registerViaApi({ declaredTools: ["totally.unknown.tool"] });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(
      body.error.details.errors.some((e: string) => e.includes("totally.unknown.tool")),
    ).toBe(true);
  });

  it("409s registering a duplicate id", async () => {
    const first = await registerViaApi();
    expect(first.statusCode).toBe(201);

    const second = await registerViaApi({ name: "A different name" });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("CONFLICT");

    // Original registration is untouched.
    const get = await app.inject({ method: "GET", url: "/api/v1/plugins/sample-plugin" });
    expect(get.json().name).toBe("Sample Plugin");
  });
});

describe("full lifecycle: register -> approve -> enable -> disable -> uninstall", () => {
  it("transitions status at each step, asserted via GET each time", async () => {
    const reg = await registerViaApi();
    expect(reg.statusCode).toBe(201);
    expect(reg.json().plugin.status).toBe("PENDING_REVIEW");

    const approve = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/approve",
      payload: { reason: "Looks safe, only declares a read-only tool." },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().plugin.status).toBe("APPROVED");

    const enable = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/enable",
    });
    expect(enable.statusCode).toBe(200);
    expect(enable.json().plugin.status).toBe("ENABLED");

    const disable = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/disable",
    });
    expect(disable.statusCode).toBe(200);
    expect(disable.json().plugin.status).toBe("DISABLED");

    const uninstall = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/uninstall",
    });
    expect(uninstall.statusCode).toBe(200);
    const uninstallBody = uninstall.json();
    expect(uninstallBody.ok).toBe(true);
    expect(uninstallBody.plugin.status).toBe("DISABLED");

    const finalGet = await app.inject({ method: "GET", url: "/api/v1/plugins/sample-plugin" });
    expect(finalGet.json().status).toBe("DISABLED");
  });
});

describe("illegal transitions -> 403", () => {
  it("403s enabling a plugin still PENDING_REVIEW", async () => {
    await registerViaApi();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/enable",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("403s approving an already-approved plugin", async () => {
    await registerViaApi();
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/approve",
      payload: { reason: "First approval." },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/approve",
      payload: { reason: "Second approval attempt." },
    });
    expect(second.statusCode).toBe(403);
    expect(second.json().error.code).toBe("FORBIDDEN");
  });
});

describe("admin gating on mutating routes", () => {
  it("403s a non-admin caller for approve/reject/enable/disable/uninstall", async () => {
    await registerViaApi();
    getRequestUser.mockReturnValue(adminUser({ role: "user" }));

    const approve = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/approve",
      payload: { reason: "n/a" },
    });
    expect(approve.statusCode).toBe(403);

    const reject = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/reject",
      payload: { reason: "n/a" },
    });
    expect(reject.statusCode).toBe(403);

    const enable = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/enable",
    });
    expect(enable.statusCode).toBe(403);

    const disable = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/disable",
    });
    expect(disable.statusCode).toBe(403);

    const uninstall = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/uninstall",
    });
    expect(uninstall.statusCode).toBe(403);
  });

  it("401s an unauthenticated (not-signed-in) caller", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await registerViaApi();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/v1/plugins/:id/reject", () => {
  it("rejects a pending plugin, and rejected plugins can be uninstalled directly", async () => {
    await registerViaApi();
    const reject = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/reject",
      payload: { reason: "Declares too broad a capability set." },
    });
    expect(reject.statusCode).toBe(200);
    expect(reject.json().plugin.status).toBe("REJECTED");

    const uninstall = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/sample-plugin/uninstall",
    });
    expect(uninstall.statusCode).toBe(200);
    expect(uninstall.json().plugin.status).toBe("DISABLED");
  });
});
