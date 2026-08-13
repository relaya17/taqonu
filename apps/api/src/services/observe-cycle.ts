import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  AtlasError,
  genomeFlowSchema,
  ingestBugsRequestSchema,
  observeCycleRequestSchema,
  parseEvidenceRecord,
  type ObserveCycleResult,
} from "@atlas/shared";
import {
  ingestBugs,
  listCycleHistory,
  listGenomeSnapshots,
  loadBugs,
  loadExpectedBehavior,
  loadGenome,
  loadTruthCounters,
  promoteObservedToExpected,
  runObserveCycle,
  saveExpectedBehavior,
  verifyAgainstExpected,
  collectP1TruthSignals,
} from "@atlas/observer";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { defaultGoldenRoot } from "./golden-root.js";

export function resolveObserverWorkspace(input: {
  projectId?: string | null;
  workspaceRoot?: string | null;
  envGoldenRoot?: string | null;
}): { workspaceRoot: string; projectId: string | null; projectSlug: string | null } {
  let workspaceRoot = input.workspaceRoot?.trim()
    ? resolve(input.workspaceRoot.trim())
    : null;
  let projectId = input.projectId ?? null;
  let projectSlug: string | null = null;

  if (projectId) {
    const project = osStore.getProject(projectId);
    if (!project) {
      throw new AtlasError("NOT_FOUND", "Project not found");
    }
    projectSlug = project.slug;
    if (!workspaceRoot) {
      const linked = osStore.getWorkspaceRoot(projectId);
      if (linked) workspaceRoot = resolve(linked);
    }
  }

  if (!workspaceRoot) {
    // Never silently observe the golden lab for a different named project.
    if (projectId) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Link a local workspaceRoot on this project (Projects → folder) before Observer/Truth.",
      );
    }
    workspaceRoot = resolve(input.envGoldenRoot || defaultGoldenRoot());
  }

  if (!existsSync(workspaceRoot)) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      `workspaceRoot not found on the API host: ${workspaceRoot}`,
    );
  }

  return { workspaceRoot, projectId, projectSlug };
}

export function executeObserveCycle(input: {
  body: unknown;
  envGoldenRoot?: string | null;
}): ObserveCycleResult {
  const body = observeCycleRequestSchema.parse(input.body);
  const resolved = resolveObserverWorkspace({
    projectId: body.projectId ?? null,
    workspaceRoot: body.workspaceRoot ?? null,
    envGoldenRoot: input.envGoldenRoot ?? null,
  });

  const result = runObserveCycle({
    workspaceRoot: resolved.workspaceRoot,
    projectId: resolved.projectId,
    projectSlug: resolved.projectSlug,
    ...(body.flows ? { flows: body.flows } : {}),
    ...(body.bugs
      ? {
          bugs: body.bugs.map((b) => ({
            title: b.title,
            ...(b.detail !== undefined ? { detail: b.detail } : {}),
            ...(b.severity !== undefined ? { severity: b.severity } : {}),
            ...(b.source !== undefined ? { source: b.source } : {}),
            ...(b.linkedFlowId !== undefined
              ? { linkedFlowId: b.linkedFlowId }
              : {}),
          })),
        }
      : {}),
    persist: body.persist,
    ...(body.trigger ? { trigger: body.trigger } : {}),
    ...(body.promoteExpected !== undefined
      ? { promoteExpected: body.promoteExpected }
      : {}),
  });

  const now = new Date().toISOString();
  const ownerId = "00000000-0000-4000-8000-000000000001";
  if (resolved.projectId) {
    const evidence = result.evidenceDrafts.map((draft) =>
      parseEvidenceRecord({
        id: crypto.randomUUID(),
        ownerId,
        projectId: resolved.projectId,
        source: draft.source,
        sourceType: draft.sourceType,
        sourceId: result.id,
        uri: null,
        excerpt: draft.excerpt,
        version: null,
        observedAt: now,
        createdAt: now,
        confidence: draft.confidence,
        epistemicState: draft.epistemicState,
        category: draft.category,
        metadata: { observeCycleId: result.id, trigger: body.trigger ?? "manual" },
      }),
    );
    if (evidence.length) {
      osStore.addEvidence(resolved.projectId, evidence);
    }
    osStore.recordEvent({
      type: "observer.cycle.completed",
      projectId: resolved.projectId,
      observeCycleId: result.id,
      riskBand: result.risk.band,
      findings: result.findings.length,
      trigger: body.trigger ?? "manual",
    });
  }

  return result;
}

/** Best-effort continuous observe after GitHub webhook (no throw). */
export function tryContinuousObserve(input: {
  projectId: string;
  envGoldenRoot?: string | null;
  trigger?: string;
}): ObserveCycleResult | null {
  try {
    const linked = osStore.getWorkspaceRoot(input.projectId);
    if (!linked || !existsSync(linked)) return null;
    return executeObserveCycle({
      body: {
        projectId: input.projectId,
        trigger: input.trigger ?? "github_webhook",
        persist: true,
      },
      envGoldenRoot: input.envGoldenRoot ?? null,
    });
  } catch {
    return null;
  }
}

export function executeBugIngest(input: {
  body: unknown;
  envGoldenRoot?: string | null;
}) {
  const body = ingestBugsRequestSchema.parse(input.body);
  const resolved = resolveObserverWorkspace({
    projectId: body.projectId ?? null,
    workspaceRoot: body.workspaceRoot ?? null,
    envGoldenRoot: input.envGoldenRoot ?? null,
  });
  const bugs = ingestBugs(
    resolved.workspaceRoot,
    body.bugs.map((b) => ({
      title: b.title,
      ...(b.detail !== undefined ? { detail: b.detail } : {}),
      ...(b.severity !== undefined ? { severity: b.severity } : {}),
      ...(b.status !== undefined ? { status: b.status } : {}),
      ...(b.source !== undefined ? { source: b.source } : {}),
      ...(b.linkedFlowId !== undefined ? { linkedFlowId: b.linkedFlowId } : {}),
    })),
    resolved.projectId,
  );
  return { items: bugs, total: bugs.length, workspaceRoot: resolved.workspaceRoot };
}

export function readObserverState(input: {
  projectId?: string | null;
  workspaceRoot?: string | null;
  envGoldenRoot?: string | null;
}) {
  try {
    const resolved = resolveObserverWorkspace(input);
    const genome = loadGenome(resolved.workspaceRoot);
    const expected = loadExpectedBehavior(resolved.workspaceRoot);
    const drifts = verifyAgainstExpected(expected, genome?.apis ?? []);
    const p1Signals = collectP1TruthSignals(resolved.workspaceRoot, drifts);
    return {
      workspaceRoot: resolved.workspaceRoot,
      projectId: resolved.projectId,
      genome,
      bugs: loadBugs(resolved.workspaceRoot),
      expected,
      expectedCompare: {
        expectedFlowCount: expected?.flows.length ?? 0,
        observedFlowCount: genome?.apis.length ?? 0,
        driftCount: drifts.length,
        drifts: drifts.slice(0, 20),
        promotedAt: expected?.promotedAt ?? null,
        source: expected?.source ?? null,
      },
      p1Signals,
      counters: loadTruthCounters(resolved.workspaceRoot),
      history: listCycleHistory(resolved.workspaceRoot).slice(0, 20),
      snapshots: listGenomeSnapshots(resolved.workspaceRoot, 20),
      error: null as string | null,
    };
  } catch (error) {
    return {
      workspaceRoot: null,
      projectId: input.projectId ?? null,
      genome: null,
      bugs: [],
      expected: null,
      expectedCompare: {
        expectedFlowCount: 0,
        observedFlowCount: 0,
        driftCount: 0,
        drifts: [],
        promotedAt: null,
        source: null,
      },
      p1Signals: {
        authEdges: 0,
        sensitiveEdges: 0,
        decisionNodes: 0,
        adrConflicts: 0,
        productionPresent: 0,
        productionMissing: 0,
        missingTitles: [] as string[],
      },
      counters: {
        analyzed: 0,
        meaningfulRisks: 0,
        confirmedRegressions: 0,
        caughtBeforeProd: 0,
        cycles: 0,
        updatedAt: new Date().toISOString(),
      },
      history: [],
      snapshots: [],
      error: error instanceof Error ? error.message : "Observer state unavailable",
    };
  }
}

export function putExpectedBehaviorModel(input: {
  projectId?: string | null;
  workspaceRoot?: string | null;
  envGoldenRoot?: string | null;
  body: unknown;
}) {
  const body = z
    .object({
      mode: z.enum(["promote_observed", "replace_flows"]).default("promote_observed"),
      flows: z.array(genomeFlowSchema).max(50).optional(),
    })
    .parse(input.body);
  const resolved = resolveObserverWorkspace({
    projectId: input.projectId ?? null,
    workspaceRoot: input.workspaceRoot ?? null,
    envGoldenRoot: input.envGoldenRoot ?? null,
  });
  const genome = loadGenome(resolved.workspaceRoot);
  if (body.mode === "replace_flows") {
    if (!body.flows?.length) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "flows required when mode=replace_flows",
      );
    }
    const model = {
      version: 1 as const,
      promotedAt: new Date().toISOString(),
      source: "manual" as const,
      flows: body.flows,
    };
    saveExpectedBehavior(resolved.workspaceRoot, model);
    return { expected: model, workspaceRoot: resolved.workspaceRoot };
  }
  const flows = genome?.apis ?? body.flows ?? [];
  const expected = promoteObservedToExpected(resolved.workspaceRoot, flows);
  return { expected, workspaceRoot: resolved.workspaceRoot };
}
