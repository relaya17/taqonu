import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AtlasError,
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
import { authorizeEntityAction } from "@atlas/agent-core";
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
import { tryPersistDecisionToSupabase } from "@atlas/database";
import { osStore } from "../store/os-store.js";
import { createApprovalRequest } from "../services/approvals.js";
import { runLiveHumanDecisionExecution } from "../services/live-human-execution.js";
import { applyApprovedPatch } from "../services/patch-write.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { defaultGoldenRoot } from "../services/golden-root.js";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import {
  assertProjectReadAccess,
  assertProjectWriteAccess,
  canReadProjectScoped,
} from "../services/project-access.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import {
  buildAtlasVerdict,
  buildEvidenceReport,
} from "../services/atlas-verdict.js";

function evalsRoot(): string {
  return findEvalsRoot();
}

export async function registerEngineeringLoopRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/actions/classify", async (request) => {
    const body = classifyActionRequestSchema.parse(request.body);
    return classifyActionResultSchema.parse(classifyAction(body.userRequest));
  });

  app.get("/api/v1/engineering/loop", async (request) => {
    const user = await requireUser(app, request);
    const items = osStore
      .listLoopRuns()
      .filter((run) => canReadProjectScoped(user, run.projectId));
    return { items, total: items.length };
  });

  app.get("/api/v1/engineering/loop/:id", async (request, reply) => {
    const user = await requireUser(app, request);
    const id = (request.params as { id: string }).id;
    const run = osStore.getLoopRun(id);
    if (!run) return reply.status(404).send({ error: { message: "Not found" } });
    if (!canReadProjectScoped(user, run.projectId)) {
      return reply.status(404).send({ error: { message: "Not found" } });
    }
    return run;
  });

  app.post("/api/v1/engineering/loop", async (request, reply) => {
    osStore.ensureLoaded();
    const body = startEngineeringLoopSchema.parse(request.body);

    // Auth: if projectId given, check project write access; otherwise require signed in.
    const user = body.projectId
      ? await assertProjectWriteAccess(app, request, body.projectId)
      : await requireSignedInForWrite(app, request);

    // Entity-policy gate: engineering loop is RECORD.EXECUTE.
    const entityDecision = authorizeEntityAction("RECORD", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityDecision.decision !== "ALLOWED") {
      const reason =
        entityDecision.decision === "DENIED"
          ? entityDecision.reason
          : "RECORD.EXECUTE requires explicit approval";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

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

    let approvalRequestId: string | null = null;
    if (patchId) {
      const approvalRequest = await createApprovalRequest({
        entityType: "DOCUMENT",
        action: "EXECUTE",
        // Requester is the loop's own agent identity, never the human user —
        // the human is the DECIDER (see /approve below), not the requester.
        // This keeps the two roles distinct on the audit trail and satisfies
        // the AGENT-actor claim contract (executorId === requestedBy).
        requestedBy: "engineering-loop",
        reason: `Apply engineering loop patch for: ${loop.userRequest.slice(0, 200)}`,
        context: {
          loopId: loop.id,
          patchId,
          projectId: body.projectId ?? null,
          workspaceRoot,
        },
      });
      approvalRequestId = approvalRequest.id;
    }

    const stored = { ...loop, patchId, approvalRequestId };
    osStore.upsertLoopRun(stored);
    appendDomainEvent({
      type: "agent.run.completed",
      projectId: body.projectId ?? null,
      ownerId: user.id,
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
    // Tenant check: caller must own the project this loop belongs to.
    if (existing.projectId) {
      await assertProjectWriteAccess(app, request, existing.projectId);
    } else if (!canReadProjectScoped(user, existing.projectId)) {
      throw new AtlasError("FORBIDDEN", "Access denied", { statusCode: 403 });
    }

    // Entity-policy gate: approve is RECORD.EXECUTE.
    const entityDecision = authorizeEntityAction("RECORD", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityDecision.decision !== "ALLOWED") {
      const reason =
        entityDecision.decision === "DENIED"
          ? entityDecision.reason
          : "RECORD.EXECUTE requires explicit approval";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
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

      if (!existing.approvalRequestId) {
        throw new AtlasError(
          "VALIDATION_ERROR",
          "Loop run has no approval request to claim (started before governed apply was wired in — re-run the loop)",
        );
      }

      // DOCUMENT.EXECUTE's default risk score (HIGH_RISK_WRITE base + no
      // confidence/evidenceCount signal on this call shape) lands in the
      // HUMAN_ONLY bucket -- which an AGENT-kind claim can never satisfy,
      // by design (see agent-dispatch-guard.ts's needsApproval check).
      // The live, freshly-authenticated human clicking Approve IS the
      // genuinely-live decision that bucket requires, so this uses the
      // dedicated live-human path (live-human-execution.ts) instead of a
      // separate decide-then-claim pair: one atomic PENDING -> CLAIMED
      // transition, decidedBy = user.id. Separation of duties
      // (decidedBy !== requestedBy) holds because the request was created
      // with requestedBy: "engineering-loop" (the agent), never the human.
      const helper = await runLiveHumanDecisionExecution({
        approvalId: existing.approvalRequestId,
        deciderId: user.id,
        decisionReason: body.note ?? "loop approve",
        entityType: "DOCUMENT",
        action: "EXECUTE",
        requestId: request.id,
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        ...(existing.projectId ? { projectId: existing.projectId } : {}),
        routeLabel: "engineering.loop.approve.apply",
        dispatchInput: { loopId: existing.id, patchId: approved.id },
        executeOnce: async () => {
          try {
            const value = applyApprovedPatch({
              existing: approved,
              user,
              bodyWorkspaceRoot: existing.workspaceRoot,
            });
            return {
              kind: "SUCCESS" as const,
              value,
              outputEvidence: JSON.stringify({
                status: value.patch.status,
                applied: value.apply.applied,
              }),
            };
          } catch (error) {
            return {
              kind: "FAILURE" as const,
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        },
      });

      if (helper.status === "APPROVAL_REQUIRED") {
        return reply.status(202).send({
          status: "APPROVAL_REQUIRED",
          approvalRequestId: helper.approvalRequestId,
          message: helper.reason,
        });
      }
      if (helper.status !== "EXECUTED") {
        const reason = "reason" in helper ? helper.reason : "governed execution failed";
        const statusCode =
          helper.status === "OUTCOME_UNKNOWN" || helper.status === "FINALIZE_INCOMPLETE"
            ? 409
            : 403;
        throw new AtlasError("FORBIDDEN", reason, { statusCode });
      }

      const applied = helper.value.apply;

      if (existing.projectId) {
        const evidence = parseEvidenceRecord({
          id: crypto.randomUUID(),
          ownerId: user.id,
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
    const user = await requireUser(app, request);
    const items = osStore
      .listEvalSuites()
      .filter((suite) => canReadProjectScoped(user, suite.projectId));
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
      evalsRoot: evalsRoot(),
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
    const user = await requireSignedInForWrite(app, request);
    const body = regressionCompareSchema.parse(request.body);
    const previous = osStore.getEvalSuite(body.previousSuiteId);
    const current = osStore.getEvalSuite(body.currentSuiteId);
    if (!previous || !current) {
      throw new AtlasError("NOT_FOUND", "Suite not found");
    }
    // Tenant check: both suites must be accessible to the caller.
    if (!canReadProjectScoped(user, previous.projectId) ||
        !canReadProjectScoped(user, current.projectId)) {
      throw new AtlasError("FORBIDDEN", "Access denied", { statusCode: 403 });
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

    // Namespace proof reports per-project instead of sharing a global slot.
    const metaKey = projectId
      ? `lastProofReport:${projectId}`
      : "lastProofReport:global";
    osStore.setMeta(metaKey, JSON.stringify(final));
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
    await requireUser(app, request);
    const q = z
      .object({ projectId: uuidSchema.optional() })
      .parse(request.query ?? {});

    // If projectId is given, check access; otherwise show global status.
    if (q.projectId) {
      await assertProjectReadAccess(app, request, q.projectId);
    }

    osStore.ensureLoaded();
    // Namespace proof reports per-project instead of sharing a global slot.
    const metaKey = q.projectId
      ? `lastProofReport:${q.projectId}`
      : "lastProofReport:global";
    const raw = osStore.getMeta(metaKey);
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
