import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-ls-route-"));
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

const { registerStudioLanguageRoutes } = await import("./studio-language.js");
const { registerStudioReplaceRoutes } = await import("./studio-replace.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");

let app: FastifyInstance;
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

const owner = testUser();
const stranger = testUser({
  id: "33333333-3333-4333-8333-333333333333",
  email: "other@example.com",
});

function seedOwnedProject(actor: AuthUser, root: string): string {
  const now = new Date().toISOString();
  const projectId = crypto.randomUUID();
  osStore.upsertProject({
    id: projectId,
    slug: `studio-ls-${Date.now().toString(36)}`,
    name: "Studio LS",
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

beforeAll(async () => {
  app = await buildRouteTestApp(async (instance) => {
    await registerStudioLanguageRoutes(instance);
    await registerStudioReplaceRoutes(instance);
  });
});

afterAll(async () => {
  await app.close();
  rmSync(storeDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
});

afterEach(() => {
  for (const dir of dirs.splice(1)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Studio language and replace routes", () => {
  it("returns TypeScript diagnostics and hover for the owner", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "atlas-ls-http-"));
    dirs.push(workspace);
    mkdirSync(join(workspace, "src"));
    writeFileSync(
      join(workspace, "src", "math.ts"),
      "export function add(a: number, b: number): number { return a + b; }\nexport const broken: number = 'nope';\n",
    );
    getRequestUser.mockResolvedValue(owner);
    const projectId = seedOwnedProject(owner, workspace);

    const diags = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/language/diagnostics`,
      payload: { path: "src/math.ts" },
    });
    expect(diags.statusCode).toBe(200);
    expect(diags.json().engine).toBe("typescript-language-service");
    expect(diags.json().diagnostics.length).toBeGreaterThan(0);

    const hover = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/language/hover`,
      payload: { path: "src/math.ts", line: 1, column: 17 },
    });
    expect(hover.statusCode).toBe(200);
    expect(String(hover.json().hover?.display ?? "")).toMatch(/add/i);
  });

  it("403s language and replace for a foreign user and Agent rename", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "atlas-ls-deny-"));
    dirs.push(workspace);
    writeFileSync(join(workspace, "a.ts"), "export const n = 1;\n");
    getRequestUser.mockResolvedValue(owner);
    const projectId = seedOwnedProject(owner, workspace);
    getRequestUser.mockResolvedValue(stranger);
    const stolen = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/language/diagnostics`,
      payload: { path: "a.ts" },
    });
    expect([403, 404]).toContain(stolen.statusCode);

    getRequestUser.mockResolvedValue(owner);
    const agent = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/language/rename`,
      headers: { "x-atlas-actor-kind": "AGENT" },
      payload: { path: "a.ts", line: 1, column: 17, newName: "m", apply: true },
    });
    expect(agent.statusCode).toBe(403);
  });

  it("previews workspace replace and applies only selected non-secret files", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "atlas-rep-http-"));
    dirs.push(workspace);
    mkdirSync(join(workspace, "src"));
    writeFileSync(join(workspace, "src", "a.ts"), "const token = 'alpha';\n");
    writeFileSync(join(workspace, "src", "b.ts"), "const other = 'alpha';\n");
    writeFileSync(join(workspace, ".env"), "alpha=secret\n");
    getRequestUser.mockResolvedValue(owner);
    const projectId = seedOwnedProject(owner, workspace);

    const preview = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/replace/preview`,
      payload: { query: "alpha", replacement: "beta" },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().items.map((row: { path: string }) => row.path).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);

    const applied = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/replace/apply`,
      payload: { query: "alpha", replacement: "beta", paths: ["src/a.ts", ".env"] },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().written.map((row: { path: string }) => row.path)).toEqual(["src/a.ts"]);
    expect(applied.json().skipped).toContain(".env");
    expect(readFileSync(join(workspace, "src", "a.ts"), "utf8")).toContain("beta");
    expect(readFileSync(join(workspace, ".env"), "utf8")).toContain("alpha=secret");
  });
});
