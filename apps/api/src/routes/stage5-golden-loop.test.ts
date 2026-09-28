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
const { isAutoRemediationDraft, approvePatchArtifact } = await import("../services/patch-write.js");
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
  // Use a request whose keywords (typescript) match a Guardian knowledge fact so
  // the Guardian returns CONSISTENT → OBSERVED → gate=PROCEED → 201.
  // This is required post D2-2: UNVERIFIED (guardian=UNKNOWN) now blocks.
  const asked = await askAgent(projectId, "hello.ts: add a TypeScript type annotation to the greeting export");
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
    // The Guardian verdict is non-deterministic (AI-based). Two valid outcomes:
    // (a) guardian=CONSISTENT → OBSERVED → gate=PROCEED → 201 with a patch
    // (b) guardian=UNKNOWN    → UNVERIFIED → gate=BLOCKED → 200 with patch=null (D2-2)
    // Both are correct post D2-2. What must NEVER happen: UNVERIFIED → PROCEED.
    expect([200, 201]).toContain(asked.statusCode);
    const understanding = asked.json().understanding;
    if (asked.statusCode === 201) {
      const patch = asked.json().patch as PatchArtifact;
      const stored = osStore.getPatch(patch.id)!;
      // Only OBSERVED may produce gate=PROCEED (D2-2 enforced)
      expect(stored.understanding?.epistemicState).toBe("OBSERVED");
      expect(stored.understanding?.gate).toBe("PROCEED");
      expect(stored.understanding?.projectId).toBe(projectId);
      expect(stored.understanding?.targets[0]).toMatchObject({
        path: "hello.ts",
        observed: true,
        baseSha256: sha(MARKER),
      });
      expect(stored.filesChanged[0]?.baseSha256).toBe(sha(MARKER));
      expect(stored.evaluationSummary).toContain("Understanding:");
    } else {
      // 200 with patch=null: UNVERIFIED was blocked (D2-2 — gate must be BLOCKED)
      expect(asked.json().patch).toBeNull();
      expect(understanding?.epistemicState).toBe("UNVERIFIED");
      expect(understanding?.gate).toBe("BLOCKED");
    }
    // In neither case is UNVERIFIED allowed to PROCEED
    if (understanding?.epistemicState === "UNVERIFIED") {
      expect(understanding.gate).toBe("BLOCKED");
    }
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

  it("D2-2: UNVERIFIED understanding blocks the proposal (gate=BLOCKED, not PROCEED)", async () => {
    // Guardian UNKNOWN → epistemicState=UNVERIFIED → gate must be BLOCKED per D2-2
    // We cannot guarantee the guardian returns UNKNOWN for this request, but if it does,
    // the gate must be BLOCKED, never PROCEED.
    const projectId = ownedProject();
    const asked = await askAgent(projectId, "hello.ts: change the greeting export comment");
    const understanding = asked.json().understanding ?? osStore.getPatch(asked.json().patch?.id)?.understanding;
    if (understanding?.epistemicState === "UNVERIFIED") {
      expect(understanding.gate).toBe("BLOCKED");
      expect(asked.json().patch).toBeNull();
    } else {
      // OBSERVED or blocked by another state — still must not be PROCEED when UNVERIFIED
      expect(understanding?.epistemicState).not.toBe("UNVERIFIED");
    }
  });

  it("D2-3: patchUnderstanding never assigns INFERRED — epistemicState must be one of the allowed non-INFERRED states", async () => {
    const projectId = ownedProject();
    const asked = await askAgent(projectId, "hello.ts: change the greeting export comment");
    const epistemicState =
      asked.json().understanding?.epistemicState ??
      osStore.getPatch(asked.json().patch?.id)?.understanding?.epistemicState;
    // INFERRED is not a valid epistemicState for patchUnderstanding (D2-3)
    expect(epistemicState).not.toBe("INFERRED");
    expect([
      "OBSERVED",
      "VERIFIED",
      "UNVERIFIED",
      "CONFLICTED",
      "INSUFFICIENT_EVIDENCE",
    ]).toContain(epistemicState);
  });

  it("D2-1: VERIFIED epistemicState must not be produced by a confidence score alone — the server never assigns VERIFIED in patchUnderstanding without human confirmation", async () => {
    // The patchUnderstanding block in code.ts only ever assigns:
    // INSUFFICIENT_EVIDENCE, CONFLICTED, UNVERIFIED, or OBSERVED.
    // It never assigns VERIFIED (which would require explicit human confirmation per D2-1).
    const projectId = ownedProject();
    const asked = await askAgent(projectId, "hello.ts: change the greeting export comment");
    const epistemicState =
      asked.json().understanding?.epistemicState ??
      osStore.getPatch(asked.json().patch?.id)?.understanding?.epistemicState;
    // VERIFIED must not be auto-assigned by the server for any automated request
    expect(epistemicState).not.toBe("VERIFIED");
  });

  it("D2-1 (Y): explicit human approval via approvals[] promotes OBSERVED understanding to VERIFIED", async () => {
    // Arrange: propose a patch that results in OBSERVED understanding (guardian=CONSISTENT)
    const projectId = ownedProject();
    const proposed = await askAgent(
      projectId,
      "hello.ts: add a TypeScript type annotation to the greeting export",
    );
    const patch = proposed.json().patch as PatchArtifact | null;
    // If guardian produced OBSERVED and patch was created, test the promotion
    if (!patch) {
      // guardian=UNKNOWN → UNVERIFIED → BLOCKED → no patch. Skip promotion test.
      const understanding = proposed.json().understanding;
      expect(understanding?.epistemicState).toBe("UNVERIFIED");
      expect(understanding?.gate).toBe("BLOCKED");
      return;
    }
    expect(patch.understanding?.epistemicState).toBe("OBSERVED");
    expect(patch.understanding?.gate).toBe("PROCEED");

    // Act: human approves via authenticated APPROVE endpoint
    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/approve`,
      payload: {},
    });
    expect(approved.statusCode).toBe(200);

    // Assert: understanding promoted to VERIFIED by approval
    const storedAfter = osStore.getPatch(patch.id);
    expect(storedAfter?.understanding?.epistemicState).toBe("VERIFIED");
    expect(storedAfter?.understanding?.gateReason).toContain("VERIFIED by explicit human approval");
    // Approval record is the auditable proof
    expect(storedAfter?.approvals).toHaveLength(1);
    expect(storedAfter?.approvals[0]?.userId).toBeTruthy();
  });

  it("D2-1 (Y): without approval, understanding remains OBSERVED and is not VERIFIED", async () => {
    const projectId = ownedProject();
    const proposed = await askAgent(
      projectId,
      "hello.ts: add a TypeScript type annotation to the greeting export",
    );
    const patch = proposed.json().patch as PatchArtifact | null;
    if (!patch) return; // UNVERIFIED path — covered by D2-2 test
    // Before any approval: understanding must be OBSERVED, not VERIFIED
    expect(patch.understanding?.epistemicState).toBe("OBSERVED");
    const stored = osStore.getPatch(patch.id);
    expect(stored?.understanding?.epistemicState).toBe("OBSERVED");
    expect(stored?.approvals).toHaveLength(0);
  });

  it("D2-1 (Y): UNVERIFIED understanding is NOT promoted to VERIFIED by approval (only OBSERVED qualifies)", async () => {
    // Guardian=UNKNOWN produces UNVERIFIED → BLOCKED → no patch.
    // Even if a patch existed with UNVERIFIED understanding, approval must not promote it.
    // We test this by directly calling approvePatchArtifact on a synthetic patch with UNVERIFIED.
    const patchWithUnverified: PatchArtifact = {
      id: crypto.randomUUID(),
      projectId: null,
      title: "test",
      reason: "test",
      mode: "generate",
      status: "PROPOSED",
      risk: "LOW",
      baseCommit: null,
      targetBranch: null,
      filesChanged: [{ path: "hello.ts", action: "modify", summary: "test" }],
      evidenceIds: [],
      claimIds: [],
      expectedImpact: "",
      tests: [],
      evaluationSummary: null,
      approvals: [],
      understanding: {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        projectId: null,
        workspaceRoot: "/tmp/test",
        request: "test",
        focusPath: null,
        targets: [{ path: "hello.ts", action: "modify", observed: false, baseSha256: null }],
        repository: { apps: 0, packages: 0, topLevel: 0 },
        guardian: { verdict: "UNKNOWN", action: "ALLOW", summary: "unknown", knowledgeUsed: 0, conflicts: 0 },
        memoryIdsUsed: [],
        epistemicState: "UNVERIFIED",
        gate: "BLOCKED",
        gateReason: "UNVERIFIED",
      },
      rejection: null,
      supersedesPatchId: null,
      appliedAt: null,
      verifiedAt: null,
      rollbackRef: null,
      rollbackSnapshot: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: "test",
      epistemicState: "PROPOSED",
      confidence: 0.5,
      authorityHint: "LLM_INFERENCE",
    };
    // Inject into store so approvePatchArtifact can upsert
    osStore.upsertPatch(patchWithUnverified);
    const afterApproval = approvePatchArtifact(patchWithUnverified, {
      approvedBy: "test@example.com",
      userId: "user-123",
    });
    // UNVERIFIED must NOT be promoted — only OBSERVED qualifies
    expect(afterApproval.understanding?.epistemicState).toBe("UNVERIFIED");
    expect(afterApproval.approvals).toHaveLength(1);
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
    const asked = await askAgent(projectId, "hello.ts: add a TypeScript type annotation to the greeting export");
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

// ---------------------------------------------------------------------------
// Helper: propose a patch and reject it, returning the rejected PatchArtifact
// ---------------------------------------------------------------------------
async function createRejectedPatch(
  projectId: string,
  reason = "Rejected in test",
): Promise<ReturnType<typeof import("@atlas/shared")["patchArtifactSchema"]["parse"]>> {
  const patch = await proposeApproved(projectId);
  await app.inject({
    method: "POST",
    url: `/api/v1/code/patches/${patch.id}/reject`,
    payload: { reason },
  });
  return osStore.getPatch(patch.id)!;
}

describe("ARL-WS-005 — CORRECT / RE-RUN / DIAGNOSE", () => {
  // Test 1: REJECTED patch is valid correction source
  it("T1: REJECTED patch is a valid correction source (201)", async () => {
    const projectId = ownedProject();
    const rejected = await createRejectedPatch(projectId, "Test T1 rejection");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T1",
        reason: "T1 fix",
        mode: "fix",
        supersedesPatchId: rejected.id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "T1" }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().patch.id).toBeDefined();
  });

  // Test 2: Non-rejected patch cannot enter correction flow
  it("T2: non-rejected patch statuses (PENDING/APPROVED) cannot be superseded (409)", async () => {
    const projectId = ownedProject();
    const patch = await proposeApproved(projectId);
    // APPROVED status
    const approvedRes = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T2",
        reason: "T2 fix",
        mode: "fix",
        supersedesPatchId: patch.id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "T2" }],
      },
    });
    expect(approvedRes.statusCode).toBe(409);

    // PENDING/PROPOSED status — propose without approving
    const proposed = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Proposed patch",
        reason: "T2",
        mode: "fix",
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "PRO" }],
      },
    });
    expect(proposed.statusCode).toBe(201);
    const proposedId = proposed.json().patch.id as string;
    const pendingRes = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T2b",
        reason: "T2b fix",
        mode: "fix",
        supersedesPatchId: proposedId,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "T2b" }],
      },
    });
    expect(pendingRes.statusCode).toBe(409);
  });

  // Test 3: correction.supersedesPatchId === rejected.id
  it("T3: correction patch carries supersedesPatchId equal to the rejected patch id", async () => {
    const projectId = ownedProject();
    const rejected = await createRejectedPatch(projectId, "T3 rejection");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T3",
        reason: "T3 fix",
        mode: "fix",
        supersedesPatchId: rejected.id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "T3" }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().patch.supersedesPatchId).toBe(rejected.id);
    expect(res.json().patch.id).not.toBe(rejected.id);
  });

  // Test 4: Original patch remains immutable after correction
  it("T4: original rejected patch remains immutable after a correction is created", async () => {
    const projectId = ownedProject();
    const rejected = await createRejectedPatch(projectId, "T4 rejection");
    const originalRejection = { ...osStore.getPatch(rejected.id)!.rejection };
    await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T4",
        reason: "T4 fix",
        mode: "fix",
        supersedesPatchId: rejected.id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "T4" }],
      },
    });
    const stillRejected = osStore.getPatch(rejected.id)!;
    expect(stillRejected.status).toBe("REJECTED");
    expect(stillRejected.rejection?.reason).toBe(originalRejection.reason);
    expect(stillRejected.rejection?.by).toBe(originalRejection.by);
  });

  // Test 5: Failure context is resolved and returned in response (via agent route)
  it("T5: agent route includes correctionContext with failedPatchId and rejection fields", async () => {
    const projectId = ownedProject();
    const rejected = await createRejectedPatch(projectId, "T5 rejection reason");
    // The agent route (ask-agent) is the one that populates correctionContext
    // The manual POST /api/v1/code/patches route returns only { patch }
    // resolveCorrectionContext is verified directly here
    const { resolveCorrectionContext } = await import("../services/patch-write.js");
    const ctx = resolveCorrectionContext({
      supersedesPatchId: rejected.id,
      projectId,
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.failedPatchId).toBe(rejected.id);
    expect(ctx!.rejection).toBeDefined();
    expect(ctx!.rejection.reason).toBe("T5 rejection reason");
    expect(Array.isArray(ctx!.evidence)).toBe(true);
    expect(Array.isArray(ctx!.unresolvedEvidenceIds)).toBe(true);
  });

  // Test 6: Missing evidence is not fabricated
  it("T6: missing evidence is not fabricated — unresolvedEvidenceIds is populated instead", async () => {
    const projectId = ownedProject();
    const rejected = await createRejectedPatch(projectId, "T6 rejection");
    const fakeEvidenceId = crypto.randomUUID();
    // Simulate orphaned evidenceId directly in the store
    const stored = osStore.getPatch(rejected.id)!;
    osStore.upsertPatch({ ...stored, evidenceIds: [fakeEvidenceId] });

    // resolveCorrectionContext must not fabricate — only unresolved ids are noted
    const { resolveCorrectionContext } = await import("../services/patch-write.js");
    const ctx = resolveCorrectionContext({
      supersedesPatchId: rejected.id,
      projectId,
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.evidence).toHaveLength(0);
    expect(ctx!.unresolvedEvidenceIds).toContain(fakeEvidenceId);
  });

  // Test 7: Ownership isolation — cross-project rejected patch returns validation error
  it("T7: correction referencing a rejected patch from a different project returns 400", async () => {
    const projectId = ownedProject();
    const otherProjectId = ownedProject();
    const rejectedInOther = await createRejectedPatch(otherProjectId, "T7 other project rejection");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T7",
        reason: "T7 fix",
        mode: "fix",
        supersedesPatchId: rejectedInOther.id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "T7" }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // Test 8: Audit relationship — manual patch submission includes supersedesPatchId in audit
  it("T8: audit log for manual correction submission includes supersedesPatchId linking to the rejected patch", async () => {
    const projectId = ownedProject();
    const rejected = await createRejectedPatch(projectId, "T8 rejection");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T8",
        reason: "T8 fix",
        mode: "fix",
        supersedesPatchId: rejected.id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "T8" }],
      },
    });
    expect(res.statusCode).toBe(201);
    const newPatchId = res.json().patch.id as string;
    // Manual route emits code.patch.submitted (not code.proposal.created)
    // with supersedesPatchId = rejected.id; stored in osStore.listAudit()
    const entries = osStore.listAudit();
    const submissionAudit = entries.find(
      (e) =>
        e["type"] === "code.patch.submitted" &&
        e["patchId"] === newPatchId,
    );
    expect(submissionAudit).toBeDefined();
    expect(submissionAudit!["supersedesPatchId"]).toBe(rejected.id);
  });

  // Test 9: Normal approval remains enforced — correction patch starts in PENDING/PROPOSED
  it("T9: correction patch is not auto-approved; it starts in a pending state", async () => {
    const projectId = ownedProject();
    const rejected = await createRejectedPatch(projectId, "T9 rejection");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T9",
        reason: "T9 fix",
        mode: "fix",
        supersedesPatchId: rejected.id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "T9" }],
      },
    });
    expect(res.statusCode).toBe(201);
    const correctionPatch = osStore.getPatch(res.json().patch.id)!;
    expect(["PENDING", "PROPOSED", "DRAFT", "EVALUATED"]).toContain(correctionPatch.status);
    expect(correctionPatch.status).not.toBe("APPROVED");
    expect(correctionPatch.status).not.toBe("APPLIED");
  });

  // Test 10: Apply remains governed — correction patch requires approve-then-apply flow
  it("T10: correction patch requires approval before apply (returns non-2xx without approval)", async () => {
    const projectId = ownedProject();
    const rejected = await createRejectedPatch(projectId, "T10 rejection");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T10",
        reason: "T10 fix",
        mode: "fix",
        supersedesPatchId: rejected.id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "T10" }],
      },
    });
    expect(res.statusCode).toBe(201);
    const correctionId = res.json().patch.id as string;
    // Try to apply without approving — should be rejected
    const applyRes = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${correctionId}/apply`,
      payload: { workspaceRoot: ws },
    });
    expect([400, 403, 409]).toContain(applyRes.statusCode);
  });

  // Test 11: Verify creates new result without overwriting original patch's evidenceIds
  it("T11: correction patch has its own evidenceIds array independent of the original rejected patch", async () => {
    const projectId = ownedProject();
    const rejected = await createRejectedPatch(projectId, "T11 rejection");
    const originalEvidenceIds = [...(osStore.getPatch(rejected.id)?.evidenceIds ?? [])];
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T11",
        reason: "T11 fix",
        mode: "fix",
        supersedesPatchId: rejected.id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "T11" }],
      },
    });
    expect(res.statusCode).toBe(201);
    const correctionId = res.json().patch.id as string;
    const correctionPatch = osStore.getPatch(correctionId)!;
    // Each patch has its own evidenceIds (may both be empty, that's fine)
    expect(Array.isArray(correctionPatch.evidenceIds)).toBe(true);
    // Mutating correction evidenceIds should not affect the original
    osStore.upsertPatch({
      ...correctionPatch,
      evidenceIds: ["fake-evidence-for-correction"],
    });
    expect(osStore.getPatch(rejected.id)?.evidenceIds).toEqual(originalEvidenceIds);
  });

  // Test 12: D2 regression — correction starts with OBSERVED understanding, not auto-promoted to VERIFIED
  it("T12: correction proposal does not auto-promote understanding to VERIFIED (D2 regression)", async () => {
    const projectId = ownedProject();
    const rejected = await createRejectedPatch(projectId, "T12 rejection");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T12",
        reason: "T12 fix",
        mode: "fix",
        supersedesPatchId: rejected.id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "T12" }],
      },
    });
    expect(res.statusCode).toBe(201);
    const corrId = res.json().patch.id as string;
    const stored = osStore.getPatch(corrId)!;
    if (stored.understanding) {
      // If understanding is present, it must NOT be VERIFIED (that requires explicit evidence)
      expect(stored.understanding.epistemicState).not.toBe("VERIFIED");
    }
    // understanding may be null for a human-submitted correction (no Guardian run)
    // both null and OBSERVED/UNVERIFIED are valid; VERIFIED must never be auto-set.
  });

  // Test 13: Correction chain — three-patch chain is traceable
  it("T13: three-patch correction chain is reconstructable from supersedesPatchId links", async () => {
    const projectId = ownedProject();
    // Patch 1 — rejected
    const patch1 = await createRejectedPatch(projectId, "T13 first rejection");

    // Patch 2 — correction of patch1, then also rejected
    const corr1Res = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T13-2",
        reason: "second attempt",
        mode: "fix",
        supersedesPatchId: patch1.id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "C2" }],
      },
    });
    expect(corr1Res.statusCode).toBe(201);
    const patch2Id = corr1Res.json().patch.id as string;
    // Approve patch2 and reject it
    await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch2Id}/approve`,
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch2Id}/reject`,
      payload: { reason: "T13 second rejection" },
    });

    // Patch 3 — correction of patch2
    const corr2Res = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T13-3",
        reason: "third attempt",
        mode: "fix",
        supersedesPatchId: patch2Id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "C3" }],
      },
    });
    expect(corr2Res.statusCode).toBe(201);
    const patch3Id = corr2Res.json().patch.id as string;

    // All three findable
    expect(osStore.getPatch(patch1.id)).toBeDefined();
    expect(osStore.getPatch(patch2Id)).toBeDefined();
    expect(osStore.getPatch(patch3Id)).toBeDefined();

    // Chain reconstructable: patch3 → patch2 → patch1
    expect(osStore.getPatch(patch3Id)?.supersedesPatchId).toBe(patch2Id);
    expect(osStore.getPatch(patch2Id)?.supersedesPatchId).toBe(patch1.id);

    // Statuses
    expect(osStore.getPatch(patch1.id)?.status).toBe("REJECTED");
    expect(osStore.getPatch(patch2Id)?.status).toBe("REJECTED");
  });

  // Test 14: Failed correction is itself independently auditable as a correction source
  it("T14: a failed (rejected) correction can itself become the source for another correction", async () => {
    const projectId = ownedProject();
    const patch1 = await createRejectedPatch(projectId, "T14 first rejection");

    // Patch 2 is a correction of patch1 — approve then reject it
    const corr1Res = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T14-2",
        reason: "second attempt",
        mode: "fix",
        supersedesPatchId: patch1.id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "C2" }],
      },
    });
    expect(corr1Res.statusCode).toBe(201);
    const patch2Id = corr1Res.json().patch.id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch2Id}/approve`,
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch2Id}/reject`,
      payload: { reason: "T14 second rejection" },
    });

    // Patch 3 corrects patch2 (a correction that itself failed)
    const corr2Res = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Correction T14-3",
        reason: "third attempt",
        mode: "fix",
        supersedesPatchId: patch2Id,
        filesChanged: [{ path: "hello.ts", action: "modify", summary: "s", afterContent: "C3" }],
      },
    });
    expect(corr2Res.statusCode).toBe(201);
    expect(corr2Res.json().patch.supersedesPatchId).toBe(patch2Id);

    // correctionContext for patch3 is resolvable via resolveCorrectionContext
    const { resolveCorrectionContext } = await import("../services/patch-write.js");
    const ctx = resolveCorrectionContext({ supersedesPatchId: patch2Id, projectId });
    expect(ctx).not.toBeNull();
    expect(ctx!.failedPatchId).toBe(patch2Id);
    expect(ctx!.rejection.reason).toBe("T14 second rejection");

    // Manual submission audit shows supersedesPatchId = patch2Id
    const entries = osStore.listAudit();
    const submissionAudit = entries.find(
      (e) =>
        e["type"] === "code.patch.submitted" &&
        e["patchId"] === corr2Res.json().patch.id,
    );
    expect(submissionAudit).toBeDefined();
    expect(submissionAudit!["supersedesPatchId"]).toBe(patch2Id);
    // ARL-WS-005 regression: causationId MUST equal supersedesPatchId on manual correction path
    expect(submissionAudit!["causationId"]).toBe(patch2Id);
  });
});

// ARL-WS-005 — causationId symmetry: manual correction path
describe("ARL-WS-005 causationId symmetry", () => {
  it("manual correction submission sets causationId === supersedesPatchId", async () => {
    const projectId = ownedProject();

    // Create a base patch and reject it
    const base = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Base patch for causation test",
        reason: "initial",
        mode: "fix",
        filesChanged: [{ path: "x.ts", action: "modify", summary: "s", afterContent: "v1" }],
      },
    });
    expect(base.statusCode).toBe(201);
    const basePatchId = base.json().patch.id as string;
    await app.inject({ method: "POST", url: `/api/v1/code/patches/${basePatchId}/reject`, payload: { reason: "rejected for causation test" } });

    // Submit a manual correction (supersedesPatchId set)
    const correction = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Manual correction",
        reason: "correcting base",
        mode: "fix",
        supersedesPatchId: basePatchId,
        filesChanged: [{ path: "x.ts", action: "modify", summary: "s", afterContent: "v2" }],
      },
    });
    expect(correction.statusCode).toBe(201);
    const corrPatchId = correction.json().patch.id as string;

    // Verify audit: causationId === supersedesPatchId
    const entries = osStore.listAudit();
    const auditEntry = entries.find(
      (e: Record<string, unknown>) => e["type"] === "code.patch.submitted" && e["patchId"] === corrPatchId,
    );
    expect(auditEntry).toBeDefined();
    expect(auditEntry!["causationId"]).toBe(basePatchId);
    expect(auditEntry!["supersedesPatchId"]).toBe(basePatchId);

    // Non-correction submission: causationId must be null
    const plain = await app.inject({
      method: "POST",
      url: "/api/v1/code/patches",
      payload: {
        projectId,
        title: "Plain patch no correction",
        reason: "fresh start",
        mode: "fix",
        filesChanged: [{ path: "y.ts", action: "modify", summary: "s", afterContent: "v1" }],
      },
    });
    expect(plain.statusCode).toBe(201);
    const plainId = plain.json().patch.id as string;
    const entries2 = osStore.listAudit();
    const plainAudit = entries2.find(
      (e: Record<string, unknown>) => e["type"] === "code.patch.submitted" && e["patchId"] === plainId,
    );
    expect(plainAudit).toBeDefined();
    expect(plainAudit!["causationId"]).toBeNull();
  });
});
