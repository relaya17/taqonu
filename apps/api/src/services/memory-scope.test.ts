import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-memory-scope-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

const { countOwnedMemoriesBySource } = await import("./memory-scope.js");
const { osStore } = await import("../store/os-store.js");

const OWNER_A = "22222222-2222-4222-8222-222222222222";
const OWNER_B = "33333333-3333-4333-8333-333333333333";
const UNRELATED_OWNER = "44444444-4444-4444-8444-444444444444";

function makeProject(): string {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  osStore.upsertProject({
    id,
    slug: `proj-${id.slice(0, 8)}`,
    name: "Test Project",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function seedMemory(input: {
  ownerId: string;
  source: string;
  projectId: string | null;
}) {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  osStore.addMemory({
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    type: "LESSON",
    projectId: input.projectId,
    statement: `seed memory for ${input.ownerId}`,
    reason: ["seed"],
    status: "ACTIVE",
    confidence: 0.7,
    category: "GENERATED_REASONING",
    epistemicState: "INFERRED",
    observationMode: "INFERRED",
    source: input.source,
    sourceType: "SYSTEM",
    sourceId: null,
    evidence: [],
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "seed",
    scope: input.projectId ? "PROJECT" : "GLOBAL",
    priority: "MEDIUM",
  });
}

let projectA: string;
let projectB: string;

beforeAll(() => {
  projectA = makeProject();
  projectB = makeProject();

  seedMemory({ ownerId: OWNER_A, source: "arletos-agent", projectId: projectA });
  seedMemory({ ownerId: OWNER_A, source: "arletos-agent", projectId: null });
  seedMemory({ ownerId: OWNER_A, source: "conversation", projectId: projectA });
  seedMemory({ ownerId: OWNER_B, source: "arletos-agent", projectId: projectB });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("countOwnedMemoriesBySource — Defect #2 canonical primitive", () => {
  it("counts only the given owner's matching-source memories across every project + global", () => {
    const count = countOwnedMemoriesBySource({
      ownerId: OWNER_A,
      source: "arletos-agent",
    });
    expect(count).toBe(2);
  });

  it("never includes another owner's memories, even in a shared project bucket", () => {
    const countA = countOwnedMemoriesBySource({
      ownerId: OWNER_A,
      source: "arletos-agent",
    });
    const countB = countOwnedMemoriesBySource({
      ownerId: OWNER_B,
      source: "arletos-agent",
    });
    // If this were an unscoped/cross-tenant sum it would be 3 for both
    // calls; each must see only its own.
    expect(countA).toBe(2);
    expect(countB).toBe(1);
    expect(countA + countB).toBe(3);
  });

  it("returns 0 for an owner with no matching memories, not a cross-tenant fallback", () => {
    const count = countOwnedMemoriesBySource({
      ownerId: UNRELATED_OWNER,
      source: "arletos-agent",
    });
    expect(count).toBe(0);
  });

  it("filters by source — a differently-sourced memory never counts", () => {
    const count = countOwnedMemoriesBySource({
      ownerId: OWNER_A,
      source: "some-other-source-nobody-seeded",
    });
    expect(count).toBe(0);
  });
});
