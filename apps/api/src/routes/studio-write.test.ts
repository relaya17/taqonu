import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-studio-write-"));
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

let app: FastifyInstance;
let workspaceRoot: string;
const dirs: string[] = [storeDir];

function testUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "engineer@example.com",
    displayName: "Engineer",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function seedOwnedProject(actor: AuthUser, root: string): string {
  const now = new Date().toISOString();
  const projectId = crypto.randomUUID();
  osStore.upsertProject({
    id: projectId,
    slug: `studio-write-${Date.now().toString(36)}`,
    name: "Studio Write",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  osStore.setWorkspaceRoot(projectId, root);
  bindProjectOwner(projectId, actor.id, "bound_on_create");
  return projectId;
}

describe("PUT /api/v1/studio/file", () => {
  beforeAll(async () => {
    app = await buildRouteTestApp(registerCodeRoutes);
  });

  afterAll(async () => {
    await app.close();
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    osStore.unloadForTests();
    osStore.ensureLoaded();
    getRequestUser.mockReset();
    workspaceRoot = mkdtempSync(join(tmpdir(), "atlas-studio-ws-"));
    dirs.push(workspaceRoot);
    writeFileSync(join(workspaceRoot, "readme.md"), "# original\n", "utf8");
  });

  afterEach(() => {
    getRequestUser.mockReset();
  });

  it("401s tree and file reads when not signed in", async () => {
    getRequestUser.mockResolvedValue(null);
    const tree = await app.inject({
      method: "GET",
      url: "/api/v1/studio/tree?workspaceRoot=/tmp",
    });
    expect(tree.statusCode).toBe(401);
    const file = await app.inject({
      method: "GET",
      url: "/api/v1/studio/file?path=readme.md",
    });
    expect(file.statusCode).toBe(401);
  });

  it("401s when not signed in", async () => {
    getRequestUser.mockResolvedValue(null);
    const projectId = crypto.randomUUID();
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: { projectId, path: "readme.md", content: "x" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("saves a file to disk and records PROJECT_STATE memory", async () => {
    const actor = testUser();
    getRequestUser.mockResolvedValue(actor);
    const projectId = seedOwnedProject(actor, workspaceRoot);

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId,
        path: "src/hello.ts",
        content: "export const n = 1;\n",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { path: string; readOnly: boolean; note: string };
    expect(body.path).toBe("src/hello.ts");
    expect(body.readOnly).toBe(false);
    expect(body.note).toMatch(/Saved to disk/i);
    expect(readFileSync(join(workspaceRoot, "src", "hello.ts"), "utf8")).toBe(
      "export const n = 1;\n",
    );
    expect(
      osStore.getMemories(projectId, actor.id).some((m) =>
        m.statement.includes("src/hello.ts"),
      ),
    ).toBe(true);
  });

  it("400s on path escape and does not write outside the workspace", async () => {
    const actor = testUser();
    getRequestUser.mockResolvedValue(actor);
    const projectId = seedOwnedProject(actor, workspaceRoot);

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId,
        path: "../outside.ts",
        content: "nope",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("403s when the project belongs to someone else", async () => {
    const owner = testUser();
    getRequestUser.mockResolvedValue(owner);
    const projectId = seedOwnedProject(owner, workspaceRoot);

    getRequestUser.mockResolvedValue(
      testUser({
        id: "33333333-3333-4333-8333-333333333333",
        email: "other@example.com",
      }),
    );
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId,
        path: "readme.md",
        content: "stolen\n",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(readFileSync(join(workspaceRoot, "readme.md"), "utf8")).toBe(
      "# original\n",
    );
  });

  it("ignores a query workspaceRoot and uses the owned project root", async () => {
    const actor = testUser();
    getRequestUser.mockResolvedValue(actor);
    const projectId = seedOwnedProject(actor, workspaceRoot);
    const decoy = mkdtempSync(join(tmpdir(), "atlas-studio-decoy-"));
    dirs.push(decoy);
    writeFileSync(join(decoy, "secret.txt"), "should-not-read", "utf8");

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/studio/file?projectId=${projectId}&path=readme.md&workspaceRoot=${encodeURIComponent(decoy)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { content: string; workspaceRoot: string };
    expect(body.content).toContain("# original");
    expect(body.workspaceRoot).toBe(workspaceRoot);
  });

  it("403s tree reads that only pass a raw workspaceRoot for a tenant user", async () => {
    getRequestUser.mockResolvedValue(testUser());
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/studio/tree?workspaceRoot=${encodeURIComponent(workspaceRoot)}`,
    });
    expect(res.statusCode).toBe(403);
  });
});
