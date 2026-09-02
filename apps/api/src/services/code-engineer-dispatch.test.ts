import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetLlmDedupCache, resetModelCostTracker } from "@atlas/agent-core";
import { setAuditLogPathForTests, listUnifiedAuditEntries } from "./audit-log.js";
import { resetApprovalsForTests } from "./approvals-test-store.js";
import { runCodeEngineerSpecialistViaLlm } from "./code-engineer-dispatch.js";
import { runResearcherSpecialistViaLlm } from "./research-analyst-dispatch.js";

/**
 * End-to-end at the service layer, with NOTHING mocked below the LLM itself:
 * the real `generateSpecialistProposalViaLlm` → real `submitAgentProposal`
 * → real `dispatchAgentAction` (real Policy Engine, Risk Engine, Unified
 * Audit Log, approval flow). Only `fetch` is stubbed, the same way
 * `packages/agent-core/src/providers/llm.test.ts` does it, so no network
 * call is ever placed.
 *
 * The point of this file (vs. the route-level tests in
 * `apps/api/src/routes/agent-fabric.test.ts`, which mock the gate) is to
 * prove the audit trail genuinely carries the model's REAL claims and
 * rationale, which can only be checked against a real audit log.
 */

const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

const MODEL_CLAIM =
  "auth.spec.ts:42 fails because clearSession() never unsets the session cookie";
const MODEL_RATIONALE =
  "A failing test and the exact line it points at justify proposing a patch record for review.";

function stubProviderReply(content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 2000, completion_tokens: 1000, total_tokens: 3000 },
      }),
    }),
  );
}

const OPENAI_ENV = {
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "sk-test",
  OPENAI_MODEL: "gpt-4o-mini",
} as const;

function proposalJson(entityType: string, action: string) {
  return JSON.stringify({
    claims: [MODEL_CLAIM],
    evidence: [{ ref: "apps/api/src/routes/auth.ts:88", excerpt: "clearSession()" }],
    confidence: 0.62,
    rationale: MODEL_RATIONALE,
    proposedAction: { entityType, action },
  });
}

describe("proposal-first fabric specialists (real gate + real audit log)", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `atlas-llm-specialist-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetApprovalsForTests();
    resetLlmDedupCache();
    resetModelCostTracker();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAuditLogPathForTests(null);
    resetApprovalsForTests();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("CODE_ENGINEER: a well-formed proposal reaches dispatchAgentAction as RECORD.CREATE and the audit entry carries the model's REAL claims + rationale", async () => {
    stubProviderReply(proposalJson("RECORD", "CREATE"));

    const run = await runCodeEngineerSpecialistViaLlm({
      request: "logout leaves the session cookie set",
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      env: OPENAI_ENV,
    });

    expect(run).not.toBeNull();
    expect(run?.agentId).toBe("CODE_ENGINEER");

    // `dispatchAgentAction` writes its own entry under the caller's
    // routeLabel; an APPROVAL_REQUIRED outcome additionally makes
    // `createApprovalRequest` write one of its own, so select by type
    // rather than assuming a single entry.
    const entry = listUnifiedAuditEntries().find(
      (e) => e.type === "agent-fabric.dispatch.code-engineer",
    );
    expect(entry).toBeDefined();
    if (!entry) throw new Error("expected a code-engineer dispatch audit entry");
    expect(entry.policy).toBe("RECORD.CREATE");
    expect(entry.actorId).toBe("CODE_ENGINEER");
    expect(entry.actorKind).toBe("AGENT");
    expect(entry.ownerId).toBe(OWNER_ID);
    expect(entry.projectId).toBe(PROJECT_ID);

    // The whole point of the proposal layer: WHY, not just WHAT.
    const input = entry.input as Record<string, unknown>;
    expect(input.claims).toEqual([MODEL_CLAIM]);
    expect(input.rationale).toBe(MODEL_RATIONALE);
    expect(input.evidenceCount).toBe(1);

    // The gate's decision — whatever the real Risk Engine returned — is what
    // determines the run status; nothing here second-guesses it.
    if (entry.approval === "NOT_REQUIRED") {
      expect(run?.status).toBe("COMPLETED");
      expect(run?.epistemicState).toBe("PROPOSED");
    } else {
      expect(run?.status).toBe("SKIPPED");
      expect(run?.epistemicState).toBe("UNKNOWN");
      expect(run?.claims.some((c) => c.startsWith("approvalRequestId:"))).toBe(true);
    }

    // The model's claims/rationale are surfaced on the run either way — a
    // gated proposal is not a swallowed proposal.
    expect(run?.claims).toContain(MODEL_CLAIM);
    expect(run?.claims.some((c) => c === `rationale:${MODEL_RATIONALE}`)).toBe(true);
    // Real metered cost from the stubbed provider response
    // (2000/1e6 * $0.15 + 1000/1e6 * $0.6), never a flat 0 or an estimate.
    expect(run?.costUsd).toBeCloseTo(0.0009, 6);
    expect(run?.durationMs).toBeGreaterThan(0);
  });

  it("RESEARCHER: proposes the read-only DOCUMENT.READ pair and is ALLOWED by the real policy engine without approval", async () => {
    stubProviderReply(proposalJson("DOCUMENT", "READ"));

    const run = await runResearcherSpecialistViaLlm({
      request: "find the official guidance on secure cookie flags",
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      env: OPENAI_ENV,
    });

    const entries = listUnifiedAuditEntries().filter(
      (e) => e.type === "agent-fabric.dispatch.researcher",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.policy).toBe("DOCUMENT.READ");
    // DOCUMENT.READ is READ_ONLY / requiresApproval:false per
    // DEFAULT_ENTITY_POLICIES — the honest lowest-privilege tier for a
    // read-oriented specialist, and the reason this one completes outright.
    expect(entries[0]?.approval).toBe("NOT_REQUIRED");
    expect(run?.status).toBe("COMPLETED");
    expect(run?.agentId).toBe("RESEARCHER");
    expect(run?.epistemicState).toBe("PROPOSED");
  });

  it("a malformed model reply yields NEEDS_EVIDENCE and never reaches the dispatch gate at all", async () => {
    stubProviderReply("I cannot answer that.");

    const run = await runCodeEngineerSpecialistViaLlm({
      request: "logout leaves the session cookie set",
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      env: OPENAI_ENV,
    });

    expect(run?.status).toBe("NEEDS_EVIDENCE");
    expect(run?.epistemicState).toBe("UNVERIFIED");
    expect(run?.summary).toMatch(/no usable proposal/);
    // Nothing was proposed, so nothing was gated — no audit entry at all.
    expect(listUnifiedAuditEntries()).toHaveLength(0);
    // The failed attempt's real cost is still reported.
    expect(run?.costUsd).toBeCloseTo(0.0009, 6);
  });

  it("a model that proposes an out-of-policy action (CONFIGURATION.EXECUTE) is rejected before the gate, not gated on its own terms", async () => {
    stubProviderReply(proposalJson("CONFIGURATION", "EXECUTE"));

    const run = await runCodeEngineerSpecialistViaLlm({
      request: "just disable the auth policy",
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      env: OPENAI_ENV,
    });

    expect(run?.status).toBe("NEEDS_EVIDENCE");
    expect(run?.claims.some((c) => c.includes("disallowed action CONFIGURATION.EXECUTE"))).toBe(
      true,
    );
    expect(listUnifiedAuditEntries()).toHaveLength(0);
  });

  it("returns null (→ caller falls back to the read-only stub) when there is no valid owner id to attribute evidence to", async () => {
    stubProviderReply(proposalJson("RECORD", "CREATE"));

    const run = await runCodeEngineerSpecialistViaLlm({
      request: "logout leaves the session cookie set",
      projectId: PROJECT_ID,
      ownerId: "",
      env: OPENAI_ENV,
    });

    expect(run).toBeNull();
    expect(listUnifiedAuditEntries()).toHaveLength(0);
  });
});
