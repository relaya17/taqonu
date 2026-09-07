/**
 * Atlas Sentinel — defensive security API routes.
 * No offensive scanning · no exploit guidance · secrets always redacted.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AtlasError, uuidSchema } from "@atlas/shared";
import { runSentinelScan, verifySentinelFinding } from "@atlas/observer";
import { resolveObserverWorkspace } from "../services/observe-cycle.js";
import { proposeTruthFindingRemediation } from "../services/remediation-pipeline.js";
import {
  assertProjectReadAccess,
  assertProjectWriteAccess,
} from "../services/project-access.js";
import {
  runGovernedClaimedExecution,
  type HelperResult,
} from "../services/governed-claimed-execution.js";
import { runLiveHumanDecisionExecution } from "../services/live-human-execution.js";

/**
 * F-02 Phase 2, Gap 3. `POST .../sentinel/scan` used to call
 * `authorizeEntityAction("CASE", "EXECUTE", { ..., approved: true })`
 * directly, with `approved: true` hardcoded — CASE.EXECUTE requires
 * approval, so this always satisfied that requirement regardless of
 * whether any real approval ever existed. It is now routed through the
 * same real approval lifecycle every other governed write in this
 * codebase uses — no special Sentinel approval system, no second
 * approval authority.
 *
 * CASE.EXECUTE is `HIGH_RISK_WRITE` + `requiresApproval: true`
 * (`entity-policies.ts`). With the conservative default confidence/
 * evidence this route supplies none of, `computeActionRiskScore` always
 * lands that combination at exactly the `HUMAN_ONLY` threshold (score 80;
 * see `risk-score.ts`'s documented thresholds) — the same bucket
 * `DOCUMENT.EXECUTE` lands at for a HIGH/CRITICAL code patch.
 * `dispatchAgentAction` never lets an ordinary decide-then-claim approval
 * TOKEN satisfy `HUMAN_ONLY` for an AGENT-kind actor (that would be
 * approval-token replay by whoever presents the id); `HUMAN_ONLY`
 * requires a genuinely *live* human decision instead. So, exactly
 * mirroring code.ts's `/apply` + `/apply/decide-and-execute` split for
 * the same risk tier:
 *
 *  - `POST .../scan` with no approval on hand requests one (202).
 *  - `POST .../scan/decide-and-execute` is the only executable path: a
 *    second, live-authenticated identity with write access to the
 *    project (never the original requester — separation of duties is
 *    enforced by the database itself, see
 *    `claim_live_approval_request_as_live_human`) atomically decides
 *    and claims the approval in one step via
 *    `runLiveHumanDecisionExecution`, and only then does this route's
 *    `executeOnce` actually run the scan.
 */
function approvalRequiredBody(approvalRequestId: string, reason: string) {
  return {
    status: "APPROVAL_REQUIRED" as const,
    approvalRequestId,
    reason,
    message:
      "A second, live-authenticated identity with write access to this " +
      "project (never the requester) must submit POST " +
      ".../sentinel/scan/decide-and-execute with " +
      `{ "approvalId": "${approvalRequestId}", "decisionReason": "..." }.`,
  };
}

function throwSentinelHelperFailure(helper: HelperResult<unknown>): never {
  const reason =
    "reason" in helper ? helper.reason : "governed execution failed";
  if (helper.status === "DENIED" && /not found/i.test(reason)) {
    throw new AtlasError("NOT_FOUND", reason, { statusCode: 404 });
  }
  if (helper.status === "OUTCOME_UNKNOWN" || helper.status === "FINALIZE_INCOMPLETE") {
    throw new AtlasError("CONFLICT", reason, { statusCode: 409 });
  }
  throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
}

type ScanResponse = ReturnType<typeof runSentinelScan> & {
  projectId: string;
  projectSlug: string | null;
  agent: string;
  mode: string;
};

export async function registerSentinelRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/projects/:id/sentinel/scan", async (request, reply) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const user = await assertProjectWriteAccess(app, request, projectId);

    const body = z
      .object({ workspaceRoot: z.string().min(1).max(1000).optional() })
      .parse(request.body ?? {});

    const helper = await runGovernedClaimedExecution<ScanResponse>({
      executorId: user.id,
      actor: { kind: "AGENT", agentId: user.id, onBehalfOfUserId: user.id },
      entityType: "CASE",
      action: "EXECUTE",
      requestId: request.id,
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId,
      routeLabel: "sentinel.scan",
      executeOnce: async () => {
        const resolved = resolveObserverWorkspace({
          projectId,
          workspaceRoot: body.workspaceRoot ?? null,
          envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
        });
        const result = runSentinelScan(resolved.workspaceRoot, { persist: true });
        const value = {
          ...result,
          projectId,
          projectSlug: resolved.projectSlug,
          agent: "Atlas Sentinel",
          mode: "defensive",
        };
        return {
          kind: "SUCCESS",
          value,
          outputEvidence: JSON.stringify({
            posture: result.posture,
            findingCount: result.findings.length,
            scannedAt: result.scannedAt,
          }),
        };
      },
    });

    // No approval is ever presented on this route, so `claimOrResume` never
    // has a record to resume/replay — this always resolves to either a
    // fresh APPROVAL_REQUIRED (the expected, ordinary outcome for this
    // HUMAN_ONLY-bucket action) or a DENIED from the gate itself (e.g. a
    // kill switch or a disabled/revoked agent identity).
    if (helper.status === "APPROVAL_REQUIRED") {
      return reply
        .status(202)
        .send(approvalRequiredBody(helper.approvalRequestId, helper.reason));
    }
    if (helper.status === "EXECUTED" && helper.gate !== undefined) {
      return reply.send(helper.value);
    }
    throwSentinelHelperFailure(helper);
  });

  app.post(
    "/api/v1/projects/:id/sentinel/scan/decide-and-execute",
    async (request, reply) => {
      const projectId = uuidSchema.parse((request.params as { id: string }).id);
      const user = await assertProjectWriteAccess(app, request, projectId);

      const body = z
        .object({
          approvalId: z.string().uuid(),
          decisionReason: z.string().min(1).max(2000),
          workspaceRoot: z.string().min(1).max(1000).optional(),
        })
        .parse(request.body ?? {});

      const helper = await runLiveHumanDecisionExecution<ScanResponse>({
        approvalId: body.approvalId,
        deciderId: user.id,
        decisionReason: body.decisionReason,
        entityType: "CASE",
        action: "EXECUTE",
        requestId: request.id,
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        projectId,
        routeLabel: "sentinel.scan.live-human",
        executeOnce: async () => {
          const resolved = resolveObserverWorkspace({
            projectId,
            workspaceRoot: body.workspaceRoot ?? null,
            envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
          });
          const result = runSentinelScan(resolved.workspaceRoot, { persist: true });
          const value = {
            ...result,
            projectId,
            projectSlug: resolved.projectSlug,
            agent: "Atlas Sentinel",
            mode: "defensive",
          };
          return {
            kind: "SUCCESS",
            value,
            outputEvidence: JSON.stringify({
              posture: result.posture,
              findingCount: result.findings.length,
              scannedAt: result.scannedAt,
            }),
          };
        },
      });

      if (helper.status === "EXECUTED") {
        // Terminal FULFILLED replay has no gate. Do not report a second
        // success and do not run the scan callback again.
        if (helper.gate === undefined) {
          throw new AtlasError(
            "FORBIDDEN",
            helper.approval
              ? `Approval request ${helper.approval.id} is already finalized`
              : "approval already finalized",
            { statusCode: 403 },
          );
        }
        return reply.send(helper.value);
      }
      throwSentinelHelperFailure(helper);
    },
  );

  app.get("/api/v1/projects/:id/sentinel", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    const resolved = resolveObserverWorkspace({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const result = runSentinelScan(resolved.workspaceRoot, { persist: false });
    return {
      ...result,
      projectId,
      projectSlug: resolved.projectSlug,
      agent: "Atlas Sentinel",
      mode: "defensive",
    };
  });

  app.post("/api/v1/projects/:id/sentinel/propose", async (request, reply) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectWriteAccess(app, request, projectId);
    const body = z
      .object({
        findingId: z.string().min(1).max(200),
      })
      .parse(request.body ?? {});
    const resolved = resolveObserverWorkspace({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const scan = runSentinelScan(resolved.workspaceRoot, { persist: false });
    const finding = scan.findings.find((f) => f.id === body.findingId);
    if (!finding) {
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Sentinel finding not present in latest defensive scan",
        },
      });
    }
    const draft = proposeTruthFindingRemediation({
      projectId,
      finding: {
        id: finding.id,
        title: finding.title,
        detail: finding.detail,
        riskBand: finding.severity,
        claim: finding.claim,
        epistemicState: finding.epistemicState,
        evidenceRefs: [...finding.evidenceRefs],
        category: "SENTINEL",
      },
    });
    return reply.status(201).send({
      draft,
      note: draft.applyBlocked
        ? "HIGH/CRITICAL — propose only; apply blocked until human gate"
        : "Draft ready for approve → apply → verify",
      loop: "PROPOSE → APPROVE → APPLY(sandbox) → VERIFY(re-scan)",
    });
  });

  app.post("/api/v1/projects/:id/sentinel/verify", async (request, reply) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectWriteAccess(app, request, projectId);
    const body = z
      .object({
        findingId: z.string().min(1).max(200),
      })
      .parse(request.body ?? {});
    const resolved = resolveObserverWorkspace({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const result = verifySentinelFinding(
      resolved.workspaceRoot,
      body.findingId,
    );
    return reply.send(result);
  });
}
