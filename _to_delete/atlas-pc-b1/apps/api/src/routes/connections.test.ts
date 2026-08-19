import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-connections-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

const verifyGithubToken = vi.fn();
const listGithubReposForToken = vi.fn();
vi.mock("@atlas/integrations-github", () => ({
  verifyGithubToken: (...args: unknown[]) => verifyGithubToken(...args),
  listGithubReposForToken: (...args: unknown[]) =>
    listGithubReposForToken(...args),
}));

const scanLocalReposRoot = vi.fn();
vi.mock("@atlas/integrations-local", () => ({
  scanLocalReposRoot: (...args: unknown[]) => scanLocalReposRoot(...args),
}));

// Same stubbing mechanism as plugins.test.ts: spread the real
// `@atlas/agent-core` module (so the real `authorizeEntityAction` still
// runs by default, i.e. the "no regression" tests below exercise the real
// Policy Engine end to end) and only stub it so individual tests can force
// a DENIED decision without faking mode/writeGateOpen plumbing.
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

const { registerConnectionRoutes } = await import("./connections.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");

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

let app: FastifyInstance;
const dirs: string[] = [tmpDir];

beforeAll(async () => {
  app = await buildRouteTestApp(registerConnectionRoutes);
});

afterAll(async () => {
  await app.close();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

afterEach(() => {
  authorizeEntityActionMock.mockReset();
});

const readRoutes: Array<{ method: "GET"; url: string }> = [
  { method: "GET", url: "/api/v1/connections" },
  { method: "GET", url: "/api/v1/connections/github/repos" },
];

const writeRoutes: Array<{ method: "POST" | "DELETE"; url: string }> = [
  { method: "POST", url: "/api/v1/connections/github" },
  { method: "DELETE", url: "/api/v1/connections/github" },
  { method: "POST", url: "/api/v1/connections/github/import" },
  { method: "POST", url: "/api/v1/connections/local" },
  { method: "DELETE", url: "/api/v1/connections/local" },
  { method: "POST", url: "/api/v1/connections/local/scan" },
];

describe("connections routes reject unauthenticated callers", () => {
  it.each(readRoutes)("401s on $method $url when not signed in", async ({ method, url }) => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
  });

  it.each(writeRoutes)("401s on $method $url when not signed in", async ({ method, url }) => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method,
      url,
      payload: {
        token: "ghp_1234567890abcdef",
        reposRoot: "/tmp/whatever",
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("connections routes still work for a signed-in caller (no regression)", () => {
  it("GET /api/v1/connections 200s with the empty connection state", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({ method: "GET", url: "/api/v1/connections" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ github: null, local: null });
  });

  it("POST /api/v1/connections/github connects with a valid token", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    verifyGithubToken.mockResolvedValue({
      login: "octocat",
      name: "The Octocat",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/connections/github",
      payload: { token: "ghp_1234567890abcdef" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().github.login).toBe("octocat");
    expect(osStore.getGithubConnection()?.token).toBe("ghp_1234567890abcdef");
  });

  it("GET /api/v1/connections/github/repos lists repos once connected", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    listGithubReposForToken.mockResolvedValue([
      {
        full_name: "octocat/hello-world",
        name: "hello-world",
        private: false,
        html_url: "https://github.com/octocat/hello-world",
        default_branch: "main",
        description: null,
        language: null,
        pushed_at: null,
      },
    ]);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/connections/github/repos",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
  });

  it("DELETE /api/v1/connections/github disconnects", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/connections/github",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ github: null });
    expect(osStore.getGithubConnection()).toBeNull();
  });

  it("POST /api/v1/connections/local connects a valid path", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    scanLocalReposRoot.mockReturnValue([]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/connections/local",
      payload: { reposRoot: tmpDir },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().local.reposRoot).toBe(tmpDir);
  });
});

/**
 * Policy Engine (`authorizeEntityAction`) gate on the 6 mutating routes.
 * Previously these routes were gated ONLY by `requireSignedInForWrite`
 * (identity), with ZERO entity-policy call — a signed-in caller could
 * mutate source connections without ever going through the Policy Engine.
 * Each `it` below proves a DENIED decision genuinely blocks the request
 * with 403 even though `requireSignedInForWrite` alone would have let it
 * through, and that `authorizeEntityAction` is invoked with the exact
 * entityType/action this route claims. The "no regression" describe block
 * above (which leaves the real Policy Engine wired in) already proves the
 * normal-signed-in-caller-ALLOWED path still works end to end.
 */
describe("Policy Engine (authorizeEntityAction) gate on mutating routes", () => {
  it("403s POST /api/v1/connections/github when the Policy Engine denies CONFIGURATION.CREATE", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/connections/github",
      payload: { token: "ghp_1234567890abcdef" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/test-forced denial/);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "CONFIGURATION",
      "CREATE",
      expect.objectContaining({ mode: "WRITE" }),
    );
    // Not actually connected — the gate must run before the mutation.
    expect(osStore.getGithubConnection()).toBeNull();
  });

  it("403s DELETE /api/v1/connections/github when the Policy Engine denies CONFIGURATION.DELETE", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/connections/github",
    });
    expect(res.statusCode).toBe(403);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "CONFIGURATION",
      "DELETE",
      expect.objectContaining({ mode: "WRITE" }),
    );
  });

  it("403s POST /api/v1/connections/github/import when the Policy Engine denies CONFIGURATION.EXECUTE", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/connections/github/import",
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "CONFIGURATION",
      "EXECUTE",
      expect.objectContaining({ mode: "WRITE" }),
    );
  });

  it("403s POST /api/v1/connections/local when the Policy Engine denies CONFIGURATION.CREATE", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/connections/local",
      payload: { reposRoot: tmpDir },
    });
    expect(res.statusCode).toBe(403);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "CONFIGURATION",
      "CREATE",
      expect.objectContaining({ mode: "WRITE" }),
    );
  });

  it("403s DELETE /api/v1/connections/local when the Policy Engine denies CONFIGURATION.DELETE", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/connections/local",
    });
    expect(res.statusCode).toBe(403);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "CONFIGURATION",
      "DELETE",
      expect.objectContaining({ mode: "WRITE" }),
    );
  });

  it("403s POST /api/v1/connections/local/scan when the Policy Engine denies CONFIGURATION.EXECUTE", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/connections/local/scan",
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "CONFIGURATION",
      "EXECUTE",
      expect.objectContaining({ mode: "WRITE" }),
    );
  });

  it("403s (not silently-allowed) when the Policy Engine returns APPROVAL_REQUIRED", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "APPROVAL_REQUIRED",
      policy: {
        entityType: "CONFIGURATION",
        action: "CREATE",
        risk: "HIGH_RISK_WRITE",
        requiresApproval: true,
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/connections/github",
      payload: { token: "ghp_1234567890abcdef" },
    });
    expect(res.statusCode).toBe(403);
  });
});
