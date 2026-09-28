import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  applyPatchSchema,
  approvePatchSchema,
  createPatchSchema,
  rejectPatchSchema,
  patchArtifactSchema,
  studioWriteFileBodySchema,
  AtlasError,
  ATLAS_SELF_APPLICATION_ID,
  ENGINEERING_AGENT_MODES,
  isControlPlaneRole,
  memorySchema,
  type EngineeringAgentMode,
  type PatchArtifact,
  type PatchUnderstanding,
} from "@atlas/shared";
import {
  analyzeImpact,
  analyzeRepository,
  listWorkspaceTree,
  proposePatch,
  rankRisks,
  readWorkspaceFile,
  captureBaseState,
  currentFileSha256,
  rollbackPatchFiles,
  searchWorkspaceFiles,
  writeWorkspaceFile,
  moveWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspaceFile,
  deleteWorkspaceFolder,
} from "@atlas/code-intelligence";
import { z } from "zod";
import { isAgentActorRequest } from "../services/studio-actor.js";
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
import {
  buildMemoryContext,
  commitMemory,
  toMemoryCitations,
  type MemoryContextItem,
} from "../services/memory-pipeline.js";
import {
  assertEntityReadAccess,
  assertProjectReadAccess,
  assertProjectWriteAccess,
  canReadProjectScoped,
} from "../services/project-access.js";
import {
  approvePatchArtifact,
  applyApprovedPatch,
  assertPatchApplicable,
  assertPatchApprovedForApply,
  assertRollbackApplicable,
  patchArtifactHash,
  rejectPatchArtifact,
  resolveApplyWorkspaceRoot,
  resolveCorrectionContext,
  verifyGovernedCodePatch,
} from "../services/patch-write.js";
import { createApprovalRequest } from "../services/approvals.js";
import { appendUnifiedAuditEntry } from "../services/audit-log.js";
import {
  approvalRequiredBody,
  approvalWorkspaceContext,
  assertApprovalMatchesPatch,
  assertApprovalWorkspaceUnchanged,
  evaluatePatchActionRisk,
  governedPatchApply,
  runPatchClaimedExecution,
  runPatchLiveHumanClaimedExecution,
  sendPatchHelperResult,
} from "../services/patch-governance.js";
import {
  applySecretRemediationToProposal,
  parsePatchRemediationTarget,
} from "../services/patch-remediation-truth.js";
import { evaluateStudioProposalGuardian } from "../services/studio-agent-guardian.js";

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

const decideAndExecuteBody = z.object({
  approvalId: z.string().uuid(),
  decisionReason: z.string().min(1).max(2000),
  workspaceRoot: z.string().min(1).max(1000),
});

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
  focusPath: z.string().min(1).max(1000).optional(),
  findingId: z.string().min(1).max(200).optional(),
  // Stage 5 (D4): correction — references the REJECTED patch this proposal supersedes
  supersedesPatchId: z.string().uuid().optional(),
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

  /** Bounded Studio file search — linked project workspace only. No raw workspaceRoot. */
  app.get("/api/v1/studio/search", async (request) => {
    const q = z
      .object({
        projectId: z.string().uuid(),
        q: z.string().min(2).max(80),
      })
      .parse(request.query);
    const root = await resolveStudioWorkspaceRoot(request, {
      projectId: q.projectId,
    });
    try {
      const result = searchWorkspaceFiles(root, q.q);
      return {
        projectId: q.projectId ?? null,
        ...result,
      };
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Failed to search workspace",
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
        findingId: z.string().min(1).max(200).optional(),
        // Stage 5 (D4): correction — references the REJECTED patch this proposal supersedes
        supersedesPatchId: z.string().uuid().optional(),
      })
      .parse(request.body);

    const root = await resolveStudioWorkspaceRoot(request, {
      projectId: body.projectId ?? undefined,
      workspaceRoot: body.workspaceRoot,
    });
    if (!existsSync(root)) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Studio ask-agent requires a local workspaceRoot on the API host.",
      );
    }

    // Stage 5 (D4): validate the superseded patch before running the agent
    if (body.supersedesPatchId && body.projectId) {
      const rejected = osStore.getPatch(body.supersedesPatchId);
      if (!rejected || rejected.projectId !== body.projectId) {
        throw new AtlasError("VALIDATION_ERROR", "Superseded patch not found in this project", {
          statusCode: 400,
        });
      }
      if (rejected.status !== "REJECTED") {
        throw new AtlasError(
          "VALIDATION_ERROR",
          "Only a REJECTED patch can be superseded by a correction",
          { statusCode: 409 },
        );
      }
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
        ...(body.path?.trim() ? { focusPath: body.path.trim() } : {}),
        ...(body.findingId?.trim() ? { findingId: body.findingId.trim() } : {}),
        ...(body.supersedesPatchId ? { supersedesPatchId: body.supersedesPatchId } : {}),
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
    // Stage 4 (approved 2026-09-26): direct Studio file write is human-only,
    // at parity with POST /api/v1/studio/file/move. An agent must go through
    // the governed proposal/patch path. The agent header is a deny signal
    // only; it never grants authority.
    if (isAgentActorRequest(request.headers as Record<string, unknown>)) {
      throw new AtlasError("FORBIDDEN", "Studio file write is human-only.", {
        statusCode: 403,
      });
    }
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
      const written = writeWorkspaceFile(root, body.path, body.content, body.expectedHash);
      const now = new Date().toISOString();
      osStore.appendAudit({
        type: "studio.file.written",
        actorKind: "USER",
        actorId: user.id,
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
      void commitMemory({ memory, env: app.atlasEnv });
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
      const code = (error as { code?: string }).code;
      if (code === "OVERWRITE_HASH_REQUIRED" || code === "OVERWRITE_CONFLICT") {
        throw new AtlasError(
          "CONFLICT",
          error instanceof Error ? error.message : "Overwrite conflict",
          { statusCode: 409 },
        );
      }
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Failed to save file",
        { statusCode: 400 },
      );
    }
  });

  app.post("/api/v1/studio/file/move", async (request, reply) => {
    if (isAgentActorRequest(request.headers as Record<string, unknown>)) {
      throw new AtlasError("FORBIDDEN", "Studio file move is human-only.", {
        statusCode: 403,
      });
    }
    const body = z
      .object({
        projectId: z.string().uuid(),
        from: z.string().trim().min(1).max(500),
        to: z.string().trim().min(1).max(500),
        approvalId: z.string().uuid().optional(),
        decisionReason: z.string().trim().min(1).max(2000).optional(),
      })
      .parse(request.body);
    const user = await assertProjectWriteAccess(app, request, body.projectId);
    const root = osStore.getWorkspaceRoot(body.projectId);
    if (!root || !existsSync(root)) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Link a local workspaceRoot before moving a file in Studio.",
        { statusCode: 400 },
      );
    }

    const persistMove = () => {
      const moved = moveWorkspaceFile(root, body.from, body.to);
      osStore.appendAudit({
        type: "studio.file.moved",
        projectId: body.projectId,
        from: moved.from,
        to: moved.to,
        by: user.id,
        at: new Date().toISOString(),
      });
      return moved;
    };

    if (isAtlasSelfStudioProject(body.projectId)) {
      const denied =
        atlasSelfStudioWriteDeniedReason(body.from) ??
        atlasSelfStudioWriteDeniedReason(body.to);
      if (denied) {
        throw new AtlasError(
          "FORBIDDEN",
          "Atlas-self Studio move blocked by self-modification boundary",
          { statusCode: 403 },
        );
      }
      const artifactHash = hashAtlasSelfFileArtifact({
        projectId: body.projectId,
        path: body.to,
        content: body.from,
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
          routeLabel: "studio.file.move",
          projectId: body.projectId,
          dispatchInput: {
            applicationId: ATLAS_SELF_APPLICATION_ID,
            projectId: body.projectId,
            from: body.from,
            to: body.to,
          },
          executeOnce: async () => {
            try {
              const moved = persistMove();
              return atlasSelfExecutedEvidence(moved, moved);
            } catch (error) {
              return {
                kind: "FAILURE" as const,
                reason: error instanceof Error ? error.message : "Failed to move file",
              };
            }
          },
        });
        return respondAtlasSelfHelper(reply, helper);
      }
      const approval = await mintAtlasSelfApproval({
        entityType: "CONFIGURATION",
        action: "UPDATE",
        requestedBy: user.id,
        reason: `Studio move ${body.from} to ${body.to} on Atlas-self project`,
        route: "studio.file.move",
        artifactHash,
        extraContext: { from: body.from, to: body.to, projectId: body.projectId },
      });
      return reply.status(202).send({
        status: "APPROVAL_REQUIRED" as const,
        approvalId: approval.id,
        executed: false,
        message:
          "Atlas-self workspace move requires an independent live-human decision.",
      });
    }

    try {
      return persistMove();
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Failed to move file",
        { statusCode: 400 },
      );
    }
  });

  // ── Studio: create folder ────────────────────────────────────────────────
  app.post("/api/v1/studio/folder", async (request, reply) => {
    if (isAgentActorRequest(request.headers as Record<string, unknown>)) {
      throw new AtlasError("FORBIDDEN", "Studio folder create is human-only.", {
        statusCode: 403,
      });
    }
    const body = z
      .object({
        projectId: z.string().uuid(),
        path: z.string().trim().min(1).max(500),
      })
      .parse(request.body);
    const user = await assertProjectWriteAccess(app, request, body.projectId);
    const root = osStore.getWorkspaceRoot(body.projectId);
    if (!root || !existsSync(root)) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Link a local workspaceRoot before creating a folder in Studio.",
        { statusCode: 400 },
      );
    }
    try {
      const created = createWorkspaceFolder(root, body.path);
      osStore.appendAudit({
        type: "studio.folder.created",
        projectId: body.projectId,
        path: created.path,
        by: user.id,
        at: new Date().toISOString(),
      });
      return reply.status(200).send({ path: created.path });
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Failed to create folder",
        { statusCode: 400 },
      );
    }
  });

  // ── Studio: delete file ──────────────────────────────────────────────────
  app.delete("/api/v1/studio/file", async (request, reply) => {
    if (isAgentActorRequest(request.headers as Record<string, unknown>)) {
      throw new AtlasError("FORBIDDEN", "Studio file delete is human-only.", {
        statusCode: 403,
      });
    }
    const body = z
      .object({
        projectId: z.string().uuid(),
        path: z.string().trim().min(1).max(500),
      })
      .parse(request.body);
    const user = await assertProjectWriteAccess(app, request, body.projectId);
    const root = osStore.getWorkspaceRoot(body.projectId);
    if (!root || !existsSync(root)) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Link a local workspaceRoot before deleting a file in Studio.",
        { statusCode: 400 },
      );
    }
    if (isAtlasSelfStudioProject(body.projectId)) {
      const denied = atlasSelfStudioWriteDeniedReason(body.path);
      if (denied) {
        throw new AtlasError(
          "FORBIDDEN",
          "Atlas-self Studio delete blocked by self-modification boundary",
          { statusCode: 403 },
        );
      }
    }
    try {
      const deleted = deleteWorkspaceFile(root, body.path);
      osStore.appendAudit({
        type: "studio.file.deleted",
        projectId: body.projectId,
        path: deleted.path,
        by: user.id,
        at: new Date().toISOString(),
      });
      return reply.status(200).send({ path: deleted.path });
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Failed to delete file",
        { statusCode: 400 },
      );
    }
  });

  // ── Studio: delete empty folder ──────────────────────────────────────────
  app.delete("/api/v1/studio/folder", async (request, reply) => {
    if (isAgentActorRequest(request.headers as Record<string, unknown>)) {
      throw new AtlasError("FORBIDDEN", "Studio folder delete is human-only.", {
        statusCode: 403,
      });
    }
    const body = z
      .object({
        projectId: z.string().uuid(),
        path: z.string().trim().min(1).max(500),
      })
      .parse(request.body);
    const user = await assertProjectWriteAccess(app, request, body.projectId);
    const root = osStore.getWorkspaceRoot(body.projectId);
    if (!root || !existsSync(root)) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Link a local workspaceRoot before deleting a folder in Studio.",
        { statusCode: 400 },
      );
    }
    try {
      const deleted = deleteWorkspaceFolder(root, body.path);
      osStore.appendAudit({
        type: "studio.folder.deleted",
        projectId: body.projectId,
        path: deleted.path,
        by: user.id,
        at: new Date().toISOString(),
      });
      return reply.status(200).send({ path: deleted.path });
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Failed to delete folder",
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
    request: FastifyRequest,
  ) {
    const user = await requireSignedInForWrite(app, request);
    let workspaceRoot = resolve(body.workspaceRoot);
    if (body.projectId) {
      await assertProjectWriteAccess(app, request, body.projectId);
      const stored = osStore.getWorkspaceRoot(body.projectId);
      if (stored) {
        workspaceRoot = resolve(stored);
      } else if (!isControlPlaneRole(user.role)) {
        throw new AtlasError(
          "VALIDATION_ERROR",
          "Link a local workspaceRoot on the project before proposing a patch.",
        );
      }
    } else {
      await requireControlPlaneWorkspace(request);
    }

    // ARL-WS-005 (CORRECT / DIAGNOSE): when this proposal corrects a rejected
    // patch, resolve the failure context and prepend it to the userRequest so
    // the engineering agent understands what was tried before and why it
    // failed. The context is clearly labelled as prior-attempt observations —
    // never injected as new agent conclusions, never promoting epistemic state.
    let correctionContextBlock = "";
    let correctionContext = null;
    if (body.supersedesPatchId && body.projectId) {
      correctionContext = resolveCorrectionContext({
        supersedesPatchId: body.supersedesPatchId,
        projectId: body.projectId,
      });
      if (!correctionContext) {
        throw new AtlasError(
          "VALIDATION_ERROR",
          "Superseded patch not found in this project",
          { statusCode: 400 },
        );
      }
      // Build the context block. Separated clearly from the user's new request.
      const evidenceSummary =
        correctionContext.evidence.length > 0
          ? correctionContext.evidence
              .map((e) => `  [${e.epistemicState}] ${e.source}: ${e.excerpt.slice(0, 400)}`)
              .join("\n")
          : "  (no evidence records resolved)";
      const unresolvedNote =
        correctionContext.unresolvedEvidenceIds.length > 0
          ? `\n  Unresolved evidence IDs: ${correctionContext.unresolvedEvidenceIds.join(", ")}`
          : "";
      const understandingNote = correctionContext.understanding
        ? `Prior understanding: ${correctionContext.understanding.epistemicState} (gate: ${correctionContext.understanding.gate}). ${correctionContext.understanding.gateReason}`
        : "Prior understanding: not recorded";
      correctionContextBlock = [
        "=== CORRECTION CONTEXT (recorded facts from prior attempt — not new agent conclusions) ===",
        `Failed patch: ${correctionContext.failedPatchId}`,
        `Previous title: ${correctionContext.previousTitle}`,
        `Previous reason: ${correctionContext.previousReason}`,
        `Previous files: ${correctionContext.previousFilePaths.join(", ")}`,
        `Rejection by: ${correctionContext.rejection.by} at ${correctionContext.rejection.at}`,
        `Rejection reason: ${correctionContext.rejection.reason}`,
        understandingNote,
        "Prior evidence:",
        evidenceSummary + unresolvedNote,
        "=== END CORRECTION CONTEXT — new request follows ===",
        "",
      ].join("\n");
    }

    const effectiveUserRequest = correctionContextBlock
      ? `${correctionContextBlock}${body.userRequest}`
      : body.userRequest;

    let memoryItems: MemoryContextItem[] = [];
    const ownerId = user.id;
    try {
      const ctx = await buildMemoryContext({
        projectId: body.projectId ?? null,
        query: body.userRequest,
        budget: 12,
        ownerId: user.id,
        requestingAgentId: "CODE_ENGINEER",
        embeddingEnv: app.atlasEnv,
      });
      memoryItems = ctx.items;
    } catch {
      memoryItems = [];
    }
    const runGuardian = (files: readonly string[]) =>
      evaluateStudioProposalGuardian({
        projectId: body.projectId ?? null,
        ownerId,
        userRequest: body.userRequest,
        workspaceRoot,
        memories: memoryItems,
        proposedFiles: files,
        focusPath: body.focusPath ?? null,
      });
    const proposal = proposePatch({
      workspaceRoot,
      mode: body.mode as EngineeringAgentMode,
      userRequest: effectiveUserRequest,
      ...(body.title ? { title: body.title } : {}),
      ...(body.focusPath ? { focusPath: body.focusPath } : {}),
      ...(memoryItems.length > 0 ? { memoryContext: { items: memoryItems } } : {}),
    });
    const remediationTarget = parsePatchRemediationTarget({
      findingId: body.findingId ?? null,
      projectId: body.projectId ?? null,
      focusPath: body.focusPath ?? null,
    });
    const secretRewrite = applySecretRemediationToProposal({
      workspaceRoot,
      filesChanged: proposal.filesChanged,
      target: remediationTarget,
      mode: body.mode,
      focusPath: body.focusPath ?? null,
    });
    if (secretRewrite.unsupported) {
      const guardianEvaluation = runGuardian([]);
      return reply.status(200).send({
        patch: null,
        analysisGraph: proposal.analysisGraph,
        evaluationSummary: secretRewrite.unsupported.summary,
        findingRemediation: secretRewrite.unsupported,
        note: secretRewrite.unsupported.summary,
        memoryUsed: memoryItems.length,
        memoryCitations: toMemoryCitations(memoryItems),
        intelligenceKind: "heuristic",
        modelInvoked: false,
        guardianEvaluation,
      });
    }
    const filesChanged = secretRewrite.filesChanged;
    const guardianEvaluation = runGuardian(filesChanged.map((file) => file.path));
    if (guardianEvaluation.action === "BLOCK") {
      osStore.appendAudit({
        type: "code.guardian.blocked",
        projectId: body.projectId ?? null,
        verdict: guardianEvaluation.verdict,
        action: guardianEvaluation.action,
        at: new Date().toISOString(),
      });
      return reply.status(200).send({
        patch: null,
        analysisGraph: proposal.analysisGraph,
        evaluationSummary: guardianEvaluation.summary,
        note: guardianEvaluation.summary,
        memoryUsed: memoryItems.length,
        memoryCitations: toMemoryCitations(memoryItems),
        intelligenceKind: "heuristic",
        modelInvoked: false,
        guardianEvaluation,
      });
    }
    if (filesChanged.length === 0) {
      return reply.status(200).send({
        patch: null,
        analysisGraph: proposal.analysisGraph,
        evaluationSummary: proposal.evaluationSummary,
        note: "Analyze/plan — no Patch created. Switch mode to Generate/Fix/… for applyable changes.",
        memoryUsed: memoryItems.length,
        memoryCitations: toMemoryCitations(memoryItems),
        intelligenceKind: "heuristic",
        modelInvoked: false,
        guardianEvaluation,
      });
    }
    const now = new Date().toISOString();
    // Stage 5 (approved D2): the Understanding is explicit, persisted with
    // the patch, and gates proposal creation. CONFLICT and insufficient
    // target understanding block; UNKNOWN proceeds only as an explicit
    // UNVERIFIED understanding, never as a silent ALLOW.
    const targets = filesChanged.map((file) => {
      const baseSha256 = currentFileSha256(workspaceRoot, file.path);
      const observed = file.action === "add" ? baseSha256 === null : baseSha256 !== null;
      return { path: file.path, action: file.action, observed, baseSha256 };
    });
    const focusUnreadable =
      Boolean(body.focusPath) && currentFileSha256(workspaceRoot, body.focusPath!) === null;
    const unobserved = targets.filter((target) => !target.observed);
    let understandingState: PatchUnderstanding["epistemicState"];
    let gateReason: string;
    if (focusUnreadable || unobserved.length > 0) {
      understandingState = "INSUFFICIENT_EVIDENCE";
      gateReason = focusUnreadable
        ? `Focus file ${body.focusPath} could not be read in the workspace.`
        : `Target state not understood: ${unobserved
            .map((t) => `${t.path} (${t.action} but the file ${t.baseSha256 === null ? "does not exist" : "already exists"})`)
            .join(", ")}.`;
    } else if (guardianEvaluation.verdict === "CONFLICT") {
      understandingState = "CONFLICTED";
      gateReason = guardianEvaluation.summary;
    } else if (guardianEvaluation.verdict === "UNKNOWN") {
      understandingState = "UNVERIFIED";
      gateReason =
        "Targets observed; no project fact confirms or contradicts the request. UNVERIFIED understanding is blocked: explicit human confirmation is required to proceed.";
    } else {
      understandingState = "OBSERVED";
      gateReason = "Targets observed and consistent with observed project facts.";
    }
    const understanding: PatchUnderstanding = {
      id: crypto.randomUUID(),
      createdAt: now,
      projectId: body.projectId ?? null,
      workspaceRoot,
      request: body.userRequest.slice(0, 4000),
      focusPath: body.focusPath ?? null,
      targets,
      repository: guardianEvaluation.repository,
      guardian: {
        verdict: guardianEvaluation.verdict,
        action: guardianEvaluation.action,
        summary: guardianEvaluation.summary.slice(0, 1000),
        knowledgeUsed: guardianEvaluation.knowledgeUsed,
        conflicts: guardianEvaluation.conflicts.length,
      },
      memoryIdsUsed: memoryItems.map((item) => item.id).slice(0, 50),
      epistemicState: understandingState,
      gate:
        understandingState === "INSUFFICIENT_EVIDENCE" ||
        understandingState === "CONFLICTED" ||
        understandingState === "UNVERIFIED"
          ? "BLOCKED"
          : "PROCEED",
      gateReason: gateReason.slice(0, 1000),
    };
    if (understanding.gate === "BLOCKED") {
      appendUnifiedAuditEntry({
        type: "code.proposal.blocked",
        actorId: "CODE_ENGINEER",
        actorKind: "AGENT",
        agentId: "CODE_ENGINEER",
        ownerId: user.id,
        reason: understanding.gateReason,
        correlationId: understanding.id,
        input: { understanding, onBehalfOfUserId: user.id },
        output: {},
        policy: "studio.proposal.understanding",
        risk: proposal.risk,
        approval: "NOT_REQUIRED",
        result: "FAILURE",
        decision: "DENY",
        blockedAt: "UNDERSTANDING",
        projectId: body.projectId ?? null,
      });
      return reply.status(200).send({
        patch: null,
        understanding,
        analysisGraph: proposal.analysisGraph,
        evaluationSummary: understanding.gateReason,
        note: `No patch: understanding is ${understanding.epistemicState}. ${understanding.gateReason}`,
        memoryUsed: memoryItems.length,
        memoryCitations: toMemoryCitations(memoryItems),
        intelligenceKind: "heuristic",
        modelInvoked: false,
        guardianEvaluation,
      });
    }
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
      filesChanged: filesChanged.map((f, index) => ({
        path: f.path,
        action: f.action,
        summary: f.summary,
        unifiedDiff: f.unifiedDiff,
        afterContent: f.afterContent,
        baseSha256: targets[index]!.baseSha256,
      })),
      evidenceIds: [],
      claimIds: [],
      expectedImpact: proposal.expectedImpact,
      tests: proposal.tests,
      understanding,
      evaluationSummary: [
        proposal.evaluationSummary,
        `Guardian: ${guardianEvaluation.verdict} (${guardianEvaluation.action}).`,
        `Understanding: ${understanding.epistemicState}.`,
        remediationTarget
          ? `Remediation target ${remediationTarget.findingId} (${remediationTarget.findingType}). PATCH_VERIFY ≠ finding remediation.`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 4000),
      ...(remediationTarget ? { remediationTarget } : {}),
      ...(body.supersedesPatchId ? { supersedesPatchId: body.supersedesPatchId } : {}),
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
      // Stage 4 attribution: the CODE_ENGINEER heuristic proposes on behalf
      // of the requesting human (server-set identity, never client input).
      actorKind: "AGENT",
      actorId: "CODE_ENGINEER",
      agentId: "CODE_ENGINEER",
      onBehalfOfUserId: user.id,
      patchId: patch.id,
      correlationId: patch.id,
      // ARL-WS-005 (AUDIT/CAUSATION): when this proposal corrects a rejected
      // patch, the causationId references the rejected patch's id. This makes
      // the causal relationship "correction caused by rejection" explicit in
      // the audit record without introducing a new audit architecture.
      // causationId = null for non-correction proposals (existing behavior).
      ...(patch.supersedesPatchId ? { causationId: patch.supersedesPatchId } : {}),
      understandingId: understanding.id,
      understandingState: understanding.epistemicState,
      mode: patch.mode,
      risk: patch.risk,
      findingId: patch.remediationTarget?.findingId ?? null,
      guardianVerdict: guardianEvaluation.verdict,
      supersedesPatchId: patch.supersedesPatchId ?? null,
      at: now,
    });
    return reply.status(201).send({
      patch,
      analysisGraph: proposal.analysisGraph,
      memoryUsed: memoryItems.length,
      memoryCitations: toMemoryCitations(memoryItems),
      intelligenceKind: "heuristic",
      modelInvoked: false,
      guardianEvaluation,
      understanding,
      // ARL-WS-005: expose resolved correction context in the response so
      // callers can confirm what failure context was supplied to the agent.
      ...(correctionContext ? { correctionContext } : {}),
      note: "Patch proposed by CODE_ENGINEER heuristic (not an LLM). Approve then Apply (ADR-015). Not applied yet. Not Truth.",
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
    // Stage 5 (G-7): the approver is the authenticated session. A client
    // `approvedBy` value is ignored.
    return approvePatchArtifact(existing, {
      approvedBy: user.email,
      ...(body.note !== undefined ? { note: body.note } : {}),
      userId: user.id,
    });
  });

  /** Stage 5 (approved D4): terminal, reasoned, audited rejection. */
  app.post("/api/v1/code/patches/:id/reject", async (request, reply) => {
    await requireSignedInForWrite(app, request);
    const id = (request.params as { id: string }).id;
    const body = rejectPatchSchema.parse(request.body ?? {});
    const existing = osStore.getPatch(id);
    if (!existing) {
      return reply.status(404).send({ error: { message: "Patch not found" } });
    }
    const user = await assertPatchWrite(app, request, existing);
    return rejectPatchArtifact(existing, { user, reason: body.reason });
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
    return governedPatchApply({
      reply,
      existing,
      user,
      requestId: request.id,
      bodyWorkspaceRoot: body.workspaceRoot ?? null,
      approvalId: query.approvalId ?? null,
      env: app.atlasEnv,
    });
  });

  app.post("/api/v1/code/patches/:id/verify", async (request, reply) => {
    await requireSignedInForWrite(app, request);
    const id = (request.params as { id: string }).id;
    const body = z
      .object({
        workspaceRoot: z.string().min(1).max(1000).optional(),
        projectId: z.string().uuid().optional(),
      })
      .parse(request.body ?? {});
    const existing = osStore.getPatch(id);
    if (!existing) {
      return reply.status(404).send({ error: { message: "Patch not found" } });
    }
    const user = await assertPatchWrite(app, request, existing);
    const { patch, verify, findingRemediation, patchVerifyStatus } =
      verifyGovernedCodePatch({
        existing,
        user,
        bodyWorkspaceRoot: body.workspaceRoot ?? null,
        projectId: body.projectId ?? null,
      });

    appendUnifiedAuditEntry({
      type: "code.patch.verified",
      actorId: user.id,
      actorKind: "USER",
      correlationId: existing.id,
      reason: [
        verify.summary,
        findingRemediation.summary,
      ].join(" | "),
      input: {
        patchId: existing.id,
        patchStatus: existing.status,
        verifyWorkspaceRoot: body.workspaceRoot ?? null,
        findingId: existing.remediationTarget?.findingId ?? null,
      },
      output: {
        status: patch.status,
        ok: verify.ok,
        patchVerifyStatus,
        remediationResult: findingRemediation.result,
        remediationVerifyStatus: findingRemediation.verifyStatus,
        findingPresence: findingRemediation.findingPresence,
      },
      policy: "code.patch.verify",
      risk: existing.risk,
      approval: "NOT_REQUIRED",
      result: verify.ok ? "SUCCESS" : "FAILURE",
      projectId: existing.projectId,
    });

    if (!verify.ok) {
      throw new AtlasError("CONFLICT", verify.summary, { statusCode: 409 });
    }
    return {
      patch,
      verify,
      patchVerifyStatus,
      findingRemediation,
      epistemicState: "OBSERVED" as const,
    };
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

      await assertApprovalMatchesPatch(body.approvalId, existing.id, "code.patch.apply");
      await assertApprovalWorkspaceUnchanged(body.approvalId, existing.projectId);
      assertPatchApplicable({
        patch: existing,
        workspaceRoot: resolveApplyWorkspaceRoot({
          projectId: existing.projectId,
          bodyWorkspaceRoot: body.workspaceRoot,
        }),
        actorId: user.id,
      });

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
            env: app.atlasEnv,
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
        correlationId: existing.id,
        causationId: body.approvalId,
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

    const rollbackRoot = resolveApplyWorkspaceRoot({
      projectId: existing.projectId,
      bodyWorkspaceRoot: body.workspaceRoot,
      requireProjectRoot: Boolean(existing.projectId),
    });
    assertRollbackApplicable({ patch: existing, workspaceRoot: rollbackRoot, actorId: user.id });

    const needsApprovalRequest = bucket === "APPROVAL" || bucket === "HUMAN_ONLY";
    if (needsApprovalRequest && !query.approvalId) {
      const approval = await createApprovalRequest({
        entityType: "DOCUMENT",
        action: "EXECUTE",
        requestedBy: user.id,
        reason: `rollback patch ${existing.id} (${explanation.bucket}, score=${explanation.score}): ${explanation.factors.join("; ")}`,
        artifactHash: patchArtifactHash(existing),
        context: {
          route: "code.patch.rollback",
          patchId: existing.id,
          correlationId: existing.id,
          risk: existing.risk,
          workspaceRoot: approvalWorkspaceContext(existing.projectId),
        },
      });
      return reply.status(202).send(approvalRequiredBody(approval.id, {
        riskScore: score,
        riskBucket: bucket,
      }));
    }

    const workspaceRoot = resolveApplyWorkspaceRoot({
      projectId: existing.projectId,
      bodyWorkspaceRoot: body.workspaceRoot,
      requireProjectRoot: Boolean(existing.projectId),
    });
    if (query.approvalId) {
      await assertApprovalMatchesPatch(query.approvalId, existing.id, "code.patch.rollback");
      await assertApprovalWorkspaceUnchanged(query.approvalId, existing.projectId);
    }

    const helper = await runPatchClaimedExecution({
      user,
      patch: existing,
      requestId: request.id,
      routeLabel: "code.patch.rollback.gate",
      action: "EXECUTE",
      ...(query.approvalId !== undefined ? { approvalRequestId: query.approvalId } : {}),
      execute: () => {
        // Patched-path restore only — see rollbackPatchFiles contract.
        // Stage 5 (D3): re-check right before writing (TOCTOU).
        assertRollbackApplicable({ patch: existing, workspaceRoot, actorId: user.id });
        const restored = rollbackPatchFiles(workspaceRoot, existing.rollbackSnapshot);
        const now = new Date().toISOString();
        const patch = patchArtifactSchema.parse({
          ...existing,
          status: "ROLLED_BACK",
          updatedAt: now,
          evaluationSummary: `${existing.evaluationSummary ?? ""}\nRolled back ${restored.length} patched path(s) to the pre-apply snapshot.`,
        });
        osStore.upsertPatch(patch);
        osStore.appendAudit({
          type: "code.patch.rolled_back",
          patchId: id,
          correlationId: id,
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
      correlationId: existing.id,
      ...(query.approvalId !== undefined ? { causationId: query.approvalId } : {}),
      reason: `${explanation.bucket} (score=${explanation.score}): ${explanation.factors.join("; ")}`,
      input: {
        patchId: existing.id,
        patchRisk: existing.risk,
        rollbackWorkspaceRoot: workspaceRoot,
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

      const workspaceRoot = resolveApplyWorkspaceRoot({
        projectId: existing.projectId,
        bodyWorkspaceRoot: body.workspaceRoot,
        requireProjectRoot: Boolean(existing.projectId),
      });
      await assertApprovalMatchesPatch(body.approvalId, existing.id, "code.patch.rollback");
      await assertApprovalWorkspaceUnchanged(body.approvalId, existing.projectId);
      assertRollbackApplicable({ patch: existing, workspaceRoot, actorId: user.id });

      const helper = await runPatchLiveHumanClaimedExecution({
        patch: existing,
        deciderId: user.id,
        decisionReason: body.decisionReason,
        approvalId: body.approvalId,
        requestId: request.id,
        routeLabel: "code.patch.rollback.live-human",
        action: "EXECUTE",
        execute: () => {
          assertRollbackApplicable({ patch: existing, workspaceRoot, actorId: user.id });
          const restored = rollbackPatchFiles(workspaceRoot, existing.rollbackSnapshot);
          const now = new Date().toISOString();
          const patch = patchArtifactSchema.parse({
            ...existing,
            status: "ROLLED_BACK",
            updatedAt: now,
            evaluationSummary: `${existing.evaluationSummary ?? ""}\nRolled back ${restored.length} patched path(s) to the pre-apply snapshot.`,
          });
          osStore.upsertPatch(patch);
          osStore.appendAudit({
            type: "code.patch.rolled_back",
            patchId: id,
            correlationId: id,
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
        correlationId: existing.id,
        causationId: body.approvalId,
        reason: `live-human decision (${explanation.bucket}, score=${explanation.score}): ${explanation.factors.join("; ")}`,
        input: {
          patchId: existing.id,
          patchRisk: existing.risk,
          rollbackWorkspaceRoot: workspaceRoot,
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
    await requireControlPlaneWorkspace(request);
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
    const user = await requireSignedInForWrite(app, request);
    const body = createPatchSchema.parse(request.body);
    for (const file of body.filesChanged) {
      const rel = file.path.replace(/\\/g, "/");
      if (rel.includes("..") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) {
        throw new AtlasError(
          "VALIDATION_ERROR",
          "path must be a relative workspace path without traversal",
          { statusCode: 400, details: { path: file.path } },
        );
      }
    }
    if (!body.projectId) {
      throw new AtlasError("VALIDATION_ERROR", "projectId is required to create a patch", {
        statusCode: 400,
      });
    }
    await assertProjectWriteAccess(app, request, body.projectId);

    // Stage 5 (D4): a correction references the REJECTED patch it replaces.
    if (body.supersedesPatchId) {
      const rejected = osStore.getPatch(body.supersedesPatchId);
      if (!rejected || rejected.projectId !== body.projectId) {
        throw new AtlasError("VALIDATION_ERROR", "Superseded patch not found in this project", {
          statusCode: 400,
        });
      }
      if (rejected.status !== "REJECTED") {
        throw new AtlasError(
          "VALIDATION_ERROR",
          "Only a REJECTED patch can be superseded by a correction",
          { statusCode: 409 },
        );
      }
    }

    // Stage 5 (D3): the base state is captured by the server from the
    // project's workspace, never taken from the client. Without a linked
    // workspace the base stays unknown and Apply fails closed.
    const createRoot = osStore.getWorkspaceRoot(body.projectId);
    const filesChanged =
      createRoot && existsSync(resolve(createRoot))
        ? captureBaseState(resolve(createRoot), body.filesChanged)
        : body.filesChanged;

    const evidenceIds = body.evidenceIds ?? [];
    for (const evidenceId of evidenceIds) {
      const record = osStore.findEvidenceById(evidenceId);
      if (!record) {
        throw new AtlasError("VALIDATION_ERROR", "Evidence not found", {
          statusCode: 400,
          details: { evidenceId },
        });
      }
      if (record.projectId !== body.projectId) {
        throw new AtlasError(
          "FORBIDDEN",
          "Evidence does not belong to this project",
          { statusCode: 403, details: { evidenceId } },
        );
      }
    }

    const now = new Date().toISOString();
    const patch = patchArtifactSchema.parse({
      id: crypto.randomUUID(),
      projectId: body.projectId,
      title: body.title,
      reason: body.reason,
      mode: body.mode,
      status: "PROPOSED",
      risk: body.risk ?? "MEDIUM",
      baseCommit: body.baseCommit ?? null,
      targetBranch: body.targetBranch ?? null,
      filesChanged,
      evidenceIds,
      ...(body.supersedesPatchId ? { supersedesPatchId: body.supersedesPatchId } : {}),
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
      createdBy: user.id,
      epistemicState: "PROPOSED",
      confidence: 0.5,
      authorityHint: "DEVELOPER_STATEMENT",
    });
    osStore.upsertPatch(patch);
    // Stage 4 attribution: a directly submitted patch is a human action.
    osStore.appendAudit({
      type: "code.patch.submitted",
      actorKind: "USER",
      actorId: user.id,
      agentId: null,
      onBehalfOfUserId: user.id,
      patchId: patch.id,
      correlationId: patch.id,
      // ARL-WS-005 (AUDIT/CAUSATION): symmetric with the agent path
      // (code.patch.proposed). When this manual submission corrects a rejected
      // patch, causationId references the rejected patch's id — identical
      // semantics to the agent correction path at line 1139.
      // causationId = null for non-correction submissions.
      causationId: patch.supersedesPatchId ?? null,
      supersedesPatchId: patch.supersedesPatchId ?? null,
      projectId: patch.projectId ?? null,
      at: new Date().toISOString(),
    });
    return reply.status(201).send({ patch });
  });
}
