import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type {
  AtlasEvalSuiteRun,
  AuthUser,
  EngineeringLoopRun,
  PatchArtifact,
} from "@atlas/shared";
import { atlasProofReportSchema, patchArtifactSchema } from "@atlas/shared";

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as conflicts.test.ts / db-feeds.test.ts).
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-engineering-loop-route-test-"));
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

const { registerEngineeringLoopRoutes } = await import("./engineering-loop.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");
const { resetApprovalsForTests } = await import("../services/approvals-test-store.js");
const { createApprovalRequest } = await import("../services/approvals.js");

// Item 1 (governed engineering-loop apply) needs a real, isolated approval
// backend -- the default (unconfigured) live approval store throws. The
// existing three /approve tests below never reach this code (blocked by
// auth/policy checks first), so this is additive, not a behavior change
// for them.
resetApprovalsForTests();

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

function makeLoopRun(projectId: string | null): EngineeringLoopRun {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const run: EngineeringLoopRun = {
    id: crypto.randomUUID(),
    projectId,
    projectSlug: null,
    workspaceRoot: "/tmp/does-not-matter",
    userRequest: "seed run",
    actionKind: "READ_ONLY",
    mode: "READ",
    status: "AWAITING_APPROVAL",
    stages: [],
    patchId: null,
    risk: null,
    decisionId: null,
    plainLanguageSummary: "seed",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  osStore.upsertLoopRun(run);
  return run;
}

function makeEvalSuite(projectId: string | null): AtlasEvalSuiteRun {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const suite: AtlasEvalSuiteRun = {
    id: crypto.randomUUID(),
    atlasVersion: "1.1.0",
    startedAt: now,
    completedAt: now,
    results: [],
    passed: 0,
    failed: 0,
    skipped: 0,
    passRate: 0,
    unauthorizedWrites: 0,
    projectId,
    ownerId: null,
  };
  osStore.addEvalSuite(suite);
  return suite;
}

/** Minimal-but-schema-valid AtlasProofReport, for seeding proof/status. */
function makeProofReportJson(projectId: string | null): string {
  const now = new Date().toISOString();
  const suite: AtlasEvalSuiteRun = {
    id: crypto.randomUUID(),
    atlasVersion: "1.1.0",
    startedAt: now,
    completedAt: now,
    results: [],
    passed: 0,
    failed: 0,
    skipped: 0,
    passRate: 0,
    unauthorizedWrites: 0,
    projectId,
    ownerId: null,
  };
  const report = atlasProofReportSchema.parse({
    id: crypto.randomUUID(),
    atlasVersion: "1.1.0",
    status: "PASS",
    golden: {
      slug: "brokeros",
      workspaceRoot: "/tmp/does-not-matter",
      source: "fixture",
      exists: true,
    },
    evalsRoot: "/tmp/does-not-matter",
    suite,
    gates: [
      {
        id: "A",
        taskId: "brokeros-A-optimistic-locking",
        title: "Optimistic locking on deal updates",
        status: "PASS",
        notes: "",
        evidenceCount: 1,
        unauthorizedWrite: false,
      },
    ],
    checklist: {
      workspaceExists: true,
      allGatesPass: true,
      unauthorizedWritesZero: true,
      suitePassRateOk: true,
    },
    metrics: { truth: 1, engineeringSuccess: 1, qaAccuracy: 1, autonomy: 1 },
    verdictSummary: null,
    evidenceReportMarkdown: "# report",
    plainLanguageSummary: "PASS",
    createdAt: now,
    projectId,
  });
  return JSON.stringify(report);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerEngineeringLoopRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  authorizeEntityActionMock.mockReset();
});

describe("POST /api/v1/actions/classify", () => {
  it("200s without auth (stateless classification utility, unchanged this round)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/actions/classify",
      payload: { userRequest: "add a login button" },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/v1/engineering/loop", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth and leaked every tenant's loop runs)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/engineering/loop" });
    expect(res.statusCode).toBe(401);
  });

  it("filters out loop runs belonging to a project owned by someone else", async () => {
    const owner = signedInUser();
    const mineProject = makeProject(owner);
    const foreignProject = makeProject(otherUser);
    const mine = makeLoopRun(mineProject);
    makeLoopRun(foreignProject);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: "/api/v1/engineering/loop" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((i: { id: string }) => i.id);
    expect(ids).toContain(mine.id);
  });
});

describe("GET /api/v1/engineering/loop/:id", () => {
  it("401s when not signed in", async () => {
    const run = makeLoopRun(null);
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/engineering/loop/${run.id}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("404s for a signed-in caller who does not own the run's project", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const run = makeLoopRun(projectId);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/engineering/loop/${run.id}`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/v1/engineering/loop", () => {
  it("401s when not signed in and projectId is omitted (security fix — this route previously had ZERO auth)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/engineering/loop",
      payload: { userRequest: "add a login button" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a non-owning signed-in user when projectId is given", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/engineering/loop",
      payload: { userRequest: "add a login button", projectId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s when the Policy Engine denies RECORD.EXECUTE (entity-policy gate wiring)", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/engineering/loop",
      payload: { userRequest: "add a login button" },
    });
    expect(res.statusCode).toBe(403);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "RECORD",
      "EXECUTE",
      expect.objectContaining({ mode: "WRITE" }),
    );
  });
});

describe("POST /api/v1/engineering/loop/:id/approve", () => {
  it("401s when not signed in", async () => {
    const run = makeLoopRun(null);
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/engineering/loop/${run.id}/approve`,
      payload: { approvedBy: "someone" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a non-owning signed-in user (security fix — previously any signed-in caller could approve/apply ANY tenant's loop)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const run = makeLoopRun(projectId);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/engineering/loop/${run.id}/approve`,
      payload: { approvedBy: "intruder" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s when the Policy Engine denies RECORD.EXECUTE (entity-policy gate wiring)", async () => {
    const run = makeLoopRun(null);
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/engineering/loop/${run.id}/approve`,
      payload: { approvedBy: "owner" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/v1/engineering/loop/:id/approve -- governed apply (Item 1)", () => {
  /**
   * Seeds a loop run + its proposed patch + a PENDING ApprovalRequest,
   * mirroring exactly what POST /api/v1/engineering/loop now persists at
   * AWAITING_APPROVAL -- without running the real (slow) 14-stage pipeline,
   * matching this file's existing makeLoopRun() convention.
   */
  async function makeLoopRunWithPatch(
    projectId: string | null,
  ): Promise<{ run: EngineeringLoopRun; patch: PatchArtifact; workspaceRoot: string }> {
    osStore.ensureLoaded();
    const now = new Date().toISOString();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "atlas-engineering-loop-apply-"));
    const patchId = crypto.randomUUID();
    const patch = patchArtifactSchema.parse({
      id: patchId,
      projectId,
      title: "Add test file",
      reason: "test fixture",
      mode: "fix",
      status: "AWAITING_APPROVAL",
      risk: "LOW",
      baseCommit: null,
      targetBranch: null,
      filesChanged: [
        { path: "loop-apply-test.txt", action: "add", summary: "add file", afterContent: "hello" },
      ],
      evidenceIds: [],
      claimIds: [],
      expectedImpact: "none",
      tests: [],
      evaluationSummary: "",
      approvals: [],
      appliedAt: null,
      verifiedAt: null,
      rollbackRef: null,
      rollbackSnapshot: [],
      createdAt: now,
      updatedAt: now,
      createdBy: "engineering-loop",
      epistemicState: "PROPOSED",
      confidence: 0.55,
      authorityHint: "LLM_INFERENCE",
    });
    osStore.upsertPatch(patch);

    const approvalRequest = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "EXECUTE",
      requestedBy: "engineering-loop",
      reason: "test fixture apply",
      context: { patchId },
    });

    const run: EngineeringLoopRun = {
      id: crypto.randomUUID(),
      projectId,
      projectSlug: null,
      workspaceRoot,
      userRequest: "add a test file",
      actionKind: "fix",
      mode: "fix",
      status: "AWAITING_APPROVAL",
      stages: [],
      patchId,
      approvalRequestId: approvalRequest.id,
      risk: "LOW",
      decisionId: null,
      plainLanguageSummary: "seed",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    osStore.upsertLoopRun(run);
    return { run, patch, workspaceRoot };
  }

  it("claims the pre-existing approval request and executes through dispatchAgentAction() (no direct applyPatchFiles bypass)", async () => {
    const owner = signedInUser();
    const { run } = await makeLoopRunWithPatch(null);
    getRequestUser.mockReturnValue(owner);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/engineering/loop/${run.id}/approve`,
      payload: { approvedBy: owner.email },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as EngineeringLoopRun;
    expect(body.status).toBe("APPLIED");

    // The real DOCUMENT.EXECUTE governance check ran (not just the route's
    // own self-approved RECORD.EXECUTE gate) -- proof the apply step now
    // goes through the shared entity-policy chokepoint.
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "DOCUMENT",
      "EXECUTE",
      expect.objectContaining({ approved: true }),
    );

    const storedPatch = osStore.getPatch(run.patchId!);
    expect(storedPatch?.status).toBe("APPLIED");
  });

  it("fails closed when the loop run has no approval request (pre-migration run)", async () => {
    const owner = signedInUser();
    const { run } = await makeLoopRunWithPatch(null);
    const legacyRun: EngineeringLoopRun = { ...run, approvalRequestId: null };
    osStore.upsertLoopRun(legacyRun);
    getRequestUser.mockReturnValue(owner);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/engineering/loop/${legacyRun.id}/approve`,
      payload: { approvedBy: owner.email },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/v1/benchmarks/tasks", () => {
  it("200s without auth (static local eval catalog, unchanged this round)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/benchmarks/tasks" });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/v1/benchmarks/suites", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/benchmarks/suites" });
    expect(res.statusCode).toBe(401);
  });

  it("200s for a signed-in caller (no regression)", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({ method: "GET", url: "/api/v1/benchmarks/suites" });
    expect(res.statusCode).toBe(200);
  });

  it("filters out suites belonging to a project owned by someone else (schema now carries projectId/ownerId)", async () => {
    const owner = signedInUser();
    const mineProject = makeProject(owner);
    const foreignProject = makeProject(otherUser);
    const mine = makeEvalSuite(mineProject);
    const foreign = makeEvalSuite(foreignProject);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: "/api/v1/benchmarks/suites" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((i: { id: string }) => i.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(foreign.id);
  });
});

describe("POST /api/v1/benchmarks/regression", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/benchmarks/regression",
      payload: {
        previousSuiteId: crypto.randomUUID(),
        currentSuiteId: crypto.randomUUID(),
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s when either compared suite belongs to a project owned by someone else", async () => {
    const owner = signedInUser();
    const mineProject = makeProject(owner);
    const foreignProject = makeProject(otherUser);
    const mine = makeEvalSuite(mineProject);
    const foreign = makeEvalSuite(foreignProject);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/benchmarks/regression",
      payload: { previousSuiteId: mine.id, currentSuiteId: foreign.id },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /api/v1/golden/project", () => {
  it("200s without auth (global env config, no tenant data, unchanged this round)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/golden/project" });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/v1/proof/status", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/proof/status" });
    expect(res.statusCode).toBe(401);
  });

  it("200s for a signed-in caller (no regression)", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({ method: "GET", url: "/api/v1/proof/status" });
    expect(res.statusCode).toBe(200);
  });

  it("403s for a non-owning signed-in user when projectId is given (security fix — this route previously read one global meta slot shared by every tenant)", async () => {
    const owner = signedInUser();
    const foreignProject = makeProject(otherUser);
    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/proof/status?projectId=${foreignProject}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("namespaces the last report per-project instead of sharing one global slot", async () => {
    const owner = signedInUser();
    const mineProject = makeProject(owner);
    osStore.setMeta(`lastProofReport:${mineProject}`, makeProofReportJson(mineProject));
    osStore.setMeta("lastProofReport:global", makeProofReportJson(null));

    getRequestUser.mockReturnValue(owner);

    const scoped = await app.inject({
      method: "GET",
      url: `/api/v1/proof/status?projectId=${mineProject}`,
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json().hasRun).toBe(true);
    expect(scoped.json().report.projectId).toBe(mineProject);

    const global = await app.inject({ method: "GET", url: "/api/v1/proof/status" });
    expect(global.statusCode).toBe(200);
    expect(global.json().hasRun).toBe(true);
    expect(global.json().report.projectId).toBeNull();
    // The two namespaced slots really are independent reports, not the
    // same one read twice.
    expect(global.json().report.id).not.toBe(scoped.json().report.id);
  });
});
