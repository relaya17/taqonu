import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser, PatchArtifact } from "@atlas/shared";
import { patchArtifactSchema } from "@atlas/shared";

/**
 * Proves the P0 fix: patch apply/rollback now route through the real
 * `authorizeEntityAction` (`DOCUMENT.EXECUTE`) + `computeActionRiskScore`/
 * `bucketForRiskScore` engines instead of being gated only by the existing
 * binary approve→apply status check. Mirrors the pattern already proven for
 * `POST /api/v1/admin/automation/run-checks` in `./admin-ops.test.ts`:
 * no `?approvalId` -> 202 + a created approval request; retry with an
 * APPROVED request's id -> claimed helper, not consume. Low-risk patches must
 * still apply with zero extra round trips. DOCUMENT.EXECUTE after claim is
 * still subject to Phase 3E HUMAN_ONLY.
 */

const storeDir = mkdtempSync(join(tmpdir(), "atlas-code-route-store-"));
process.env.ATLAS_STORE_PATH = join(storeDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

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
const { decideApprovalRequest, getApprovalRequest } = await import("../services/approvals.js");
const { resetApprovalsForTests } = await import(
  "../services/approvals-test-store.js"
);
const { resetGovernedClaimStartsForTests } = await import(
  "../services/governed-claimed-execution.js"
);
const { osStore } = await import("../store/os-store.js");
const { readAuditLogTail, setAuditLogPathForTests } = await import(
  "../services/audit-log.js"
);

let app: FastifyInstance;
let workspaceRoot: string;
let logDir: string;
let logFile: string;

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

function someUuid(seed: number): string {
  const hex = seed.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

/** Builds a valid, directly-constructed PatchArtifact (bypassing propose). */
function makePatch(overrides: Partial<PatchArtifact> = {}): PatchArtifact {
  const now = new Date().toISOString();
  return patchArtifactSchema.parse({
    id: crypto.randomUUID(),
    projectId: null,
    title: "Test patch",
    reason: "Testing apply/rollback risk gating",
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
    createdBy: "test",
    epistemicState: "PROPOSED",
    confidence: 1,
    authorityHint: "DEVELOPER_STATEMENT",
    ...overrides,
  });
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerCodeRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(storeDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(testUser());
  resetApprovalsForTests();
  resetGovernedClaimStartsForTests();

  workspaceRoot = mkdtempSync(join(tmpdir(), "atlas-code-route-ws-"));
  writeFileSync(join(workspaceRoot, "test.txt"), "original content", "utf8");

  logDir = mkdtempSync(join(tmpdir(), "atlas-code-route-audit-"));
  logFile = join(logDir, "audit.ndjson");
  setAuditLogPathForTests(logFile);
  delete process.env.ATLAS_SKIP_AUDIT_LOG;
});

afterEach(() => {
  setAuditLogPathForTests(null);
  resetApprovalsForTests();
  resetGovernedClaimStartsForTests();
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

function lastAuditEntry(type: string) {
  const tail = readAuditLogTail(50);
  const matches = tail.filter((r) => r.type === type);
  return matches[matches.length - 1];
}

describe("POST /api/v1/code/patches/:id/apply", () => {
  it("applies a LOW-risk approved patch straight through — no approval round trip — and logs a risk-scored audit entry", async () => {
    const patch = makePatch({ risk: "LOW", confidence: 1, evidenceIds: [] });
    osStore.upsertPatch(patch);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/apply`,
      payload: { workspaceRoot },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.patch.status).toBe("APPLIED");
    expect(readFileSync(join(workspaceRoot, "test.txt"), "utf8")).toBe(
      "modified content",
    );

    const entry = lastAuditEntry("code.patch.applied");
    expect(entry).toBeDefined();
    expect(entry?.payload.risk).toBe("LOW");
    expect(entry?.payload.approval).toBe("NOT_REQUIRED");
    expect(String(entry?.payload.reason)).toMatch(/score=/);
  });

  it("blocks a HIGH-risk patch with 202, then holds HUMAN_ONLY after claim instead of consuming", async () => {
    const patch = makePatch({
      risk: "HIGH",
      confidence: 0.9,
      evidenceIds: [someUuid(1), someUuid(2), someUuid(3)],
    });
    osStore.upsertPatch(patch);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/apply`,
      payload: { workspaceRoot },
    });
    expect(first.statusCode).toBe(202);
    const firstBody = first.json();
    expect(firstBody.status).toBe("APPROVAL_REQUIRED");
    expect(typeof firstBody.approvalId).toBe("string");
    expect(["APPROVAL", "HUMAN_ONLY"]).toContain(firstBody.riskBucket);

    expect(readFileSync(join(workspaceRoot, "test.txt"), "utf8")).toBe(
      "original content",
    );

    await decideApprovalRequest(firstBody.approvalId, {
      decidedBy: testUser().id,
      approve: true,
      decisionReason: "approved for test",
    });

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/apply?approvalId=${firstBody.approvalId}`,
      payload: { workspaceRoot },
    });
    // Claimed DOCUMENT.EXECUTE re-check is HUMAN_ONLY. Consume no longer
    // bypasses that hold. The file must not change.
    expect(second.statusCode).toBe(202);
    expect(second.json().status).toBe("APPROVAL_REQUIRED");
    expect(readFileSync(join(workspaceRoot, "test.txt"), "utf8")).toBe(
      "original content",
    );
    const claimed = await getApprovalRequest(firstBody.approvalId);
    expect(claimed?.status).not.toBe("CONSUMED");
    expect(claimed?.status).toBe("FAILED");

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/apply?approvalId=${firstBody.approvalId}`,
      payload: { workspaceRoot },
    });
    expect(replay.statusCode).toBe(403);
    expect(readFileSync(join(workspaceRoot, "test.txt"), "utf8")).toBe(
      "original content",
    );
  });

  it("still 403s a not-yet-approved patch exactly as before (existing invariant preserved)", async () => {
    const patch = makePatch({ status: "AWAITING_APPROVAL", approvals: [] });
    osStore.upsertPatch(patch);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/apply`,
      payload: { workspaceRoot },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/v1/code/patches/:id/rollback", async () => {
  it("blocks rollback with 202, then holds HUMAN_ONLY after claim instead of consuming", async () => {
    writeFileSync(join(workspaceRoot, "test.txt"), "modified content", "utf8");
    const patch = makePatch({
      risk: "LOW",
      status: "APPLIED",
      appliedAt: new Date().toISOString(),
      confidence: 1,
      evidenceIds: [someUuid(4), someUuid(5), someUuid(6)],
    });
    osStore.upsertPatch(patch);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/rollback`,
      payload: { workspaceRoot },
    });
    expect(first.statusCode).toBe(202);
    const firstBody = first.json();
    expect(firstBody.status).toBe("APPROVAL_REQUIRED");
    expect(typeof firstBody.approvalId).toBe("string");

    expect(readFileSync(join(workspaceRoot, "test.txt"), "utf8")).toBe(
      "modified content",
    );

    await decideApprovalRequest(firstBody.approvalId, {
      decidedBy: testUser().id,
      approve: true,
      decisionReason: "approved rollback for test",
    });

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/rollback?approvalId=${firstBody.approvalId}`,
      payload: { workspaceRoot },
    });
    expect(second.statusCode).toBe(202);
    expect(second.json().status).toBe("APPROVAL_REQUIRED");
    expect(readFileSync(join(workspaceRoot, "test.txt"), "utf8")).toBe(
      "modified content",
    );
    const claimed = await getApprovalRequest(firstBody.approvalId);
    expect(claimed?.status).not.toBe("CONSUMED");
    expect(claimed?.status).toBe("FAILED");
  });

  it("404s when the apply-flow approvalId is unknown, and 403s when it is still PENDING", async () => {
    const patch = makePatch({
      risk: "LOW",
      status: "APPLIED",
      appliedAt: new Date().toISOString(),
    });
    osStore.upsertPatch(patch);

    const notFound = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/rollback?approvalId=00000000-0000-4000-8000-000000000000`,
      payload: { workspaceRoot },
    });
    expect(notFound.statusCode).toBe(404);

    const requested = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/rollback`,
      payload: { workspaceRoot },
    });
    const { approvalId } = requested.json();

    const stillPending = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/rollback?approvalId=${approvalId}`,
      payload: { workspaceRoot },
    });
    expect(stillPending.statusCode).toBe(403);
  });
});
