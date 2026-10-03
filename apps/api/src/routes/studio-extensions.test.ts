import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-studio-ext-"));
process.env.ATLAS_STORE_PATH = join(storeDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/resolve-identity.js")>();
  return { ...actual, getRequestUser: (...args: unknown[]) => getRequestUser(...args) };
});

const { registerStudioExtensionRoutes } = await import("./studio-extensions.js");
const { registerStudioExtensionGate } = await import("../middleware/studio-extension-gate.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");

const OWNER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.com",
  displayName: "Owner",
  role: "user",
  locale: "en",
  provider: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
} as AuthUser;
const OTHER = { ...OWNER, id: "22222222-2222-4222-8222-222222222222", email: "other@example.com" } as AuthUser;

const dirs: string[] = [storeDir];

function seedProject(owner: AuthUser, withGit = true): string {
  const root = mkdtempSync(join(tmpdir(), "atlas-ext-ws-"));
  dirs.push(root);
  if (withGit) mkdirSync(join(root, ".git"));
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  osStore.upsertProject({
    id,
    slug: `ext-${crypto.randomUUID().slice(0, 8)}`,
    name: "Ext",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  osStore.setWorkspaceRoot(id, root);
  bindProjectOwner(id, owner.id, "bound_on_create");
  return id;
}

describe("Studio extensions (ADR-026)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildRouteTestApp(async (f) => {
      registerStudioExtensionGate(f);
      await registerStudioExtensionRoutes(f);
      // Stand-ins for capability routes the manifests declare.
      f.get("/api/v1/qa/runs", async () => ({ ok: true }));
      f.get("/api/v1/feeds/:projectId/deployment", async () => ({ items: [] }));
      f.post("/api/v1/projects/:id/studio/terminal", async () => ({ ran: true }));
      f.get("/api/v1/memory", async () => ({ items: [] }));
    });
  });

  afterAll(async () => {
    await app.close();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    osStore.unloadForTests();
    osStore.ensureLoaded();
    getRequestUser.mockReset();
    getRequestUser.mockResolvedValue(OWNER);
  });

  it("lists built-ins as installed with nothing granted, and official ones as not installed", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/studio/extensions/catalog" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.contract).toMatchObject({ thirdParty: false, userProvidedJs: false, installGrantsPermissions: false });
    const git = body.extensions.find((e: { manifest: { id: string } }) => e.manifest.id === "arletos.git");
    const cloud = body.extensions.find((e: { manifest: { id: string } }) => e.manifest.id === "arletos.cloud");
    expect(git).toMatchObject({ installed: true, granted: [], pendingPermissions: ["git.read"] });
    expect(git.manifest.kind).toBe("builtin");
    expect(cloud).toMatchObject({ installed: false });
  });

  it("installs and uninstalls an official extension; built-ins cannot be uninstalled", async () => {
    const install = await app.inject({ method: "POST", url: "/api/v1/studio/extensions/arletos.cloud/install" });
    expect(install.statusCode).toBe(200);
    expect(install.json().install.grants).toEqual([]);
    const again = await app.inject({ method: "POST", url: "/api/v1/studio/extensions/arletos.cloud/install" });
    expect(again.statusCode).toBe(409);

    const builtin = await app.inject({ method: "POST", url: "/api/v1/studio/extensions/arletos.git/uninstall" });
    expect(builtin.statusCode).toBe(403);

    const remove = await app.inject({ method: "POST", url: "/api/v1/studio/extensions/arletos.cloud/uninstall" });
    expect(remove.statusCode).toBe(200);
    expect(osStore.getStudioExtensionInstalls(OWNER.id)["arletos.cloud"]).toBeUndefined();

    const unknown = await app.inject({ method: "POST", url: "/api/v1/studio/extensions/acme.evil/install" });
    expect(unknown.statusCode).toBe(404);
  });

  it("grants only declared permissions; unknown permissions fail closed", async () => {
    await app.inject({ method: "POST", url: "/api/v1/studio/extensions/arletos.cloud/install" });
    const undeclared = await app.inject({
      method: "POST",
      url: "/api/v1/studio/extensions/arletos.cloud/permissions",
      payload: { grant: ["git.read"] },
    });
    expect(undeclared.statusCode).toBe(409);
    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/studio/extensions/arletos.cloud/permissions",
      payload: { grant: ["root.everything"] },
    });
    expect(unknown.statusCode).toBe(409);
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/studio/extensions/arletos.cloud/permissions",
      payload: { grant: ["cloud.read"] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().install.grants).toEqual(["cloud.read"]);
  });

  it("keeps installs per user and enablement/order per project, and survives a store reload", async () => {
    const projectId = seedProject(OWNER);
    await app.inject({ method: "POST", url: "/api/v1/studio/extensions/arletos.cloud/install" });
    const notInstalledForOther = async () => {
      getRequestUser.mockResolvedValue(OTHER);
      const res = await app.inject({ method: "GET", url: "/api/v1/studio/extensions/catalog" });
      getRequestUser.mockResolvedValue(OWNER);
      return res.json().extensions.find((e: { manifest: { id: string } }) => e.manifest.id === "arletos.cloud").installed;
    };
    expect(await notInstalledForOther()).toBe(false);

    const enable = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/extensions/arletos.cloud/enable`,
    });
    expect(enable.statusCode).toBe(200);
    const order = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/studio/extensions/order`,
      payload: { order: ["arletos.cloud", "arletos.git"] },
    });
    expect(order.statusCode).toBe(200);

    // Round-trip the durable shape (what the cloud store saves and loads).
    const shape = osStore.toShape();
    osStore.unloadForTests();
    osStore.replaceWithShape(shape);

    const listed = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/studio/extensions` });
    const body = listed.json();
    expect(body.order.slice(0, 2)).toEqual(["arletos.cloud", "arletos.git"]);
    const cloud = body.extensions.find((e: { manifest: { id: string } }) => e.manifest.id === "arletos.cloud");
    expect(cloud).toMatchObject({ installed: true, enabled: true });
  });

  it("cannot enable an extension that is not installed", async () => {
    const projectId = seedProject(OWNER);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/extensions/arletos.security/enable`,
    });
    expect(res.statusCode).toBe(409);
  });

  it("verification checks the project's prerequisites", async () => {
    const withGit = seedProject(OWNER, true);
    const withoutGit = seedProject(OWNER, false);
    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${withGit}/studio/extensions/arletos.git/verify`,
    });
    expect(ok.json().verification.ok).toBe(true);
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${withoutGit}/studio/extensions/arletos.git/verify`,
    });
    expect(bad.json().verification).toMatchObject({ ok: false });
    expect(bad.json().verification.checks).toContainEqual({ id: "git-repo", ok: false, reason: "NO_GIT_REPOSITORY" });
  });

  describe("server-side enforcement (x-arletos-extension)", () => {
    const ext = (id: string, projectId?: string) => ({
      "x-arletos-extension": id,
      ...(projectId ? { "x-arletos-project": projectId } : {}),
    });

    it("leaves core requests without the header untouched", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/qa/runs" });
      expect(res.statusCode).toBe(200);
    });

    it("blocks an extension until its permission is granted, then allows it", async () => {
      const projectId = seedProject(OWNER);
      const before = await app.inject({ method: "GET", url: "/api/v1/qa/runs", headers: ext("arletos.tests", projectId) });
      expect(before.statusCode).toBe(403);
      expect(before.json().error.message).toMatch(/PERMISSION_NOT_GRANTED/);

      await app.inject({
        method: "POST",
        url: "/api/v1/studio/extensions/arletos.tests/permissions",
        payload: { grant: ["qa.run"] },
      });
      const after = await app.inject({ method: "GET", url: "/api/v1/qa/runs", headers: ext("arletos.tests", projectId) });
      expect(after.statusCode).toBe(200);

      // Revoking takes effect at once.
      await app.inject({
        method: "POST",
        url: "/api/v1/studio/extensions/arletos.tests/permissions",
        payload: { revoke: ["qa.run"] },
      });
      const revoked = await app.inject({ method: "GET", url: "/api/v1/qa/runs", headers: ext("arletos.tests", projectId) });
      expect(revoked.statusCode).toBe(403);
    });

    it("blocks a disabled extension, an undeclared route and an unknown extension", async () => {
      const projectId = seedProject(OWNER);
      await app.inject({
        method: "POST",
        url: "/api/v1/studio/extensions/arletos.tests/permissions",
        payload: { grant: ["qa.run"] },
      });
      await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/studio/extensions/arletos.tests/disable` });
      const disabled = await app.inject({ method: "GET", url: "/api/v1/qa/runs", headers: ext("arletos.tests", projectId) });
      expect(disabled.json().error.message).toMatch(/NOT_ENABLED/);

      const undeclared = await app.inject({ method: "GET", url: "/api/v1/memory", headers: ext("arletos.git", projectId) });
      expect(undeclared.statusCode).toBe(403);
      expect(undeclared.json().error.message).toMatch(/ROUTE_NOT_DECLARED/);

      const unknown = await app.inject({ method: "GET", url: "/api/v1/qa/runs", headers: ext("acme.evil", projectId) });
      expect(unknown.statusCode).toBe(403);
    });

    it("needs an installed official extension and reads the project from the URL", async () => {
      const projectId = seedProject(OWNER);
      const notInstalled = await app.inject({
        method: "GET",
        url: `/api/v1/feeds/${projectId}/deployment`,
        headers: ext("arletos.cloud"),
      });
      expect(notInstalled.json().error.message).toMatch(/NOT_INSTALLED/);
      await app.inject({ method: "POST", url: "/api/v1/studio/extensions/arletos.cloud/install" });
      await app.inject({
        method: "POST",
        url: "/api/v1/studio/extensions/arletos.cloud/permissions",
        payload: { grant: ["cloud.read"] },
      });
      await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/studio/extensions/arletos.cloud/enable` });
      const ok = await app.inject({
        method: "GET",
        url: `/api/v1/feeds/${projectId}/deployment`,
        headers: ext("arletos.cloud"),
      });
      expect(ok.statusCode).toBe(200);
    });

    it("limits the Git extension to read-only Git commands", async () => {
      const projectId = seedProject(OWNER);
      await app.inject({
        method: "POST",
        url: "/api/v1/studio/extensions/arletos.git/permissions",
        payload: { grant: ["git.read"] },
      });
      const read = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/studio/terminal`,
        headers: ext("arletos.git"),
        payload: { commandId: "git.status" },
      });
      expect(read.statusCode).toBe(200);
      const push = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/studio/terminal`,
        headers: ext("arletos.git"),
        payload: { commandId: "git.push" },
      });
      expect(push.statusCode).toBe(403);
      expect(push.json().error.message).toMatch(/COMMAND_NOT_DECLARED/);
    });
  });

  it("only the project owner changes project-scope state", async () => {
    const projectId = seedProject(OWNER);
    getRequestUser.mockResolvedValue(OTHER);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/extensions/arletos.git/disable`,
    });
    expect(res.statusCode).toBe(403);
  });
});
