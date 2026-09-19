import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const { resetApprovalsForTests } = await import(
  "../services/approvals-test-store.js"
);
const { resetGovernedClaimStartsForTests } = await import(
  "../services/governed-claimed-execution.js"
);
const { ATLAS_SELF_APPLICATION_ID, ATLAS_SELF_PROJECT_ID } = await import(
  "@atlas/shared"
);

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

function seedAtlasSelfProject(actor: AuthUser, root: string): string {
  const now = new Date().toISOString();
  osStore.upsertProject({
    id: ATLAS_SELF_PROJECT_ID,
    slug: "atlas-core",
    name: "Atlas Core",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  osStore.setWorkspaceRoot(ATLAS_SELF_PROJECT_ID, root);
  bindProjectOwner(ATLAS_SELF_PROJECT_ID, actor.id, "bound_on_create");
  return ATLAS_SELF_PROJECT_ID;
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
    resetApprovalsForTests();
    resetGovernedClaimStartsForTests();
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
    const search = await app.inject({
      method: "GET",
      url: `/api/v1/studio/search?projectId=${crypto.randomUUID()}&q=original`,
    });
    expect(search.statusCode).toBe(401);
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

  it("401s ask-agent when not signed in", async () => {
    getRequestUser.mockResolvedValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/studio/ask-agent",
      payload: {
        projectId: crypto.randomUUID(),
        mode: "fix",
        instruction: "Add validation to this handler",
      },
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

  it("requires independent approval before writing the Atlas-self workspace", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: "readme.md",
        content: "approved write\n",
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as {
      status: string;
      approvalId: string;
      applicationId: string;
      executed: boolean;
    };
    expect(body.status).toBe("APPROVAL_REQUIRED");
    expect(body.applicationId).toBe(ATLAS_SELF_APPLICATION_ID);
    expect(body.executed).toBe(false);
    expect(typeof body.approvalId).toBe("string");
    expect(readFileSync(join(workspaceRoot, "readme.md"), "utf8")).toBe(
      "# original\n",
    );
  });

  it("rejects self-approval of an Atlas-self Studio write", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);
    const requested = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: "readme.md",
        content: "self signed\n",
      },
    });
    const { approvalId } = requested.json() as { approvalId: string };
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: "readme.md",
        content: "self signed\n",
        approvalId,
        decisionReason: "self sign-off",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(readFileSync(join(workspaceRoot, "readme.md"), "utf8")).toBe(
      "# original\n",
    );
  });

  it("writes only after an independent live-human decision", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    const decider = testUser({
      id: "77777777-7777-4777-8777-777777777777",
      email: "decider@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);
    const requested = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: "readme.md",
        content: "independent write\n",
      },
    });
    expect(requested.statusCode).toBe(202);
    getRequestUser.mockResolvedValue(decider);
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: "readme.md",
        content: "independent write\n",
        approvalId: requested.json().approvalId,
        decisionReason: "independent review",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      path: string;
      executed: boolean;
      verified: boolean;
      applicationId: string;
    };
    expect(body.path).toBe("readme.md");
    expect(body.executed).toBe(true);
    expect(body.verified).toBe(false);
    expect(body.applicationId).toBe(ATLAS_SELF_APPLICATION_ID);
    expect(readFileSync(join(workspaceRoot, "readme.md"), "utf8")).toBe(
      "independent write\n",
    );
  });

  it("rejects path or content substitution against the bound Atlas-self artifact", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    const decider = testUser({
      id: "77777777-7777-4777-8777-777777777777",
      email: "decider@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);
    const requested = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: "readme.md",
        content: "approved content\n",
      },
    });
    const { approvalId } = requested.json() as { approvalId: string };
    getRequestUser.mockResolvedValue(decider);
    const swappedContent = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: "readme.md",
        content: "stolen content\n",
        approvalId,
        decisionReason: "independent review",
      },
    });
    expect(swappedContent.statusCode).toBe(403);
    const swappedPath = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: "src/hello.ts",
        content: "approved content\n",
        approvalId,
        decisionReason: "independent review",
      },
    });
    expect(swappedPath.statusCode).toBe(403);
    expect(readFileSync(join(workspaceRoot, "readme.md"), "utf8")).toBe(
      "# original\n",
    );
  });

  it("treats a second project bound to the Atlas-self workspace as Atlas-self", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);
    const decoyId = seedOwnedProject(requester, workspaceRoot);
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: decoyId,
        path: "readme.md",
        content: "via decoy project\n",
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().applicationId).toBe(ATLAS_SELF_APPLICATION_ID);
    expect(readFileSync(join(workspaceRoot, "readme.md"), "utf8")).toBe(
      "# original\n",
    );
  });

  it("403s Atlas-self Studio writes to apps/api/dist/** and does not mutate filesystem", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);

    const deniedPath = "apps/api/dist/main.js";
    const targetOnDisk = join(workspaceRoot, "apps", "api", "dist", "main.js");

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: deniedPath,
        content: "// hacked by atlas-self\n",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(existsSync(targetOnDisk)).toBe(false);
  });

  it("403s Atlas-self Studio writes to apps/control-plane/dist/** and does not mutate filesystem", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);

    const deniedPath = "apps/control-plane/dist/server.js";
    const targetOnDisk = join(workspaceRoot, "apps", "control-plane", "dist", "server.js");

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: deniedPath,
        content: "// hacked by atlas-self\n",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(existsSync(targetOnDisk)).toBe(false);
  });

  it("403s Atlas-self Studio writes to governance-critical source paths (apps/**/src/**) and does not mutate filesystem", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);

    const deniedPath = "apps/api/src/services/governed-execution.ts";
    const targetOnDisk = join(
      workspaceRoot,
      "apps",
      "api",
      "src",
      "services",
      "governed-execution.ts",
    );

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: deniedPath,
        content: "// hacked by atlas-self\n",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(existsSync(targetOnDisk)).toBe(false);
  });

  it("403s Atlas-self Studio writes to supabase/migrations/** and does not mutate filesystem", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);

    const deniedPath =
      "supabase/migrations/20260903170000_atlas_self_approval_separation.sql";
    const targetOnDisk = join(
      workspaceRoot,
      "supabase",
      "migrations",
      "20260903170000_atlas_self_approval_separation.sql",
    );

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: deniedPath,
        content: "-- hacked by atlas-self\n",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(existsSync(targetOnDisk)).toBe(false);
  });

  it("403s Atlas-self Studio writes to .atlas/** and does not mutate filesystem", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);

    const deniedPath = ".atlas/store.json";
    const targetOnDisk = join(workspaceRoot, ".atlas", "store.json");

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: deniedPath,
        content: '{"tampered":true}',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(existsSync(targetOnDisk)).toBe(false);
  });

  it("403s Atlas-self Studio writes to .atlas/users.json and does not mutate filesystem", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);

    const deniedPath = ".atlas/users.json";
    const targetOnDisk = join(workspaceRoot, ".atlas", "users.json");

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: deniedPath,
        content: '{"users":[]}',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(existsSync(targetOnDisk)).toBe(false);
  });

  it("403s Atlas-self Studio writes to .atlas/sessions.json and does not mutate filesystem", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);

    const deniedPath = ".atlas/sessions.json";
    const targetOnDisk = join(workspaceRoot, ".atlas", "sessions.json");

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: deniedPath,
        content: '{"sessions":[]}',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(existsSync(targetOnDisk)).toBe(false);
  });

  it("403s Atlas-self Studio writes to node_modules/** and does not mutate filesystem", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);

    const deniedPath = "node_modules/@atlas/shared/evil.js";
    const targetOnDisk = join(
      workspaceRoot,
      "node_modules",
      "@atlas",
      "shared",
      "evil.js",
    );

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: deniedPath,
        content: "// injected via node_modules\n",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(existsSync(targetOnDisk)).toBe(false);
  });

  it("403s Atlas-self Studio writes to apps/api/tsconfig*.json build config and does not mutate filesystem", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);

    const deniedPath = "apps/api/tsconfig.build.json";
    const targetOnDisk = join(workspaceRoot, "apps", "api", "tsconfig.build.json");

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: deniedPath,
        content: "// hacked build config\n",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(existsSync(targetOnDisk)).toBe(false);
  });

  it("403s Atlas-self Studio writes to .env runtime configuration and does not mutate filesystem", async () => {
    const requester = testUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
      role: "admin",
    });
    getRequestUser.mockResolvedValue(requester);
    seedAtlasSelfProject(requester, workspaceRoot);

    const deniedPath = ".env";
    const targetOnDisk = join(workspaceRoot, ".env");

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/studio/file",
      payload: {
        projectId: ATLAS_SELF_PROJECT_ID,
        path: deniedPath,
        content: "API_PORT=9999\n",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(existsSync(targetOnDisk)).toBe(false);
  });

  it("403s ask-agent when the project belongs to someone else", async () => {
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
      method: "POST",
      url: "/api/v1/studio/ask-agent",
      payload: {
        projectId,
        workspaceRoot,
        mode: "fix",
        instruction: "Add validation to this handler",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s tenant ask-agent that only passes a raw workspaceRoot", async () => {
    getRequestUser.mockResolvedValue(testUser());
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/studio/ask-agent",
      payload: {
        workspaceRoot,
        mode: "fix",
        instruction: "Add validation to this handler",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s tree and file reads for a foreign owner", async () => {
    const owner = testUser();
    getRequestUser.mockResolvedValue(owner);
    const projectId = seedOwnedProject(owner, workspaceRoot);
    getRequestUser.mockResolvedValue(
      testUser({
        id: "33333333-3333-4333-8333-333333333333",
        email: "other@example.com",
      }),
    );
    const tree = await app.inject({
      method: "GET",
      url: `/api/v1/studio/tree?projectId=${projectId}`,
    });
    expect(tree.statusCode).toBe(403);
    const file = await app.inject({
      method: "GET",
      url: `/api/v1/studio/file?projectId=${projectId}&path=readme.md`,
    });
    expect(file.statusCode).toBe(403);
    const search = await app.inject({
      method: "GET",
      url: `/api/v1/studio/search?projectId=${projectId}&q=original`,
    });
    expect(search.statusCode).toBe(403);
  });

  it("rejects Studio search that only passes a raw workspaceRoot", async () => {
    getRequestUser.mockResolvedValue(
      testUser({ role: "owner", email: "owner@atlas.local" }),
    );
    const search = await app.inject({
      method: "GET",
      url: `/api/v1/studio/search?workspaceRoot=${encodeURIComponent(workspaceRoot)}&q=original`,
    });
    expect(search.statusCode).toBe(400);
  });

  it("200s tree and file for the owner and scopes ask-agent to that project", async () => {
    const actor = testUser();
    getRequestUser.mockResolvedValue(actor);
    const projectId = seedOwnedProject(actor, workspaceRoot);
    const tree = await app.inject({
      method: "GET",
      url: `/api/v1/studio/tree?projectId=${projectId}`,
    });
    expect(tree.statusCode).toBe(200);
    expect(tree.json().projectId).toBe(projectId);
    const file = await app.inject({
      method: "GET",
      url: `/api/v1/studio/file?projectId=${projectId}&path=readme.md`,
    });
    expect(file.statusCode).toBe(200);
    expect(file.json().content).toContain("# original");
    const search = await app.inject({
      method: "GET",
      url: `/api/v1/studio/search?projectId=${projectId}&q=original`,
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().projectId).toBe(projectId);
    expect(
      (search.json().items as Array<{ path: string }>).some(
        (h) => h.path === "readme.md",
      ),
    ).toBe(true);
    const ask = await app.inject({
      method: "POST",
      url: "/api/v1/studio/ask-agent",
      payload: {
        projectId,
        path: "readme.md",
        mode: "fix",
        instruction: "Clarify the README heading",
      },
    });
    expect([200, 201]).toContain(ask.statusCode);
    const patch = ask.json().patch as { projectId?: string } | null;
    if (patch) expect(patch.projectId).toBe(projectId);
  });
});
