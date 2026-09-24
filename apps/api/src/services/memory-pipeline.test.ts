import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { controlProfileTestFixture } from "@atlas/shared";
import {
  memorySchema,
  type MemoryEvidence,
  type QaPortfolioPattern,
} from "@atlas/shared";
import { DeterministicConceptEmbeddingProvider } from "@atlas/embeddings";
import { osStore } from "../store/os-store.js";
import {
  approveMemory,
  retrieveMemories,
  seedPortfolioPatternMemories,
  commitMemory,
  eraseOwnedMemory,
  expireDueMemories,
  findOwnedMemory,
  setOwnedMemoryTtl,
  supersedeMemoryById,
  toMemoryCitations,
  MEMORY_AGENT_VISIBILITY_CONTRACT,
  MEMORY_DURABILITY_CONTRACT,
  memoryIsVisibleToAgent,
  memoryVisibleForControlProfile,
} from "./memory-pipeline.js";
import { listUnifiedAuditEntries, setAuditLogPathForTests } from "./audit-log.js";

process.env.ATLAS_SKIP_AUDIT_LOG = "1";

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
    osStore.resetInMemoryForTests();
    osStore.addMemory(memory(PROJECT_A, "secret from tenant A"));
    osStore.addMemory(memory(PROJECT_B, "secret from tenant B"));
    osStore.addMemory(memory(null, "platform-only global note"));
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
  });

  it("does not leak another project's memories when scoped", async () => {
    const { items } = await retrieveMemories({ projectId: PROJECT_A, budget: 20 });
    const statements = items.map((row) => row.statement);
    expect(statements).toContain("secret from tenant A");
    expect(statements).not.toContain("secret from tenant B");
    expect(statements).not.toContain("platform-only global note");
  });

  it("does not dump every project when unscoped", async () => {
    const { items } = await retrieveMemories({ budget: 20 });
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
    osStore.resetInMemoryForTests();
    osStore.addMemory(memory(null, "owner A's global note", OWNER_A));
    osStore.addMemory(memory(null, "owner B's global note", OWNER_B));
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
  });

  it("only returns the caller's own memories when ownerId is provided", async () => {
    const { items } = await retrieveMemories({ budget: 20, ownerId: OWNER_A });
    const statements = items.map((row) => row.statement);
    expect(statements).toContain("owner A's global note");
    expect(statements).not.toContain("owner B's global note");
  });

  it("returns every owner's memories when ownerId is omitted (trusted internal caller)", async () => {
    const { items } = await retrieveMemories({ budget: 20 });
    const statements = items.map((row) => row.statement);
    expect(statements).toContain("owner A's global note");
    expect(statements).toContain("owner B's global note");
  });
});

describe("approveMemory ownerId scoping (P0 tenant-isolation fix)", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    osStore.resetInMemoryForTests();
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
    osStore.resetInMemoryForTests();
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
    osStore.resetInMemoryForTests();
    osStore.addMemory(
      memory(null, "judge-only note", OWNER_A, ["JUDGE"]),
    );
    osStore.addMemory(memory(null, "open note, no allowedAgents", OWNER_A));
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
  });

  it("excludes an agent-scoped memory when the requesting agent is not in allowedAgents", async () => {
    const { items } = await retrieveMemories({
      budget: 20,
      requestingAgentId: "ORCHESTRATOR",
    });
    const statements = items.map((row) => row.statement);
    expect(statements).not.toContain("judge-only note");
  });

  it("includes an agent-scoped memory when an unprofiled requesting agent is in allowedAgents", async () => {
    osStore.addMemory(
      memory(null, "plugin-only note", OWNER_A, ["legacy-plugin"]),
    );
    const { items } = await retrieveMemories({
      budget: 20,
      requestingAgentId: "legacy-plugin",
    });
    const statements = items.map((row) => row.statement);
    expect(statements).toContain("plugin-only note");
    expect(statements).not.toContain("judge-only note");
  });

  it("denies a professional Control agent personal memory even when it is listed in allowedAgents", async () => {
    const { items } = await retrieveMemories({
      budget: 20,
      requestingAgentId: "JUDGE",
    });
    const statements = items.map((row) => row.statement);
    expect(statements).not.toContain("judge-only note");
    expect(statements).not.toContain("open note, no allowedAgents");
  });

  it("includes an agent-scoped memory when no requestingAgentId is passed (backward-compat)", async () => {
    const { items } = await retrieveMemories({ budget: 20 });
    const statements = items.map((row) => row.statement);
    expect(statements).toContain("judge-only note");
  });

  it("a memory with no allowedAgents stays open for an unprofiled agent and closed for a professional Control agent", async () => {
    const asLegacy = await retrieveMemories({
      budget: 20,
      requestingAgentId: "legacy-plugin",
    });
    const asOrchestrator = await retrieveMemories({
      budget: 20,
      requestingAgentId: "ORCHESTRATOR",
    });
    const asPsa = await retrieveMemories({
      budget: 20,
      requestingAgentId: `psa:${OWNER_A}`,
    });
    expect(asLegacy.items.map((row) => row.statement)).toContain(
      "open note, no allowedAgents",
    );
    expect(asOrchestrator.items.map((row) => row.statement)).not.toContain(
      "open note, no allowedAgents",
    );
    expect(asPsa.items.map((row) => row.statement)).toContain(
      "open note, no allowedAgents",
    );
  });

  it("locks the allowedAgents contract: empty is default-open for unprofiled ids, omit-requester stays human-visible", () => {
    expect(MEMORY_AGENT_VISIBILITY_CONTRACT.emptyAllowedAgents).toBe(
      "default-open",
    );
    expect(MEMORY_AGENT_VISIBILITY_CONTRACT.omitRequesterId).toBe(
      "human-surface-visible",
    );
    const open = memory(null, "open", OWNER_A, []);
    const restricted = memory(null, "restricted", OWNER_A, ["JUDGE"]);
    const pluginOnly = memory(null, "plugin", OWNER_A, ["legacy-plugin"]);
    expect(memoryIsVisibleToAgent(open, "legacy-plugin")).toBe(true);
    expect(memoryIsVisibleToAgent(open, "ORCHESTRATOR")).toBe(false);
    expect(memoryIsVisibleToAgent(restricted, "ORCHESTRATOR")).toBe(false);
    expect(memoryIsVisibleToAgent(restricted, "JUDGE")).toBe(false);
    expect(memoryIsVisibleToAgent(pluginOnly, "legacy-plugin")).toBe(true);
    expect(memoryIsVisibleToAgent(pluginOnly, "other-plugin")).toBe(false);
    expect(memoryIsVisibleToAgent(restricted)).toBe(true);
  });

  it("locks durable memory SoR: RAM is cache; persist file is local SoR; cloud is dual-write", () => {
    expect(MEMORY_DURABILITY_CONTRACT.ramIsSoR).toBe(false);
    expect(MEMORY_DURABILITY_CONTRACT.localPersist).toBe(
      "osStore.persist store.json",
    );
    expect(MEMORY_DURABILITY_CONTRACT.cloudDualWrite).toBe(
      "commitMemory → tryPersistMemoryToSupabase when env is live",
    );
    expect(MEMORY_DURABILITY_CONTRACT.localOnlyByDesign).toBe(
      "tests, demo-seed, qa portfolio pattern seed",
    );
  });

  it("commitMemory always writes locally and does not throw when cloud is unavailable", async () => {
    const row = memory(PROJECT_A, "durable dual-write candidate", OWNER_A);
    const result = await commitMemory({
      memory: row,
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "replace-me",
      },
    });
    expect(result.cloudSynced).toBe(false);
    expect(osStore.getMemories(PROJECT_A, OWNER_A).some((m) => m.id === row.id)).toBe(
      true,
    );
  });

  it("commitMemory requireCloudSuccess fails closed when cloud is not configured", async () => {
    const row = memory(PROJECT_A, "require cloud", OWNER_A);
    await expect(
      commitMemory({
        memory: row,
        env: {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_ANON_KEY: "anon-key",
          SUPABASE_SERVICE_ROLE_KEY: "replace-me",
        },
        requireCloudSuccess: true,
      }),
    ).rejects.toThrow(/Cloud database is not configured/);
    expect(osStore.getMemories(PROJECT_A, OWNER_A).some((m) => m.id === row.id)).toBe(
      true,
    );
  });

  it("includes an agent-scoped memory when any unprofiled requestingAgentIds candidate is allowed", async () => {
    osStore.addMemory(
      memory(null, "plugin-only note", OWNER_A, ["legacy-plugin"]),
    );
    const { items } = await retrieveMemories({
      budget: 20,
      requestingAgentIds: ["ORCHESTRATOR", "legacy-plugin"],
    });
    expect(items.map((row) => row.statement)).toContain("plugin-only note");
    expect(items.map((row) => row.statement)).not.toContain("judge-only note");
  });

  it("excludes an agent-scoped memory when no requestingAgentIds candidate is allowed", async () => {
    const { items } = await retrieveMemories({
      budget: 20,
      requestingAgentIds: ["ORCHESTRATOR", "SECURITY"],
    });
    expect(items.map((row) => row.statement)).not.toContain("judge-only note");
  });

  it("unions requestingAgentId with requestingAgentIds (OR) for unprofiled ids", async () => {
    osStore.addMemory(
      memory(null, "plugin-only note", OWNER_A, ["legacy-plugin"]),
    );
    const { items } = await retrieveMemories({
      budget: 20,
      requestingAgentId: "ORCHESTRATOR",
      requestingAgentIds: ["legacy-plugin"],
    });
    expect(items.map((row) => row.statement)).toContain("plugin-only note");
    expect(items.map((row) => row.statement)).not.toContain("judge-only note");
  });
});

describe("control profile memory enforcement", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    osStore.resetInMemoryForTests();
    osStore.addMemory(memory(null, "owner A personal", OWNER_A));
    osStore.addMemory(memory(null, "owner B personal", OWNER_B));
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
  });

  it("denies professional-only read, write, and persist", async () => {
    const { items } = await retrieveMemories({
      ownerId: OWNER_A,
      budget: 20,
      requestingAgentId: "CODE_ENGINEER",
    });
    expect(items.map((row) => row.statement)).not.toContain("owner A personal");
    const row = memory(null, "engineer write", OWNER_A);
    const result = await commitMemory({ memory: row, controlAgentId: "CODE_ENGINEER" });
    expect(result.persisted).toBe(false);
    expect(osStore.getMemories("global", OWNER_A).some((item) => item.id === row.id)).toBe(
      false,
    );
  });

  it("lets a PSA identity read the owner's personal memory and blocks write and persist", async () => {
    const { items } = await retrieveMemories({
      ownerId: OWNER_A,
      budget: 20,
      requestingAgentId: `psa:${OWNER_A}`,
    });
    expect(items.map((row) => row.statement)).toContain("owner A personal");
    const row = memory(null, "psa write", OWNER_A);
    const result = await commitMemory({
      memory: row,
      controlAgentId: `psa:${OWNER_A}`,
    });
    expect(result.persisted).toBe(false);
    expect(osStore.getMemories("global", OWNER_A).some((item) => item.id === row.id)).toBe(
      false,
    );
  });

  it("keeps owner isolation ahead of a personal-scoped agent", async () => {
    const { items } = await retrieveMemories({
      ownerId: OWNER_B,
      budget: 20,
      requestingAgentId: `psa:${OWNER_A}`,
    });
    expect(items.map((row) => row.statement)).toContain("owner B personal");
    expect(items.map((row) => row.statement)).not.toContain("owner A personal");
  });

  it("denies NOT_PROVEN application identity personal memory", async () => {
    const { items } = await retrieveMemories({
      ownerId: OWNER_A,
      budget: 20,
      requestingAgentId: "agent.cio",
    });
    expect(items).toEqual([]);
  });

  it("still persists a human write that does not name a Control agent", async () => {
    const row = memory(null, "human write", OWNER_A);
    const result = await commitMemory({ memory: row });
    expect(result.persisted).toBe(true);
    expect(osStore.getMemories("global", OWNER_A).some((item) => item.id === row.id)).toBe(
      true,
    );
  });

  it("admits one both-scope test fixture through the shared read gate", () => {
    const profile = controlProfileTestFixture();
    const row = memory(null, "owner A personal", OWNER_A);
    expect(memoryVisibleForControlProfile(row, profile)).toBe(true);
    expect(profile.agentId).toBe("test.personal-professional");
    expect(profile.personalScope && profile.professionalScope).toBe(true);
  });
});

describe("retrieveMemories semantic ranking (B2)", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;
  const concept = new DeterministicConceptEmbeddingProvider();

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    osStore.resetInMemoryForTests();
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
  });

  it("ranks synonym-related text above unrelated text with an injected embedding function", async () => {
    osStore.addMemory(memory(null, "authentication flow throws an exception"));
    osStore.addMemory(memory(null, "weather forecast for the weekend"));

    const { items, embeddingKind } = await retrieveMemories({
      budget: 20,
      query: "user login is broken",
      embeddingProvider: concept,
    });

    expect(embeddingKind).toBe("semantic");
    expect(items.map((row) => row.statement)[0]).toBe(
      "authentication flow throws an exception",
    );
    expect(items.map((row) => row.statement)).toContain(
      "weather forecast for the weekend",
    );
  });

  it("still excludes a semantically closer memory when the requesting agent is denied", async () => {
    osStore.addMemory(
      memory(null, "authentication flow throws an exception", OWNER_A, ["JUDGE"]),
    );
    osStore.addMemory(memory(null, "weather forecast for the weekend"));

    const { items } = await retrieveMemories({
      budget: 20,
      query: "user login is broken",
      requestingAgentId: "legacy-plugin",
      embeddingProvider: concept,
    });
    const statements = items.map((row) => row.statement);
    expect(statements).not.toContain("authentication flow throws an exception");
    expect(statements).toContain("weather forecast for the weekend");
  });

  it("labels hash-trick fallback as lexical-hash, not semantic", async () => {
    osStore.addMemory(memory(null, "webhook idempotency keys"));
    const { embeddingKind } = await retrieveMemories({
      budget: 20,
      query: "webhook idempotency",
      embeddingEnv: {},
    });
    expect(embeddingKind).toBe("lexical-hash");
  });
});

describe("seedPortfolioPatternMemories redacts secrets (Gap 3)", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;
  const prevSkipDispatch = process.env.ATLAS_SKIP_EVENT_DISPATCH;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    osStore.resetInMemoryForTests();
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

describe("supersedeMemoryById", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    osStore.resetInMemoryForTests();
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
  });

  it("marks only the owned row SUPERSEDED and leaves the statement on disk", () => {
    const original = memory(null, "old preference", OWNER_A);
    osStore.addMemory(original);
    osStore.addMemory(memory(null, "unrelated", OWNER_A));
    const newerId = crypto.randomUUID();
    expect(
      supersedeMemoryById({
        memoryId: original.id,
        newerMemoryId: newerId,
        ownerId: OWNER_A,
      }),
    ).toBe(true);
    const stored = osStore.getMemories("global").find((row) => row.id === original.id);
    expect(stored?.status).toBe("SUPERSEDED");
    expect(stored?.supersededBy).toBe(newerId);
    expect(stored?.statement).toBe("old preference");
    expect(
      osStore.getMemories("global").find((row) => row.statement === "unrelated")?.status,
    ).toBe("ACTIVE");
  });

  it("does not supersede another tenant's memory", () => {
    const foreign = memory(null, "foreign note", OWNER_B);
    osStore.addMemory(foreign);
    expect(
      supersedeMemoryById({
        memoryId: foreign.id,
        newerMemoryId: crypto.randomUUID(),
        ownerId: OWNER_A,
      }),
    ).toBe(false);
    expect(findOwnedMemory({ memoryId: foreign.id, ownerId: OWNER_A })).toBeNull();
    expect(osStore.getMemories("global").find((row) => row.id === foreign.id)?.status).toBe(
      "ACTIVE",
    );
  });
});

describe("toMemoryCitations", () => {
  it("caps citations and truncates statements without copying evidence", () => {
    const citations = toMemoryCitations([
      {
        id: "11111111-1111-4111-8111-111111111111",
        type: "LESSON",
        epistemicState: "CONFIRMED",
        category: "DECISION_MEMORY",
        source: "studio",
        statement: "x".repeat(300),
      },
    ]);
    expect(citations).toHaveLength(1);
    expect(citations[0]?.statement).toHaveLength(240);
    expect(citations[0]).not.toHaveProperty("evidence");
    expect(toMemoryCitations([])).toEqual([]);
  });
});

describe("R10 expire / erase", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    osStore.resetInMemoryForTests();
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
  });

  it("expires an ACTIVE memory whose validUntil has passed", async () => {
    const row = memory(PROJECT_A, "expired lesson");
    osStore.addMemory({
      ...row,
      validUntil: new Date(Date.now() - 5_000).toISOString(),
    });
    expect(expireDueMemories()).toBe(1);
    const { items } = await retrieveMemories({
      projectId: PROJECT_A,
      budget: 20,
    });
    expect(items.map((item) => item.statement)).not.toContain("expired lesson");
  });

  it("erases only the owned row", () => {
    osStore.addMemory(memory(PROJECT_A, "keep me", OWNER_A));
    osStore.addMemory(memory(PROJECT_A, "erase me", OWNER_B));
    const target = osStore
      .getMemories(PROJECT_A)
      .find((row) => row.statement === "erase me")!;
    const denied = eraseOwnedMemory({
      memoryId: target.id,
      ownerId: OWNER_A,
    });
    expect(denied.ok).toBe(false);
    const erased = eraseOwnedMemory({
      memoryId: target.id,
      ownerId: OWNER_B,
    });
    expect(erased.ok).toBe(true);
    if (erased.ok) {
      expect(erased.memory.statement).toBe("[erased]");
      expect(erased.memory.status).toBe("SUPERSEDED");
    }
  });

  it("sets TTL on an owned memory", () => {
    const row = memory(PROJECT_A, "ttl target", OWNER_A);
    osStore.addMemory(row);
    const until = new Date(Date.now() + 60_000).toISOString();
    const updated = setOwnedMemoryTtl({
      memoryId: row.id,
      ownerId: OWNER_A,
      validUntil: until,
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.memory.validUntil).toBe(until);
  });
});

describe("governed memory attribution", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;
  const auditDir = mkdtempSync(join(tmpdir(), "atlas-memory-attr-"));

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    setAuditLogPathForTests(join(auditDir, `audit-${Date.now()}-${Math.random()}.ndjson`));
    osStore.resetInMemoryForTests();
    osStore.addMemory(memory(null, "owner A personal", OWNER_A));
  });

  afterEach(() => {
    process.env.ATLAS_SKIP_AUDIT_LOG = "1";
    setAuditLogPathForTests(null);
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
  });

  it("attributes a governed read and a denied persist without substituting owner or supervisor", async () => {
    await retrieveMemories({
      ownerId: OWNER_A,
      budget: 5,
      requestingAgentId: "CODE_ENGINEER",
    });
    await retrieveMemories({
      ownerId: OWNER_A,
      budget: 5,
      requestingAgentId: `psa:${OWNER_A}`,
    });
    const row = memory(null, "denied persist", OWNER_A);
    const denied = await commitMemory({ memory: row, controlAgentId: "CODE_ENGINEER" });
    expect(denied.persisted).toBe(false);
    await retrieveMemories({
      ownerId: OWNER_A,
      budget: 5,
      requestingAgentId: "legacy-plugin",
    });

    const entries = listUnifiedAuditEntries().filter((entry) => entry.type === "memory.governance");
    const engineer = entries.find((entry) => entry.agentId === "CODE_ENGINEER" && entry.action === "READ");
    const psa = entries.find((entry) => entry.agentId === "PERSONAL_SUPERVISING_AGENT");
    const persist = entries.find(
      (entry) => entry.agentId === "CODE_ENGINEER" && entry.input.operation === "persist",
    );
    expect(engineer?.ownerId).toBe(OWNER_A);
    expect(engineer?.agentId).not.toBe(engineer?.ownerId);
    expect(engineer?.input.applicationId).toBe("def-000");
    expect(engineer?.input.applicationId).not.toBe(engineer?.agentId);
    expect(engineer?.input.supervisorAgentId).toBeNull();
    expect(engineer?.decision).toBe("DENY");
    expect(engineer?.approval).toBe("NOT_REQUIRED");
    expect(engineer?.verificationVerdict).toBe("NOT_APPLICABLE");
    expect(engineer?.model).toBeNull();
    expect(psa?.agentId).not.toBe(engineer?.agentId);
    expect(psa?.decision).toBe("ALLOW");
    expect(psa?.input.supervisorType).toBe("HUMAN");
    expect(psa?.input.supervisorAgentId).toBeNull();
    expect(persist?.decision).toBe("DENY");
    expect(persist?.ownerId).toBe(OWNER_A);
    expect(entries.some((entry) => entry.agentId === "legacy-plugin")).toBe(false);
  });
});
