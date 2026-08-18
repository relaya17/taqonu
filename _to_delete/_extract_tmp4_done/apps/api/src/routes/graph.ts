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
import { authorizeEntityAction } from "@atlas/agent-core";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { osStore } from "../store/os-store.js";
import { defaultGoldenRoot } from "../services/golden-root.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import { checkResourceAccess } from "../services/resource-access.js";
import { getProjectOwnerId } from "../services/project-access.js";

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
    const user = requireSignedInForWrite(app, request);

    // Entity-policy gate: rebuilding the Software Knowledge Graph recomputes
    // derived control-plane state from a workspace — it's a system/config
    // operation, not a business-record CRUD — so it is classified as
    // CONFIGURATION.EXECUTE. `writeGateOpen: true` + `approved: true`
    // represents the self-approved case of an authenticated human directly
    // triggering this write via the REST API (mirrors how a signed-in human
    // REST write is already implicitly trusted elsewhere in this codebase,
    // e.g. portfolio.ts's discovery/link route).
    const entityDecision = authorizeEntityAction("CONFIGURATION", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityDecision.decision === "DENIED") {
      throw new AtlasError("FORBIDDEN", entityDecision.reason, {
        statusCode: 403,
      });
    }
    if (entityDecision.decision === "APPROVAL_REQUIRED") {
      throw new AtlasError(
        "FORBIDDEN",
        "CONFIGURATION.EXECUTE requires explicit approval",
        { statusCode: 403 },
      );
    }

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

    if (resolved.projectId) {
      // Only checked when the rebuild targets a specific project (there's a
      // resolvable resourceOwnerId to compare against); a bare
      // workspaceRoot/golden-root rebuild has no single owning resource, so
      // ownership isn't checked and the capability check above alone gates it.
      const accessDecision = checkResourceAccess({
        actorId: user.id,
        role: user.role,
        requiredCapability: "write.workspace_root",
        resourceOwnerId: getProjectOwnerId(resolved.projectId),
      });
      if (accessDecision.decision === "DENIED") {
        throw new AtlasError("FORBIDDEN", accessDecision.reason, {
          statusCode: 403,
        });
      }
    }

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
