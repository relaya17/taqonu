import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-github-install-test-"));
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

const { registerGithubRoutes } = await import("./github.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const OWNER = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "owner@example.com",
  displayName: "Owner",
  role: "user",
  locale: "en",
  provider: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
} as AuthUser;
const STRANGER = { ...OWNER, id: "55555555-5555-4555-8555-555555555555" } as AuthUser;

function seedProject(): string {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  osStore.upsertProject({
    id,
    slug: `inst-${Date.now().toString(36)}`,
    name: "Install",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  bindProjectOwner(id, OWNER.id, "bound_on_create");
  return id;
}

function cookieFrom(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
  return value.split(";")[0]!;
}

describe("GitHub App install → Studio binding", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildRouteTestApp(
      async (f) => {
        f.decorate("atlasLogger", {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        } as never);
        await registerGithubRoutes(f);
      },
      {
        GITHUB_APP_ID: "12345",
        GITHUB_PRIVATE_KEY: PRIVATE_KEY_PEM,
        GITHUB_APP_SLUG: "arletos-test",
        WEB_ORIGIN: "https://web.example",
      },
    );
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    osStore.unloadForTests();
    osStore.ensureLoaded();
    getRequestUser.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 777,
            account: { login: "relaya17", type: "User" },
            target_type: "User",
            repository_selection: "selected",
            suspended_at: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("only the project owner can start a project-scoped install", async () => {
    const projectId = seedProject();
    getRequestUser.mockResolvedValue(STRANGER);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/github/install?projectId=${projectId}&returnTo=studio`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("binds the installation to the project and returns to Studio, even when GitHub drops state", async () => {
    const projectId = seedProject();
    getRequestUser.mockResolvedValue(OWNER);
    const start = await app.inject({
      method: "GET",
      url: `/api/v1/github/install?projectId=${projectId}&locale=he&returnTo=studio`,
    });
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toMatch(
      /^https:\/\/github\.com\/apps\/arletos-test\/installations\/new\?state=/,
    );
    const cookie = cookieFrom(start.headers["set-cookie"]);
    expect(cookie).toMatch(/^atlas_gh_install=/);

    // "Configure" on an existing installation: GitHub calls back without state.
    const back = await app.inject({
      method: "GET",
      url: "/api/v1/github/install/callback?installation_id=777&setup_action=update",
      headers: { cookie },
    });
    expect(back.statusCode).toBe(302);
    const location = new URL(String(back.headers.location));
    expect(location.origin + location.pathname).toBe("https://web.example/he/studio");
    expect(location.searchParams.get("project")).toBe(projectId);
    expect(location.searchParams.get("github_install")).toBe("success");
    expect(osStore.getStudioGithubSource(projectId)).toMatchObject({
      installationId: "777",
      repoFullName: null,
    });
    expect(String(back.headers["set-cookie"])).toMatch(/atlas_gh_install=;.*Max-Age=0/);
  });

  it("still rejects a callback with neither state nor cookie", async () => {
    const back = await app.inject({
      method: "GET",
      url: "/api/v1/github/install/callback?installation_id=777",
    });
    expect(back.statusCode).toBe(302);
    expect(String(back.headers.location)).toMatch(/github_install=error&reason=invalid_state/);
  });
});
