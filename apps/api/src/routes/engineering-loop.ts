import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AtlasError,
  STUB_OWNER_ID,
  approveEngineeringLoopSchema,
  atlasProofReportSchema,
  classifyActionRequestSchema,
  classifyActionResultSchema,
  decisionSchema,
  parseEvidenceRecord,
  patchArtifactSchema,
  startEngineeringLoopSchema,
  regressionCompareSchema,
  runProofRequestSchema,
  uuidSchema,
} from "@atlas/shared";
import {
  classifyAction,
  compareSuiteRuns,
  findEvalsRoot,
  loadEvalTasks,
  proposeForLoop,
  resolveGoldenWorkspace,
  runAtlasProof,
  runBenchmarkSuite,
  runEngineeringLoop,
  summarizeProofMetrics,
} from "@atlas/engineering-loop";
import { applyPatchFiles } from "@atlas/code-intelligence";
import { tryPersistDecisionToSupabase } from "@atlas/database";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { defaultGoldenRoot } from "../services/golden-root.js";
import {
  requireSignedInForWrite,
  requireUser,
} from "../middleware/auth-guards.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import {
  assertProjectWriteAccess,
  canReadProjectScoped,
} from "../services/project-access.js";
import {
  buildAtlasVerdict,
  buildEvidenceReport,
} from "../services/atlas-verdict.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

function evalsRoot(): string {
  return findEvalsRoot();
}

/**
 * Per-tenant namespacing for the "last proof report" `osStore` meta slot.
 * Previously this was a single global key (`"lastProofReport"`) shared by
 * every tenant — whichever project ran `/proof/run` last clobbered the
 * value everyone else read back from `/proof/status`. Namespacing by
 * `projectId` (falling back to a `"global"` bucket for project-less runs,
 * e.g. the default BrokerOS golden run) fixes that without a store schema
 * migration — `osStore.meta` is already a free-form string map.
 */
function proofMetaKey(projectId: string | null): string {
  return `lastProofReport:${projectId ?? "global"}`;
}

export async function registerEngineeringLoopRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/actions/classify", async (request) => {
    const body = classifyActionRequestSchema.parse(request.body);
    return classifyActionResultSchema.parse(classifyAction(body.userRequest));
  });

  app.get("/api/v1/engineering/loop", async (request) => {
    // SECURITY FIX (found while widening Policy Engine coverage): this
    // route had ZERO auth and listed every loop run (userRequest text,
    // patch content, workspace roots) across every tenant unfiltered.
    const user = await requireUser(app, request);
    const items = osStore
      .listLoopRuns()
      .filter((run) => canReadProjectScoped(user, run.projectId));
    return { items, total: items.length };
  });

  app.get("/api/v1/engineering/loop/:id", async (request, reply) => {
    // SECURITY FIX: same class of gap as the list route above.
    const user = await requireUser(app, request);
    const id = (request.params as { id: string }).id;
    const run = osStore.getLoopRun(id);
    if (!run || !canReadProjectScoped(user, run.projectId)) {
      return reply.status(404).send({ error: { message: "Not found" } });
    }
    return run;
  });

  app.post("/api/v1/engineering/loop", async (request, reply) => {
    // SECURITY FIX (found while widening Policy Engine coverage): this
    // route had ZERO auth — anyone could trigger a real engineering-loop
    // run (compute + a workspace-root read) unauthenticated. When a
    // projectId is given, ownership is enforced the same way as other
    // project-scoped write routes; when it's null (portfolio-level run),
    // sign-in alone is required, matching the rest of this file's routes.
    osStore.ensureLoaded();
    const body = startEngineeringLoopSchema.parse(request.body);
    const startUser = body.projectId
      ? await assertProjectWriteAccess(app, request, body.projectId)
      : await requireSignedInForWrite(app, request);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "EXECUTE",
      routeLabel: "engineering.loop.start",
      actorId: startUser.id,
      projectId: body.projectId ?? null,
    });
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
    const user = await requireSignedInForWrite(app, request);
    const id = (request.params as { id: string }).id;
    const body = approveEngineeringLoopSchema.parse(request.body ?? {});
    const approvedBy = body.approvedBy.trim() || user.email;
    const existing = osStore.getLoopRun(id);
    if (!existing) {
      throw new AtlasError("NOT_FOUND", "Loop run not found");
    }
    // SECURITY FIX: this route had sign-in but no ownership check — any
    // signed-in caller could approve (and apply — writes files to disk!)
    // ANY tenant's loop run. `existing.projectId` is only known once the
    // run is fetched, same scan-then-authorize shape used in conflicts.ts.
    if (existing.projectId) {
      await assertProjectWriteAccess(app, request, existing.projectId);
    }
    enforceEntityWrite({
      entityType: "RECORD",
      action: "EXECUTE",
      routeLabel: "engineering.loop.approve",
      actorId: user.id,
      projectId: existing.projectId ?? null,
    });
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
        const evidence = parseEvidenceRecord({
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
          category: "CODE",
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
        const identity = await resolveCloudIdentity(app, request);
        if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);
        void tryPersistDecisionToSupabase(
          app.atlasEnv,
          decision,
          identity.ownerId,
          { userAccessToken: identity.userAccessToken },
        );
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
    const items = loadEvalTasks(evalsRoot()).filter(
      (t) => !t.id.startsWith("placeholder"),
    );
    return { items, total: items.length, evalsRoot: evalsRoot() };
  });

  app.get("/api/v1/benchmarks/suites", async (request) => {
    // SECURITY FIX (found while widening Policy Engine coverage): this
    // route had ZERO auth, and `AtlasEvalSuiteRun` carried no owner/project
    // attribution at all — every signed-in caller saw every tenant's
    // suites. `atlasEvalSuiteRunSchema` now carries `projectId`/`ownerId`
    // (set by `runBenchmarkSuite`), so this is filtered the same way as the
    // loop-run list above (`canReadProjectScoped`) instead of returning the
    // whole store.
    const user = await requireUser(app, request);
    const items = osStore
      .listEvalSuites()
      .filter((s) => canReadProjectScoped(user, s.projectId));
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

    // SECURITY FIX: this route had ZERO auth — anyone could trigger a real
    // benchmark suite run (compute + workspace-root read) unauthenticated.
    const benchmarkUser = body.projectId
      ? await assertProjectWriteAccess(app, request, body.projectId)
      : await requireSignedInForWrite(app, request);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "EXECUTE",
      routeLabel: "benchmarks.run",
      actorId: benchmarkUser.id,
      projectId: body.projectId ?? null,
    });

    const workspaceRoot =
      body.workspaceRoot ||
      app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ||
      defaultGoldenRoot();

    const suite = runBenchmarkSuite({
      evalsRoot: evalsRoot(),
      workspaceRoot,
      projectId: body.projectId ?? null,
      ownerId: benchmarkUser.id,
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
    // SECURITY FIX: previously gated to signed-in only, with no per-tenant
    // check on the two suites being compared — a signed-in caller could
    // pass another tenant's suite ids and have their (userRequest text,
    // patch content, workspace root) leaked back inside the regression
    // report. Now that suites carry `projectId`, both suites are checked
    // with `canReadProjectScoped` before comparing, same as GET
    // /benchmarks/suites above.
    const user = await requireUser(app, request);
    const body = regressionCompareSchema.parse(request.body);
    const previous = osStore.getEvalSuite(body.previousSuiteId);
    const current = osStore.getEvalSuite(body.currentSuiteId);
    if (!previous || !current) {
      throw new AtlasError("NOT_FOUND", "Suite not found");
    }
    if (
      !canReadProjectScoped(user, previous.projectId) ||
      !canReadProjectScoped(user, current.projectId)
    ) {
      throw new AtlasError(
        "FORBIDDEN",
        "Project isolation: you do not own one of these suites",
        { statusCode: 403 },
      );
    }
    const report = compareSuiteRuns(previous, current);
    osStore.addRegressionReport(report);
    return reply.status(201).send(report);
  });

  app.get("/api/v1/golden/project", async () => {
    const golden = resolveGoldenWorkspace({
      envRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
      slug: app.atlasEnv.ATLAS_GOLDEN_PROJECT_SLUG ?? "brokeros",
    });
    return {
      slug: golden.slug,
      workspaceRoot: golden.workspaceRoot,
      exists: golden.exists,
      source: golden.source,
      evalsRoot: evalsRoot(),
      note:
        golden.source === "fixture"
          ? "Using in-repo fixtures/golden-brokeros (BrokerOS path missing). Set ATLAS_GOLDEN_PROJECT_ROOT for the full lab repo."
          : "BrokerOS is the Golden Project for Atlas 1.1 Proof & Autonomy.",
    };
  });

  /** Atlas 1.1 Proof golden scenario — Engineering Loop A–F → Verdict + evidence. */
  app.post("/api/v1/proof/run", async (request, reply) => {
    // SECURITY FIX (found while widening Policy Engine coverage): this
    // route had ZERO auth — anyone could trigger the full Atlas Proof
    // golden scenario (real compute) unauthenticated.
    osStore.ensureLoaded();
    const body = runProofRequestSchema.parse(request.body ?? {});
    const slug =
      body.projectSlug ??
      app.atlasEnv.ATLAS_GOLDEN_PROJECT_SLUG ??
      "brokeros";

    let projectId = body.projectId ?? null;
    if (!projectId) {
      const project =
        osStore.getProjectBySlug(slug) ??
        osStore.listProjects().find((p) => p.slug === slug) ??
        null;
      projectId = project?.id ?? null;
    }
    const proofUser = projectId
      ? await assertProjectWriteAccess(app, request, projectId)
      : await requireSignedInForWrite(app, request);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "EXECUTE",
      routeLabel: "proof.run",
      actorId: proofUser.id,
      projectId: projectId ?? null,
    });

    let verdictSummary: {
      status: string | null;
      productionReadiness: number | null;
      evidenceCoverage: number | null;
      criticalBlockers: number | null;
      evidenceCount: number | null;
    } | null = null;
    let evidenceReportId: string | null = null;

    const report = runAtlasProof({
      workspaceRoot: body.workspaceRoot ?? null,
      envRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
      projectId,
      ownerId: proofUser.id,
      projectSlug: slug,
      ...(body.taskIds ? { taskIds: body.taskIds } : {}),
      evalsRoot: evalsRoot(),
      atlasVersion: "1.1.0",
    });

    osStore.addEvalSuite(report.suite);

    if (projectId && osStore.getProject(projectId)) {
      try {
        const verdict = buildAtlasVerdict({
          projectId,
          workspaceRoot: report.golden.workspaceRoot,
          locale: "en",
        });
        verdictSummary = {
          status: verdict.status,
          productionReadiness: verdict.productionReadiness,
          evidenceCoverage: verdict.evidenceCoverage,
          criticalBlockers: verdict.criticalBlockers,
          evidenceCount: verdict.evidenceCount,
        };
        const evReport = buildEvidenceReport({
          projectId,
          workspaceRoot: report.golden.workspaceRoot,
          locale: "en",
        });
        evidenceReportId = evReport.id;
        osStore.incrementUsage("reportsGenerated");
      } catch {
        /* project may lack enough state — suite proof still valid */
      }
    }

    const final = atlasProofReportSchema.parse({
      ...report,
      verdictSummary,
      evidenceReportMarkdown: evidenceReportId
        ? `${report.evidenceReportMarkdown}\n\n_Product evidence report id: ${evidenceReportId}_\n`
        : report.evidenceReportMarkdown,
    });

    osStore.setMeta(proofMetaKey(projectId), JSON.stringify(final));
    osStore.appendAudit({
      type: "proof.golden.completed",
      proofId: final.id,
      status: final.status,
      passRate: final.suite.passRate,
      unauthorizedWrites: final.suite.unauthorizedWrites,
      goldenSource: final.golden.source,
      at: final.createdAt,
    });
    appendDomainEvent({
      type: "evaluation.completed",
      projectId,
      epistemicState: "OBSERVED",
      payload: {
        kind: "atlas-proof-1.1",
        proofId: final.id,
        status: final.status,
        gatesPass: final.checklist.allGatesPass,
      },
    });

    return reply.status(201).send(final);
  });

  app.get("/api/v1/proof/status", async (request) => {
    // SECURITY FIX (found while widening Policy Engine coverage): this
    // route had ZERO auth AND read a single global `osStore` meta slot
    // shared by every tenant — whichever project ran /proof/run last
    // clobbered what every other tenant saw here. Now namespaced per
    // `projectId` via `proofMetaKey` (see its doc comment) and gated with
    // `canReadProjectScoped`, matching the rest of this file's project-
    // scoped list/read routes.
    const q = z
      .object({ projectId: uuidSchema.nullable().optional() })
      .parse(request.query ?? {});
    const user = await requireUser(app, request);
    if (!canReadProjectScoped(user, q.projectId ?? null)) {
      throw new AtlasError(
        "FORBIDDEN",
        "Project isolation: you do not own this project",
        { statusCode: 403 },
      );
    }
    osStore.ensureLoaded();
    const raw = osStore.getMeta(proofMetaKey(q.projectId ?? null));
    const golden = resolveGoldenWorkspace({
      envRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
      slug: app.atlasEnv.ATLAS_GOLDEN_PROJECT_SLUG ?? "brokeros",
    });
    if (!raw) {
      return {
        hasRun: false,
        golden: {
          slug: golden.slug,
          workspaceRoot: golden.workspaceRoot,
          exists: golden.exists,
          source: golden.source,
        },
        report: null,
        howToRun: [
          "pnpm proof:run",
          "POST /api/v1/proof/run",
          "UI: /he/proof → Run Proof 1.1",
        ],
      };
    }
    const report = atlasProofReportSchema.parse(JSON.parse(raw));
    return {
      hasRun: true,
      golden: report.golden,
      report,
      howToRun: [
        "pnpm proof:run",
        "POST /api/v1/proof/run",
        "UI: /he/proof → Run Proof 1.1",
      ],
    };
  });
}
