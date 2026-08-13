import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  graphImpactQuerySchema,
  graphImpactResultSchema,
  graphNodeSchema,
  paginatedResponseSchema,
  uuidSchema,
} from "@atlas/shared";
import {
  buildSoftwareKnowledgeGraph,
  computeGraphImpact,
  loadSoftwareKnowledgeGraph,
  saveSoftwareKnowledgeGraph,
} from "@atlas/observer";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { osStore } from "../store/os-store.js";
import { defaultGoldenRoot } from "../services/golden-root.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";

const graphPageSchema = paginatedResponseSchema(graphNodeSchema).extend({
  edgesTotal: z.number().int().nonnegative(),
  builtAt: z.string().nullable(),
  workspaceRoot: z.string().nullable(),
  note: z.string(),
});

function resolveGraphWorkspace(input: {
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
    if (!project) throw new AtlasError("NOT_FOUND", "Project not found");
    projectSlug = project.slug;
    const linked = osStore.getWorkspaceRoot(projectId);
    if (!workspaceRoot && linked) workspaceRoot = resolve(linked);
  }

  if (!workspaceRoot) {
    if (projectId) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Link a local workspaceRoot on this project before building the Knowledge Graph.",
      );
    }
    workspaceRoot = resolve(input.envGoldenRoot || defaultGoldenRoot());
  }
  if (!existsSync(workspaceRoot)) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      `workspaceRoot not found: ${workspaceRoot}`,
    );
  }
  return { workspaceRoot, projectId, projectSlug };
}

export async function registerGraphRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/graph/nodes", async (request) => {
    const q = z
      .object({
        projectId: uuidSchema.optional(),
        workspaceRoot: z.string().max(1000).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
        rebuild: z
          .enum(["0", "1", "true", "false"])
          .optional()
          .transform((v) => v === "1" || v === "true"),
      })
      .parse(request.query);

    let workspaceRoot: string | null = null;
    let projectId: string | null = q.projectId ?? null;
    let projectSlug: string | null = null;
    try {
      const resolved = resolveGraphWorkspace({
        projectId,
        workspaceRoot: q.workspaceRoot ?? null,
        envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
      });
      workspaceRoot = resolved.workspaceRoot;
      projectId = resolved.projectId;
      projectSlug = resolved.projectSlug;
    } catch {
      return graphPageSchema.parse({
        items: [],
        page: q.page,
        pageSize: q.pageSize,
        total: 0,
        edgesTotal: 0,
        builtAt: null,
        workspaceRoot: null,
        note: "Link a local workspace or pass workspaceRoot to build the Software Knowledge Graph.",
      });
    }

    let graph = loadSoftwareKnowledgeGraph(workspaceRoot);
    if (!graph || q.rebuild) {
      graph = buildSoftwareKnowledgeGraph({
        workspaceRoot,
        projectId,
        projectSlug,
      });
      saveSoftwareKnowledgeGraph(graph);
    }

    const start = (q.page - 1) * q.pageSize;
    const items = graph.nodes.slice(start, start + q.pageSize);
    return graphPageSchema.parse({
      items,
      page: q.page,
      pageSize: q.pageSize,
      total: graph.nodes.length,
      edgesTotal: graph.edges.length,
      builtAt: graph.builtAt,
      workspaceRoot,
      note: "Software Knowledge Graph v0 — OBSERVED/INFERRED edges from repo structure.",
    });
  });

  app.post("/api/v1/graph/rebuild", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const body = z
      .object({
        projectId: uuidSchema.optional(),
        workspaceRoot: z.string().max(1000).optional(),
      })
      .parse(request.body ?? {});
    const resolved = resolveGraphWorkspace({
      projectId: body.projectId ?? null,
      workspaceRoot: body.workspaceRoot ?? null,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const graph = buildSoftwareKnowledgeGraph({
      workspaceRoot: resolved.workspaceRoot,
      projectId: resolved.projectId,
      projectSlug: resolved.projectSlug,
    });
    saveSoftwareKnowledgeGraph(graph);
    return reply.send({
      builtAt: graph.builtAt,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      workspaceRoot: graph.workspaceRoot,
    });
  });

  app.get("/api/v1/graph/nodes/:id/impact", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const query = graphImpactQuerySchema.parse(request.query);
    const q = z
      .object({
        projectId: uuidSchema.optional(),
        workspaceRoot: z.string().max(1000).optional(),
      })
      .parse(request.query);

    const resolved = resolveGraphWorkspace({
      projectId: q.projectId ?? null,
      workspaceRoot: q.workspaceRoot ?? null,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    let graph = loadSoftwareKnowledgeGraph(resolved.workspaceRoot);
    if (!graph) {
      graph = buildSoftwareKnowledgeGraph({
        workspaceRoot: resolved.workspaceRoot,
        projectId: resolved.projectId,
        projectSlug: resolved.projectSlug,
      });
      saveSoftwareKnowledgeGraph(graph);
    }

    const impact = computeGraphImpact({
      graph,
      rootNodeId: params.id,
      depth: query.depth,
      direction: query.direction,
    });
    return graphImpactResultSchema.parse(impact);
  });
}
