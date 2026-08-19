import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
