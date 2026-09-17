import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STUB_OWNER_ID,
  parseEvidenceRecord,
  patchArtifactSchema,
  type PatchArtifact,
} from "@atlas/shared";
import { ingestBugs, loadBugs } from "@atlas/observer";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-bug-fix-learning-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

const {
  persistValidatedBugFixMemory,
  learnFromObserverBugs,
  learnFromVerifiedPatch,
  BUG_FIX_MEMORY_SOURCE,
  BUG_FIX_LEARNING_AGENT_ID,
} = await import("./bug-fix-learning.js");
const { retrieveMemories } = await import("./memory-pipeline.js");
const { recordRemediationVerification } = await import("./patch-write.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("./project-access.js");

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function evidence(reference = crypto.randomUUID()) {
  return [
    {
      kind: "remediation_verify",
      reference,
      excerpt: "Verify PASS — applied file present",
    },
  ];
}

function validatedInput(
  overrides: Partial<Parameters<typeof persistValidatedBugFixMemory>[0]> = {},
) {
  return {
    ownerId: OWNER_A,
    projectId: PROJECT_A,
    bugId: crypto.randomUUID(),
    bugTitle: "Null deref on checkout confirm",
    bugDetail: "confirmCharge threw when cart was empty",
    bugStatus: "VERIFIED" as const,
    verifiedFix: true,
    evidence: evidence(),
    patchId: crypto.randomUUID(),
    agentId: BUG_FIX_LEARNING_AGENT_ID,
    ...overrides,
  };
}

function makePatch(overrides: Partial<PatchArtifact> = {}): PatchArtifact {
  const now = new Date().toISOString();
  return patchArtifactSchema.parse({
    id: crypto.randomUUID(),
    projectId: PROJECT_A,
    title: "Fix empty-cart confirmCharge",
    reason: "Guard null cart before charge",
    mode: "fix",
    status: "APPLIED",
    risk: "LOW",
    baseCommit: null,
    targetBranch: null,
    filesChanged: [
      {
        path: "docs/AUTO_FIX.md",
        action: "add",
        summary: "remediation note",
        afterContent: "Auto-remediation",
      },
    ],
    evidenceIds: [],
    claimIds: [],
    expectedImpact: "prevent crash",
    tests: [],
    evaluationSummary: null,
    sourceIssueId: crypto.randomUUID(),
    approvals: [{ by: OWNER_A, at: now }],
    appliedAt: now,
    verifiedAt: null,
    rollbackRef: null,
    rollbackSnapshot: [],
    createdAt: now,
    updatedAt: now,
    createdBy: "atlas-auto-remediation",
    epistemicState: "OBSERVED",
    confidence: 0.8,
    authorityHint: "REPOSITORY_CODE",
    ...overrides,
  });
}

function addProject(id: string) {
  const now = new Date().toISOString();
  osStore.upsertProject({
    id,
    slug: `proj-${id.slice(0, 8)}`,
    name: "Bug fix learning project",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
}

describe("bug-fix-learning", () => {
  beforeEach(() => {
    osStore.resetInMemoryForTests();
    addProject(PROJECT_A);
    addProject(PROJECT_B);
    bindProjectOwner(PROJECT_A, OWNER_A, "bound_on_create");
    bindProjectOwner(PROJECT_B, OWNER_B, "bound_on_create");
  });

  it("does not persist memory for an unverified OPEN bug", () => {
    const result = persistValidatedBugFixMemory(
      validatedInput({
        bugStatus: "OPEN",
        verifiedFix: false,
      }),
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toBe("unverified");
    }
    expect(osStore.getMemories(PROJECT_A, OWNER_A)).toHaveLength(0);
  });

  it("does not persist memory for FIXED without a validation gate", () => {
    const result = persistValidatedBugFixMemory(
      validatedInput({
        bugStatus: "FIXED",
        verifiedFix: false,
      }),
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toBe("unverified");
    }
  });

  it("does not persist a claimed VERIFIED bug that has no independent evidence", () => {
    const result = persistValidatedBugFixMemory(
      validatedInput({
        bugStatus: "VERIFIED",
        verifiedFix: false,
        evidence: [{ kind: "claimed", reference: "not-a-real-evidence-id" }],
      }),
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toBe("unverified");
    }
  });

  it("does not persist when evidence is empty", () => {
    const result = persistValidatedBugFixMemory(
      validatedInput({ evidence: [] }),
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toBe("no_evidence");
    }
  });

  it("persists an OBSERVED SOLUTION memory for a validated fix with provenance", () => {
    const bugId = crypto.randomUUID();
    const patchId = crypto.randomUUID();
    const evidenceId = crypto.randomUUID();
    const result = persistValidatedBugFixMemory(
      validatedInput({
        bugId,
        patchId,
        evidence: evidence(evidenceId),
      }),
    );
    expect(result.status).toBe("written");
    if (result.status !== "written") return;
    expect(result.memory.ownerId).toBe(OWNER_A);
    expect(result.memory.ownerId).not.toBe(STUB_OWNER_ID);
    expect(result.memory.type).toBe("SOLUTION");
    expect(result.memory.epistemicState).toBe("OBSERVED");
    expect(result.memory.source).toBe(BUG_FIX_MEMORY_SOURCE);
    expect(result.memory.sourceId).toBe(bugId);
    expect(result.memory.agentId).toBe(BUG_FIX_LEARNING_AGENT_ID);
    expect(result.memory.reason).toContain(`bugId:${bugId}`);
    expect(result.memory.reason).toContain(`patchId:${patchId}`);
    expect(result.memory.evidence[0]?.reference).toBe(evidenceId);
    expect(result.memory.statement).toContain(bugId);
  });

  it("suppresses a duplicate write for the same bug+fix", () => {
    const input = validatedInput();
    const first = persistValidatedBugFixMemory(input);
    const second = persistValidatedBugFixMemory(input);
    expect(first.status).toBe("written");
    expect(second.status).toBe("duplicate");
    if (first.status === "written" && second.status === "duplicate") {
      expect(second.memory.id).toBe(first.memory.id);
    }
    expect(
      osStore
        .getMemories(PROJECT_A, OWNER_A)
        .filter((m) => m.source === BUG_FIX_MEMORY_SOURCE),
    ).toHaveLength(1);
  });

  it("keeps owner/tenant isolation on retrieve", async () => {
    persistValidatedBugFixMemory(
      validatedInput({
        ownerId: OWNER_A,
        projectId: PROJECT_A,
        bugTitle: "owner A secret bug lesson",
      }),
    );
    persistValidatedBugFixMemory(
      validatedInput({
        ownerId: OWNER_B,
        projectId: PROJECT_B,
        bugTitle: "owner B secret bug lesson",
      }),
    );

    const forA = await retrieveMemories({
      projectId: PROJECT_A,
      ownerId: OWNER_A,
      requestingAgentId: BUG_FIX_LEARNING_AGENT_ID,
    });
    const forB = await retrieveMemories({
      projectId: PROJECT_A,
      ownerId: OWNER_B,
      requestingAgentId: BUG_FIX_LEARNING_AGENT_ID,
    });
    expect(forA.items.map((m) => m.statement).join(" ")).toContain(
      "owner A secret bug lesson",
    );
    expect(forA.items.map((m) => m.statement).join(" ")).not.toContain(
      "owner B secret bug lesson",
    );
    expect(forB.items).toHaveLength(0);
  });

  it("honors allowedAgents so a CODE_ENGINEER lane cannot see a DEBUGGER-scoped lesson", async () => {
    persistValidatedBugFixMemory(
      validatedInput({
        bugTitle: "debugger-only verified fix",
        allowedAgents: [BUG_FIX_LEARNING_AGENT_ID],
      }),
    );
    const debuggerHits = await retrieveMemories({
      projectId: PROJECT_A,
      ownerId: OWNER_A,
      requestingAgentId: BUG_FIX_LEARNING_AGENT_ID,
    });
    const engineerHits = await retrieveMemories({
      projectId: PROJECT_A,
      ownerId: OWNER_A,
      requestingAgentId: "CODE_ENGINEER",
    });
    expect(debuggerHits.items.map((m) => m.statement).join(" ")).toContain(
      "debugger-only verified fix",
    );
    expect(engineerHits.items.map((m) => m.statement).join(" ")).not.toContain(
      "debugger-only verified fix",
    );
  });

  it("does not stamp STUB_OWNER_ID when the request owner is the placeholder", () => {
    const result = persistValidatedBugFixMemory(
      validatedInput({ ownerId: STUB_OWNER_ID }),
    );
    expect(result.status).toBe("written");
    if (result.status !== "written") return;
    expect(result.memory.ownerId).toBe(OWNER_A);
    expect(result.memory.ownerId).not.toBe(STUB_OWNER_ID);
  });

  it("learnFromObserverBugs ignores OPEN ingest and learns VERIFIED only with store evidence", () => {
    const workspace = mkdtempSync(join(tmpdir(), "atlas-bugs-"));
    const openBugs = ingestBugs(
      workspace,
      [{ title: "open crash", status: "OPEN" }],
      PROJECT_A,
    );
    expect(
      learnFromObserverBugs({
        ownerId: OWNER_A,
        projectId: PROJECT_A,
        bugs: openBugs,
      }),
    ).toHaveLength(0);

    const evidenceId = crypto.randomUUID();
    const now = new Date().toISOString();
    const verifiedBugs = ingestBugs(
      workspace,
      [
        {
          title: "verified crash",
          status: "VERIFIED",
          evidenceRefs: [evidenceId],
        },
      ],
      PROJECT_A,
    );
    const bug = verifiedBugs.find((b) => b.status === "VERIFIED");
    expect(bug).toBeDefined();
    osStore.addEvidence(PROJECT_A, [
      parseEvidenceRecord({
        id: evidenceId,
        ownerId: OWNER_A,
        projectId: PROJECT_A,
        source: `bug:${bug!.id}`,
        sourceType: "SYSTEM",
        sourceId: bug!.id,
        uri: null,
        excerpt: "regression test passed after fix",
        version: null,
        observedAt: now,
        createdAt: now,
        confidence: 0.9,
        epistemicState: "OBSERVED",
        classification: "INTERNAL",
        authorityRank: "REPOSITORY_CODE",
        category: "CODE",
        metadata: { bugId: bug!.id },
      }),
    ]);
    const learned = learnFromObserverBugs({
      ownerId: OWNER_A,
      projectId: PROJECT_A,
      bugs: verifiedBugs.filter((b) => b.status === "VERIFIED"),
    });
    expect(learned).toHaveLength(1);
    expect(learned[0]?.ownerId).toBe(OWNER_A);
    rmSync(workspace, { recursive: true, force: true });
  });

  it("recordRemediationVerification with verify.ok writes a lesson and stamps the tracker bug", () => {
    const workspace = mkdtempSync(join(tmpdir(), "atlas-verify-bugs-"));
    const ingested = ingestBugs(
      workspace,
      [{ title: "charge NPE", status: "OPEN" }],
      PROJECT_A,
    );
    const bug = ingested[ingested.length - 1]!;
    const patch = makePatch({ sourceIssueId: bug.id });
    osStore.upsertPatch(patch);

    const afterFail = recordRemediationVerification({
      patch,
      workspaceRoot: workspace,
      verify: {
        ok: false,
        checks: [{ id: "exists", passed: false, detail: "missing" }],
        summary: "Verify FAIL",
      },
      userId: OWNER_A,
    });
    expect(afterFail.status).not.toBe("VERIFIED");
    expect(
      osStore
        .getMemories(PROJECT_A, OWNER_A)
        .filter((m) => m.source === BUG_FIX_MEMORY_SOURCE),
    ).toHaveLength(0);

    recordRemediationVerification({
      patch: afterFail,
      workspaceRoot: workspace,
      verify: {
        ok: true,
        checks: [{ id: "exists", passed: true, detail: "present" }],
        summary: "Verify PASS",
      },
      userId: OWNER_A,
    });
    const memories = osStore
      .getMemories(PROJECT_A, OWNER_A)
      .filter((m) => m.source === BUG_FIX_MEMORY_SOURCE);
    expect(memories).toHaveLength(1);
    expect(memories[0]?.reason).toContain(`bugId:${bug.id}`);
    expect(loadBugs(workspace).find((b) => b.id === bug.id)?.status).toBe(
      "VERIFIED",
    );
    rmSync(workspace, { recursive: true, force: true });
  });

  it("learnFromVerifiedPatch is idempotent for the same patch", () => {
    const bugId = crypto.randomUUID();
    const patchId = crypto.randomUUID();
    const first = learnFromVerifiedPatch({
      ownerId: OWNER_A,
      projectId: PROJECT_A,
      bugId,
      bugTitle: "idempotent fix",
      patchId,
      evidenceId: crypto.randomUUID(),
      verifySummary: "Verify PASS",
    });
    const second = learnFromVerifiedPatch({
      ownerId: OWNER_A,
      projectId: PROJECT_A,
      bugId,
      bugTitle: "idempotent fix",
      patchId,
      evidenceId: crypto.randomUUID(),
      verifySummary: "Verify PASS again",
    });
    expect(first.status).toBe("written");
    expect(second.status).toBe("duplicate");
  });
});
