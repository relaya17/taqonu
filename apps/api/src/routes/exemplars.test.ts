import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-exemplar-route-"));
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

const { registerExemplarRoutes } = await import("./exemplars.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");

let app: FastifyInstance;
let src: string;
let dest: string;

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

describe("exemplar routes", () => {
  beforeAll(async () => {
    app = await buildRouteTestApp(registerExemplarRoutes);
  });

  afterAll(async () => {
    await app.close();
    rmSync(storeDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    osStore.unloadForTests();
    osStore.ensureLoaded();
    getRequestUser.mockReset();
    getRequestUser.mockResolvedValue(testUser());
    src = mkdtempSync(join(tmpdir(), "ex-src-"));
    dest = mkdtempSync(join(tmpdir(), "ex-dest-"));
    mkdirSync(join(src, "src"), { recursive: true });
    writeFileSync(
      join(src, "atlas-exemplar.json"),
      JSON.stringify({
        slug: "route-ex",
        title: "Route exemplar",
        description: "test",
        kind: "mini_app",
        version: "1.0.0",
        completeness: {
          builds: true,
          runsLocally: true,
          hasAuth: true,
          hasConfigAndVersions: true,
          hasTests: true,
          hasDeployPath: true,
          hasEnvExample: true,
          hasCloneMap: true,
        },
        units: [
          {
            id: "whole",
            kind: "WHOLE",
            title: "All",
            description: "all",
            paths: ["src/a.ts"],
            dependsOn: [],
          },
        ],
      }),
    );
    writeFileSync(join(src, "src", "a.ts"), "export const a = 1;\n");
  });

  it("isolates personal ingest from another user", async () => {
    const ingest = await app.inject({
      method: "POST",
      url: "/api/v1/exemplars/ingest",
      payload: {
        title: "Route exemplar",
        slug: "route-ex",
        sourceRoot: src,
        visibility: "personal",
      },
    });
    expect(ingest.statusCode).toBe(201);
    const id = (ingest.json() as { exemplar: { id: string } }).exemplar.id;

    getRequestUser.mockResolvedValue(
      testUser({ id: "33333333-3333-4333-8333-333333333333", email: "other@example.com" }),
    );
    const hidden = await app.inject({
      method: "GET",
      url: `/api/v1/exemplars/${id}`,
    });
    expect(hidden.statusCode).toBe(404);
  });

  it("clone without workspaceRoot is 400; clone does not write files", async () => {
    const ingest = await app.inject({
      method: "POST",
      url: "/api/v1/exemplars/ingest",
      payload: {
        title: "Route exemplar",
        slug: "route-ex",
        sourceRoot: src,
        visibility: "personal",
      },
    });
    const id = (ingest.json() as { exemplar: { id: string } }).exemplar.id;
    const now = new Date().toISOString();
    const projectId = "22222222-2222-4222-8222-222222222222";
    osStore.upsertProject({
      id: projectId,
      slug: "clone-proj",
      name: "Clone",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    bindProjectOwner(projectId, testUser().id, "bound_on_create");

    const missingRoot = await app.inject({
      method: "POST",
      url: `/api/v1/exemplars/${id}/clone`,
      payload: { projectId },
    });
    expect(missingRoot.statusCode).toBe(400);

    osStore.setWorkspaceRoot(projectId, dest);
    const cloned = await app.inject({
      method: "POST",
      url: `/api/v1/exemplars/${id}/clone`,
      payload: { projectId, unitId: "WHOLE" },
    });
    expect(cloned.statusCode).toBe(201);
    const body = cloned.json() as { files: number; patch: { status: string } };
    expect(body.files).toBeGreaterThan(0);
    expect(body.patch.status).toBe("AWAITING_APPROVAL");
    expect(osStore.getWorkspaceRoot(projectId)).toBe(dest);
  });
});
