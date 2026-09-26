import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memorySchema, type Memory, type ProjectStateSnapshot } from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import {
  WITHHELD_SNAPSHOT_SUMMARY,
  assistantRunIdentity,
  authorizeSnapshotForAgentContext,
} from "./agent-context-authorization.js";

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT = "11111111-1111-4111-8111-111111111111";

function memory(input: {
  ownerId: string;
  statement: string;
  type?: Memory["type"];
  projectId?: string | null;
  allowedAgents?: string[] | null;
}): Memory {
  const now = new Date().toISOString();
  return memorySchema.parse({
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    type: input.type ?? "TASK",
    projectId: input.projectId === undefined ? PROJECT : input.projectId,
    statement: input.statement,
    reason: ["test"],
    status: "ACTIVE",
    confidence: 0.7,
    category: "GENERATED_REASONING",
    epistemicState: "OBSERVED",
    observationMode: "OBSERVED",
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
    scope: "PROJECT",
    priority: "MEDIUM",
    allowedAgents: input.allowedAgents ?? null,
  });
}

function snapshot(slices: Array<{ key: string; summary: string }>): ProjectStateSnapshot {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    projectId: PROJECT,
    asOf: now,
    reconciledAt: now,
    slices: slices.map((slice) => ({
      key: slice.key as ProjectStateSnapshot["slices"][number]["key"],
      summary: slice.summary,
      epistemicState: "INFERRED",
      confidence: 0.5,
      evidenceIds: [],
      claimIds: [],
      asOf: now,
      validUntil: null,
      stale: false,
    })),
    conflicts: [],
    overallEpistemicState: "INFERRED",
    sourceConnectors: ["github"],
  };
}

describe("assistantRunIdentity (Stage 4 D-A)", () => {
  it("derives psa:<session owner> as the acting identity", () => {
    expect(assistantRunIdentity(OWNER_A)).toEqual({
      agentId: `psa:${OWNER_A}`,
      actorKind: "AGENT",
      onBehalfOfUserId: OWNER_A,
      ownerId: OWNER_A,
    });
  });

  it("refuses to build an identity without an authenticated session owner", () => {
    expect(() => assistantRunIdentity("")).toThrow();
    expect(() => assistantRunIdentity("   ")).toThrow();
  });
});

describe("authorizeSnapshotForAgentContext (Stage 4 snapshot bypass fix)", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;
  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    osStore.resetInMemoryForTests();
  });
  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
  });

  it("keeps non-memory content and authorized memory statements, withholds restricted and foreign ones", () => {
    osStore.addMemory(memory({ ownerId: OWNER_A, statement: "a-allowed-task" }));
    osStore.addMemory(memory({ ownerId: OWNER_A, statement: "a-judge-only-task", allowedAgents: ["JUDGE"] }));
    osStore.addMemory(memory({ ownerId: OWNER_B, statement: "b-foreign-bug", type: "BUG" }));
    const input = snapshot([
      { key: "TASKS", summary: "connector-task · a-allowed-task · a-judge-only-task" },
      { key: "RISKS", summary: "known-risk · b-foreign-bug" },
      { key: "DATABASE", summary: "db summary a-judge-only-task" },
    ]);
    const out = authorizeSnapshotForAgentContext(input, `psa:${OWNER_A}`);
    expect(out?.slices[0]?.summary).toBe("connector-task · a-allowed-task");
    expect(out?.slices[1]?.summary).toBe("known-risk");
    // Only memory-derived slices are filtered; others are untouched.
    expect(out?.slices[2]?.summary).toBe("db summary a-judge-only-task");
    // The input snapshot is not mutated.
    expect(input.slices[0]?.summary).toContain("a-judge-only-task");
  });

  it("replaces a slice that would become empty with an explicit withheld marker", () => {
    osStore.addMemory(memory({ ownerId: OWNER_B, statement: "b-only-task" }));
    const out = authorizeSnapshotForAgentContext(
      snapshot([{ key: "TASKS", summary: "b-only-task" }]),
      `psa:${OWNER_A}`,
    );
    expect(out?.slices[0]?.summary).toBe(WITHHELD_SNAPSHOT_SUMMARY);
  });

  it("withholds every memory-derived statement for an identity that may not read memory", () => {
    osStore.addMemory(memory({ ownerId: OWNER_A, statement: "a-task" }));
    for (const agentId of ["CODE_ENGINEER", "legacy-plugin", "", `psa:${OWNER_B}`]) {
      const out = authorizeSnapshotForAgentContext(
        snapshot([{ key: "TASKS", summary: "connector-task · a-task" }]),
        agentId,
      );
      expect(out?.slices[0]?.summary).toBe("connector-task");
    }
  });

  it("returns null for a missing snapshot", () => {
    expect(authorizeSnapshotForAgentContext(null, `psa:${OWNER_A}`)).toBeNull();
  });
});
