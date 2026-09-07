import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as conflicts.test.ts / db-feeds.test.ts).
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-sentinel-route-test-"));
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

const { registerSentinelRoutes } = await import("./sentinel.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");
const { createApprovalRequest } = await import("../services/approvals.js");
const { resetApprovalsForTests } = await import(
  "../services/approvals-test-store.js"
);
const { resetGovernedClaimStartsForTests } = await import(
  "../services/governed-claimed-execution.js"
);
const { setAuditLogPathForTests, listUnifiedAuditEntries } = await import(
  "../services/audit-log.js"
);

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

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerSentinelRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  authorizeEntityActionMock.mockReset();
});

describe("GET /api/v1/projects/:id/sentinel", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth and leaked security-scan findings)", async () => {
    const projectId = makeProject(null);
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/sentinel`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a non-owning signed-in user", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/sentinel`,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/v1/projects/:id/sentinel/scan", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth)", async () => {
    const projectId = makeProject(null);
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/scan`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s when the Policy Engine denies CASE.EXECUTE (entity-policy gate wiring)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    getRequestUser.mockReturnValue(owner);
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/scan`,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "CASE",
      "EXECUTE",
      expect.objectContaining({ mode: "WRITE" }),
    );
  });
});

describe("POST /api/v1/projects/:id/sentinel/verify", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth)", async () => {
    const projectId = makeProject(null);
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/verify`,
      payload: { findingId: "f1" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/v1/projects/:id/sentinel/scan + .../scan/decide-and-execute — F-02 Phase 2 Gap 3: real approval lifecycle", () => {
  // CASE.EXECUTE is HIGH_RISK_WRITE + requiresApproval (entity-policies.ts).
  // With the conservative default confidence/evidence risk-score.ts applies
  // when none is supplied, that combination always scores exactly at the
  // HUMAN_ONLY bucket -- the same bucket a HIGH/CRITICAL code patch lands
  // at for DOCUMENT.EXECUTE (see code.ts). `dispatchAgentAction` never lets
  // an ordinary decide-then-claim approval TOKEN satisfy HUMAN_ONLY for an
  // AGENT-kind actor (that would be approval-token replay by whoever
  // presents the id) -- HUMAN_ONLY requires a genuinely *live* human
  // decision instead. So, exactly like code.ts's `/apply` +
  // `/apply/decide-and-execute` split, `/scan` alone can only ever request
  // approval; `/scan/decide-and-execute` is this action's only executable
  // path, and requires a second, live-authenticated identity (never the
  // original requester) to decide and claim the approval in one atomic
  // step. This route used to call `authorizeEntityAction` directly with a
  // hardcoded `approved: true`, which always satisfied CASE.EXECUTE's
  // approval requirement regardless of whether any real approval ever
  // existed -- these tests exercise the real approval lifecycle end to end
  // instead of the removed shortcut.
  const requester = signedInUser();
  // Project write access is single-owner (project-access.ts, admin/CP
  // roles bypass ownership) -- so a genuinely different identity that
  // still legitimately holds write access to the SAME project must be an
  // operator/admin, exactly like every other decide-and-execute caller in
  // this codebase (see code.test.ts).
  const decider = signedInUser({
    id: "77777777-7777-4777-8777-777777777777",
    email: "decider@example.com",
    role: "admin",
  });
  // A third identity, distinct from both the requester and the decider
  // above, but with equally legitimate write access to the project --
  // used to prove a wrong executor cannot reuse someone else's already-
  // finalized approval (required-coverage item: "wrong executor cannot
  // use the approval").
  const thirdPartyDecider = signedInUser({
    id: "88888888-8888-4888-8888-888888888888",
    email: "third-party-decider@example.com",
    role: "admin",
  });
  let scanWorkspace: string;
  let auditDir: string;

  beforeEach(() => {
    scanWorkspace = mkdtempSync(join(tmpdir(), "atlas-sentinel-scan-workspace-"));
    auditDir = mkdtempSync(join(tmpdir(), "atlas-sentinel-scan-audit-"));
    setAuditLogPathForTests(join(auditDir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetApprovalsForTests();
    resetGovernedClaimStartsForTests();
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    process.env.ATLAS_SKIP_AUDIT_LOG = "1";
    resetApprovalsForTests();
    resetGovernedClaimStartsForTests();
    rmSync(scanWorkspace, { recursive: true, force: true });
    rmSync(auditDir, { recursive: true, force: true });
  });

  async function requestApproval(projectId: string): Promise<string> {
    getRequestUser.mockReturnValue(requester);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/scan`,
      payload: { workspaceRoot: scanWorkspace },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { status: string; approvalRequestId: string };
    expect(body.status).toBe("APPROVAL_REQUIRED");
    expect(typeof body.approvalRequestId).toBe("string");
    expect(body.approvalRequestId.length).toBeGreaterThan(0);
    return body.approvalRequestId;
  }

  it("1. no approval on hand -> 202 APPROVAL_REQUIRED (not executed)", async () => {
    const projectId = makeProject(requester);
    await requestApproval(projectId);
  });

  it("2. a different, live-authenticated decider can decide-and-execute in one atomic step; replaying the same approval afterward is refused", async () => {
    const projectId = makeProject(requester);
    const approvalId = await requestApproval(projectId);

    getRequestUser.mockReturnValue(decider);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/scan/decide-and-execute`,
      payload: {
        approvalId,
        decisionReason: "reviewed and approved",
        workspaceRoot: scanWorkspace,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agent: string; mode: string; projectId: string };
    expect(body.agent).toBe("Atlas Sentinel");
    expect(body.mode).toBe("defensive");
    expect(body.projectId).toBe(projectId);

    // Audit records the outcome.
    const entry = listUnifiedAuditEntries().find(
      (e) => e.type === "sentinel.scan.live-human",
    );
    expect(entry).toBeDefined();
    expect(entry?.result).toBe("SUCCESS");

    // A consumed (already-FULFILLED) approval cannot be replayed for a
    // second execution, even by the same decider.
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/scan/decide-and-execute`,
      payload: {
        approvalId,
        decisionReason: "trying again",
        workspaceRoot: scanWorkspace,
      },
    });
    expect(replay.statusCode).toBe(403);
    const replayBody = replay.json() as { error?: { message?: string } };
    expect(JSON.stringify(replayBody)).toMatch(/already finalized/);
  });

  it("3. self-approval is rejected: the requester cannot also be the live decider for their own scan", async () => {
    const projectId = makeProject(requester);
    const approvalId = await requestApproval(projectId);

    getRequestUser.mockReturnValue(requester);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/scan/decide-and-execute`,
      payload: {
        approvalId,
        decisionReason: "self sign-off attempt",
        workspaceRoot: scanWorkspace,
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { message?: string } };
    expect(JSON.stringify(body)).toMatch(/separation of duties/);
  });

  it("4. an expired approval fails, even for a genuinely different decider", async () => {
    const projectId = makeProject(requester);
    // The live-human path never has an intermediate APPROVED state -- a
    // request just sits PENDING until it is atomically decided and
    // claimed, or it lapses. Create one directly with a short future
    // expiry and let it lapse before presenting it.
    const created = await createApprovalRequest({
      entityType: "CASE",
      action: "EXECUTE",
      requestedBy: requester.id,
      reason: "run a defensive sentinel scan",
      expiresAt: new Date(Date.now() + 200).toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    getRequestUser.mockReturnValue(decider);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/scan/decide-and-execute`,
      payload: {
        approvalId: created.id,
        decisionReason: "reviewed and approved",
        workspaceRoot: scanWorkspace,
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { message?: string } };
    expect(JSON.stringify(body)).toMatch(/expired/);
  });

  it("5. a forged/nonexistent approvalId 404s, not silently ignored", async () => {
    const projectId = makeProject(requester);
    getRequestUser.mockReturnValue(decider);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/scan/decide-and-execute`,
      payload: {
        approvalId: "99999999-9999-4999-8999-999999999999",
        decisionReason: "no such request",
        workspaceRoot: scanWorkspace,
      },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error?: { message?: string } };
    expect(JSON.stringify(body)).toMatch(/not found/);
  });

  it("6. project write-access is still enforced ahead of decide-and-execute's approval logic", async () => {
    const projectId = makeProject(requester);
    const approvalId = await requestApproval(projectId);

    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/scan/decide-and-execute`,
      payload: {
        approvalId,
        decisionReason: "not my project",
        workspaceRoot: scanWorkspace,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("7. project write-access is still enforced on /scan itself (403 for a non-owning signed-in user)", async () => {
    const projectId = makeProject(requester);
    getRequestUser.mockReturnValue(otherUser);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/scan`,
      payload: { workspaceRoot: scanWorkspace },
    });
    expect(res.statusCode).toBe(403);
  });

  it("8. a wrong executor -- a different, otherwise-authorized identity than the one who fulfilled it -- cannot reuse an already-finalized approval", async () => {
    const projectId = makeProject(requester);
    const approvalId = await requestApproval(projectId);

    getRequestUser.mockReturnValue(decider);
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/scan/decide-and-execute`,
      payload: {
        approvalId,
        decisionReason: "reviewed and approved",
        workspaceRoot: scanWorkspace,
      },
    });
    expect(first.statusCode).toBe(200);

    // A third identity -- neither the original requester nor the decider
    // who fulfilled the approval, but otherwise a legitimate admin with
    // write access to this same project -- cannot pick up the same,
    // already-consumed approval id and execute with it. There is no
    // executor binding left to exploit once an approval is terminal.
    getRequestUser.mockReturnValue(thirdPartyDecider);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/sentinel/scan/decide-and-execute`,
      payload: {
        approvalId,
        decisionReason: "I will take this one",
        workspaceRoot: scanWorkspace,
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { message?: string } };
    expect(JSON.stringify(body)).toMatch(/already finalized/);
  });
});
