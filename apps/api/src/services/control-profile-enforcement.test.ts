import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ATLAS_SELF_APPLICATION_ID,
  approvalRequestSchema,
  governanceProfileForAgentId,
} from "@atlas/shared";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-profile-enforcement-"));
process.env.ATLAS_STORE_PATH = join(storeDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const { dispatchAgentAction } = await import("./agent-dispatch-guard.js");
const { evaluateApplicationPreflight } = await import("./application-preflight.js");

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APPROVAL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("control profile does not grant execution", () => {
  const originalKill = process.env.ATLAS_KILL_SWITCHES;

  afterEach(() => {
    if (originalKill === undefined) delete process.env.ATLAS_KILL_SWITCHES;
    else process.env.ATLAS_KILL_SWITCHES = originalKill;
  });

  it("denies dispatch when the kill switch is active even if the agent can read personal memory", async () => {
    const profile = governanceProfileForAgentId(`psa:${OWNER}`);
    expect(profile?.memory.canReadPersonalMemory).toBe(true);
    expect(profile?.executionAuthorityGrantedByProfile).toBe(false);
    process.env.ATLAS_KILL_SWITCHES = "agentDispatch";
    const result = await dispatchAgentAction({
      actor: {
        kind: "AGENT",
        agentId: profile?.agentId ?? "PERSONAL_SUPERVISING_AGENT",
        onBehalfOfUserId: OWNER,
      },
      entityType: "RECORD",
      action: "EXECUTE",
      routeLabel: "test.profile.kill-switch",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
    });
    expect(result.decision).toBe("DENIED");
    if (result.decision !== "DENIED") throw new Error("expected DENIED");
    expect(result.reason).toMatch(/Kill switch "agentDispatch" is active/);
  });

  it("denies a profiled fabric agent when runtime status is REVOKED", async () => {
    delete process.env.ATLAS_KILL_SWITCHES;
    const profile = governanceProfileForAgentId("CODE_ENGINEER");
    expect(profile?.applicationId).toBe(ATLAS_SELF_APPLICATION_ID);
    expect(profile?.memory.canReadProfessionalKnowledge).toBe(true);
    const result = await dispatchAgentAction({
      actor: {
        kind: "AGENT",
        agentId: "CODE_ENGINEER",
        onBehalfOfUserId: OWNER,
      },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.profile.revoked",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      agentRuntimeStatus: "REVOKED",
    });
    expect(result.decision).toBe("DENIED");
    if (result.decision !== "DENIED") throw new Error("expected DENIED");
    expect(result.reason).toMatch(/cannot execute/);
  });

  it("denies a self-approved claim through the dispatch guard", async () => {
    delete process.env.ATLAS_KILL_SWITCHES;
    const profile = governanceProfileForAgentId("CODE_ENGINEER");
    expect(profile?.maySelfApprove).toBe(false);
    const now = new Date().toISOString();
    const claimed = approvalRequestSchema.parse({
      id: APPROVAL_ID,
      entityType: "RECORD",
      action: "DELETE",
      requestedBy: OWNER,
      requestedAt: now,
      status: "CLAIMED",
      reason: "TEST FIXTURE self-approval claim",
      decidedBy: OWNER,
      decidedAt: now,
      decisionReason: "same party",
      claimedBy: OWNER,
      claimedAt: now,
    });
    const result = await dispatchAgentAction({
      actor: { kind: "HUMAN", agentId: OWNER, onBehalfOfUserId: OWNER },
      entityType: "RECORD",
      action: "DELETE",
      routeLabel: "test.profile.self-approval",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      input: {},
      claimedApproval: claimed,
    });
    expect(result.decision).toBe("DENIED");
    if (result.decision !== "DENIED") throw new Error("expected DENIED");
    expect(result.reason).toMatch(/does not match this governed action/);
  });

  it("keeps preflight authoritative for Atlas-self and does not execute", async () => {
    const body = JSON.stringify({
      schemaVersion: "atlas.application-preflight.v1",
      applicationId: ATLAS_SELF_APPLICATION_ID,
      tenantId: "atlas",
      projectId: "atlas-self",
      actorId: "CODE_ENGINEER",
      actorKind: "AGENT",
      agentId: "CODE_ENGINEER",
      operation: "profile-proof",
      operationClass: "TOOL_ACTION",
      requestId: "profile-proof-request",
      idempotencyKey: "profile-proof-key",
    });
    const result = await evaluateApplicationPreflight({
      rawBody: body,
      headers: {},
    });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({
      decision: "OUT_OF_SCOPE",
      executed: false,
    });
  });
});
