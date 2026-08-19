import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  memorySchema,
  type MemoryEvidence,
  type QaPortfolioPattern,
} from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import {
  approveMemory,
  retrieveMemories,
  seedPortfolioPatternMemories,
} from "./memory-pipeline.js";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** A single non-empty evidence entry — satisfies the evidence-required gate. */
function oneEvidenceEntry(): MemoryEvidence[] {
  return [
    {
      id: crypto.randomUUID(),
      kind: "qa_finding",
      reference: "finding-1",
      excerpt: "supporting evidence excerpt",
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
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    osStore.addMemory(memory(PROJECT_A, "secret from tenant A"));
    osStore.addMemory(memory(PROJECT_B, "secret from tenant B"));
    osStore.addMemory(memory(null, "platform-only global note"));
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
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
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    osStore.addMemory(memory(null, "owner A's global note", OWNER_A));
    osStore.addMemory(memory(null, "owner B's global note", OWNER_B));
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
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
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
  });

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
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
  });

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

describe("retrieveMemories per-agent scoping (P1 fix)", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    osStore.addMemory(
      memory(null, "judge-only note", OWNER_A, ["JUDGE"]),
    );
    osStore.addMemory(memory(null, "open note, no allowedAgents", OWNER_A));
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
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
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;
  const prevSkipDispatch = process.env.ATLAS_SKIP_EVENT_DISPATCH;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
    if (prevSkipDispatch === undefined) {
      delete process.env.ATLAS_SKIP_EVENT_DISPATCH;
    } else {
      process.env.ATLAS_SKIP_EVENT_DISPATCH = prevSkipDispatch;
    }
  });

  it("redacts a fake AWS access key embedded in a QA pattern's title/summary before persisting the memory", () => {
    const now = new Date().toISOString();
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
