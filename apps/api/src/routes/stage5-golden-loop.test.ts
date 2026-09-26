import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AuthUser, PatchArtifact } from "@atlas/shared";
import { APPROVAL_CONTROL_PATH, patchArtifactSchema } from "@atlas/shared";

/**
 * Stage 5 — ArletOS Golden Engineering Loop contracts (master §7.10/§7.11):
 * D2 understanding gates, D3 base-state protection for Apply and Rollback,
 * truthful Apply, D4 rejection, server-derived approver identity, remediation
 * tenant scope and provenance, one SoD model for both apply paths, the
 * Control approval boundary (G-10), and lifecycle correlation.
 */

const storeDir = mkdtempSync(join(tmpdir(), "atlas-stage5-store-"));
process.env.ATLAS_STORE_PATH = join(storeDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
const CP_TOKEN = "stage5-test-control-token-not-a-secret";
process.env.ATLAS_CONTROL_PLANE_TOKEN = CP_TOKEN;

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/resolve-identity.js")>()),
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

const { registerCodeRoutes } = await import("./code.js");
const { registerRemediationRoutes } = await import("./remediation.js");
const { registerApprovalRoutes } = await import("./approvals.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { createApprovalRequest, decideApprovalRequest, getApprovalRequest } = await import(
  "../services/approvals.js"
);
const { resetApprovalsForTests } = await import("../services/approvals-test-store.js");
const { resetGovernedClaimStartsForTests } = await import(
  "../services/governed-claimed-execution.js"
);
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");
const { isAutoRemediationDraft } = await import("../services/patch-write.js");
const { listUnifiedAuditEntries, setAuditLogPathForTests } = await import(
  "../services/audit-log.js"
);

function user(id: string, email: string, partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id,
    email,
    displayName: email,
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as AuthUser;
}

const OWNER = user("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "owner@stage5.test");
const OTHER_TENANT = user("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "other@stage5.test");
const DECIDER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MARKER = "export const greeting = 'hello';\n";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

let app: FastifyInstance;
let ws: string;
let auditDir: string;

function ownedProject(owner: AuthUser = OWNER, root = ws): string {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  osStore.upsertProject({
    id,
    slug: `s5-${id.slice(0, 8)}`,
    name: "stage5",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  bindProjectOwner(id, owner.id, "bound_on_create");
  osStore.setWorkspaceRoot(id, root);
  return id;
}

async function askAgent(projectId: string, instruction: string, path = "hello.ts") {
  return app.inject({
    method: "POST",
    url: "/api/v1/studio/ask-agent",
    payload: { projectId, workspaceRoot: ws, mode: "fix", path, instruction },
  });
}

async function proposeApproved(projectId: string): Promise<PatchArtifact> {
  const asked = await askAgent(projectId, "hello.ts: change the greeting export comment");
  expect(asked.statusCode).toBe(201);
  const patch = asked.json().patch as PatchArtifact;
  const approved = await app.inject({
    method: "POST",
    url: `/api/v1/code/patches/${patch.id}/approve`,
    payload: {},
  });
  expect(approved.statusCode).toBe(200);
  return approved.json() as PatchArtifact;
}

async function mintApply(patchId: string): Promise<string> {
  const minted = await app.inject({
    method: "POST",
    url: `/api/v1/code/patches/${patchId}/apply`,
    payload: { workspaceRoot: ws },
  });
  expect(minted.statusCode).toBe(202);
  return minted.json().approvalId as string;
}

async function sodApply(patchId: string) {
  const approvalId = await mintApply(patchId);
  await decideApprovalRequest(approvalId, {
    decidedBy: DECIDER,
    approve: true,
    decisionReason: "independent decider",
  });
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/code/patches/${patchId}/apply?approvalId=${approvalId}`,
    payload: { workspaceRoot: ws },
  });
  return { res, approvalId };
}

beforeAll(async () => {
  app = await buildRouteTestApp(async (f) => {
    await registerCodeRoutes(f);
    await registerRemediationRoutes(f);
    await registerApprovalRoutes(f);
  });
});

afterAll(async () => {
  await app.close();
  rmSync(storeDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetApprovalsForTests();
  resetGovernedClaimStartsForTests();
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(OWNER);
  ws = mkdtempSync(join(tmpdir(), "atlas-stage5-ws-"));
  writeFileSync(join(ws, "hello.ts"), MARKER, "utf8");
  auditDir = mkdtempSync(join(tmpdir(), "atlas-stage5-audit-"));
  setAuditLogPathForTests(join(auditDir, "audit.ndjson"));
  delete process.env.ATLAS_SKIP_AUDIT_LOG;
});

afterEach(() => {
  setAuditLogPathForTests(null);
  process.env.ATLAS_SKIP_AUDIT_LOG = "1";
  rmSync(ws, { recursive: true, force: true });
  rmSync(auditDir, { recursive: true, force: true });
});

describe("Stage 5 D2 — persisted Understanding gates proposals", () => {
  it("observed target: the patch carries a persisted Understanding and the server-captured base", async () => {
    const projectId = ownedProject();
    const asked = await askAgent(projectId, "hello.ts: change the greeting export comment");
    expect(asked.statusCode).toBe(201);
    const patch = asked.json().patch as PatchArtifact;
    const stored = osStore.getPatch(patch.id)!;
    expect(stored.understanding?.gate).toBe("PROCEED");
    expect(["OBSERVED", "UNVERIFIED"]).toContain(stored.understanding?.epistemicState);
    expect(stored.understanding?.projectId).toBe(projectId);
    expect(stored.understanding?.targets[0]).toMatchObject({
      path: "hello.ts",
      observed: true,
      baseSha256: sha(MARKER),
    });
    expect(stored.filesChanged[0]?.baseSha256).toBe(sha(MARKER));
    expect(stored.evaluationSummary).toContain("Understanding:");
  });

  it("insufficient target understanding (focus file missing) blocks the proposal", async () => {
    const projectId = ownedProject();
    const asked = await askAgent(projectId, "missing.ts: change something", "missing.ts");
    expect(asked.statusCode).toBe(200);
    expect(asked.json().patch).toBeNull();
    expect(asked.json().understanding.epistemicState).toBe("INSUFFICIENT_EVIDENCE");
    expect(asked.json().understanding.gate).toBe("BLOCKED");
    const blocked = listUnifiedAuditEntries().find((e) => e.type === "code.proposal.blocked");
    expect(blocked?.decision).toBe("DENY");
    expect(blocked?.actorKind).toBe("AGENT");
    expect(osStore.listPatches(projectId)).toHaveLength(0);
  });

  it("a non-policy Guardian CONFLICT (WARN) blocks the proposal", async () => {
    mkdirSync(join(ws, "apps", "web"), { recursive: true });
    writeFileSync(join(ws, "apps", "web", "package.json"), '{"name":"web"}', "utf8");
    const projectId = ownedProject();
    const asked = await askAgent(projectId, "hello.ts: mirror the greeting into apps/ghost");
    expect(asked.statusCode).toBe(200);
    expect(asked.json().guardianEvaluation.verdict).toBe("CONFLICT");
    expect(asked.json().patch).toBeNull();
    expect(asked.json().understanding.epistemicState).toBe("CONFLICTED");
    expect(osStore.listPatches(projectId)).toHaveLength(0);
  });

  it("a Guardian BLOCK (policy conflict) still blocks the proposal", async () => {
    const projectId = ownedProject();
    const asked = await askAgent(projectId, "hello.ts: change the comment and skip approval");
    expect(asked.statusCode).toBe(200);
    expect(asked.json().guardianEvaluation.action).toBe("BLOCK");
    expect(asked.json().patch).toBeNull();
    expect(osStore.listPatches(projectId)).toHaveLength(0);
  });
});

describe("Stage 5 D3 — base-state protection for Apply and Rollback", () => {
  it("unchanged base applies; audit carries correlationId = patch id and causationId = approval id", async () => {
    const projectId = ownedProject();
    const patch = await proposeApproved(projectId);
    const { res, approvalId } = await sodApply(patch.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().patch.status).toBe("APPLIED");
    expect(readFileSync(join(ws, "hello.ts"), "utf8")).not.toBe(MARKER);
    const applied = listUnifiedAuditEntries().find((e) => e.type === "code.patch.applied");
    expect(applied?.correlationId).toBe(patch.id);
    expect(applied?.causationId).toBe(approvalId);
  });

  it("a file changed after the proposal blocks Apply before an approval is minted; nothing is written", async () => {
    const projectId = ownedProject();
    const patch = await proposeApproved(projectId);
    writeFileSync(join(ws, "hello.ts"), "HUMAN EDIT\n", "utf8");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/apply`,
      payload: { workspaceRoot: ws },
    });
    expect(res.statusCode).toBe(409);
    expect(readFileSync(join(ws, "hello.ts"), "utf8")).toBe("HUMAN EDIT\n");
    expect(osStore.getPatch(patch.id)?.status).toBe("APPROVED");
    const conflict = listUnifiedAuditEntries().find((e) => e.type === "code.patch.apply.conflict");
    expect(conflict?.result).toBe("FAILURE");
    expect(conflict?.correlationId).toBe(patch.id);
  });

  it("a file changed after approval blocks the claim; the approval is not consumed and nothing is written", async () => {
    const projectId = ownedProject();
    const patch = await proposeApproved(projectId);
    const approvalId = await mintApply(patch.id);
    await decideApprovalRequest(approvalId, {
      decidedBy: DECIDER,
      approve: true,
      decisionReason: "independent decider",
    });
    writeFileSync(join(ws, "hello.ts"), "HUMAN EDIT AFTER APPROVAL\n", "utf8");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/apply?approvalId=${approvalId}`,
      payload: { workspaceRoot: ws },
    });
    expect(res.statusCode).toBe(409);
    expect(readFileSync(join(ws, "hello.ts"), "utf8")).toBe("HUMAN EDIT AFTER APPROVAL\n");
    expect((await getApprovalRequest(approvalId))?.status).toBe("APPROVED");
  });

  it("create never replaces: an `add` over a file that existed at proposal time is refused", async () => {
    const projectId = ownedProject();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Add hello",
        reason: "r",
        mode: "fix",
        filesChanged: [{ path: "hello.ts", action: "add", summary: "s", afterContent: "REPLACED" }],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().patch.id as string;
    expect(osStore.getPatch(id)?.filesChanged[0]?.baseSha256).toBe(sha(MARKER));
    await app.inject({ method: "POST", url: `/api/v1/code/patches/${id}/approve`, payload: {} });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${id}/apply`,
      payload: { workspaceRoot: ws },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/create would replace an existing file/);
    expect(readFileSync(join(ws, "hello.ts"), "utf8")).toBe(MARKER);
  });

  it("a client cannot supply its own base hash", async () => {
    const projectId = ownedProject();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Forged base",
        reason: "r",
        mode: "fix",
        filesChanged: [
          {
            path: "hello.ts",
            action: "modify",
            summary: "s",
            afterContent: "X",
            baseSha256: "0".repeat(64),
          },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(osStore.getPatch(created.json().patch.id)?.filesChanged[0]?.baseSha256).toBe(
      sha(MARKER),
    );
  });

  it("all-or-nothing: one stale file in a multi-file patch means no file is written", async () => {
    writeFileSync(join(ws, "second.ts"), "second\n", "utf8");
    const projectId = ownedProject();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Two files",
        reason: "r",
        mode: "fix",
        filesChanged: [
          { path: "hello.ts", action: "modify", summary: "a", afterContent: "A" },
          { path: "second.ts", action: "modify", summary: "b", afterContent: "B" },
        ],
      },
    });
    const id = created.json().patch.id as string;
    await app.inject({ method: "POST", url: `/api/v1/code/patches/${id}/approve`, payload: {} });
    writeFileSync(join(ws, "second.ts"), "second changed\n", "utf8");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${id}/apply`,
      payload: { workspaceRoot: ws },
    });
    expect(res.statusCode).toBe(409);
    expect(readFileSync(join(ws, "hello.ts"), "utf8")).toBe(MARKER);
    expect(readFileSync(join(ws, "second.ts"), "utf8")).toBe("second changed\n");
  });

  it("a legacy patch without a recorded base fails closed", async () => {
    const projectId = ownedProject();
    const now = new Date().toISOString();
    const legacy = patchArtifactSchema.parse({
      id: crypto.randomUUID(),
      projectId,
      title: "Legacy",
      reason: "r",
      mode: "fix",
      status: "APPROVED",
      risk: "LOW",
      baseCommit: null,
      targetBranch: null,
      filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "Y" }],
      evidenceIds: [],
      claimIds: [],
      expectedImpact: "",
      tests: [],
      evaluationSummary: null,
      approvals: [{ by: OWNER.email, at: now }],
      appliedAt: null,
      verifiedAt: null,
      rollbackRef: null,
      rollbackSnapshot: [],
      createdAt: now,
      updatedAt: now,
      createdBy: OWNER.id,
    });
    osStore.upsertPatch(legacy);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${legacy.id}/apply`,
      payload: { workspaceRoot: ws },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/no recorded base state/);
  });

  it("Rollback refuses to overwrite a change made after Apply", async () => {
    const projectId = ownedProject();
    const patch = await proposeApproved(projectId);
    const { res } = await sodApply(patch.id);
    expect(res.statusCode).toBe(200);
    writeFileSync(join(ws, "hello.ts"), "HUMAN EDIT AFTER APPLY\n", "utf8");
    const rolled = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/rollback`,
      payload: { workspaceRoot: ws },
    });
    expect(rolled.statusCode).toBe(409);
    expect(readFileSync(join(ws, "hello.ts"), "utf8")).toBe("HUMAN EDIT AFTER APPLY\n");
    expect(osStore.getPatch(patch.id)?.status).toBe("APPLIED");
    const conflict = listUnifiedAuditEntries().find(
      (e) => e.type === "code.patch.rollback.conflict",
    );
    expect(conflict?.correlationId).toBe(patch.id);
  });
});

describe("Stage 5 G-7 — approver identity is server-derived", () => {
  it("a forged approvedBy is ignored; the session user is recorded", async () => {
    const projectId = ownedProject();
    const asked = await askAgent(projectId, "hello.ts: change the greeting export comment");
    const id = asked.json().patch.id as string;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${id}/approve`,
      payload: { approvedBy: "ceo@forged.example", note: "n" },
    });
    expect(res.statusCode).toBe(200);
    const approval = osStore.getPatch(id)!.approvals.at(-1)!;
    expect(approval.by).toBe(OWNER.email);
    expect(approval.userId).toBe(OWNER.id);
  });
});

describe("Stage 5 D4 — rejection", () => {
  it("records a terminal, reasoned rejection; the rejected patch cannot be approved or applied", async () => {
    const projectId = ownedProject();
    const patch = await proposeApproved(projectId);
    const noReason = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/reject`,
      payload: {},
    });
    expect(noReason.statusCode).toBe(400);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/reject`,
      payload: { reason: "Wrong file" },
    });
    expect(res.statusCode).toBe(200);
    const stored = osStore.getPatch(patch.id)!;
    expect(stored.status).toBe("REJECTED");
    expect(stored.rejection).toMatchObject({ userId: OWNER.id, reason: "Wrong file" });
    expect(stored.filesChanged).toEqual(patch.filesChanged);
    const audit = listUnifiedAuditEntries().find((e) => e.type === "code.patch.rejected");
    expect(audit?.actorId).toBe(OWNER.id);
    expect(audit?.correlationId).toBe(patch.id);

    const reApprove = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/approve`,
      payload: {},
    });
    expect(reApprove.statusCode).toBe(400);
    const apply = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/apply`,
      payload: { workspaceRoot: ws },
    });
    expect(apply.statusCode).toBe(403);
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/reject`,
      payload: { reason: "again" },
    });
    expect(again.statusCode).toBe(409);
    expect(osStore.getPatch(patch.id)?.rejection?.reason).toBe("Wrong file");
  });

  it("a correction is a new patch that references the rejected one; only REJECTED can be superseded", async () => {
    const projectId = ownedProject();
    const patch = await proposeApproved(projectId);
    const payload = (supersedesPatchId: string) => ({
      projectId,
      title: "Correction",
      reason: "fixed",
      mode: "fix",
      supersedesPatchId,
      filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "Z" }],
    });
    const early = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: payload(patch.id),
    });
    expect(early.statusCode).toBe(409);
    await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/reject`,
      payload: { reason: "Wrong file" },
    });
    const correction = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: payload(patch.id),
    });
    expect(correction.statusCode).toBe(201);
    expect(correction.json().patch.supersedesPatchId).toBe(patch.id);
    expect(correction.json().patch.id).not.toBe(patch.id);
    expect(osStore.getPatch(patch.id)?.status).toBe("REJECTED");
  });

  it("another tenant cannot reject", async () => {
    const projectId = ownedProject();
    const patch = await proposeApproved(projectId);
    getRequestUser.mockReturnValue(OTHER_TENANT);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/reject`,
      payload: { reason: "not mine" },
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(osStore.getPatch(patch.id)?.status).toBe("APPROVED");
  });
});

function remediationDraft(projectId: string): PatchArtifact {
  const now = new Date().toISOString();
  return patchArtifactSchema.parse({
    id: crypto.randomUUID(),
    projectId,
    title: "AUTO_FIX: note",
    reason: "r",
    mode: "generate",
    status: "APPROVED",
    risk: "LOW",
    baseCommit: null,
    targetBranch: null,
    filesChanged: [
      { path: "note.md", action: "add", summary: "s", afterContent: "note", baseSha256: null },
    ],
    evidenceIds: [],
    claimIds: [],
    expectedImpact: "",
    tests: [],
    evaluationSummary: null,
    sourceIssueId: crypto.randomUUID(),
    approvals: [{ by: OWNER.email, at: now }],
    appliedAt: null,
    verifiedAt: null,
    rollbackRef: null,
    rollbackSnapshot: [],
    createdAt: now,
    updatedAt: now,
    createdBy: "atlas-auto-remediation",
  });
}

describe("Stage 5 G-1/G-2 — remediation path scope, provenance and SoD", () => {
  it("another tenant cannot list, read, approve, apply, or verify a draft", async () => {
    const projectId = ownedProject();
    const draft = remediationDraft(projectId);
    osStore.upsertPatch(draft);
    getRequestUser.mockReturnValue(OTHER_TENANT);
    const list = await app.inject({ method: "GET", url: "/api/v1/remediation/drafts" });
    expect((list.json().items as PatchArtifact[]).some((p) => p.id === draft.id)).toBe(false);
    for (const [method, url] of [
      ["GET", `/api/v1/remediation/drafts/${draft.id}`],
      ["POST", `/api/v1/remediation/drafts/${draft.id}/approve`],
      ["POST", `/api/v1/remediation/drafts/${draft.id}/apply`],
      ["POST", `/api/v1/remediation/drafts/${draft.id}/verify`],
    ] as const) {
      const res = await app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const byProject = await app.inject({
      method: "GET",
      url: `/api/v1/remediation/drafts?projectId=${projectId}`,
    });
    expect(byProject.statusCode).toBe(403);
    expect(existsSync(join(ws, "note.md"))).toBe(false);
    expect(osStore.getPatch(draft.id)?.status).toBe("APPROVED");

    getRequestUser.mockReturnValue(OWNER);
    const own = await app.inject({ method: "GET", url: `/api/v1/remediation/drafts/${draft.id}` });
    expect(own.statusCode).toBe(200);
  });

  it("the owner's draft apply needs a second identity, like a Studio patch", async () => {
    const projectId = ownedProject();
    const draft = remediationDraft(projectId);
    osStore.upsertPatch(draft);
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/remediation/drafts/${draft.id}/apply`,
      payload: {},
    });
    expect(first.statusCode).toBe(202);
    expect(existsSync(join(ws, "note.md"))).toBe(false);
  });

  it("a human-created patch titled AUTO_FIX: is a normal patch, not a remediation draft", async () => {
    const projectId = ownedProject();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "AUTO_FIX: sneaky",
        reason: "r",
        mode: "fix",
        risk: "LOW",
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "SELF" }],
      },
    });
    const id = created.json().patch.id as string;
    expect(isAutoRemediationDraft(osStore.getPatch(id)!)).toBe(false);
    await app.inject({ method: "POST", url: `/api/v1/code/patches/${id}/approve`, payload: {} });
    const viaRemediation = await app.inject({
      method: "POST",
      url: `/api/v1/remediation/drafts/${id}/apply`,
      payload: {},
    });
    expect(viaRemediation.statusCode).toBe(404);
    expect(readFileSync(join(ws, "hello.ts"), "utf8")).toBe(MARKER);
  });
});

describe("Stage 5 G-10 — Control approval boundary", () => {
  it("the Control service cannot decide an ArletOS patch-apply approval", async () => {
    const projectId = ownedProject();
    const patch = await proposeApproved(projectId);
    const approvalId = await mintApply(patch.id);
    const decided = await app.inject({
      method: "POST",
      url: `${APPROVAL_CONTROL_PATH}/${approvalId}/decide`,
      headers: { authorization: `Bearer ${CP_TOKEN}` },
      payload: { approve: true, reason: "control attempt", decidedBy: "x" },
    });
    expect(decided.statusCode).toBe(403);
    expect((await getApprovalRequest(approvalId))?.status).toBe("PENDING");
    const denied = listUnifiedAuditEntries().find(
      (e) => e.type === "approval.control.decide.denied",
    );
    expect(denied?.actorKind).toBe("SYSTEM");
    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/apply?approvalId=${approvalId}`,
      payload: { workspaceRoot: ws },
    });
    expect(retry.statusCode).not.toBe(200);
    expect(readFileSync(join(ws, "hello.ts"), "utf8")).toBe(MARKER);
  });

  it("the Control service still decides approvals it is responsible for, recorded as SYSTEM", async () => {
    const gateway = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: OWNER.id,
      reason: "gateway approval",
      context: { source: "control-gateway", operation: "read" },
    });
    const decided = await app.inject({
      method: "POST",
      url: `${APPROVAL_CONTROL_PATH}/${gateway.id}/decide`,
      headers: { authorization: `Bearer ${CP_TOKEN}` },
      payload: { approve: true, reason: "control decision", decidedBy: "x" },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().decidedBy).toBe("cp:service");
    const audit = listUnifiedAuditEntries().find(
      (e) => e.type === "approval.decided" && e.actorId === "cp:service",
    );
    expect(audit?.actorKind).toBe("SYSTEM");
  });
});
