import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEvidenceRecord, SYSTEM_OWNER_ID } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-evidence-for-project-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("./project-access.js");
const { evidenceForGovernedProject } = await import("./evidence-for-project.js");

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

function addProject(id: string, slug: string) {
  const now = new Date().toISOString();
  osStore.upsertProject({
    id,
    slug,
    name: slug,
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
}

function record(ownerId: string, projectId: string, excerpt: string) {
  const now = new Date().toISOString();
  return parseEvidenceRecord({
    id: crypto.randomUUID(),
    ownerId,
    projectId,
    source: "unit-test",
    sourceType: "USER",
    sourceId: null,
    uri: null,
    excerpt,
    version: null,
    observedAt: now,
    createdAt: now,
    confidence: 1,
    epistemicState: "FACT",
    classification: "INTERNAL",
    authorityRank: "REPOSITORY_CODE",
    category: "CODE",
    metadata: {},
  });
}

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("evidenceForGovernedProject", () => {
  beforeEach(() => {
    osStore.resetInMemoryForTests();
    addProject(PROJECT_A, "proj-a");
    addProject(PROJECT_B, "proj-b");
    bindProjectOwner(PROJECT_A, OWNER_A, "bound_on_create");
    bindProjectOwner(PROJECT_B, OWNER_B, "bound_on_create");
  });

  it("counts owner and SYSTEM evidence on the project", () => {
    osStore.addEvidence(PROJECT_A, [
      record(OWNER_A, PROJECT_A, "owner-a-row"),
      record(SYSTEM_OWNER_ID, PROJECT_A, "system-row"),
    ]);
    const scoped = evidenceForGovernedProject(PROJECT_A);
    expect(scoped).toHaveLength(2);
    expect(scoped.map((row) => row.excerpt).sort()).toEqual([
      "owner-a-row",
      "system-row",
    ]);
  });

  it("does not count another project's owner's planted evidence", () => {
    osStore.addEvidence(PROJECT_A, [
      record(OWNER_A, PROJECT_A, "owner-a-row"),
      record(OWNER_B, PROJECT_A, "planted-by-b"),
    ]);
    const scoped = evidenceForGovernedProject(PROJECT_A);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.excerpt).toBe("owner-a-row");
    expect(osStore.getEvidence(PROJECT_A)).toHaveLength(2);
  });

  it("does not mix project B's store into project A", () => {
    osStore.addEvidence(PROJECT_B, [record(OWNER_B, PROJECT_B, "only-b")]);
    expect(evidenceForGovernedProject(PROJECT_A)).toHaveLength(0);
    expect(evidenceForGovernedProject(PROJECT_B)).toHaveLength(1);
  });
});
