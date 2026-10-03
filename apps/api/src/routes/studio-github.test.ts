import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-studio-github-"));
process.env.ATLAS_STORE_PATH = join(storeDir, "store.json");
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

const { registerCodeRoutes } = await import("./code.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");
const { resetStudioGithubCaches } = await import("../services/studio-github-source.js");

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const OWNER: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.com",
  displayName: "Owner",
  role: "user",
  locale: "en",
  provider: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
} as AuthUser;

const STRANGER: AuthUser = {
  ...OWNER,
  id: "22222222-2222-4222-8222-222222222222",
  email: "stranger@example.com",
} as AuthUser;

interface FakeGithub {
  calls: string[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function repo(fullName: string) {
  const [, name] = fullName.split("/");
  return {
    full_name: fullName,
    name,
    private: true,
    html_url: `https://github.com/${fullName}`,
    default_branch: "main",
  };
}

function installFakeGithub(repos: string[]): FakeGithub {
  const state: FakeGithub = { calls: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      state.calls.push(`${url.pathname}${url.search}`);
      if (/^\/app\/installations\/\d+\/access_tokens$/.test(url.pathname)) {
        return json({ token: "ghs_test", expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
      }
      if (url.pathname === "/installation/repositories") {
        return json({ total_count: repos.length, repositories: repos.map(repo) });
      }
      if (/\/git\/trees\/main$/.test(url.pathname)) {
        return json({
          truncated: false,
          tree: [
            { path: "README.md", type: "blob", size: 12 },
            { path: "src", type: "tree" },
            { path: "src/index.ts", type: "blob", size: 20 },
            { path: "node_modules", type: "tree" },
            { path: "node_modules/x/index.js", type: "blob", size: 1 },
            { path: ".env", type: "blob", size: 5 },
          ],
        });
      }
      if (url.pathname.endsWith("/contents/src/index.ts")) {
        return new Response("export const a = 1;\n", { status: 200 });
      }
      if (url.pathname.endsWith("/contents/logo.png")) {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), { status: 200 });
      }
      return json({ message: "Not Found" }, 404);
    }),
  );
  return state;
}

function seedProject(owner: AuthUser, slug = `gh-${Date.now().toString(36)}`): string {
  const now = new Date().toISOString();
  const projectId = crypto.randomUUID();
  osStore.upsertProject({
    id: projectId,
    slug,
    name: "GitHub Studio",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  bindProjectOwner(projectId, owner.id, "bound_on_create");
  return projectId;
}

function connect(projectId: string, repoFullName: string | null = null): void {
  osStore.setStudioGithubSource(projectId, {
    installationId: "4242",
    repoFullName,
    updatedAt: new Date().toISOString(),
  });
}

describe("Studio GitHub source (read-only)", () => {
  let app: FastifyInstance;
  let bareApp: FastifyInstance;

  beforeAll(async () => {
    app = await buildRouteTestApp(registerCodeRoutes, {
      GITHUB_APP_ID: "12345",
      GITHUB_PRIVATE_KEY: PRIVATE_KEY_PEM,
    });
    bareApp = await buildRouteTestApp(registerCodeRoutes);
  });

  afterAll(async () => {
    await app.close();
    await bareApp.close();
    rmSync(storeDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    osStore.unloadForTests();
    osStore.ensureLoaded();
    resetStudioGithubCaches();
    getRequestUser.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists the connected repository as a read-only tree, hiding vendor dirs and dot-files", async () => {
    installFakeGithub(["relaya17/taqonu"]);
    getRequestUser.mockResolvedValue(OWNER);
    const projectId = seedProject(OWNER);
    connect(projectId);

    const res = await app.inject({ method: "GET", url: `/api/v1/studio/tree?projectId=${projectId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.readOnly).toBe(true);
    expect(body.source).toMatchObject({ kind: "github", repo: "relaya17/taqonu", ref: "main" });
    expect(body.root).toBe("github:relaya17/taqonu@main");
    const names = body.tree.children.map((n: { name: string }) => n.name);
    expect(names).toEqual(["README.md", "src"]);
    expect(body.tree.children[1].children[0]).toMatchObject({ path: "src/index.ts", kind: "file" });
  });

  it("opens a text file read-only and refuses binaries", async () => {
    installFakeGithub(["relaya17/taqonu"]);
    getRequestUser.mockResolvedValue(OWNER);
    const projectId = seedProject(OWNER);
    connect(projectId);

    const ok = await app.inject({
      method: "GET",
      url: `/api/v1/studio/file?projectId=${projectId}&path=src/index.ts`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      path: "src/index.ts",
      content: "export const a = 1;\n",
      readOnly: true,
      languageHint: "typescript",
    });

    const bin = await app.inject({
      method: "GET",
      url: `/api/v1/studio/file?projectId=${projectId}&path=logo.png`,
    });
    expect(bin.statusCode).toBe(400);

    const missing = await app.inject({
      method: "GET",
      url: `/api/v1/studio/file?projectId=${projectId}&path=nope.ts`,
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.message).toMatch(/File not found/);
  });

  it("never serves .env through the GitHub path", async () => {
    installFakeGithub(["relaya17/taqonu"]);
    getRequestUser.mockResolvedValue(OWNER);
    const projectId = seedProject(OWNER);
    connect(projectId);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/studio/file?projectId=${projectId}&path=.env`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects path traversal", async () => {
    installFakeGithub(["relaya17/taqonu"]);
    getRequestUser.mockResolvedValue(OWNER);
    const projectId = seedProject(OWNER);
    connect(projectId);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/studio/file?projectId=${projectId}&path=${encodeURIComponent("../secrets.txt")}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not let another user read the project's repository", async () => {
    const gh = installFakeGithub(["relaya17/taqonu"]);
    const projectId = seedProject(OWNER);
    connect(projectId);
    getRequestUser.mockResolvedValue(STRANGER);
    const res = await app.inject({ method: "GET", url: `/api/v1/studio/tree?projectId=${projectId}` });
    expect(res.statusCode).toBe(403);
    expect(gh.calls).toHaveLength(0);
  });

  it("keeps the 'link a folder' answer when nothing is connected", async () => {
    installFakeGithub(["relaya17/taqonu"]);
    getRequestUser.mockResolvedValue(OWNER);
    const projectId = seedProject(OWNER);
    const res = await app.inject({ method: "GET", url: `/api/v1/studio/tree?projectId=${projectId}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/workspaceRoot/);
  });

  it("ignores the GitHub binding when the API has no App credentials", async () => {
    const gh = installFakeGithub(["relaya17/taqonu"]);
    getRequestUser.mockResolvedValue(OWNER);
    const projectId = seedProject(OWNER);
    connect(projectId);
    const res = await bareApp.inject({ method: "GET", url: `/api/v1/studio/tree?projectId=${projectId}` });
    expect(res.statusCode).toBe(400);
    expect(gh.calls).toHaveLength(0);

    const status = await bareApp.inject({
      method: "GET",
      url: `/api/v1/studio/github-source?projectId=${projectId}`,
    });
    expect(status.json()).toMatchObject({ appConfigured: false, installUrl: null });
  });

  it("reports connection status with a project-scoped install URL", async () => {
    installFakeGithub(["relaya17/taqonu"]);
    getRequestUser.mockResolvedValue(OWNER);
    const projectId = seedProject(OWNER);
    const before = await app.inject({
      method: "GET",
      url: `/api/v1/studio/github-source?projectId=${projectId}`,
    });
    expect(before.json()).toMatchObject({ appConfigured: true, connected: false });
    expect(before.json().installUrl).toBe(
      `/api/v1/github/install?projectId=${projectId}&returnTo=studio`,
    );
    connect(projectId);
    const after = await app.inject({
      method: "GET",
      url: `/api/v1/studio/github-source?projectId=${projectId}`,
    });
    expect(after.json()).toMatchObject({ connected: true });
  });

  it("picks the repo matching the project slug and lets the owner switch repos", async () => {
    installFakeGithub(["relaya17/alpha", "relaya17/taqonu"]);
    getRequestUser.mockResolvedValue(OWNER);
    const projectId = seedProject(OWNER, "taqonu");
    connect(projectId);

    const first = await app.inject({ method: "GET", url: `/api/v1/studio/tree?projectId=${projectId}` });
    expect(first.json().source).toMatchObject({
      repo: "relaya17/taqonu",
      repos: ["relaya17/alpha", "relaya17/taqonu"],
    });

    const bad = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/github-source",
      payload: { projectId, repo: "someone/else" },
    });
    expect(bad.statusCode).toBe(400);

    const pick = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/github-source",
      payload: { projectId, repo: "relaya17/alpha" },
    });
    expect(pick.statusCode).toBe(200);
    expect(pick.json().source.repo).toBe("relaya17/alpha");
    expect(osStore.getStudioGithubSource(projectId)?.repoFullName).toBe("relaya17/alpha");
  });

  it("only the owner may switch the repository", async () => {
    installFakeGithub(["relaya17/alpha", "relaya17/taqonu"]);
    const projectId = seedProject(OWNER);
    connect(projectId);
    getRequestUser.mockResolvedValue(STRANGER);
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/github-source",
      payload: { projectId, repo: "relaya17/alpha" },
    });
    expect(res.statusCode).toBe(403);
  });
});
