import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYSTEM_OWNER_ID, memorySchema } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-state-recon-iso-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("./project-access.js");
const { runStateReconciliation } = await import("./state-reconciliation.js");

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const SECRET_B_BUG = "TENANT-B-SECRET bug in payroll connector token rotation";
const SECRET_B_TASK = "TENANT-B-SECRET todo: export competitor pricing sheet";
const OWNER_A_BUG = "TENANT-A-OWN bug in checkout timeout retry";
const SYSTEM_BUG = "SYSTEM-ACTOR bug observed on platform ingest path";
const ADMIN_ON_PROJECT_BUG = "ADMIN-ON-PROJECT bug filed against this workspace";

function sliceSummary(
  snapshot: { slices: ReadonlyArray<{ key: string; summary: string }> },
  key: string,
): string {
  return snapshot.slices.find((slice) => slice.key === key)?.summary ?? "";
}

function plantMemory(input: {
  ownerId: string;
  projectId: string | null;
  type: "BUG" | "TASK";
  statement: string;
}): void {
  const now = new Date().toISOString();
  osStore.addMemory(
    memorySchema.parse({
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      type: input.type,
      projectId: input.projectId,
      statement: input.statement,
      reason: ["n2-isolation-test"],
      status: "ACTIVE",
      confidence: 0.7,
      category: "GENERATED_REASONING",
      epistemicState: "OBSERVED",
      observationMode: "OBSERVED",
      source: "n2-isolation-test",
      sourceType: "USER",
      sourceId: null,
      evidence: [],
      supersededBy: null,
      validFrom: now,
      validUntil: null,
      observedAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: "test",
      scope: input.projectId ? "PROJECT" : "GLOBAL",
      priority: "HIGH",
    }),
  );
}

describe("runStateReconciliation memory isolation", () => {
  beforeEach(() => {
    osStore.resetInMemoryForTests();
  });

  afterEach(() => {
    osStore.resetInMemoryForTests();
  });

  it("does not copy another tenant's global memory statement into the project snapshot", () => {
    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    osStore.upsertProject({
      id: projectId,
      slug: `proj-${projectId.slice(0, 8)}`,
      name: "Owner A project",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    bindProjectOwner(projectId, OWNER_A, "bound_on_create");

    plantMemory({
      ownerId: OWNER_B,
      projectId: null,
      type: "BUG",
      statement: SECRET_B_BUG,
    });
    plantMemory({
      ownerId: OWNER_B,
      projectId: null,
      type: "TASK",
      statement: SECRET_B_TASK,
    });
    plantMemory({
      ownerId: OWNER_A,
      projectId: null,
      type: "BUG",
      statement: OWNER_A_BUG,
    });
    plantMemory({
      ownerId: SYSTEM_OWNER_ID,
      projectId: null,
      type: "BUG",
      statement: SYSTEM_BUG,
    });
    plantMemory({
      ownerId: ADMIN,
      projectId,
      type: "BUG",
      statement: ADMIN_ON_PROJECT_BUG,
    });

    const snapshot = runStateReconciliation(projectId);
    const risks = sliceSummary(snapshot, "RISKS");
    const tasks = sliceSummary(snapshot, "TASKS");

    expect(risks).not.toContain(SECRET_B_BUG);
    expect(tasks).not.toContain(SECRET_B_TASK);
    expect(risks).toContain(OWNER_A_BUG);
    expect(risks).toContain(SYSTEM_BUG);
    expect(risks).toContain(ADMIN_ON_PROJECT_BUG);
  });
});
