import { afterAll, describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  memorySchema,
  type MemoryEvidence,
  type QaPortfolioPattern,
} from "@atlas/shared";

// ISOLATION FIX (found while widening Policy Engine coverage — this file's
// lack of isolation was silently corrupting the real repo `.atlas/store.json`
// on every run, since `osStore` falls back to that real path whenever
// `ATLAS_STORE_PATH` isn't set): same pattern every other route/service test
// in this codebase uses — set `ATLAS_STORE_PATH` to a throwaway tmp dir
// BEFORE `osStore` is ever imported (hence the dynamic imports below,
// mirroring memory.test.ts / events.test.ts), and set
// `ATLAS_SKIP_STORE_PERSIST`/`ATLAS_SKIP_EVENT_DISPATCH` once for the whole
// file instead of the previous per-describe-block save/restore dance (which
// didn't address the real bug: the *initial* `ensureLoaded()` read from the
// real file regardless of that flag).
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-memory-pipeline-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

const { osStore } = await import("../store/os-store.js");
const {
  approveMemory,
  buildMemoryContext,
  resolveMemoryProvenance,
  retrieveMemories,
  seedPortfolioPatternMemories,
} = await import("./memory-pipeline.js");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
// Dedicated project for the semantic-ranking tests below — retrieveMemories()
// with no projectId scans the shared "global" pool, which by this point in
// the file also holds memories added by every earlier describe block (this
// file doesn't reset osStore between tests); scoping to a fresh project id
// keeps each semantic-ranking assertion isolated to just its own fixtures.
const PROJECT_SEMANTIC = "33333333-3333-4333-8333-333333333333";
const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * A single evidence entry with a genuine verification signal — satisfies
 * both the evidence-required gate (non-empty) AND the stricter
 * evidence-*verified* gate (Gate 3 strengthening — see
 * `hasVerificationSignal()` in memory-pipeline.ts): `kind: "TEST_RUN"` is
 * one of `evidenceSourceTypeSchema`'s inherently-verified source kinds.
 */
function oneEvidenceEntry(): MemoryEvidence[] {
  return [
    {
      id: crypto.randomUUID(),
      kind: "TEST_RUN",
      reference: "finding-1",
      excerpt: "supporting evidence excerpt",
    },
  ];
}

/**
 * A single evidence entry with NO verification signal — a bare
 * USER-sourced assertion. Non-empty (so it clears "no_evidence"), but
 * should still fail the stricter evidence-*verified* gate on its own.
 */
function unverifiedEvidenceEntry(): MemoryEvidence[] {
  return [
    {
      id: crypto.randomUUID(),
      kind: "USER",
      reference: "conversation-1",
      excerpt: "someone said this is true",
    },
  ];
}

function memory(
  projectId: string | null,
  statement: string,
  ownerId: string = OWNER_A,
  allowedAgents: string[] | null = null,
  // Approval-gate tests need at least one evidence entry to reach CONFIRMED
  // (see "requires non-empty evidence" describe block below for the empty
  // case); default non-empty so the ownerId-scoping tests above continue to
  // exercise only what they intend — ownership, not evidence.
  evidence: MemoryEvidence[] = oneEvidenceEntry(),
) {
  const now = new Date().toISOString();
  return memorySchema.parse({
    id: crypto.randomUUID(),
    ownerId,
    type: "LESSON",
    projectId,
    statement,
    reason: ["test"],
    status: "ACTIVE",
    confidence: 0.7,
    category: "GENERATED_REASONING",
    epistemicState: "INFERRED",
    observationMode: "INFERRED",
    source: "test",
    sourceType: "SYSTEM",
    sourceId: null,
    evidence,
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "test",
    scope: projectId ? "PROJECT" : "GLOBAL",
    priority: "MEDIUM",
    allowedAgents,
  });
}

describe("retrieveMemories isolation", () => {
  beforeEach(() => {
    osStore.addMemory(memory(PROJECT_A, "secret from tenant A"));
    osStore.addMemory(memory(PROJECT_B, "secret from tenant B"));
    osStore.addMemory(memory(null, "platform-only global note"));
  });

  it("does not leak another project's memories when scoped", () => {
    const { items } = retrieveMemories({ projectId: PROJECT_A, budget: 20 });
    const statements = items.map((row) => row.statement);
    expect(statements).toContain("secret from tenant A");
    expect(statements).not.toContain("secret from tenant B");
    expect(statements).not.toContain("platform-only global note");
  });

  it("does not dump every project when unscoped", () => {
    const { items } = retrieveMemories({ budget: 20 });
    const statements = items.map((row) => row.statement);
    expect(statements).toContain("platform-only global note");
    expect(statements).not.toContain("secret from tenant A");
    expect(statements).not.toContain("secret from tenant B");
  });
});

describe("retrieveMemories ownerId scoping (P0 tenant-isolation fix)", () => {
  beforeEach(() => {
    osStore.addMemory(memory(null, "owner A's global note", OWNER_A));
    osStore.addMemory(memory(null, "owner B's global note", OWNER_B));
  });

  it("only returns the caller's own memories when ownerId is provided", () => {
    const { items } = retrieveMemories({ budget: 20, ownerId: OWNER_A });
    const statements = items.map((row) => row.statement);
    expect(statements).toContain("owner A's global note");
    expect(statements).not.toContain("owner B's global note");
  });

  it("returns every owner's memories when ownerId is omitted (trusted internal caller)", () => {
    const { items } = retrieveMemories({ budget: 20 });
    const statements = items.map((row) => row.statement);
    expect(statements).toContain("owner A's global note");
    expect(statements).toContain("owner B's global note");
  });
});

describe("approveMemory ownerId scoping (P0 tenant-isolation fix)", () => {
  it("returns { memory: null, reason: 'not_found' } when ownerId doesn't match the memory's owner", () => {
    const target = memory(null, "owner A's memory", OWNER_A);
    osStore.addMemory(target);

    const result = approveMemory({
      memoryId: target.id,
      projectId: null,
      ownerId: OWNER_B,
    });

    expect(result.memory).toBeNull();
    expect(result.reason).toBe("not_found");
  });

  it("returns { memory: null, reason: 'not_found' } for a memoryId that doesn't exist under that owner, same shape as truly-missing (no enumeration)", () => {
    const missingResult = approveMemory({
      memoryId: crypto.randomUUID(),
      projectId: null,
      ownerId: OWNER_A,
    });
    expect(missingResult.memory).toBeNull();
    expect(missingResult.reason).toBe("not_found");
  });

  it("approves the memory when ownerId matches and evidence is present, and stamps verifiedBy/verifiedAt", () => {
    const target = memory(null, "owner A's memory to approve", OWNER_A);
    osStore.addMemory(target);

    const before = Date.now();
    const result = approveMemory({
      memoryId: target.id,
      projectId: null,
      ownerId: OWNER_A,
    });
    const after = Date.now();

    expect(result.memory).not.toBeNull();
    expect(result.memory?.epistemicState).toBe("CONFIRMED");
    // Provenance trail (Gap 2): who approved it and when.
    expect(result.memory?.verifiedBy).toBe(OWNER_A);
    expect(result.memory?.verifiedAt).toBeTruthy();
    const verifiedAtMs = Date.parse(result.memory!.verifiedAt!);
    expect(verifiedAtMs).toBeGreaterThanOrEqual(before);
    expect(verifiedAtMs).toBeLessThanOrEqual(after);
  });

  it("does not delete another owner's memories under the same project key when a mismatched-owner approve is attempted", () => {
    const ownerAMemory = memory(null, "owner A's untouched memory", OWNER_A);
    const ownerBMemory = memory(null, "owner B's memory", OWNER_B);
    osStore.addMemory(ownerAMemory);
    osStore.addMemory(ownerBMemory);

    // Owner A tries (and fails) to approve owner B's memory.
    const result = approveMemory({
      memoryId: ownerBMemory.id,
      projectId: null,
      ownerId: OWNER_A,
    });
    expect(result.memory).toBeNull();
    expect(result.reason).toBe("not_found");

    // Both memories must still be present and unmodified — a naive
    // ownerId-filtered read-modify-write would have silently dropped
    // owner A's memory from the persisted "global" list.
    const all = osStore.getMemories("global");
    const ids = all.map((m) => m.id);
    expect(ids).toContain(ownerAMemory.id);
    expect(ids).toContain(ownerBMemory.id);
  });

  it("still allows approval when ownerId is omitted (trusted internal/admin caller)", () => {
    const target = memory(null, "some owner's memory", OWNER_B);
    osStore.addMemory(target);

    const result = approveMemory({
      memoryId: target.id,
      projectId: null,
    });

    expect(result.memory).not.toBeNull();
    expect(result.memory?.epistemicState).toBe("CONFIRMED");
    // No ownerId passed (trusted internal/admin caller) — verifiedBy falls
    // back to the memory's own prior value (null here), never fabricated.
    expect(result.memory?.verifiedBy ?? null).toBeNull();
  });
});

describe("approveMemory requires non-empty evidence (evidence-required gate)", () => {
  it("rejects promotion to CONFIRMED when evidence is an empty array", () => {
    const target = memory(
      null,
      "owner A's evidence-less memory",
      OWNER_A,
      null,
      [],
    );
    osStore.addMemory(target);

    const result = approveMemory({
      memoryId: target.id,
      projectId: null,
      ownerId: OWNER_A,
    });

    expect(result.memory).toBeNull();
    expect(result.reason).toBe("no_evidence");

    // Never reached CONFIRMED — still exactly as stored.
    const stored = osStore
      .getMemories("global")
      .find((m) => m.id === target.id);
    expect(stored?.epistemicState).not.toBe("CONFIRMED");
    expect(stored?.epistemicState).toBe("INFERRED");
    expect(stored?.verifiedBy ?? null).toBeNull();
    expect(stored?.verifiedAt ?? null).toBeNull();
  });

  it("approves when at least one evidence entry is present", () => {
    const target = memory(
      null,
      "owner A's evidenced memory",
      OWNER_A,
      null,
      oneEvidenceEntry(),
    );
    osStore.addMemory(target);

    const result = approveMemory({
      memoryId: target.id,
      projectId: null,
      ownerId: OWNER_A,
    });

    expect(result.memory).not.toBeNull();
    expect(result.memory?.epistemicState).toBe("CONFIRMED");
    expect(result.memory?.verifiedBy).toBe(OWNER_A);
    expect(result.memory?.verifiedAt).toBeTruthy();
  });
});

describe("approveMemory requires verified evidence (Gate 3 strengthening)", () => {
  it("rejects promotion to CONFIRMED when evidence is non-empty but none of it is verified", () => {
    const target = memory(
      null,
      "owner A's unverified-evidence memory",
      OWNER_A,
      null,
      unverifiedEvidenceEntry(),
    );
    osStore.addMemory(target);

    const result = approveMemory({
      memoryId: target.id,
      projectId: null,
      ownerId: OWNER_A,
    });

    expect(result.memory).toBeNull();
    expect(result.reason).toBe("unverified_evidence");

    // Never reached CONFIRMED — still exactly as stored.
    const stored = osStore
      .getMemories("global")
      .find((m) => m.id === target.id);
    expect(stored?.epistemicState).not.toBe("CONFIRMED");
    expect(stored?.epistemicState).toBe("INFERRED");
    expect(stored?.verifiedBy ?? null).toBeNull();
    expect(stored?.verifiedAt ?? null).toBeNull();
  });

  it("is distinguishable from 'no_evidence' — empty vs. non-empty-but-unverified are different reasons", () => {
    const emptyTarget = memory(
      null,
      "owner A's empty-evidence memory",
      OWNER_A,
      null,
      [],
    );
    const unverifiedTarget = memory(
      null,
      "owner A's unverified-only memory",
      OWNER_A,
      null,
      unverifiedEvidenceEntry(),
    );
    osStore.addMemory(emptyTarget);
    osStore.addMemory(unverifiedTarget);

    const emptyResult = approveMemory({
      memoryId: emptyTarget.id,
      projectId: null,
      ownerId: OWNER_A,
    });
    const unverifiedResult = approveMemory({
      memoryId: unverifiedTarget.id,
      projectId: null,
      ownerId: OWNER_A,
    });

    expect(emptyResult.reason).toBe("no_evidence");
    expect(unverifiedResult.reason).toBe("unverified_evidence");
    expect(emptyResult.reason).not.toBe(unverifiedResult.reason);
  });

  it("does not leak cross-tenant existence: a mismatched owner gets 'not_found', never 'unverified_evidence', even though the memory does exist with unverified evidence", () => {
    const target = memory(
      null,
      "owner A's memory with unverified evidence",
      OWNER_A,
      null,
      unverifiedEvidenceEntry(),
    );
    osStore.addMemory(target);

    const result = approveMemory({
      memoryId: target.id,
      projectId: null,
      ownerId: OWNER_B,
    });

    // The ownership check runs before the evidence gate (see doc comment
    // above `approveMemory()`), so a mismatched owner never learns anything
    // about whether the memory has evidence, verified or otherwise — same
    // no-enumeration guarantee the "not_found" reason already provides.
    expect(result.memory).toBeNull();
    expect(result.reason).toBe("not_found");
    expect(result.reason).not.toBe("unverified_evidence");
  });

  it("approves when at least one evidence entry is verified, even alongside unverified entries", () => {
    const target = memory(
      null,
      "owner A's mixed-evidence memory",
      OWNER_A,
      null,
      [...unverifiedEvidenceEntry(), ...oneEvidenceEntry()],
    );
    osStore.addMemory(target);

    const result = approveMemory({
      memoryId: target.id,
      projectId: null,
      ownerId: OWNER_A,
    });

    expect(result.memory).not.toBeNull();
    expect(result.memory?.epistemicState).toBe("CONFIRMED");
    expect(result.memory?.verifiedBy).toBe(OWNER_A);
    expect(result.memory?.verifiedAt).toBeTruthy();
  });
});

describe("resolveMemoryProvenance (evidence provenance chain)", () => {
  it("returns a complete, correctly-classified chain for a memory with mixed verified/unverified evidence", () => {
    const verified = oneEvidenceEntry()[0]!;
    const unverified = unverifiedEvidenceEntry()[0]!;
    const target = memory(
      null,
      "owner A's mixed-provenance memory",
      OWNER_A,
      null,
      [verified, unverified],
    );

    const provenance = resolveMemoryProvenance(target);

    expect(provenance.memoryId).toBe(target.id);
    expect(provenance.epistemicState).toBe(target.epistemicState);
    expect(provenance.evidenceCount).toBe(2);
    expect(provenance.verifiedEvidenceCount).toBe(1);
    expect(provenance.meetsApprovalEvidenceBar).toBe(true);
    expect(provenance.entries).toHaveLength(2);

    const verifiedEntry = provenance.entries.find(
      (e) => e.evidenceId === verified.id,
    );
    const unverifiedEntry = provenance.entries.find(
      (e) => e.evidenceId === unverified.id,
    );
    expect(verifiedEntry).toMatchObject({
      kind: "TEST_RUN",
      reference: verified.reference,
      excerpt: verified.excerpt,
      hasVerificationSignal: true,
    });
    expect(unverifiedEntry).toMatchObject({
      kind: "USER",
      reference: unverified.reference,
      excerpt: unverified.excerpt,
      hasVerificationSignal: false,
    });
  });

  it("reports meetsApprovalEvidenceBar: false and verifiedEvidenceCount: 0 when no evidence is verified", () => {
    const target = memory(
      null,
      "owner A's unverified-only provenance memory",
      OWNER_A,
      null,
      unverifiedEvidenceEntry(),
    );

    const provenance = resolveMemoryProvenance(target);

    expect(provenance.evidenceCount).toBe(1);
    expect(provenance.verifiedEvidenceCount).toBe(0);
    expect(provenance.meetsApprovalEvidenceBar).toBe(false);
  });

  it("returns an empty chain for a memory with no evidence at all", () => {
    const target = memory(
      null,
      "owner A's evidence-less provenance memory",
      OWNER_A,
      null,
      [],
    );

    const provenance = resolveMemoryProvenance(target);

    expect(provenance.evidenceCount).toBe(0);
    expect(provenance.verifiedEvidenceCount).toBe(0);
    expect(provenance.meetsApprovalEvidenceBar).toBe(false);
    expect(provenance.entries).toEqual([]);
  });
});

describe("retrieveMemories per-agent scoping (P1 fix)", () => {
  beforeEach(() => {
    osStore.addMemory(
      memory(null, "judge-only note", OWNER_A, ["JUDGE"]),
    );
    osStore.addMemory(memory(null, "open note, no allowedAgents", OWNER_A));
  });

  it("excludes an agent-scoped memory when the requesting agent is not in allowedAgents", () => {
    const { items } = retrieveMemories({
      budget: 20,
      requestingAgentId: "ORCHESTRATOR",
    });
    const statements = items.map((row) => row.statement);
    expect(statements).not.toContain("judge-only note");
  });

  it("includes an agent-scoped memory when the requesting agent is in allowedAgents", () => {
    const { items } = retrieveMemories({
      budget: 20,
      requestingAgentId: "JUDGE",
    });
    const statements = items.map((row) => row.statement);
    expect(statements).toContain("judge-only note");
  });

  it("includes an agent-scoped memory when no requestingAgentId is passed (backward-compat)", () => {
    const { items } = retrieveMemories({ budget: 20 });
    const statements = items.map((row) => row.statement);
    expect(statements).toContain("judge-only note");
  });

  it("a memory with no allowedAgents set is visible to any agent (default-open)", () => {
    const asOrchestrator = retrieveMemories({
      budget: 20,
      requestingAgentId: "ORCHESTRATOR",
    });
    const asJudge = retrieveMemories({ budget: 20, requestingAgentId: "JUDGE" });
    expect(
      asOrchestrator.items.map((row) => row.statement),
    ).toContain("open note, no allowedAgents");
    expect(asJudge.items.map((row) => row.statement)).toContain(
      "open note, no allowedAgents",
    );
  });
});

describe("seedPortfolioPatternMemories redacts secrets (Gap 3)", () => {
  it("redacts a fake AWS access key embedded in a QA pattern's title/summary before persisting the memory", () => {
    const fakeSecret = "AKIAIOSFODNN7EXAMPLE";
    const finding1 = crypto.randomUUID();
    const pattern: Pick<
      QaPortfolioPattern,
      | "id"
      | "patternKey"
      | "title"
      | "summary"
      | "projectIds"
      | "findingIds"
      | "epistemicState"
    > = {
      id: crypto.randomUUID(),
      patternKey: "leaked-credential-pattern",
      title: `Hardcoded credential ${fakeSecret} found in config`,
      summary: `Multiple projects hardcode the same key ${fakeSecret} in source.`,
      projectIds: [crypto.randomUUID(), crypto.randomUUID()],
      findingIds: [finding1],
      epistemicState: "INFERRED",
    };

    const seeded = seedPortfolioPatternMemories([pattern]);

    expect(seeded).toHaveLength(1);
    const memory = seeded[0]!;
    expect(memory.statement).not.toContain(fakeSecret);
    expect(memory.statement).toContain("[REDACTED_SECRET]");
    for (const evidence of memory.evidence) {
      expect(evidence.excerpt ?? "").not.toContain(fakeSecret);
    }

    // Also verify what actually landed in the store, not just the return
    // value.
    const stored = osStore
      .getMemories("global")
      .find((m) => m.id === memory.id);
    expect(stored?.statement).not.toContain(fakeSecret);
  });
});

describe("retrieveMemories semantic ranking (local hash-trick embeddings, @atlas/embeddings)", () => {
  it("surfaces a memory that shares no literal term with the query when it is embedding-closer than an equally non-substring-matching distractor", () => {
    // Neither statement below contains any literal word from the query
    // ("why did the deploy fail") — the pre-existing substring bonus (see
    // `retrieveMemories()`) can't fire for either one, so with budget: 1 the
    // only thing that can break the tie is the new semantic-similarity term.
    osStore.addMemory(
      memory(
        PROJECT_SEMANTIC,
        "production build broke due to missing env var",
      ),
    );
    osStore.addMemory(
      memory(
        PROJECT_SEMANTIC,
        "quarterly revenue exceeded expectations this year",
      ),
    );

    const { items } = retrieveMemories({
      projectId: PROJECT_SEMANTIC,
      budget: 1,
      query: "why did the deploy fail",
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.statement).toBe(
      "production build broke due to missing env var",
    );
  });

  it("still ranks a literal substring match first (no regression from the pre-existing exact/substring behavior)", () => {
    // Regression guard for the *existing* behavior this task must not
    // replace: a memory whose statement literally contains the query phrase
    // keeps winning, semantic layer or not.
    osStore.addMemory(
      memory(
        PROJECT_SEMANTIC,
        "webhook idempotency keys must be enforced on retries",
      ),
    );
    osStore.addMemory(
      memory(
        PROJECT_SEMANTIC,
        "the database index needed a rebuild after migration",
      ),
    );

    const { items } = retrieveMemories({
      projectId: PROJECT_SEMANTIC,
      budget: 1,
      query: "webhook idempotency",
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.statement).toBe(
      "webhook idempotency keys must be enforced on retries",
    );
  });

  it("never scores a query-dissimilar memory below its query-less baseline (additive-only, matches every other term in this function)", () => {
    // Same memory, scored with and without a query that has nothing to do
    // with it — the semantic term must never make its score *worse* than the
    // query-less baseline (it's clamped non-negative, see doc comment on
    // `retrieveMemories()`).
    osStore.addMemory(
      memory(PROJECT_SEMANTIC, "the coffee machine on floor 3 is broken"),
    );

    const withoutQuery = retrieveMemories({
      projectId: PROJECT_SEMANTIC,
      budget: 20,
    });
    const withUnrelatedQuery = retrieveMemories({
      projectId: PROJECT_SEMANTIC,
      budget: 20,
      query: "annual tax filing deadline extension",
    });

    const baseline = withoutQuery.items.find(
      (m) => m.statement === "the coffee machine on floor 3 is broken",
    );
    const withQuery = withUnrelatedQuery.items.find(
      (m) => m.statement === "the coffee machine on floor 3 is broken",
    );
    expect(baseline).toBeDefined();
    expect(withQuery).toBeDefined();
  });

  it("does not change epistemic-state/evidence-tagging output shape when a query is supplied", () => {
    // buildMemoryContext()/toMemoryContextItem() must stay exactly as they
    // were — semantic ranking only changes *which* memories surface and in
    // what order, never the evidence-tagged shape or MEMORY_CONTEXT_NOTE.
    osStore.addMemory(
      memory(
        PROJECT_SEMANTIC,
        "production build broke due to missing env var",
      ),
    );

    const payload = buildMemoryContext({
      projectId: PROJECT_SEMANTIC,
      query: "why did the deploy fail",
      budget: 5,
    });

    expect(payload.note).toBe(
      "Memories are evidence-tagged by epistemicState — do not silently merge as FACT.",
    );
    expect(payload.epistemicState).toBe("INFERRED");
    expect(payload.items.length).toBeGreaterThan(0);
    for (const item of payload.items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          "category",
          "confidence",
          "epistemicState",
          "evidence",
          "id",
          "priority",
          "projectId",
          "scope",
          "source",
          "statement",
          "type",
        ].sort(),
      );
    }
  });
});

describe("P0.5 — retrieval honours the memory validity window", () => {
  const PROJECT_WINDOW = "55555555-5555-4555-8555-555555555555";

  /** Reuses this file's `memory()` fixture, overriding only the window. */
  function windowed(statement: string, overrides: Record<string, unknown>) {
    return memorySchema.parse({
      ...memory(PROJECT_WINDOW, statement),
      ...overrides,
    });
  }

  it("EXCLUDES an ACTIVE memory whose validity window has already closed", () => {
    // Status and validity answer different questions: status is "has someone
    // retired this?", validity is "does this apply right now?". An un-retired
    // memory can still have stopped applying, and must not reach the LLM as
    // current truth.
    const expired = windowed("the deploy key rotated last month", {
      validUntil: new Date(Date.now() - 60_000).toISOString(),
    });
    osStore.addMemory(expired);

    const { items } = retrieveMemories({ projectId: PROJECT_WINDOW, budget: 20 });
    expect(items.some((m) => m.id === expired.id)).toBe(false);
  });

  it("EXCLUDES a memory whose validity has not started yet", () => {
    const future = windowed("next quarter's policy", {
      validFrom: new Date(Date.now() + 60_000).toISOString(),
    });
    osStore.addMemory(future);

    const { items } = retrieveMemories({ projectId: PROJECT_WINDOW, budget: 20 });
    expect(items.some((m) => m.id === future.id)).toBe(false);
  });

  it("INCLUDES a memory currently inside its window", () => {
    const current = windowed("currently applicable fact", {
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      validUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    osStore.addMemory(current);

    const { items } = retrieveMemories({ projectId: PROJECT_WINDOW, budget: 20 });
    expect(items.some((m) => m.id === current.id)).toBe(true);
  });

  it("INCLUDES a memory with an open-ended window (validUntil null)", () => {
    const unbounded = windowed("standing architectural rule", { validUntil: null });
    osStore.addMemory(unbounded);

    const { items } = retrieveMemories({ projectId: PROJECT_WINDOW, budget: 20 });
    expect(items.some((m) => m.id === unbounded.id)).toBe(true);
  });
});
