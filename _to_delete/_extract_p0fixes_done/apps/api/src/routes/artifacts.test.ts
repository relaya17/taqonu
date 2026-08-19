import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Artifact, AssistRun, AuthUser } from "@atlas/shared";

// Focused on the read-only GET /api/v1/artifacts and GET /api/v1/assists/runs
// list handlers — POST handlers (upload/run assist) are unchanged this round.

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-artifacts-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

const { registerArtifactRoutes } = await import("./artifacts.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");

function signedInUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "owner@example.com",
    displayName: "Owner",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const otherUser = signedInUser({
  id: "33333333-3333-4333-8333-333333333333",
  email: "other@example.com",
});

function makeProject(owner: AuthUser | null) {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  osStore.upsertProject({
    id,
    slug: `proj-${id.slice(0, 8)}`,
    name: "Test Project",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  if (owner) {
    bindProjectOwner(id, owner.id, "bound_on_create");
  }
  return id;
}

function makeArtifact(projectId: string | null): Artifact {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const artifact: Artifact = {
    id: crypto.randomUUID(),
    projectId,
    filename: "screenshot.png",
    mimeType: "image/png",
    kind: "IMAGE",
    byteSize: 128,
    sha256: "a".repeat(64),
    storagePath: "/tmp/fake.png",
    evidenceId: crypto.randomUUID(),
    note: null,
    createdAt: now,
  };
  osStore.upsertArtifact(artifact);
  return artifact;
}

function makeAssistRun(projectId: string | null): AssistRun {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const run: AssistRun = {
    id: crypto.randomUUID(),
    projectId,
    artifactIds: [],
    expertId: "ENGINEERING",
    provider: "local-checklist",
    userRequest: "check this",
    summary: "looks fine",
    findings: [],
    creditsCharged: 0,
    epistemicState: "INFERRED",
    createdAt: now,
  };
  osStore.addAssistRun(run);
  return run;
}

let app: FastifyInstance;
const dirs: string[] = [tmpDir];

beforeAll(async () => {
  app = await buildRouteTestApp(registerArtifactRoutes);
});

afterAll(async () => {
  await app.close();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("GET /api/v1/artifacts", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/artifacts" });
    expect(res.statusCode).toBe(401);
  });

  it("filters out artifacts tied to a project owned by someone else", async () => {
    const owner = signedInUser();
    const mineProject = makeProject(owner);
    const foreignProject = makeProject(otherUser);
    const mine = makeArtifact(mineProject);
    const foreign = makeArtifact(foreignProject);
    const global = makeArtifact(null);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: "/api/v1/artifacts" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((a: { id: string }) => a.id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(global.id);
    expect(ids).not.toContain(foreign.id);
  });

  it("returns the caller's own artifact (no regression)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const mine = makeArtifact(projectId);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: "/api/v1/artifacts" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((a: { id: string }) => a.id);
    expect(ids).toContain(mine.id);
  });
});

describe("GET /api/v1/assists/runs", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/assists/runs" });
    expect(res.statusCode).toBe(401);
  });

  it("filters out assist runs tied to a project owned by someone else", async () => {
    const owner = signedInUser();
    const mineProject = makeProject(owner);
    const foreignProject = makeProject(otherUser);
    const mine = makeAssistRun(mineProject);
    const foreign = makeAssistRun(foreignProject);
    const global = makeAssistRun(null);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: "/api/v1/assists/runs" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((r: { id: string }) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(global.id);
    expect(ids).not.toContain(foreign.id);
  });
});
