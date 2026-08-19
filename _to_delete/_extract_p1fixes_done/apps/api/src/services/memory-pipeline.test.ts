import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { memorySchema } from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { retrieveMemories } from "./memory-pipeline.js";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function memory(
  projectId: string | null,
  statement: string,
  ownerId: string = OWNER_A,
  allowedAgents: string[] | null = null,
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
    evidence: [],
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
