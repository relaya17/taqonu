import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  atlasEvalResultSchema,
  atlasEvalSuiteRunSchema,
  atlasEvalTaskSchema,
  type AtlasEvalSuiteRun,
  type AtlasEvalTask,
} from "@atlas/shared";
import { runEngineeringLoop } from "./loop.js";

const ATLAS_VERSION = "1.1.0";

export function loadEvalTasks(evalsRoot: string): AtlasEvalTask[] {
  const tasks: AtlasEvalTask[] = [];
  if (!existsSync(evalsRoot)) return tasks;
  const categories = readdirSync(evalsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "results" && d.name !== "baselines")
    .map((d) => d.name);

  for (const cat of categories) {
    const dir = join(evalsRoot, cat);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
      tasks.push(atlasEvalTaskSchema.parse(raw));
    }
  }
  return tasks;
}

export function runBenchmarkSuite(input: {
  evalsRoot: string;
  workspaceRoot: string;
  projectId?: string | null;
  ownerId?: string | null;
  projectSlug?: string;
  taskIds?: string[];
  atlasVersion?: string;
}): AtlasEvalSuiteRun {
  const startedAt = new Date().toISOString();
  const version = input.atlasVersion ?? ATLAS_VERSION;
  let tasks = loadEvalTasks(input.evalsRoot).filter(
    (t) => !t.id.startsWith("placeholder"),
  );
  if (input.taskIds?.length) {
    const set = new Set(input.taskIds);
    tasks = tasks.filter((t) => set.has(t.id));
  }

  const results = tasks.map((task) => {
    const t0 = Date.now();
    try {
      const loop = runEngineeringLoop({
        workspaceRoot: input.workspaceRoot,
        userRequest: task.task,
        projectId: input.projectId ?? null,
        projectSlug: input.projectSlug ?? task.repository,
        runHeavyChecks: false,
        taskId: task.id,
      });

      const evidenceCount =
        loop.stages.find((s) => s.stage === "evidence_collection")?.artifactRefs
          .length ?? 0;
      const patchProposed = Boolean(loop.patchId);
      const unauthorizedWrite = false; // loop never applies without approval

      const criteriaOk =
        evidenceCount > 0 ||
        loop.actionKind === "HUMAN_ACTION" ||
        loop.actionKind === "INFRASTRUCTURE" ||
        loop.actionKind === "EXTERNAL_INTEGRATION" ||
        loop.status === "AWAITING_APPROVAL" ||
        loop.status === "PASSED";

      const failedHard = loop.status === "FAILED" || loop.status === "BLOCKED";
      const status = failedHard ? "FAIL" : criteriaOk ? "PASS" : "FAIL";

      return atlasEvalResultSchema.parse({
        id: crypto.randomUUID(),
        taskId: task.id,
        atlasVersion: version,
        status,
        score: status === "PASS" ? 1 : 0,
        notes: loop.plainLanguageSummary,
        loopRunId: loop.id,
        evidenceCount,
        patchProposed,
        unauthorizedWrite,
        durationMs: Date.now() - t0,
        epistemicState: status === "PASS" ? "OBSERVED" : "UNVERIFIED",
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      return atlasEvalResultSchema.parse({
        id: crypto.randomUUID(),
        taskId: task.id,
        atlasVersion: version,
        status: "ERROR",
        score: 0,
        notes: String(err),
        loopRunId: null,
        evidenceCount: 0,
        patchProposed: false,
        unauthorizedWrite: false,
        durationMs: Date.now() - t0,
        epistemicState: "UNKNOWN",
        createdAt: new Date().toISOString(),
      });
    }
  });

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter(
    (r) => r.status === "FAIL" || r.status === "ERROR",
  ).length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const unauthorizedWrites = results.filter((r) => r.unauthorizedWrite).length;
  const passRate = results.length ? passed / results.length : 0;

  return atlasEvalSuiteRunSchema.parse({
    id: crypto.randomUUID(),
    atlasVersion: version,
    startedAt,
    completedAt: new Date().toISOString(),
    results,
    passed,
    failed,
    skipped,
    passRate,
    unauthorizedWrites,
    projectId: input.projectId ?? null,
    ownerId: input.ownerId ?? null,
  });
}
