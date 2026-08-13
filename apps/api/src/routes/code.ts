import type { FastifyInstance } from "fastify";
import {
  applyPatchSchema,
  approvePatchSchema,
  createPatchSchema,
  patchArtifactSchema,
  AtlasError,
  ENGINEERING_AGENT_MODES,
  type EngineeringAgentMode,
} from "@atlas/shared";
import {
  analyzeImpact,
  analyzeRepository,
  listWorkspaceTree,
  proposePatch,
  rankRisks,
  readWorkspaceFile,
  rollbackPatchFiles,
} from "@atlas/code-intelligence";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import {
  approvePatchArtifact,
  applyApprovedPatch,
} from "../services/patch-write.js";

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
  /** Read-only studio: project tree (human may view; never mutate here). */
  app.get("/api/v1/studio/tree", async (request) => {
    const q = z
      .object({
        projectId: z.string().uuid().optional(),
        workspaceRoot: z.string().min(1).max(1000).optional(),
      })
      .parse(request.query);

    let root: string | null = q.workspaceRoot ? resolve(q.workspaceRoot) : null;
    if (q.projectId) {
      const project = osStore.getProject(q.projectId);
      if (!project) {
        throw new AtlasError("NOT_FOUND", "Project not found");
      }
      root = osStore.getWorkspaceRoot(q.projectId) ?? root;
    }
    if (!root) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Link a local workspaceRoot on the project (or pass workspaceRoot) to open Studio.",
      );
    }
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
        note: "Read-only. Only the agent may add or change code (Patch propose) — humans Approve & Apply.",
      };
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Failed to list workspace",
      );
    }
  });

  /** Read-only studio: single file contents. */
  app.get("/api/v1/studio/file", async (request) => {
    const q = z
      .object({
        projectId: z.string().uuid().optional(),
        workspaceRoot: z.string().min(1).max(1000).optional(),
        path: z.string().min(1).max(1000),
      })
      .parse(request.query);

    let root: string | null = q.workspaceRoot ? resolve(q.workspaceRoot) : null;
    if (q.projectId) {
      const project = osStore.getProject(q.projectId);
      if (!project) {
        throw new AtlasError("NOT_FOUND", "Project not found");
      }
      root = osStore.getWorkspaceRoot(q.projectId) ?? root;
    }
    if (!root) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Link a local workspaceRoot to open files in Studio.",
      );
    }
    try {
      return {
        projectId: q.projectId ?? null,
        workspaceRoot: root,
        ...readWorkspaceFile(root, q.path),
        note: "Read-only. Only the agent proposes add/change — Apply only after Approve on /patches.",
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
        mode: z.enum(["fix", "generate", "implement", "refactor", "secure"]).default("fix"),
        instruction: z.string().min(3).max(4000),
      })
      .parse(request.body);

    let root: string | null = body.workspaceRoot
      ? resolve(body.workspaceRoot)
      : null;
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
      ? `Focus file (read-only context): ${body.path.trim()}\n\n`
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
    );
  });

  app.post("/api/v1/code/analyze", async (request) => {
    const body = analyzeBody.parse(request.body);
    const root = resolve(body.workspaceRoot);
    const analysis = analyzeRepository(root);
    const impact = body.query
      ? analyzeImpact(root, body.query)
      : null;
    return { analysis, impact, epistemicState: "OBSERVED" as const };
  });

  app.post("/api/v1/code/impact", async (request) => {
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
  ) {
    const proposal = proposePatch({
      workspaceRoot: body.workspaceRoot,
      mode: body.mode as EngineeringAgentMode,
      userRequest: body.userRequest,
      ...(body.title ? { title: body.title } : {}),
    });
    if (proposal.filesChanged.length === 0) {
      return reply.status(200).send({
        patch: null,
        analysisGraph: proposal.analysisGraph,
        evaluationSummary: proposal.evaluationSummary,
        note: "Analyze/plan — no Patch created. Switch mode to Generate/Fix/… for applyable changes.",
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
      note: "Patch proposed — Approve then Apply (ADR-015). Not applied yet.",
    });
  }

  app.post("/api/v1/code/patch", async (request, reply) => {
    const body = proposeBody.parse(request.body);
    return createProposal(body, reply);
  });

  app.post("/api/v1/code/explain", async (request) => {
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
    const q = request.query as { projectId?: string };
    const items = osStore.listPatches(q.projectId ?? undefined);
    return { items, page: 1, pageSize: items.length, total: items.length };
  });

  app.get("/api/v1/code/patches/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const patch = osStore.getPatch(id);
    if (!patch) {
      return reply.status(404).send({ error: { message: "Patch not found" } });
    }
    return patch;
  });

  app.post("/api/v1/code/patches/:id/approve", async (request, reply) => {
    const user = requireSignedInForWrite(app, request);
    const id = (request.params as { id: string }).id;
    const body = approvePatchSchema.parse(request.body ?? {});
    const existing = osStore.getPatch(id);
    if (!existing) {
      return reply.status(404).send({ error: { message: "Patch not found" } });
    }
    return approvePatchArtifact(existing, {
      approvedBy: body.approvedBy?.trim() || user.email,
      ...(body.note !== undefined ? { note: body.note } : {}),
      userId: user.id,
    });
  });

  app.post("/api/v1/code/patches/:id/apply", async (request, reply) => {
    const user = requireSignedInForWrite(app, request);
    const id = (request.params as { id: string }).id;
    const body = applyPatchSchema.parse(request.body ?? {});
    const existing = osStore.getPatch(id);
    if (!existing) {
      return reply.status(404).send({ error: { message: "Patch not found" } });
    }
    return applyApprovedPatch({
      existing,
      user,
      bodyWorkspaceRoot: body.workspaceRoot ?? null,
    });
  });

  app.post("/api/v1/code/patches/:id/rollback", async (request, reply) => {
    const user = requireSignedInForWrite(app, request);
    const id = (request.params as { id: string }).id;
    const body = z
      .object({ workspaceRoot: z.string().min(1).max(1000) })
      .parse(request.body);
    const existing = osStore.getPatch(id);
    if (!existing) {
      return reply.status(404).send({ error: { message: "Patch not found" } });
    }
    if (existing.status !== "APPLIED" && existing.status !== "VERIFIED") {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Only APPLIED or VERIFIED patches can roll back",
      );
    }
    const restored = rollbackPatchFiles(
      body.workspaceRoot,
      existing.rollbackSnapshot,
    );
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
  });

  app.post("/api/v1/code/refactor", async (request, reply) => {
    const body = proposeBody.parse({
      ...(request.body as object),
      mode: "refactor",
    });
    return createProposal(body, reply);
  });

  app.post("/api/v1/code/fix", async (request, reply) => {
    const body = proposeBody.parse({
      ...(request.body as object),
      mode: "fix",
    });
    return createProposal(body, reply);
  });

  app.post("/api/v1/code/tests", async (request, reply) => {
    const body = proposeBody.parse({
      ...(request.body as object),
      mode: "test",
    });
    return createProposal(body, reply);
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
