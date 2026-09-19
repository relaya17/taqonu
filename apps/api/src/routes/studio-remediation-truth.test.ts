import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { patchArtifactSchema, type AuthUser, type PatchArtifact } from "@atlas/shared";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-remediation-truth-"));
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
const { verifyGovernedCodePatch } = await import("../services/patch-write.js");
const { parsePatchRemediationTarget } = await import(
  "../services/patch-remediation-truth.js"
);

const AWS = "AKIA0000000000000001";
const FINDING_ID = "sentinel:secret:leaked-credential.ts:aws_access_key:1";

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
    slug: `remediation-${Date.now().toString(36)}`,
    name: "Remediation Truth",
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

function secretPatch(
  rootFile: string,
  afterContent: string,
  extras: Partial<PatchArtifact> = {},
): PatchArtifact {
  const now = new Date().toISOString();
  return patchArtifactSchema.parse({
    id: crypto.randomUUID(),
    projectId: extras.projectId ?? null,
    title: "Secure leaked-credential.ts",
    reason: "Remove AWS key",
    mode: "secure",
    status: "APPLIED",
    risk: "HIGH",
    baseCommit: null,
    targetBranch: null,
    filesChanged: [
      {
        path: "leaked-credential.ts",
        action: "modify",
        summary: "rewrite",
        afterContent,
      },
    ],
    evidenceIds: [],
    claimIds: [],
    expectedImpact: "secret gone",
    tests: [],
    evaluationSummary: null,
    remediationTarget: parsePatchRemediationTarget({
      findingId: FINDING_ID,
      projectId: extras.projectId ?? null,
      focusPath: "leaked-credential.ts",
    }),
    approvals: [{ by: "human", at: now }],
    appliedAt: now,
    verifiedAt: null,
    rollbackRef: null,
    rollbackSnapshot: [
      { path: "leaked-credential.ts", previousContent: rootFile },
    ],
    createdAt: now,
    updatedAt: now,
    createdBy: "atlas-code-intelligence",
    epistemicState: "PROPOSED",
    confidence: 0.55,
    authorityHint: "LLM_INFERENCE",
    ...extras,
  });
}

let app: FastifyInstance;
let workspaceRoot: string;
const dirs: string[] = [storeDir];

describe("secret finding remediation truth", () => {
  beforeAll(async () => {
    app = await buildRouteTestApp(registerCodeRoutes);
  });

  afterAll(async () => {
    await app.close();
    for (const dir of dirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  beforeEach(() => {
    osStore.unloadForTests();
    osStore.ensureLoaded();
    resetApprovalsForTests();
    resetGovernedClaimStartsForTests();
    getRequestUser.mockReset();
    workspaceRoot = mkdtempSync(join(tmpdir(), "atlas-secret-ws-"));
    dirs.push(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, "leaked-credential.ts"),
      `export const accessKeyId = '${AWS}';\n`,
      "utf8",
    );
  });

  it("binds a secret findingId onto the proposed patch and does not write disk", async () => {
    const actor = testUser();
    getRequestUser.mockResolvedValue(actor);
    const projectId = seedOwnedProject(actor, workspaceRoot);
    const before = readFileSync(join(workspaceRoot, "leaked-credential.ts"), "utf8");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/studio/ask-agent",
      payload: {
        projectId,
        path: "leaked-credential.ts",
        mode: "secure",
        findingId: FINDING_ID,
        instruction: "Remove the hard-coded AWS access key assignment.",
      },
    });
    expect([200, 201]).toContain(res.statusCode);
    const body = res.json() as {
      patch: { id: string; remediationTarget?: { findingId: string } } | null;
      findingRemediation?: { result: string };
    };
    expect(readFileSync(join(workspaceRoot, "leaked-credential.ts"), "utf8")).toBe(
      before,
    );
    if (body.patch) {
      expect(body.patch.remediationTarget?.findingId).toBe(FINDING_ID);
      expect(existsSync(join(workspaceRoot, "leaked-credential.ts"))).toBe(true);
    } else {
      expect(body.findingRemediation?.result).toBe("UNSUPPORTED");
    }
  });

  it("401s anonymous ask-agent even with a findingId", async () => {
    getRequestUser.mockResolvedValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/studio/ask-agent",
      payload: {
        projectId: crypto.randomUUID(),
        path: "leaked-credential.ts",
        mode: "secure",
        findingId: FINDING_ID,
        instruction: "Remove the hard-coded AWS access key assignment.",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s ask-agent for a foreign project", async () => {
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
        path: "leaked-credential.ts",
        mode: "secure",
        findingId: FINDING_ID,
        instruction: "Remove the hard-coded AWS access key assignment.",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("keeps PATCH_VERIFY PASS independent of STILL_PRESENT / NOT_FIXED", () => {
    const actor = testUser();
    const projectId = seedOwnedProject(actor, workspaceRoot);
    const after = `export const accessKeyId = '${AWS}';\n// ATLAS-PATCH (secure)\n`;
    writeFileSync(join(workspaceRoot, "leaked-credential.ts"), after, "utf8");
    const patch = secretPatch(`export const accessKeyId = '${AWS}';\n`, after, {
      projectId,
    });
    osStore.upsertPatch(patch);
    const result = verifyGovernedCodePatch({
      existing: patch,
      user: actor,
      projectId,
    });
    expect(result.patchVerifyStatus).toBe("PASS");
    expect(result.verify.ok).toBe(true);
    expect(result.findingRemediation.result).toBe("NOT_FIXED");
    expect(result.findingRemediation.findingPresence).toBe("STILL_PRESENT");
    expect(result.findingRemediation.verifyStatus).toBe("FAIL");
    expect(readFileSync(join(workspaceRoot, "leaked-credential.ts"), "utf8")).toContain(
      AWS,
    );
  });

  it("reports remediation PASS only after the detector is silent", () => {
    const actor = testUser();
    const projectId = seedOwnedProject(actor, workspaceRoot);
    const after = `export const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "";\n`;
    writeFileSync(join(workspaceRoot, "leaked-credential.ts"), after, "utf8");
    const patch = secretPatch(`export const accessKeyId = '${AWS}';\n`, after, {
      projectId,
    });
    osStore.upsertPatch(patch);
    const result = verifyGovernedCodePatch({
      existing: patch,
      user: actor,
      projectId,
    });
    expect(result.patchVerifyStatus).toBe("PASS");
    expect(result.findingRemediation.result).toBe("FIXED");
    expect(result.findingRemediation.findingPresence).toBe("ABSENT");
    expect(readFileSync(join(workspaceRoot, "leaked-credential.ts"), "utf8")).not.toContain(
      AWS,
    );
  });

  it("still requires a second identity before Apply writes disk", async () => {
    const actor = testUser();
    getRequestUser.mockResolvedValue(actor);
    const projectId = seedOwnedProject(actor, workspaceRoot);
    const after = `export const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "";\n`;
    const now = new Date().toISOString();
    const patch = secretPatch(`export const accessKeyId = '${AWS}';\n`, after, {
      projectId,
      status: "APPROVED",
      appliedAt: null,
      approvals: [{ by: actor.email, at: now }],
    });
    osStore.upsertPatch(patch);
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/code/patches/${patch.id}/apply`,
      payload: { workspaceRoot },
    });
    expect(first.statusCode).toBe(202);
    expect(readFileSync(join(workspaceRoot, "leaked-credential.ts"), "utf8")).toContain(
      AWS,
    );
  });
});
