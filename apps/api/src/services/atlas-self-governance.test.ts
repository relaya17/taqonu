import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ATLAS_SELF_APPLICATION_ID,
  ATLAS_SELF_PROJECT_ID,
  ATLAS_SELF_TENANT_ID,
  atlasSelfControlArtifactHash,
} from "@atlas/shared";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-self-gov-"));
process.env.ATLAS_STORE_PATH = join(storeDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { osStore } = await import("../store/os-store.js");
const {
  auditAtlasSelfDecision,
  evaluateStoredAtlasSelfControlApproval,
  isAtlasSelfStudioProject,
  mintAtlasSelfApproval,
  mintAtlasSelfControlApproval,
  verifyAtlasSelfControlApproval,
} = await import("./atlas-self-governance.js");
const { decideApprovalRequest, revokeApprovalRequest } = await import(
  "./approvals.js"
);
const {
  listUnifiedAuditEntries,
  setAuditLogPathForTests,
} = await import("./audit-log.js");
const { resetApprovalsForTests } = await import("./approvals-test-store.js");

describe("atlas-self-governance", () => {
  let logDir: string;
  let logFile: string;

  beforeEach(() => {
    osStore.unloadForTests();
    osStore.ensureLoaded();
    resetApprovalsForTests();
    logDir = mkdtempSync(join(tmpdir(), "atlas-self-audit-"));
    logFile = join(logDir, "audit.ndjson");
    mkdirSync(logDir, { recursive: true });
    setAuditLogPathForTests(logFile);
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    process.env.ATLAS_SKIP_AUDIT_LOG = "1";
    rmSync(logDir, { recursive: true, force: true });
  });

  it("classifies the bound Atlas-self project id, slug, and same workspace", () => {
    const now = new Date().toISOString();
    osStore.upsertProject({
      id: ATLAS_SELF_PROJECT_ID,
      slug: "atlas-core",
      name: "Atlas Core",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    osStore.setWorkspaceRoot(ATLAS_SELF_PROJECT_ID, storeDir);
    expect(isAtlasSelfStudioProject(ATLAS_SELF_PROJECT_ID)).toBe(true);

    const slugTwin = crypto.randomUUID();
    osStore.upsertProject({
      id: slugTwin,
      slug: "arletos",
      name: "Arletos",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    expect(isAtlasSelfStudioProject(slugTwin)).toBe(true);

    const workspaceTwin = crypto.randomUUID();
    osStore.upsertProject({
      id: workspaceTwin,
      slug: "unrelated-customer",
      name: "Decoy",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    osStore.setWorkspaceRoot(workspaceTwin, storeDir);
    expect(isAtlasSelfStudioProject(workspaceTwin)).toBe(true);

    const ordinary = crypto.randomUUID();
    osStore.upsertProject({
      id: ordinary,
      slug: "hotel-os",
      name: "Hotel",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    osStore.setWorkspaceRoot(ordinary, join(storeDir, "other"));
    expect(isAtlasSelfStudioProject(ordinary)).toBe(false);
  });

  it("mints an approval whose context is Atlas-self, not a caller-supplied application", async () => {
    const approval = await mintAtlasSelfApproval({
      entityType: "CONFIGURATION",
      action: "UPDATE",
      requestedBy: "66666666-6666-4666-8666-666666666666",
      reason: "disable QA",
      route: "agents.disable",
      extraContext: { agentId: "QA" },
    });
    expect(approval.context["applicationId"]).toBe(ATLAS_SELF_APPLICATION_ID);
    expect(approval.context["projectId"]).toBe(ATLAS_SELF_PROJECT_ID);
    expect(approval.context["tenantId"]).toBe(ATLAS_SELF_TENANT_ID);
    expect(approval.context["route"]).toBe("agents.disable");
    expect(approval.status).toBe("PENDING");
  });

  it("records applicationId=def-000 and executed ≠ verified on Atlas-self audit", () => {
    auditAtlasSelfDecision({
      type: "agents.disable",
      actorId: "77777777-7777-4777-8777-777777777777",
      routeLabel: "agents.disable",
      decision: "ALLOW",
      reason: "Independent live-human approval executed Atlas-self agent overlay",
      approvalId: "22222222-2222-4222-8222-222222222222",
      approvalStatus: "CLAIMED",
      executed: true,
      verificationVerdict: "INCONCLUSIVE",
      extra: { agentId: "QA", enabled: false },
    });
    const entries = listUnifiedAuditEntries();
    expect(entries.length).toBeGreaterThan(0);
    const last = entries[entries.length - 1]!;
    expect(last.input["applicationId"]).toBe("def-000");
    expect(last.output["applicationId"]).toBe("def-000");
    expect(last.input["executed"]).toBe(true);
    expect(last.input["verified"]).toBe(false);
    expect(last.verificationVerdict).toBe("INCONCLUSIVE");
    expect(last.projectId).toBe(ATLAS_SELF_PROJECT_ID);
  });

  it("verifies only an independently APPROVED Atlas-self control binding", async () => {
    const missing = await verifyAtlasSelfControlApproval(
      "00000000-0000-4000-8000-000000000000",
      { agentId: "CODE_ENGINEER", action: "pause" },
    );
    expect(missing.verified).toBe(false);
    expect(missing.reason).toMatch(/missing/i);

    const pending = await mintAtlasSelfControlApproval({
      agentId: "CODE_ENGINEER",
      action: "pause",
      reason: "pause CODE_ENGINEER",
    });
    expect(
      (await verifyAtlasSelfControlApproval(pending.id, {
        agentId: "CODE_ENGINEER",
        action: "pause",
      })).verified,
    ).toBe(false);

    await expect(
      decideApprovalRequest(pending.id, {
        decidedBy: "cp:service",
        approve: true,
        decisionReason: "self sign-off",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const approved = await decideApprovalRequest(pending.id, {
      decidedBy: "77777777-7777-4777-8777-777777777777",
      approve: true,
      decisionReason: "independent review",
    });
    expect(
      (await verifyAtlasSelfControlApproval(approved.id, {
        agentId: "CODE_ENGINEER",
        action: "pause",
      })).verified,
    ).toBe(true);
    expect(
      (await verifyAtlasSelfControlApproval(approved.id, {
        agentId: "QA",
        action: "pause",
      })).reason,
    ).toMatch(/target/i);
    expect(
      (await verifyAtlasSelfControlApproval(approved.id, {
        agentId: "CODE_ENGINEER",
        action: "revoke",
      })).reason,
    ).toMatch(/operation/i);

    const denied = await mintAtlasSelfControlApproval({
      agentId: "QA",
      action: "pause",
      reason: "will reject",
    });
    await decideApprovalRequest(denied.id, {
      decidedBy: "77777777-7777-4777-8777-777777777777",
      approve: false,
      decisionReason: "no",
    });
    expect(
      (await verifyAtlasSelfControlApproval(denied.id, {
        agentId: "QA",
        action: "pause",
      })).reason,
    ).toBe("DENIED");

    const expired = await mintAtlasSelfApproval({
      entityType: "CONFIGURATION",
      action: "UPDATE",
      requestedBy: "cp:service",
      reason: "expired pause",
      route: "agents.control",
      artifactHash: atlasSelfControlArtifactHash("CODE_ENGINEER", "disable"),
      extraContext: { agentId: "CODE_ENGINEER", controlAction: "disable" },
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    await decideApprovalRequest(expired.id, {
      decidedBy: "77777777-7777-4777-8777-777777777777",
      approve: true,
      decisionReason: "late",
    });
    expect(
      (await verifyAtlasSelfControlApproval(expired.id, {
        agentId: "CODE_ENGINEER",
        action: "disable",
      })).reason,
    ).toBe("EXPIRED");

    const revoked = await mintAtlasSelfControlApproval({
      agentId: "CODE_ENGINEER",
      action: "quarantine",
      reason: "will revoke",
    });
    await decideApprovalRequest(revoked.id, {
      decidedBy: "77777777-7777-4777-8777-777777777777",
      approve: true,
      decisionReason: "ok",
    });
    await revokeApprovalRequest(revoked.id, {
      revokedBy: "77777777-7777-4777-8777-777777777777",
      reason: "withdrawn",
    });
    expect(
      (await verifyAtlasSelfControlApproval(revoked.id, {
        agentId: "CODE_ENGINEER",
        action: "quarantine",
      })).reason,
    ).toBe("REVOKED");

    const sodBypass = evaluateStoredAtlasSelfControlApproval(
      {
        ...approved,
        decidedBy: approved.requestedBy,
      },
      { agentId: "CODE_ENGINEER", action: "pause" },
    );
    expect(sodBypass.verified).toBe(false);
    expect(sodBypass.reason).toMatch(/separation of duties/i);
  });
});
