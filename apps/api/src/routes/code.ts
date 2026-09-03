import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  applyPatchSchema,
  approvePatchSchema,
  createPatchSchema,
  patchArtifactSchema,
  studioWriteFileBodySchema,
  AtlasError,
  ATLAS_SELF_APPLICATION_ID,
  ENGINEERING_AGENT_MODES,
  isControlPlaneRole,
  memorySchema,
  type AuthUser,
  type EngineeringAgentMode,
  type PatchArtifact,
  type PatchRisk,
} from "@atlas/shared";
import type { ToolRisk } from "@atlas/shared";
import {
  analyzeImpact,
  analyzeRepository,
  listWorkspaceTree,
  proposePatch,
  rankRisks,
  readWorkspaceFile,
  rollbackPatchFiles,
  writeWorkspaceFile,
} from "@atlas/code-intelligence";
import {
  authorizeEntityAction,
  bucketForRiskScore,
  computeActionRiskScore,
  explainRiskScore,
  type EntityAction,
  type EntityAuthorizationDecision,
} from "@atlas/agent-core";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import {
  atlasSelfExecutedEvidence,
  auditAtlasSelfDecision,
  executeAtlasSelfLiveHuman,
  hashAtlasSelfFileArtifact,
  isAtlasSelfStudioProject,
  atlasSelfStudioWriteDeniedReason,
  mintAtlasSelfApproval,
  respondAtlasSelfHelper,
} from "../services/atlas-self-governance.js";
import { getRequestUser } from "../services/resolve-identity.js";
import { buildMemoryContext } from "../services/memory-pipeline.js";
import {
  assertEntityReadAccess,
  assertProjectReadAccess,
  assertProjectWriteAccess,
  canReadProjectScoped,
} from "../services/project-access.js";
import {
  approvePatchArtifact,
  applyApprovedPatch,
  assertPatchApprovedForApply,
} from "../services/patch-write.js";
import { createApprovalRequest } from "../services/approvals.js";
import { appendUnifiedAuditEntry } from "../services/audit-log.js";
import {
  runGovernedClaimedExecution,
  type HelperResult,
} from "../services/governed-claimed-execution.js";
import { runLiveHumanDecisionExecution } from "../services/live-human-execution.js";
import { computeArtifactHash } from "../services/governed-execution.js";

async function assertPatchWrite(
  app: FastifyInstance,
  request: FastifyRequest,
  patch: PatchArtifact,
) {
  if (patch.projectId) {
    return await assertProjectWriteAccess(app, request, patch.projectId);
  }
  return await requireSignedInForWrite(app, request);
}

/**
 * Maps the patch-level `PatchRisk` tier (`LOW|MEDIUM|HIGH|CRITICAL`, set by
 * the proposer / `code-intelligence` risk ranking) onto the entity-policy
 * layer's `ToolRisk` tier (`READ_ONLY|LOW_RISK_WRITE|HIGH_RISK_WRITE|
 * DESTRUCTIVE`) so it can feed `computeActionRiskScore`'s `baseTier`. A code
 * patch apply/rollback is never READ_ONLY (it mutates files on disk), so
 * that tier is intentionally unused here. `HIGH` and `CRITICAL` both map to
 * `DESTRUCTIVE` because `ToolRisk` has no tier above it — the two are still
 * distinguished by whatever `confidence`/`evidenceCount` the patch itself
 * carries, which is the best signal this route has beyond the coarse tier.
 */
function patchRiskToToolRisk(risk: PatchRisk): ToolRisk {
  switch (risk) {
    case "LOW":
      return "LOW_RISK_WRITE";
    case "MEDIUM":
      return "HIGH_RISK_WRITE";
    case "HIGH":
    case "CRITICAL":
      return "DESTRUCTIVE";
    default:
      return "DESTRUCTIVE";
  }
}

/**
 * Route-level 202 gate only. Does not authorize live execution.
 *
 * `entityApproved` is the patch-status signal for this score:
 *   - apply: `assertPatchApprovedForApply` already proved POST /patches/:id/approve
 *   - rollback: no equivalent patch-status gate, so false
 *
 * A live `ApprovalRequest` is never established by this boolean. Execution
 * goes through `runGovernedClaimedExecution`.
 */
function evaluatePatchActionRisk(input: {
  readonly patch: PatchArtifact;
  readonly entityApproved: boolean;
}): {
  readonly entityAuthz: EntityAuthorizationDecision;
  readonly score: number;
  readonly bucket: ReturnType<typeof bucketForRiskScore>;
  readonly explanation: ReturnType<typeof explainRiskScore>;
} {
  const entityAuthz = authorizeEntityAction("DOCUMENT", "EXECUTE", {
    // `AgentMode` (@atlas/shared) has no literal "EXECUTE" value; "WRITE" is
    // the closest real mode for an action that mutates workspace files.
    mode: "WRITE",
    approved: input.entityApproved,
    writeGateOpen: true,
  });

  const riskInput = {
    baseTier: patchRiskToToolRisk(input.patch.risk),
    confidence: input.patch.confidence,
    evidenceCount: input.patch.evidenceIds.length,
    requiresApproval: entityAuthz.decision === "APPROVAL_REQUIRED",
  };
  const score = computeActionRiskScore(riskInput);
  const bucket = bucketForRiskScore(score);
  const explanation = explainRiskScore(riskInput);

  return { entityAuthz, score, bucket, explanation };
}

function patchArtifactHash(patch: PatchArtifact): string {
  return computeArtifactHash(
    JSON.stringify({
      id: patch.id,
      files: patch.filesChanged.map((file) => ({
        path: file.path,
        action: file.action,
        afterContent: file.afterContent ?? null,
      })),
    }),
  );
}

function approvalRequiredBody(
  approvalId: string,
  extras?: { readonly riskScore?: number; readonly riskBucket?: string },
) {
  return {
    status: "APPROVAL_REQUIRED" as const,
    approvalId,
    ...(extras?.riskScore !== undefined ? { riskScore: extras.riskScore } : {}),
    ...(extras?.riskBucket !== undefined ? { riskBucket: extras.riskBucket } : {}),
    message:
      "Submit POST /api/v1/approvals/:id/decide to approve, then retry this " +
      `request with ?approvalId=${approvalId}.`,
  };
}

function throwPatchHelperFailure(helper: HelperResult<unknown>): never {
  const reason = "reason" in helper ? helper.reason : "governed execution failed";
  if (helper.status === "DENIED" && /not found/i.test(helper.reason)) {
    throw new AtlasError("NOT_FOUND", helper.reason, { statusCode: 404 });
  }
  if (helper.status === "OUTCOME_UNKNOWN" || helper.status === "FINALIZE_INCOMPLETE") {
    throw new AtlasError("CONFLICT", reason, { statusCode: 409 });
  }
  throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
}

async function runPatchClaimedExecution<T>(input: {
  readonly user: AuthUser;
  readonly patch: PatchArtifact;
  readonly requestId: string;
  readonly routeLabel: string;
  readonly approvalRequestId?: string;
  readonly action: EntityAction;
  readonly execute: () => T;
  readonly evidence: (value: T) => string;
}): Promise<HelperResult<T>> {
  return runGovernedClaimedExecution({
    executorId: input.user.id,
    actor: {
      kind: "AGENT",
      agentId: input.user.id,
      onBehalfOfUserId: input.user.id,
    },
    entityType: "DOCUMENT",
    action: input.action,
    artifactHash: patchArtifactHash(input.patch),
    ...(input.approvalRequestId !== undefined
      ? { approvalRequestId: input.approvalRequestId }
      : {}),
    requestId: input.requestId,
    sourceContext: { origin: "user_message", trustLevel: "trusted" },
    ...(input.patch.projectId ? { projectId: input.patch.projectId } : {}),
    routeLabel: input.routeLabel,
    dispatchInput: { patchId: input.patch.id, route: input.routeLabel },
    executeOnce: async () => {
      try {
        const value = input.execute();
        return {
          kind: "SUCCESS",
          value,
          outputEvidence: input.evidence(value),
        };
      } catch (error) {
        return {
          kind: "FAILURE",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

/**
 * CP7.1/CP7.2 HUMAN_ONLY live-human path -- mirrors `runPatchClaimedExecution`
 * exactly, except the claim is established by a live, separately-
 * authenticated human decision (`claim_live_approval_request_as_live_human`,
 * no intermediate APPROVED token) rather than by presenting a previously-
 * decided approval id. `DOCUMENT.EXECUTE` is HIGH_RISK_WRITE tier, which
 * (with the conservative default confidence/evidence this route supplies
 * none of) lands at exactly the HUMAN_ONLY threshold -- so a HIGH/CRITICAL
 * patch's approval can be granted via `/decide` but can never be consumed
 * by the ordinary `?approvalId=` retry (see `agent-dispatch-guard.ts`'s
 * unconditional HUMAN_ONLY block for AGENT-kind actors). This is that
 * action's only executable path.
 */
async function runPatchLiveHumanClaimedExecution<T>(input: {
  readonly patch: PatchArtifact;
  readonly deciderId: string;
  readonly decisionReason: string;
  readonly approvalId: string;
  readonly requestId: string;
  readonly routeLabel: string;
  readonly action: EntityAction;
  readonly execute: () => T;
  readonly evidence: (value: T) => string;
}): Promise<HelperResult<T>> {
  return runLiveHumanDecisionExecution({
    approvalId: input.approvalId,
    deciderId: input.deciderId,
    decisionReason: input.decisionReason,
    entityType: "DOCUMENT",
    action: input.action,
    artifactHash: patchArtifactHash(input.patch),
    requestId: input.requestId,
    sourceContext: { origin: "user_message", trustLevel: "trusted" },
    ...(input.patch.projectId ? { projectId: input.patch.projectId } : {}),
    routeLabel: input.routeLabel,
    dispatchInput: { patchId: input.patch.id, route: input.routeLabel },
    executeOnce: async () => {
      try {
        const value = input.execute();
        return {
          kind: "SUCCESS",
          value,
          outputEvidence: input.evidence(value),
        };
      } catch (error) {
        return {
          kind: "FAILURE",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

const decideAndExecuteBody = z.object({
  approvalId: z.string().uuid(),
  decisionReason: z.string().min(1).max(2000),
  workspaceRoot: z.string().min(1).max(1000),
});

async function sendPatchHelperResult<T>(
  reply: FastifyReply,
  helper: HelperResult<T>,
): Promise<T> {
  if (helper.status === "EXECUTED") {
    // Terminal FULFILLED replay has no gate. Do not report a second success
    // and do not run the callback again.
    if (helper.gate === undefined) {
      throw new AtlasError(
        "FORBIDDEN",
        helper.approval
          ? `Approval request ${helper.approval.id} is already finalized`
          : "approval already finalized",
        { statusCode: 403 },
      );
    }
    return helper.value;
  }
  if (helper.status === "APPROVAL_REQUIRED") {
    const extras =
      helper.gate.decision === "APPROVAL_REQUIRED"
        ? { riskScore: helper.gate.score, riskBucket: helper.gate.bucket }
        : undefined;
    return reply.status(202).send(
      approvalRequiredBody(helper.approvalRequestId, extras),
    ) as T;
  }
  throwPatchHelperFailure(helper);
}

const analyzeBody = z.object({
  workspaceRoot: z.string().min(1).max(1000),
  query: z.string().max(500).optional(),
});

const proposeBody = z.object({
  workspaceRoot: z.string().min(1).max(1000),
  userRequest: z.string().min(3).max(4000),
  mode: z.enum(ENGINEERING_AGENT_MODES).default("generate"),
  projectId: z.string().uuid().nullable().optional(),
  title: z.string().max(200).optional(),
});

export async function registerCodeRoutes(app: FastifyInstance): Promise<void> {
  async function resolveStudioWorkspaceRoot(
    request: FastifyRequest,
    q: { projectId?: string | undefined; workspaceRoot?: string | undefined },
  ): Promise<string> {
    const user = await requireUser(app, request);
    const control = isControlPlaneRole(user.role);
    if (q.projectId) {
      await assertProjectReadAccess(app, request, q.projectId);
      const stored = osStore.getWorkspaceRoot(q.projectId);
      if (stored) return resolve(stored);
      if (control && q.workspaceRoot) return resolve(q.workspaceRoot);
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Link a local workspaceRoot on the project to open Studio.",
      );
    }
    if (control && q.workspaceRoot) return resolve(q.workspaceRoot);
    throw new AtlasError(
      "FORBIDDEN",
      "Studio requires a project you own. Raw workspaceRoot is Control Plane only.",
      { statusCode: 403 },
    );
  }

  /** Studio project tree (view). Humans save files via PUT /studio/file. */
  app.get("/api/v1/studio/tree", async (request) => {
    const q = z
      .object({
        projectId: z.string().uuid().optional(),
        workspaceRoot: z.string().min(1).max(1000).optional(),
      })
      .parse(request.query);
    const root = await resolveStudioWorkspaceRoot(request, q);
    if (!existsSync(root)) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        `workspaceRoot not found on the API host: ${root}`,
      );
    }
    try {
      const listed = listWorkspaceTree(root);
      return {
        projectId: q.projectId ?? null,
        ...listed,
        note: "Tree is viewable. Humans save via PUT /api/v1/studio/file. Agent clone/ask remain Patch propose — Approve then Apply.",
      };
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Failed to list workspace",
      );
    }
  });

  /** Studio: single file contents. Humans may save via PUT. */
  app.get("/api/v1/studio/file", async (request) => {
    const q = z
      .object({
        projectId: z.string().uuid().optional(),
        workspaceRoot: z.string().min(1).max(1000).optional(),
        path: z.string().min(1).max(1000),
      })
      .parse(request.query);
    const root = await resolveStudioWorkspaceRoot(request, q);
    try {
      return {
        projectId: q.projectId ?? null,
        workspaceRoot: root,
        ...readWorkspaceFile(root, q.path),
        note: "Editable in Studio via PUT /api/v1/studio/file. Agent patches still require Approve then Apply.",
      };
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Failed to read file",
      );
    }
  });

  /**
   * Studio → agent: propose a Patch (fix/add). Does not apply.
   * Disk writes remain on Approve → Apply only.
   */
  app.post("/api/v1/studio/ask-agent", async (request, reply) => {
    const body = z
      .object({
        projectId: z.string().uuid().nullable().optional(),
        workspaceRoot: z.string().min(1).max(1000).optional(),
        path: z.string().max(1000).optional(),
        mode: z
          .enum(["fix", "generate", "implement", "refactor", "secure"])
          .default("fix"),
        instruction: z.string().min(3).max(4000),
      })
      .parse(request.body);

    let root: string | null = body.workspaceRoot ? resolve(body.workspaceRoot) : null;
    if (body.projectId) {
      root = osStore.getWorkspaceRoot(body.projectId) ?? root;
    }
    if (!root || !existsSync(root)) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Studio ask-agent requires a local workspaceRoot on the API host.",
      );
    }

    const focus = body.path?.trim()
      ? `Focus file: ${body.path.trim()}\n\n`
      : "";
    return createProposal(
      {
        workspaceRoot: root,
        userRequest: `${focus}${body.instruction.trim()}`,
        mode: body.mode,
        projectId: body.projectId ?? null,
        title: body.path
          ? `Studio · ${body.mode} · ${body.path}`
          : `Studio · ${body.mode}`,
      },
      reply,
      request,
    );
  });

  app.put("/api/v1/studio/file", async (request, reply) => {
    const body = studioWriteFileBodySchema
      .extend({
        approvalId: z.string().uuid().optional(),
        decisionReason: z.string().trim().min(1).max(2000).optional(),
      })
      .parse(request.body);
    const user = await assertProjectWriteAccess(app, request, body.projectId);
    const root = osStore.getWorkspaceRoot(body.projectId);
    if (!root || !existsSync(root)) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Link a local workspaceRoot before saving a file in Studio.",
        { statusCode: 400 },
      );
    }

    const persistStudioWrite = () => {
      const written = writeWorkspaceFile(root, body.path, body.content);
      const now = new Date().toISOString();
      osStore.appendAudit({
        type: "studio.file.written",
        projectId: body.projectId,
        path: written.path,
        bytes: written.bytes,
        by: user.id,
        at: now,
        applicationId: isAtlasSelfStudioProject(body.projectId)
          ? ATLAS_SELF_APPLICATION_ID
          : undefined,
      });
      const memory = memorySchema.parse({
        id: crypto.randomUUID(),
        ownerId: user.id,
        type: "PROJECT_STATE",
        projectId: body.projectId,
        statement: `Human edited ${written.path} in Studio (${written.bytes} bytes).`,
        reason: ["studio-human-write"],
        status: "ACTIVE",
        confidence: 0.7,
        category: "EVENT_MEMORY",
        epistemicState: "PROPOSED",
        observationMode: "OBSERVED",
        source: "studio",
        sourceType: "USER",
        sourceId: written.path,
        evidence: [],
        supersededBy: null,
        validFrom: now,
        validUntil: null,
        observedAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: user.email,
        scope: "PROJECT",
        priority: "MEDIUM",
      });
      osStore.addMemory(memory);
      return {
        ...written,
        note: "Saved to disk. Personal agent recorded PROJECT_STATE in memory.",
      };
    };

    if (isAtlasSelfStudioProject(body.projectId)) {
      const deniedReason = atlasSelfStudioWriteDeniedReason(body.path);
      if (deniedReason) {
        auditAtlasSelfDecision({
          type: "studio.file.write",
          actorId: user.id,
          routeLabel: "studio.file.write",
          decision: "DENY",
          reason: `Atlas-self Studio write blocked: ${deniedReason}`,
          executed: false,
          verificationVerdict: "BLOCKED",
          extra: { path: body.path, projectId: body.projectId },
        });
        throw new AtlasError(
          "FORBIDDEN",
          "Atlas-self Studio write blocked by self-modification boundary",
          { statusCode: 403 },
        );
      }

      const artifactHash = hashAtlasSelfFileArtifact({
        projectId: body.projectId,
        path: body.path,
        content: body.content,
      });
      if (body.approvalId) {
        if (!body.decisionReason) {
          throw new AtlasError(
            "VALIDATION_ERROR",
            "decisionReason is required for an Atlas-self live-human decision",
          );
        }
        const helper = await executeAtlasSelfLiveHuman({
          approvalId: body.approvalId,
          deciderId: user.id,
          decisionReason: body.decisionReason,
          entityType: "CONFIGURATION",
          action: "UPDATE",
          artifactHash,
          requestId: request.id,
          routeLabel: "studio.file.write",
          projectId: body.projectId,
          dispatchInput: {
            applicationId: ATLAS_SELF_APPLICATION_ID,
            projectId: body.projectId,
            path: body.path,
          },
          executeOnce: async () => {
            try {
              const written = persistStudioWrite();
              return atlasSelfExecutedEvidence(
                {
                  ...written,
                  executed: true,
                  verified: false,
                  applicationId: ATLAS_SELF_APPLICATION_ID,
                },
                { path: written.path, bytes: written.bytes },
              );
            } catch (error) {
              return {
                kind: "FAILURE" as const,
                reason: error instanceof Error ? error.message : "Failed to save file",
              };
            }
          },
        });
        if (helper.status === "EXECUTED") {
          auditAtlasSelfDecision({
            type: "studio.file.written",
            actorId: user.id,
            routeLabel: "studio.file.write",
            decision: "ALLOW",
            reason: "Independent live-human approval wrote Atlas-self workspace file",
            approvalId: body.approvalId,
            approvalStatus: helper.approvalRecord?.status ?? "CLAIMED",
            executed: true,
            verificationVerdict: "INCONCLUSIVE",
            extra: { path: body.path, projectId: body.projectId },
          });
        }
        return respondAtlasSelfHelper(reply, helper);
      }

      const approval = await mintAtlasSelfApproval({
        entityType: "CONFIGURATION",
        action: "UPDATE",
        requestedBy: user.id,
        reason: `Studio write ${body.path} on Atlas-self project`,
        route: "studio.file.write",
        artifactHash,
        extraContext: { path: body.path, projectId: body.projectId },
      });
      auditAtlasSelfDecision({
        type: "studio.file.write",
        actorId: user.id,
        routeLabel: "studio.file.write",
        decision: "REQUIRE_APPROVAL",
        reason: "Atlas-self Studio write requires independent approval",
        approvalId: approval.id,
        approvalStatus: approval.status,
        executed: false,
        extra: { path: body.path, projectId: body.projectId },
      });
      return reply.status(202).send({
        status: "APPROVAL_REQUIRED" as const,
        approvalId: approval.id,
        applicationId: ATLAS_SELF_APPLICATION_ID,
        executed: false,
        verified: false,
        message:
          "Atlas-self workspace write requires an independent live-human decision. Retry with approvalId and decisionReason from a different authenticated identity.",
      });
    }

    try {
      return persistStudioWrite();
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Failed to save file",
        { statusCode: 400 },
      );
    }
  });

  async function requireControlPlaneWorkspace(request: FastifyRequest): Promise<void> {
    const user = await requireUser(app, request);
    if (!isControlPlaneRole(user.role)) {
      throw new AtlasError(
        "FORBIDDEN",
        "Code analysis of a raw workspaceRoot is Control Plane only.",
        { statusCode: 403 },
      );
    }
  }

  app.post("/api/v1/code/analyze", async (request) => {
    await requireControlPlaneWorkspace(request);
    const body = analyzeBody.parse(request.body);
    const root = resolve(body.workspaceRoot);
    const analysis = analyzeRepository(root);
    const impact = body.query ? analyzeImpact(root, body.query) : null;
    return { analysis, impact, epistemicState: "OBSERVED" as const };
  });

  app.post("/api/v1/code/impact", async (request) => {
    await requireControlPlaneWorkspace(request);
    const body = analyzeBody.extend({ query: z.string().min(1) }).parse(request.body);
    return {
      impact: analyzeImpact(resolve(body.workspaceRoot), body.query),
      epistemicState: "INFERRED" as const,
    };
  });

  app.post("/api/v1/code/risks", async (request) => {
    const body = z
      .object({
        items: z
          .array(
            z.object({
              name: z.string(),
              impact: z.number().min(1).max(5),
              probability: z.number().min(1).max(5),
              changeSurface: z.number().min(1).max(5),
              uncertainty: z.number().min(1).max(5),
              missingEvidence: z.number().min(1).max(5),
            }),
          )
          .min(1)
          .max(50),
      })
      .parse(request.body);
    return { items: rankRisks(body.items) };
  });

  async function createProposal(
    body: z.infer<typeof proposeBody>,
    reply: { status: (c: number) => { send: (b: unknown) => unknown } },
    request?: FastifyRequest,
  ) {
    let memoryItems: Array<{
      statement: string;
      type: string;
      epistemicState: string;
    }> = [];
    if (request) {
      try {
        const user = await getRequestUser(app, request);
        if (user) {
          const ctx = buildMemoryContext({
            projectId: body.projectId ?? null,
            query: body.userRequest,
            budget: 12,
            ownerId: user.id,
            requestingAgentId: "CODE_ENGINEER",
          });
          memoryItems = ctx.items;
        }
      } catch {
        memoryItems = [];
      }
    }
    const proposal = proposePatch({
      workspaceRoot: body.workspaceRoot,
      mode: body.mode as EngineeringAgentMode,
      userRequest: body.userRequest,
      ...(body.title ? { title: body.title } : {}),
      ...(memoryItems.length > 0 ? { memoryContext: { items: memoryItems } } : {}),
    });
    if (proposal.filesChanged.length === 0) {
      return reply.status(200).send({
        patch: null,
        analysisGraph: proposal.analysisGraph,
        evaluationSummary: proposal.evaluationSummary,
        note: "Analyze/plan — no Patch created. Switch mode to Generate/Fix/… for applyable changes.",
        memoryUsed: memoryItems.length,
      });
    }
    const now = new Date().toISOString();
    const patch = patchArtifactSchema.parse({
      id: crypto.randomUUID(),
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
        unifiedDiff: f.unifiedDiff,
        afterContent: f.afterContent,
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
      createdBy: "atlas-code-intelligence",
      epistemicState: "PROPOSED",
      confidence: 0.55,
      authorityHint: "LLM_INFERENCE",
    });
    osStore.upsertPatch(patch);
    osStore.appendAudit({
      type: "code.patch.proposed",
      patchId: patch.id,
      mode: patch.mode,
      risk: patch.risk,
      at: now,
    });
    return reply.status(201).send({
      patch,
      analysisGraph: proposal.analysisGraph,
      memoryUsed: memoryItems.length,
      note: "Patch proposed — Approve then Apply (ADR-015). Not applied yet.",
    });
  }

  app.post("/api/v1/code/patch", async (request, reply) => {
    const body = proposeBody.parse(request.body);
    return createProposal(body, reply, request);
  });

  app.post("/api/v1/code/explain", async (request) => {
    await requireControlPlaneWorkspace(request);
    const body = proposeBody.parse(request.body);
    const analysis = analyzeRepository(resolve(body.workspaceRoot));
    return {
      explanation: [
        `Mode context: explain`,
        body.userRequest,
        "",
        analysis.graphHint,
        "",
        "Epistemic: INFERRED from repository structure scan.",
      ].join("\n"),
      analysis,
    };
  });

  app.get("/api/v1/code/patches", async (request) => {
    const user = await requireUser(app, request);
    const q = request.query as { projectId?: string };
    if (q.projectId) {
      await assertEntityReadAccess(app, request, q.projectId);
    }
    let items = osStore.listPatches(q.projectId ?? undefined);
    if (!q.projectId) {
      items = items.filter((p) => canReadProjectScoped(user, p.projectId));
    }
    return { items, page: 1, pageSize: items.length, total: items.length };
  });

  app.get("/api/v1/code/patches/:id", async (request, reply) => {
    await requireUser(app, request);
    const id = (request.params as { id: string }).id;
    const patch = osStore.getPatch(id);
    if (!patch) {
      return reply.status(404).send({ error: { message: "Patch not found" } });
    }
    await assertEntityReadAccess(app, request, patch.projectId);
    return patch;
  });

  app.post("/api/v1/code/patches/:id/approve", async (request, reply) => {
    await requireSignedInForWrite(app, request);
    const id = (request.params as { id: string }).id;
    const body = approvePatchSchema.parse(request.body ?? {});
    const existing = osStore.getPatch(id);
    if (!existing) {
      return reply.status(404).send({ error: { message: "Patch not found" } });
    }
    const user = await assertPatchWrite(app, request, existing);
    return approvePatchArtifact(existing, {
      approvedBy: body.approvedBy?.trim() || user.email,
      ...(body.note !== undefined ? { note: body.note } : {}),
      userId: user.id,
    });
  });

  app.post("/api/v1/code/patches/:id/apply", async (request, reply) => {
    await requireSignedInForWrite(app, request);
    const id = (request.params as { id: string }).id;
    const body = applyPatchSchema.parse(request.body ?? {});
    const query = z
      .object({ approvalId: z.string().uuid().optional() })
      .parse(request.query ?? {});
    const existing = osStore.getPatch(id);
    if (!existing) {
      return reply.status(404).send({ error: { message: "Patch not found" } });
    }
    const user = await assertPatchWrite(app, request, existing);

    // Preserve the existing invariant (403 "approve first") before layering
    // the new risk-based gate on top — a patch that never went through the
    // pre-existing Approve step should fail exactly as it did before, not
    // get routed into a brand-new approval-request round trip instead.
    assertPatchApprovedForApply(existing);

    const { entityAuthz, score, bucket, explanation } = evaluatePatchActionRisk({
      patch: existing,
      entityApproved: true,
    });
    if (entityAuthz.decision === "DENIED") {
      throw new AtlasError("FORBIDDEN", entityAuthz.reason, {
        statusCode: 403,
      });
    }

    const needsApprovalRequest = bucket === "APPROVAL" || bucket === "HUMAN_ONLY";
    if (needsApprovalRequest && !query.approvalId) {
      const approval = await createApprovalRequest({
        entityType: "DOCUMENT",
        action: "EXECUTE",
        requestedBy: user.id,
        reason: `apply patch ${existing.id} (${explanation.bucket}, score=${explanation.score}): ${explanation.factors.join("; ")}`,
        context: {
          route: "code.patch.apply",
          patchId: existing.id,
          risk: existing.risk,
        },
      });
      return reply.status(202).send(approvalRequiredBody(approval.id, {
        riskScore: score,
        riskBucket: bucket,
      }));
    }

    // AUTO/AUTO_LOG: helper no-approval path. DOCUMENT.READ is Policy-ALLOWED
    // so this does not invent `approved: true` and does not force a
    // DOCUMENT.EXECUTE HUMAN_ONLY hold onto a patch already scored auto.
    // Approval-backed apply claims the minted DOCUMENT.EXECUTE record.
    const helper = await runPatchClaimedExecution({
      user,
      patch: existing,
      requestId: request.id,
      routeLabel: "code.patch.apply.gate",
      action: needsApprovalRequest ? "EXECUTE" : "READ",
      ...(needsApprovalRequest && query.approvalId
        ? { approvalRequestId: query.approvalId }
        : {}),
      execute: () =>
        applyApprovedPatch({
          existing,
          user,
          bodyWorkspaceRoot: body.workspaceRoot ?? null,
        }),
      evidence: (value) =>
        JSON.stringify({ status: value.patch.status, applied: value.apply.applied }),
    });
    const result = await sendPatchHelperResult(reply, helper);
    if (helper.status !== "EXECUTED") {
      return result;
    }

    appendUnifiedAuditEntry({
      type: "code.patch.applied",
      actorId: user.id,
      actorKind: "USER",
      reason: `${explanation.bucket} (score=${explanation.score}): ${explanation.factors.join("; ")}`,
      input: {
        patchId: existing.id,
        patchRisk: existing.risk,
        applyWorkspaceRoot: body.workspaceRoot ?? null,
      },
      output: { status: result.patch.status, applied: result.apply.applied },
      policy: "DOCUMENT.EXECUTE",
      risk: existing.risk,
      approval: needsApprovalRequest ? "APPROVED" : "NOT_REQUIRED",
      result: "SUCCESS",
      projectId: existing.projectId,
    });

    return result;
  });

  app.post(
    "/api/v1/code/patches/:id/apply/decide-and-execute",
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const body = decideAndExecuteBody.parse(request.body ?? {});
      const existing = osStore.getPatch(id);
      if (!existing) {
        return reply.status(404).send({ error: { message: "Patch not found" } });
      }
      const user = await assertPatchWrite(app, request, existing);
      assertPatchApprovedForApply(existing);

      const { entityAuthz, explanation } = evaluatePatchActionRisk({
        patch: existing,
        entityApproved: true,
      });
      if (entityAuthz.decision === "DENIED") {
        throw new AtlasError("FORBIDDEN", entityAuthz.reason, {
          statusCode: 403,
        });
      }

      const helper = await runPatchLiveHumanClaimedExecution({
        patch: existing,
        deciderId: user.id,
        decisionReason: body.decisionReason,
        approvalId: body.approvalId,
        requestId: request.id,
        routeLabel: "code.patch.apply.live-human",
        action: "EXECUTE",
        execute: () =>
          applyApprovedPatch({
            existing,
            user,
            bodyWorkspaceRoot: body.workspaceRoot,
          }),
        evidence: (value) =>
          JSON.stringify({ status: value.patch.status, applied: value.apply.applied }),
      });
      const result = await sendPatchHelperResult(reply, helper);
      if (helper.status !== "EXECUTED") {
        return result;
      }

      appendUnifiedAuditEntry({
        type: "code.patch.applied",
        actorId: user.id,
        actorKind: "USER",
        reason: `live-human decision (${explanation.bucket}, score=${explanation.score}): ${explanation.factors.join("; ")}`,
        input: {
          patchId: existing.id,
          patchRisk: existing.risk,
          applyWorkspaceRoot: body.workspaceRoot,
        },
        output: { status: result.patch.status, applied: result.apply.applied },
        policy: "DOCUMENT.EXECUTE",
        risk: existing.risk,
        approval: "APPROVED",
        result: "SUCCESS",
        projectId: existing.projectId,
      });

      return result;
    },
  );

  app.post("/api/v1/code/patches/:id/rollback", async (request, reply) => {
    await requireSignedInForWrite(app, request);
    const id = (request.params as { id: string }).id;
    const body = z
      .object({ workspaceRoot: z.string().min(1).max(1000) })
      .parse(request.body);
    const query = z
      .object({ approvalId: z.string().uuid().optional() })
      .parse(request.query ?? {});
    const existing = osStore.getPatch(id);
    if (!existing) {
      return reply.status(404).send({ error: { message: "Patch not found" } });
    }
    const user = await assertPatchWrite(app, request, existing);
    if (existing.status !== "APPLIED" && existing.status !== "VERIFIED") {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Only APPLIED or VERIFIED patches can roll back",
      );
    }

    const { entityAuthz, score, bucket, explanation } = evaluatePatchActionRisk({
      patch: existing,
      entityApproved: false,
    });
    if (entityAuthz.decision === "DENIED") {
      throw new AtlasError("FORBIDDEN", entityAuthz.reason, {
        statusCode: 403,
      });
    }

    const needsApprovalRequest = bucket === "APPROVAL" || bucket === "HUMAN_ONLY";
    if (needsApprovalRequest && !query.approvalId) {
      const approval = await createApprovalRequest({
        entityType: "DOCUMENT",
        action: "EXECUTE",
        requestedBy: user.id,
        reason: `rollback patch ${existing.id} (${explanation.bucket}, score=${explanation.score}): ${explanation.factors.join("; ")}`,
        context: {
          route: "code.patch.rollback",
          patchId: existing.id,
          risk: existing.risk,
        },
      });
      return reply.status(202).send(approvalRequiredBody(approval.id, {
        riskScore: score,
        riskBucket: bucket,
      }));
    }

    const helper = await runPatchClaimedExecution({
      user,
      patch: existing,
      requestId: request.id,
      routeLabel: "code.patch.rollback.gate",
      action: "EXECUTE",
      ...(query.approvalId !== undefined ? { approvalRequestId: query.approvalId } : {}),
      execute: () => {
        const restored = rollbackPatchFiles(body.workspaceRoot, existing.rollbackSnapshot);
        const now = new Date().toISOString();
        const patch = patchArtifactSchema.parse({
          ...existing,
          status: "ROLLED_BACK",
          updatedAt: now,
          evaluationSummary: `${existing.evaluationSummary ?? ""}\nRolled back ${restored.length} file(s).`,
        });
        osStore.upsertPatch(patch);
        osStore.appendAudit({
          type: "code.patch.rolled_back",
          patchId: id,
          at: now,
          by: user.id,
        });
        return { patch, restored };
      },
      evidence: (value) =>
        JSON.stringify({ status: value.patch.status, restored: value.restored }),
    });
    const executed = await sendPatchHelperResult(reply, helper);
    if (helper.status !== "EXECUTED") {
      return executed;
    }
    const { patch, restored } = executed;

    appendUnifiedAuditEntry({
      type: "code.patch.rolled_back",
      actorId: user.id,
      actorKind: "USER",
      reason: `${explanation.bucket} (score=${explanation.score}): ${explanation.factors.join("; ")}`,
      input: {
        patchId: existing.id,
        patchRisk: existing.risk,
        rollbackWorkspaceRoot: body.workspaceRoot,
      },
      output: { status: patch.status, restored },
      policy: "DOCUMENT.EXECUTE",
      risk: existing.risk,
      approval: needsApprovalRequest ? "APPROVED" : "NOT_REQUIRED",
      result: "SUCCESS",
      projectId: existing.projectId,
    });

    return { patch, restored };
  });

  app.post(
    "/api/v1/code/patches/:id/rollback/decide-and-execute",
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const body = decideAndExecuteBody.parse(request.body ?? {});
      const existing = osStore.getPatch(id);
      if (!existing) {
        return reply.status(404).send({ error: { message: "Patch not found" } });
      }
      const user = await assertPatchWrite(app, request, existing);
      if (existing.status !== "APPLIED" && existing.status !== "VERIFIED") {
        throw new AtlasError(
          "VALIDATION_ERROR",
          "Only APPLIED or VERIFIED patches can roll back",
        );
      }

      const { entityAuthz, explanation } = evaluatePatchActionRisk({
        patch: existing,
        entityApproved: false,
      });
      if (entityAuthz.decision === "DENIED") {
        throw new AtlasError("FORBIDDEN", entityAuthz.reason, {
          statusCode: 403,
        });
      }

      const helper = await runPatchLiveHumanClaimedExecution({
        patch: existing,
        deciderId: user.id,
        decisionReason: body.decisionReason,
        approvalId: body.approvalId,
        requestId: request.id,
        routeLabel: "code.patch.rollback.live-human",
        action: "EXECUTE",
        execute: () => {
          const restored = rollbackPatchFiles(body.workspaceRoot, existing.rollbackSnapshot);
          const now = new Date().toISOString();
          const patch = patchArtifactSchema.parse({
            ...existing,
            status: "ROLLED_BACK",
            updatedAt: now,
            evaluationSummary: `${existing.evaluationSummary ?? ""}\nRolled back ${restored.length} file(s).`,
          });
          osStore.upsertPatch(patch);
          osStore.appendAudit({
            type: "code.patch.rolled_back",
            patchId: id,
            at: now,
            by: user.id,
          });
          return { patch, restored };
        },
        evidence: (value) =>
          JSON.stringify({ status: value.patch.status, restored: value.restored }),
      });
      const executed = await sendPatchHelperResult(reply, helper);
      if (helper.status !== "EXECUTED") {
        return executed;
      }
      const { patch, restored } = executed;

      appendUnifiedAuditEntry({
        type: "code.patch.rolled_back",
        actorId: user.id,
        actorKind: "USER",
        reason: `live-human decision (${explanation.bucket}, score=${explanation.score}): ${explanation.factors.join("; ")}`,
        input: {
          patchId: existing.id,
          patchRisk: existing.risk,
          rollbackWorkspaceRoot: body.workspaceRoot,
        },
        output: { status: patch.status, restored },
        policy: "DOCUMENT.EXECUTE",
        risk: existing.risk,
        approval: "APPROVED",
        result: "SUCCESS",
        projectId: existing.projectId,
      });

      return { patch, restored };
    },
  );

  app.post("/api/v1/code/refactor", async (request, reply) => {
    const body = proposeBody.parse({
      ...(request.body as object),
      mode: "refactor",
    });
    return createProposal(body, reply, request);
  });

  app.post("/api/v1/code/fix", async (request, reply) => {
    const body = proposeBody.parse({
      ...(request.body as object),
      mode: "fix",
    });
    return createProposal(body, reply, request);
  });

  app.post("/api/v1/code/tests", async (request, reply) => {
    const body = proposeBody.parse({
      ...(request.body as object),
      mode: "test",
    });
    return createProposal(body, reply, request);
  });

  app.post("/api/v1/code/review", async (request) => {
    const body = proposeBody.parse(request.body);
    const analysis = analyzeRepository(resolve(body.workspaceRoot));
    const impact = analyzeImpact(resolve(body.workspaceRoot), body.userRequest);
    return {
      review: {
        summary: "Code review (INFERRED)",
        graph: analysis.graphHint,
        impact,
        recommendations: [
          "Propose a patch via /api/v1/code/patch",
          "Require human Approve before Apply",
          "Add regression tests for HIGH risk",
        ],
      },
      epistemicState: "INFERRED",
    };
  });

  // createPatchSchema available for direct validated creates
  app.post("/api/v1/code/patches", async (request, reply) => {
    const body = createPatchSchema.parse(request.body);
    const now = new Date().toISOString();
    const patch = patchArtifactSchema.parse({
      id: crypto.randomUUID(),
      projectId: body.projectId ?? null,
      title: body.title,
      reason: body.reason,
      mode: body.mode,
      status: "PROPOSED",
      risk: body.risk ?? "MEDIUM",
      baseCommit: body.baseCommit ?? null,
      targetBranch: body.targetBranch ?? null,
      filesChanged: body.filesChanged,
      evidenceIds: body.evidenceIds ?? [],
      claimIds: [],
      expectedImpact: body.expectedImpact ?? "",
      tests: body.tests ?? [],
      evaluationSummary: null,
      approvals: [],
      appliedAt: null,
      verifiedAt: null,
      rollbackRef: null,
      rollbackSnapshot: [],
      createdAt: now,
      updatedAt: now,
      createdBy: "api",
      epistemicState: "PROPOSED",
      confidence: 0.5,
      authorityHint: "DEVELOPER_STATEMENT",
    });
    osStore.upsertPatch(patch);
    return reply.status(201).send({ patch });
  });
}
