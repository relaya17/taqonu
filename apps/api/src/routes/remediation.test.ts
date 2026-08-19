import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser, PatchArtifact } from "@atlas/shared";
import { patchArtifactSchema } from "@atlas/shared";

/**
 * Proves `remediation.ts`'s auto-remediation apply paths (`/drafts/:id/apply`
 * and `/auto-apply-low`) now route through the real `authorizeEntityAction`
 * (`DOCUMENT.EXECUTE`) instead of having zero entity-policy-engine coverage
 * — "auto-apply" is exactly the kind of irreversible, agent-triggered action
 * the entity-policy layer exists to gate. Mirrors the pattern already
 * proven for `POST /api/v1/code/patches/:id/apply` in `./code.test.ts`.
 */

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-remediation-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
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

const authorizeEntityAction = vi.fn();

vi.mock("@atlas/agent-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/agent-core")>();
  return {
    ...actual,
    authorizeEntityAction: (
      ...args: Parameters<typeof actual.authorizeEntityAction>
    ) => authorizeEntityAction(...args) ?? actual.authorizeEntityAction(...args),
  };
});

const { registerRemediationRoutes } = await import("./remediation.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");

let app: FastifyInstance;
let workspaceRoot: string;

function testUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    email: "remediation-ops@example.com",
    displayName: "Remediation Ops",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

/** Builds a valid, directly-constructed auto-remediation draft PatchArtifact. */
function makeAutoFixDraft(overrides: Partial<PatchArtifact> = {}): PatchArtifact {
  const now = new Date().toISOString();
  return patchArtifactSchema.parse({
    id: crypto.randomUUID(),
    projectId: overrides.projectId ?? null,
    title: "AUTO_FIX: test remediation",
    reason: "Testing remediation apply auth gating",
    mode: "fix",
    status: "APPROVED",
    risk: "LOW",
    baseCommit: null,
    targetBranch: null,
    filesChanged: [
      {
        path: "test.txt",
        action: "modify",
        summary: "update test file",
        afterContent: "modified content",
      },
    ],
    evidenceIds: [],
    claimIds: [],
    expectedImpact: "trivial",
    tests: [],
    evaluationSummary: null,
    approvals: [{ by: "human@example.com", at: now }],
    appliedAt: null,
    verifiedAt: null,
    rollbackRef: null,
    rollbackSnapshot: [{ path: "test.txt", previousContent: "original content" }],
    createdAt: now,
    updatedAt: now,
    createdBy: "atlas-auto-remediation",
    epistemicState: "PROPOSED",
    confidence: 1,
    authorityHint: "DEVELOPER_STATEMENT",
    ...overrides,
  });
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerRemediationRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(testUser());
  authorizeEntityAction.mockReset();
  authorizeEntityAction.mockReturnValue(undefined);

  workspaceRoot = mkdtempSync(join(tmpdir(), "atlas-remediation-route-ws-"));
  writeFileSync(join(workspaceRoot, "test.txt"), "original content", "utf8");
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("POST /api/v1/remediation/drafts/:id/apply", () => {
  it("401s for an unauthenticated caller", async () => {
    const projectId = crypto.randomUUID();
    osStore.setWorkspaceRoot(projectId, workspaceRoot);
    const draft = makeAutoFixDraft({ projectId });
    osStore.upsertPatch(draft);

    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/remediation/drafts/${draft.id}/apply`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s when the real authorizeEntityAction is engaged and denies the action", async () => {
    const projectId = crypto.randomUUID();
    osStore.setWorkspaceRoot(projectId, workspaceRoot);
    const draft = makeAutoFixDraft({ projectId });
    osStore.upsertPatch(draft);

    authorizeEntityAction.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/remediation/drafts/${draft.id}/apply`,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(res.json().error.message).toMatch(/test-forced denial/);
  });

  it("still 403s a not-yet-approved draft exactly as before (existing invariant preserved)", async () => {
    const projectId = crypto.randomUUID();
    osStore.setWorkspaceRoot(projectId, workspaceRoot);
    const draft = makeAutoFixDraft({
      projectId,
      status: "AWAITING_APPROVAL",
      approvals: [],
    });
    osStore.upsertPatch(draft);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/remediation/drafts/${draft.id}/apply`,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("200s for a signed-in caller applying an approved LOW-risk draft", async () => {
    const projectId = crypto.randomUUID();
    osStore.setWorkspaceRoot(projectId, workspaceRoot);
    const draft = makeAutoFixDraft({ projectId });
    osStore.upsertPatch(draft);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/remediation/drafts/${draft.id}/apply`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    // Auto-remediation drafts run verify inline after apply (see
    // `applyApprovedPatch`'s `isAutoRemediationDraft` branch), so a clean
    // apply lands on VERIFIED rather than staying at APPLIED.
    expect(["APPLIED", "VERIFIED"]).toContain(res.json().patch.status);
  });
});

describe("POST /api/v1/remediation/auto-apply-low", () => {
  it("401s for an unauthenticated caller", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/remediation/auto-apply-low",
      payload: { force: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s (pre-existing gate) when neither the env flag nor body.force is set", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/remediation/auto-apply-low",
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s when the real authorizeEntityAction is engaged and denies the action, even with force:true", async () => {
    authorizeEntityAction.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/remediation/auto-apply-low",
      payload: { force: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(res.json().error.message).toMatch(/test-forced denial/);
  });

  it("200s for a signed-in caller with force:true and applies a queued LOW draft", async () => {
    const projectId = crypto.randomUUID();
    osStore.setWorkspaceRoot(projectId, workspaceRoot);
    const draft = makeAutoFixDraft({
      projectId,
      status: "AWAITING_APPROVAL",
      approvals: [],
    });
    osStore.upsertPatch(draft);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/remediation/auto-apply-low",
      payload: { force: true, projectId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied + body.skipped + body.failed).toBe(1);
  });
});
