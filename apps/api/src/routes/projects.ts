import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  createProjectSchema,
  projectResumeSchema,
  projectSchema,
  uuidSchema,
} from "@atlas/shared";
import { tryPersistProjectToSupabase } from "@atlas/database";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { osStore } from "../store/os-store.js";
import {
  assertCloudSlotAvailable,
  getAccountPlan,
  resolveOwnerId,
} from "../services/plan-quota.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  osStore.ensureLoaded();

  app.get("/api/v1/projects", async () => {
    const items = osStore.listProjects().map((project) => {
      const link = osStore.getCloudLink(project.id);
      const workspaceRoot = osStore.getWorkspaceRoot(project.id) ?? null;
      return {
        ...project,
        cloudSynced: Boolean(link),
        cloudProjectId: link?.cloudProjectId ?? null,
        cloudSyncedAt: link?.syncedAt ?? null,
        workspaceRoot,
      };
    });
    return {
      items,
      page: 1,
      pageSize: Math.max(items.length, 20),
      total: items.length,
    };
  });

  app.get("/api/v1/projects/:id", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const project = osStore.getProject(params.id);
    if (!project) {
      throw new AtlasError("NOT_FOUND", "Project not found");
    }
    const link = osStore.getCloudLink(project.id);
    return {
      ...project,
      cloudSynced: Boolean(link),
      cloudProjectId: link?.cloudProjectId ?? null,
      cloudSyncedAt: link?.syncedAt ?? null,
      workspaceRoot: osStore.getWorkspaceRoot(project.id) ?? null,
    };
  });

  /** Explicit local folder permission — Atlas never scans whole disk. */
  app.put("/api/v1/projects/:id/workspace-root", async (request) => {
    requireSignedInForWrite(app, request);
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const body = z
      .object({
        workspaceRoot: z.string().min(1).max(1000).nullable(),
      })
      .parse(request.body);
    const project = osStore.getProject(params.id);
    if (!project) {
      throw new AtlasError("NOT_FOUND", "Project not found");
    }
    if (body.workspaceRoot) {
      const root = resolve(body.workspaceRoot);
      if (!existsSync(root)) {
        throw new AtlasError(
          "VALIDATION_ERROR",
          `workspaceRoot not found: ${root}`,
        );
      }
      osStore.setWorkspaceRoot(params.id, root);
      return {
        projectId: params.id,
        workspaceRoot: root,
        note: "Explicit folder permission stored — used by portfolio health & audits",
      };
    }
    osStore.setWorkspaceRoot(params.id, null);
    return {
      projectId: params.id,
      workspaceRoot: null,
      note: "Workspace root cleared",
    };
  });

  app.post("/api/v1/projects", async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const now = new Date().toISOString();
    const existing = osStore.getProjectBySlug(body.slug);
    if (existing) {
      throw new AtlasError("CONFLICT", `Project slug already exists: ${body.slug}`);
    }
    const project = projectSchema.parse({
      id: crypto.randomUUID(),
      slug: body.slug,
      name: body.name,
      description: body.description ?? null,
      status: "ACTIVE",
      techStack: body.techStack ?? [],
      createdAt: now,
      updatedAt: now,
    });
    osStore.upsertProject(project);

    let cloudProjectId: string | null = null;
    let cloudSyncedAt: string | null = null;
    if (body.syncToCloud) {
      await assertCloudSlotAvailable(app.atlasEnv);
      const ownerId = resolveOwnerId(app.atlasEnv);
      const cloud = await tryPersistProjectToSupabase(
        {
          SUPABASE_URL: app.atlasEnv.SUPABASE_URL,
          SUPABASE_ANON_KEY: app.atlasEnv.SUPABASE_ANON_KEY,
          SUPABASE_SERVICE_ROLE_KEY: app.atlasEnv.SUPABASE_SERVICE_ROLE_KEY,
        },
        body,
        ownerId,
        { requireSuccess: true },
      );
      if (cloud) {
        cloudProjectId = cloud.id;
        cloudSyncedAt = now;
        osStore.setCloudLink(project.id, {
          cloudProjectId: cloud.id,
          syncedAt: now,
        });
      }
    }

    return reply.status(201).send({
      ...project,
      cloudSynced: Boolean(cloudProjectId),
      cloudProjectId,
      cloudSyncedAt,
    });
  });

  app.post("/api/v1/projects/:id/cloud", async (request, reply) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const project = osStore.getProject(params.id);
    if (!project) {
      throw new AtlasError("NOT_FOUND", "Project not found");
    }

    const existing = osStore.getCloudLink(project.id);
    if (existing) {
      const plan = await getAccountPlan(app.atlasEnv);
      return {
        projectId: project.id,
        cloudProjectId: existing.cloudProjectId,
        syncedAt: existing.syncedAt,
        plan,
        alreadySynced: true,
      };
    }

    await assertCloudSlotAvailable(app.atlasEnv);
    const ownerId = resolveOwnerId(app.atlasEnv);
    const now = new Date().toISOString();
    const cloud = await tryPersistProjectToSupabase(
      {
        SUPABASE_URL: app.atlasEnv.SUPABASE_URL,
        SUPABASE_ANON_KEY: app.atlasEnv.SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: app.atlasEnv.SUPABASE_SERVICE_ROLE_KEY,
      },
      {
        slug: project.slug,
        name: project.name,
        description: project.description ?? undefined,
        techStack: project.techStack,
      },
      ownerId,
      { requireSuccess: true },
    );

    if (!cloud) {
      throw new AtlasError("INTEGRATION_ERROR", "Failed to upload project to cloud database");
    }

    osStore.setCloudLink(project.id, {
      cloudProjectId: cloud.id,
      syncedAt: now,
    });

    const plan = await getAccountPlan(app.atlasEnv);
    return reply.status(201).send({
      projectId: project.id,
      cloudProjectId: cloud.id,
      syncedAt: now,
      plan,
      alreadySynced: false,
    });
  });

  app.get("/api/v1/projects/:id/resume", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const project = osStore.getProject(params.id);
    const snapshot = osStore.getSnapshot(params.id);
    const decisions = osStore.getDecisions(params.id);
    const lastDecision = decisions.at(-1)?.decision ?? null;
    const gitSlice = snapshot?.slices.find((slice) => slice.key === "GIT");
    const tasksSlice = snapshot?.slices.find((slice) => slice.key === "TASKS");

    const resumeEpistemic =
      snapshot?.overallEpistemicState === "CONFLICTED" ||
      snapshot?.overallEpistemicState === "FACT" ||
      snapshot?.overallEpistemicState === "INFERRED" ||
      snapshot?.overallEpistemicState === "UNKNOWN"
        ? snapshot.overallEpistemicState
        : project
          ? "INFERRED"
          : "UNKNOWN";

    return projectResumeSchema.parse({
      projectId: params.id,
      stateSnapshotId: snapshot?.id ?? null,
      currentState: snapshot
        ? `Overall ${snapshot.overallEpistemicState}. ${gitSlice?.summary ?? ""}`
        : project
          ? `Project ${project.name} registered. Current State not reconciled yet.`
          : "Project not found in local registry.",
      lastActivity: snapshot?.reconciledAt ?? null,
      lastDecision,
      lastSuccessfulDeployment: null,
      lastFailedTest: null,
      openTasks: tasksSlice?.summary
        ? tasksSlice.summary.split(" · ")
        : [
            "Discover remaining GitHub repositories",
            "Run state reconciliation",
            "Capture architectural decisions with evidence",
          ],
      recommendedNextAction: snapshot
        ? snapshot.overallEpistemicState === "UNKNOWN"
          ? "Ingest GitHub sync evidence, then reconcile."
          : "Review Current State slices and resolve conflicts if any."
        : "POST /api/v1/github/discover then reconcile Current State.",
      relevantMemories: osStore
        .getMemories(params.id)
        .slice(-5)
        .map((item) => item.statement),
      relevantRepositoryChanges: gitSlice ? [gitSlice.summary] : [],
      conflictCount: snapshot?.conflicts.length ?? 0,
      epistemicState: resumeEpistemic,
    });
  });

  app.get("/api/v1/projects/:id/context-export", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const project = osStore.getProject(params.id);
    if (!project) {
      throw new AtlasError("NOT_FOUND", "Project not found");
    }
    const snapshot = osStore.getSnapshot(params.id);
    const decisions = osStore.getDecisions(params.id);
    const memories = osStore.getMemories(params.id);
    const evidence = osStore.getEvidence(params.id);

    const markdown = [
      `# ArletOS Context Export — ${project.name}`,
      ``,
      `Product: ArletOS (Atlas Core)`,
      `Exported for: Cursor / Claude Code (read-only context pack)`,
      `Epistemic note: slices labeled FACT/CONFIRMED/INFERRED/PROPOSED/UNKNOWN/CONFLICTED — do not merge.`,
      ``,
      `## Project`,
      `- id: ${project.id}`,
      `- slug: ${project.slug}`,
      `- stack: ${project.techStack.join(", ") || "unknown"}`,
      ``,
      `## Current State`,
      snapshot
        ? [
            `- overall: ${snapshot.overallEpistemicState}`,
            `- asOf: ${snapshot.asOf}`,
            ...snapshot.slices.map(
              (slice) =>
                `- [${slice.epistemicState}] ${slice.key}: ${slice.summary}`,
            ),
          ].join("\n")
        : "- UNKNOWN — not reconciled",
      ``,
      `## Active Decisions`,
      decisions.length === 0
        ? "- none"
        : decisions
            .filter((item) => item.status === "ACTIVE")
            .map((item) => `- [${item.epistemicState}] ${item.decision}`)
            .join("\n"),
      ``,
      `## Memories (sample)`,
      memories.length === 0
        ? "- none"
        : memories
            .slice(-10)
            .map((item) => `- [${item.epistemicState}] (${item.type}) ${item.statement}`)
            .join("\n"),
      ``,
      `## Evidence count`,
      `- ${evidence.length} records (secrets never included)`,
      ``,
      `## Conflicts`,
      snapshot && snapshot.conflicts.length > 0
        ? snapshot.conflicts
            .map((c) => `- ${c.sliceKey}: ${c.resolution ?? "unresolved"}`)
            .join("\n")
        : "- none",
    ].join("\n");

    return {
      projectId: project.id,
      format: "markdown",
      epistemicState: snapshot?.overallEpistemicState ?? "UNKNOWN",
      markdown,
      generatedAt: new Date().toISOString(),
    };
  });
}
