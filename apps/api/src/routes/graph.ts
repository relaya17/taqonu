import type { FastifyInstance } from "fastify";
import {
  graphImpactQuerySchema,
  graphImpactResultSchema,
  uuidSchema,
} from "@atlas/shared";
import { z } from "zod";

export async function registerGraphRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/graph/nodes", async () => ({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    note: "Graph upserts arrive from GitHub sync + memory/decision writes.",
  }));

  app.get("/api/v1/graph/nodes/:id/impact", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const query = graphImpactQuerySchema.parse(request.query);

    void query;
    return graphImpactResultSchema.parse({
      rootNodeId: params.id,
      nodes: [],
      edges: [],
      epistemicState: "UNKNOWN",
    });
  });
}
