import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ZodError } from "zod";
import type { AgentProposal } from "@atlas/shared";
import { setAuditLogPathForTests, listUnifiedAuditEntries } from "./audit-log.js";
import { getApprovalRequest } from "./approvals.js";
import { resetApprovalsForTests } from "./approvals-test-store.js";
import { submitAgentProposal } from "./agent-proposal.js";
import { generateStubAgentProposal } from "./agent-proposal-stub-generator.js";

const AGENT_ID = "SECURITY" as const;
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const EVIDENCE_ID = "55555555-5555-4555-8555-555555555555";

/** Full, schema-valid `AgentProposal` fixture — every test starts from this and overrides only what it needs. */
function buildProposal(overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
    agentId: AGENT_ID,
    taskId: TASK_ID,
    projectId: PROJECT,
    action: { entityType: "RECORD", action: "READ" },
    inputs: { note: "fixture" },
    claims: ["RECORD 1234 looks stale and should be re-verified"],
    evidence: [
      {
        id: EVIDENCE_ID,
        ownerId: USER_ID,
        projectId: PROJECT,
        source: "test-fixture",
        sourceType: "SYSTEM",
        sourceId: TASK_ID,
        uri: null,
        excerpt: "fixture evidence excerpt",
        version: null,
        observedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        confidence: 0.8,
        epistemicState: "OBSERVED",
        category: "TASKS",
        classification: "INTERNAL",
        authorityRank: "REPOSITORY_CODE",
        metadata: {},
      },
    ],
    confidence: 0.75,
    rationale: "Fixture proposal for agent-proposal.test.ts",
    ...overrides,
  };
}

describe("submitAgentProposal", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `atlas-agent-proposal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetApprovalsForTests();
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetApprovalsForTests();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("(a) a well-formed proposal is validated and correctly translated into a dispatchAgentAction() call, with the right actor/entity/action mapping", async () => {
    const proposal = buildProposal();

    const result = await submitAgentProposal(proposal, {
      actorKind: "AGENT",
      onBehalfOfUserId: USER_ID,
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.agent-proposal.record.read",
    });

    expect(result.decision).toBe("ALLOWED");
    if (result.decision !== "ALLOWED") throw new Error("expected ALLOWED");

    // Proposal metadata is carried on the result for callers that don't
    // want to re-read the audit log.
    expect(result.proposal).toEqual({
      agentId: AGENT_ID,
      taskId: TASK_ID,
      claims: proposal.claims,
      rationale: proposal.rationale,
      confidence: proposal.confidence,
      evidenceCount: 1,
    });

    const [entry] = listUnifiedAuditEntries();
    // actor mapping: proposal.agentId -> DispatchActor.agentId -> audit actorId
    expect(entry?.actorId).toBe(AGENT_ID);
    expect(entry?.actorKind).toBe("AGENT");
    // onBehalfOfUserId (supplied by the caller, not the proposal) -> ownerId
    expect(entry?.ownerId).toBe(USER_ID);
    // proposal.projectId -> dispatch projectId -> audit projectId
    expect(entry?.projectId).toBe(PROJECT);
    // proposal.action.{entityType,action} -> dispatch entityType/action -> audit policy
    expect(entry?.policy).toBe("RECORD.READ");
    expect(entry?.result).toBe("SUCCESS");
    expect(entry?.approval).toBe("NOT_REQUIRED");
  });

  it("(b) a malformed proposal (missing claims) is rejected before ever reaching the dispatch gate", async () => {
    const proposal = buildProposal({ claims: [] });

    await expect(
      submitAgentProposal(proposal, {
        actorKind: "AGENT",
        onBehalfOfUserId: USER_ID,
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        routeLabel: "test.agent-proposal.malformed.claims",
      }),
    ).rejects.toThrow(ZodError);

    // No audit entry means dispatchAgentAction() was never called.
    expect(listUnifiedAuditEntries()).toEqual([]);
  });

  it("(b) a malformed proposal (missing evidence) is rejected before ever reaching the dispatch gate", async () => {
    const proposal = buildProposal({ evidence: [] });

    await expect(
      submitAgentProposal(proposal, {
        actorKind: "AGENT",
        onBehalfOfUserId: USER_ID,
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        routeLabel: "test.agent-proposal.malformed.evidence",
      }),
    ).rejects.toThrow(ZodError);

    expect(listUnifiedAuditEntries()).toEqual([]);
  });

  it("(b) a malformed proposal (confidence out of range) is rejected before ever reaching the dispatch gate", async () => {
    const proposal = buildProposal({ confidence: 1.5 });

    await expect(
      submitAgentProposal(proposal, {
        actorKind: "AGENT",
        onBehalfOfUserId: USER_ID,
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        routeLabel: "test.agent-proposal.malformed.confidence",
      }),
    ).rejects.toThrow(ZodError);

    expect(listUnifiedAuditEntries()).toEqual([]);
  });

  it("(c) end-to-end: stub generator -> submitAgentProposal -> dispatchAgentAction returns a result whose audit trail carries the proposal's rationale/claims", async () => {
    const proposal = generateStubAgentProposal({
      agentId: "DEBUGGER",
      taskId: TASK_ID,
      projectId: PROJECT,
      ownerId: USER_ID,
      entityType: "RECORD",
      action: "DELETE",
    });

    // Deterministic: calling it again with identical input reproduces the
    // exact same proposal — proving this is a stub, not a real LLM call.
    const proposalAgain = generateStubAgentProposal({
      agentId: "DEBUGGER",
      taskId: TASK_ID,
      projectId: PROJECT,
      ownerId: USER_ID,
      entityType: "RECORD",
      action: "DELETE",
    });
    expect(proposalAgain).toEqual(proposal);

    // The stub generator honestly tags its evidence `LLM_INFERENCE` (see its
    // own doc comment). `verifyProposal()`, which `submitAgentProposal()` now
    // runs BEFORE the dispatch gate, correctly FAILS a proposal whose only
    // evidence is the model's own inference — that is circular, and it is
    // asserted directly in the dedicated test below. To keep exercising the
    // dispatch→audit path this test is actually about, substitute evidence
    // that reflects a real execution.
    const verifiableProposal = {
      ...proposal,
      evidence: proposal.evidence.map((record) => ({
        ...record,
        authorityRank: "CI_ARTIFACT" as const,
      })),
    };

    const result = await submitAgentProposal(verifiableProposal, {
      actorKind: "AGENT",
      onBehalfOfUserId: USER_ID,
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.agent-proposal.e2e.record.delete",
    });

    // RECORD.DELETE is DESTRUCTIVE-tier -> always APPROVAL_REQUIRED.
    expect(result.decision).toBe("APPROVAL_REQUIRED");
    if (result.decision !== "APPROVAL_REQUIRED") {
      throw new Error("expected APPROVAL_REQUIRED");
    }

    // Provable, not just claimed: read the actual audit entry back and
    // confirm it carries the stub proposal's rationale/claims verbatim —
    // this is what makes the "why" auditable, not merely asserted by the
    // caller.
    const entry = listUnifiedAuditEntries().find(
      (candidate) => candidate.type === "test.agent-proposal.e2e.record.delete",
    );
    expect(entry).toBeDefined();
    expect(entry?.input?.["claims"]).toEqual(proposal.claims);
    expect(entry?.input?.["rationale"]).toBe(proposal.rationale);
    expect(entry?.input?.["taskId"]).toBe(TASK_ID);
    expect(entry?.approval).toBe("PENDING");
    expect(entry?.result).toBe("PARTIAL");

    // The approval request created underneath also embeds the same input
    // (createApprovalRequest's `context.input`), so a human reviewing the
    // pending approval sees the same rationale/claims a later auditor would.
    const approval = await getApprovalRequest(result.approvalRequestId);
    expect(approval?.context?.["input"]).toMatchObject({
      claims: proposal.claims,
      rationale: proposal.rationale,
    });

    expect(result.proposal.claims).toEqual(proposal.claims);
    expect(result.proposal.rationale).toBe(proposal.rationale);
    expect(result.proposal.evidenceCount).toBe(proposal.evidence.length);
  });
});

describe("submitAgentProposal — verification gate (runs before dispatch)", () => {
  it("records INCONCLUSIVE (and still dispatches) when the only evidence is the model's own inference", async () => {
    // The stub generator emits `authorityRank: "LLM_INFERENCE"` verbatim.
    // A proposal that cites only its own reasoning has proven nothing, so it
    // must never reach the Policy/Risk gate at all — no audit entry for a
    // dispatch that didn't happen, and no approval request manufactured for
    // a proposal already known to be defective.
    const proposal = generateStubAgentProposal({
      agentId: "DEBUGGER",
      taskId: TASK_ID,
      projectId: PROJECT,
      ownerId: USER_ID,
      entityType: "RECORD",
      action: "READ",
    });

    const result = await submitAgentProposal(proposal, {
      actorKind: "AGENT",
      onBehalfOfUserId: USER_ID,
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.agent-proposal.verification.inconclusive",
    });

    expect(result.verification.verdict).toBe("INCONCLUSIVE");
    expect(
      result.verification.checks.find(
        (c) => c.checkId === "evidence-not-self-referential",
      )?.verdict,
    ).toBe("INCONCLUSIVE");

    // It still reaches the gate — but the audit trail records that nothing
    // was verified, so "unverified" is never mistaken for "verified".
    const entry = listUnifiedAuditEntries().find(
      (c) => c.type === "test.agent-proposal.verification.inconclusive",
    );
    expect(entry?.input?.["verificationVerdict"]).toBe("INCONCLUSIVE");
  });

  it("DENIES without dispatching when a proposal overclaims confidence on inference-only evidence", async () => {
    const base = generateStubAgentProposal({
      agentId: "DEBUGGER",
      taskId: TASK_ID,
      projectId: PROJECT,
      ownerId: USER_ID,
      entityType: "RECORD",
      action: "READ",
    });
    const overclaimed = { ...base, confidence: 0.97 };

    const before = listUnifiedAuditEntries().length;
    const result = await submitAgentProposal(overclaimed, {
      actorKind: "AGENT",
      onBehalfOfUserId: USER_ID,
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.agent-proposal.verification.overclaim",
    });

    expect(result.decision).toBe("DENIED");
    expect(result.verification.verdict).toBe("FAILED");
    // The gate was never reached — nothing was dispatched.
    expect(listUnifiedAuditEntries().length).toBe(before);
  });

  it("carries the verification verdict onto the audit entry when it does dispatch", async () => {
    const proposal = generateStubAgentProposal({
      agentId: "DEBUGGER",
      taskId: TASK_ID,
      projectId: PROJECT,
      ownerId: USER_ID,
      entityType: "RECORD",
      action: "READ",
    });
    const verifiable = {
      ...proposal,
      evidence: proposal.evidence.map((record) => ({
        ...record,
        authorityRank: "CI_ARTIFACT" as const,
      })),
    };

    const result = await submitAgentProposal(verifiable, {
      actorKind: "AGENT",
      onBehalfOfUserId: USER_ID,
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.agent-proposal.verification.recorded",
    });

    expect(result.verification.verdict).toBe("VERIFIED");
    const entry = listUnifiedAuditEntries().find(
      (candidate) => candidate.type === "test.agent-proposal.verification.recorded",
    );
    // "we verified this" must never be indistinguishable from "nothing objected".
    expect(entry?.input?.["verificationVerdict"]).toBe("VERIFIED");
  });
});
