import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AtlasError,
  STUB_OWNER_ID,
  approveEngineeringLoopSchema,
  classifyActionRequestSchema,
  classifyActionResultSchema,
  decisionSchema,
  evidenceRecordSchema,
  patchArtifactSchema,
  startEngineeringLoopSchema,
  regressionCompareSchema,
  uuidSchema,
} from "@atlas/shared";
import {
  classifyAction,
  compareSuiteRuns,
  loadEvalTasks,
  proposeForLoop,
  runBenchmarkSuite,
  runEngineeringLoop,
  summarizeProofMetrics,
} from "@atlas/engineering-loop";
import { applyPatchFiles } from "@atlas/code-intelligence";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { defaultGoldenRoot } from "../services/golden-root.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";

function findEvalsRoot(): string {
  const fromEnv = process.env.ATLAS_EVALS_ROOT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  let dir = process.cwd();
  for (;;) {
    const candidate = resolve(dir, "atlas-evals");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), "atlas-evals");
}

export async function registerEngineeringLoopRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/actions/classify", async (request) => {
    const body = classifyActionRequestSchema.parse(request.body);
    return classifyActionResultSchema.parse(classifyAction(body.userRequest));
  });

  app.get("/api/v1/engineering/loop", async () => {
    const items = osStore.listLoopRuns();
    return { items, total: items.length };
  });

  app.get("/api/v1/engineering/loop/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const run = osStore.getLoopRun(id);
    if (!run) return reply.status(404).send({ error: { message: "Not found" } });
    return run;
  });

  app.post("/api/v1/engineering/loop", async (request, reply) => {
    osStore.ensureLoaded();
    const body = startEngineeringLoopSchema.parse(request.body);
    const loop = runEngineeringLoop({
      workspaceRoot:
        body.workspaceRoot ||
        app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ||
        defaultGoldenRoot(),
      userRequest: body.userRequest,
      projectId: body.projectId ?? null,
      projectSlug: body.projectSlug ?? "brokeros",
      ...(body.mode ? { mode: body.mode } : {}),
      runHeavyChecks: body.runHeavyChecks === true,
      ...(body.taskId ? { taskId: body.taskId } : {}),
    });

    const workspaceRoot = loop.workspaceRoot;

    let patchId = loop.patchId;
    if (loop.patchId && loop.status === "AWAITING_APPROVAL") {
      const proposal = proposeForLoop({
        workspaceRoot,
        userRequest: body.userRequest,
        mode: loop.mode,
      });
      if (proposal.filesChanged.length > 0) {
        const now = new Date().toISOString();
        const patch = patchArtifactSchema.parse({
          id: loop.patchId,
          projectId: body.projectId ?? null,
          title: proposal.title,
          reason: proposal.reason,
          mode: proposal.mode,
          status: "AWAITING_APPROVAL",
          risk: proposal.risk,
          baseCommit: null,
          targetBranch: null,
          filesChanged: proposal.filesChanged.map((f) => ({
            path: f.path,
            action: f.action,
            summary: f.summary,
            ...(f.unifiedDiff !== undefined
              ? { unifiedDiff: f.unifiedDiff }
              : {}),
            ...(f.afterContent !== undefined
              ? { afterContent: f.afterContent }
              : {}),
          })),
          evidenceIds: [],
          claimIds: [],
          expectedImpact: proposal.expectedImpact,
          tests: proposal.tests,
          evaluationSummary: proposal.evaluationSummary,
          approvals: [],
          appliedAt: null,
          verifiedAt: null,
          rollbackRef: null,
          rollbackSnapshot: [],
          createdAt: now,
          updatedAt: now,
          createdBy: "engineering-loop",
          epistemicState: "PROPOSED",
          confidence: 0.55,
          authorityHint: "LLM_INFERENCE",
        });
        osStore.upsertPatch(patch);
        patchId = patch.id;
      } else {
        patchId = null;
      }
    }

    const stored = { ...loop, patchId };
    osStore.upsertLoopRun(stored);
    appendDomainEvent({
      type: "agent.run.completed",
      projectId: body.projectId ?? null,
      epistemicState: "OBSERVED",
      payload: {
        kind: "engineering-loop",
        loopId: stored.id,
        status: stored.status,
        actionKind: stored.actionKind,
      },
    });

    return reply.status(201).send(stored);
  });

  app.post("/api/v1/engineering/loop/:id/approve", async (request, reply) => {
    const user = requireSignedInForWrite(app, request);
    const id = (request.params as { id: string }).id;
    const body = approveEngineeringLoopSchema.parse(request.body ?? {});
    const approvedBy = body.approvedBy.trim() || user.email;
    const existing = osStore.getLoopRun(id);
    if (!existing) {
      throw new AtlasError("NOT_FOUND", "Loop run not found");
    }
    if (existing.status !== "AWAITING_APPROVAL") {
      throw new AtlasError(
        "VALIDATION_ERROR",
        `Loop status ${existing.status} cannot approve`,
      );
    }
    const now = new Date().toISOString();
    let decisionId: string | null = null;

    if (body.apply !== false && existing.patchId) {
      const patch = osStore.getPatch(existing.patchId);
      if (!patch) {
        throw new AtlasError("NOT_FOUND", "Patch not found for loop");
      }
      const approved = patchArtifactSchema.parse({
        ...patch,
        status: "APPROVED",
        approvals: [
          ...patch.approvals,
          {
            by: approvedBy,
            at: now,
            note: body.note ?? "loop approve",
          },
        ],
        updatedAt: now,
      });
      osStore.upsertPatch(approved);

      const applied = applyPatchFiles(
        existing.workspaceRoot,
        approved.filesChanged.map((f) => {
          const change: {
            path: string;
            action: "add" | "modify" | "delete";
            summary: string;
            afterContent?: string;
            unifiedDiff?: string;
          } = {
            path: f.path,
            action: f.action,
            summary: f.summary,
          };
          if (f.afterContent !== undefined) change.afterContent = f.afterContent;
          if (f.unifiedDiff !== undefined) change.unifiedDiff = f.unifiedDiff;
          return change;
        }),
      );

      const appliedPatch = patchArtifactSchema.parse({
        ...approved,
        status: "APPLIED",
        appliedAt: now,
        updatedAt: now,
        evaluationSummary: [
          approved.evaluationSummary ?? "",
          `Applied files: ${applied.applied.join(", ")}`,
        ].join("\n"),
      });
      osStore.upsertPatch(appliedPatch);

      if (existing.projectId) {
        const evidence = evidenceRecordSchema.parse({
          id: crypto.randomUUID(),
          ownerId: STUB_OWNER_ID,
          projectId: existing.projectId,
          source: `loop:${existing.id}`,
          sourceType: "SYSTEM",
          sourceId: existing.id,
          uri: null,
          excerpt: `Applied patch ${approved.id}: ${applied.applied.join(", ")}`,
          version: null,
          observedAt: now,
          createdAt: now,
          confidence: 0.9,
          epistemicState: "OBSERVED",
          classification: "INTERNAL",
          authorityRank: "REPOSITORY_CODE",
          metadata: {
            loopId: existing.id,
            patchId: approved.id,
            actorUserId: user.id,
          },
        });
        osStore.addEvidence(existing.projectId, [evidence]);

        const decision = decisionSchema.parse({
          id: crypto.randomUUID(),
          projectId: existing.projectId,
          decision: `Approved engineering loop apply for: ${existing.userRequest.slice(0, 200)}`,
          reason: [
            `Approved by ${approvedBy}`,
            body.note ?? existing.plainLanguageSummary,
          ],
          alternatives: ["Reject patch", "Request revision"],
          tradeOffs: [`Risk ${existing.risk ?? "UNKNOWN"}`],
          evidence: [evidence.id],
          status: "ACTIVE",
          confidence: 0.85,
          epistemicState: "CONFIRMED",
          supersededBy: null,
          adrPath: null,
          decidedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        osStore.addDecision(decision);
        decisionId = decision.id;
      }

      const bump = (
        stageName: (typeof existing.stages)[number]["stage"],
        status: (typeof existing.stages)[number]["status"],
        summary: string,
      ) => {
        const idx = existing.stages.findIndex((s) => s.stage === stageName);
        if (idx >= 0) {
          existing.stages[idx] = {
            ...existing.stages[idx]!,
            status,
            summary,
            completedAt: now,
          };
        } else {
          existing.stages.push({
            stage: stageName,
            status,
            summary,
            epistemicState: "OBSERVED",
            evidenceIds: [],
            artifactRefs: [],
            durationMs: 0,
            startedAt: now,
            completedAt: now,
          });
        }
      };

      bump(
        "awaiting_human_approval",
        "PASSED",
        `Approved by ${approvedBy}`,
      );
      bump(
        "apply",
        "PASSED",
        `Applied: ${applied.applied.join(", ") || "none"}`,
      );
      bump("regression", "SKIPPED", "Run POST /api/v1/benchmarks/run for suite regression.");
      bump("evidence_update", "PASSED", "Evidence recorded for apply.");
      bump(
        "decision_log",
        "PASSED",
        decisionId ? `Decision ${decisionId}` : "Decision noted on loop.",
      );

      const next = {
        ...existing,
        status: "APPLIED" as const,
        stages: [...existing.stages],
        decisionId,
        updatedAt: now,
        completedAt: now,
      };
      osStore.upsertLoopRun(next);
      osStore.appendAudit({
        type: "engineering.loop.applied",
        loopId: id,
        patchId: existing.patchId,
        at: now,
      });
      return reply.status(200).send(next);
    }

    const next = {
      ...existing,
      status: "PASSED" as const,
      updatedAt: now,
      completedAt: now,
    };
    osStore.upsertLoopRun(next);
    return reply.status(200).send(next);
  });

  app.get("/api/v1/benchmarks/tasks", async () => {
    const items = loadEvalTasks(findEvalsRoot()).filter(
      (t) => !t.id.startsWith("placeholder"),
    );
    return { items, total: items.length, evalsRoot: findEvalsRoot() };
  });

  app.get("/api/v1/benchmarks/suites", async () => {
    const items = osStore.listEvalSuites();
    return { items, total: items.length };
  });

  app.post("/api/v1/benchmarks/run", async (request, reply) => {
    const body = z
      .object({
        workspaceRoot: z.string().min(1).max(1000).optional(),
        projectId: uuidSchema.nullable().optional(),
        projectSlug: z.string().max(64).optional(),
        taskIds: z.array(z.string()).optional(),
      })
      .parse(request.body ?? {});

    const workspaceRoot =
      body.workspaceRoot ||
      app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ||
      defaultGoldenRoot();

    const suite = runBenchmarkSuite({
      evalsRoot: findEvalsRoot(),
      workspaceRoot,
      projectId: body.projectId ?? null,
      projectSlug: body.projectSlug ?? "brokeros",
      ...(body.taskIds ? { taskIds: body.taskIds } : {}),
      atlasVersion: "1.1.0",
    });
    osStore.addEvalSuite(suite);
    const metrics = summarizeProofMetrics(suite.results);
    osStore.appendAudit({
      type: "benchmark.suite.completed",
      suiteId: suite.id,
      passRate: suite.passRate,
      unauthorizedWrites: suite.unauthorizedWrites,
      metrics,
      at: new Date().toISOString(),
    });
    return reply.status(201).send({ suite, metrics });
  });

  app.post("/api/v1/benchmarks/regression", async (request, reply) => {
    const body = regressionCompareSchema.parse(request.body);
    const previous = osStore.getEvalSuite(body.previousSuiteId);
    const current = osStore.getEvalSuite(body.currentSuiteId);
    if (!previous || !current) {
      throw new AtlasError("NOT_FOUND", "Suite not found");
    }
    const report = compareSuiteRuns(previous, current);
    osStore.addRegressionReport(report);
    return reply.status(201).send(report);
  });

  app.get("/api/v1/golden/project", async () => {
    const root =
      app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT || defaultGoldenRoot();
    return {
      slug: app.atlasEnv.ATLAS_GOLDEN_PROJECT_SLUG ?? "brokeros",
      workspaceRoot: root,
      exists: existsSync(root),
      evalsRoot: findEvalsRoot(),
      note: "BrokerOS is the Golden Project for Atlas 1.1 Proof & Autonomy.",
    };
  });
}
