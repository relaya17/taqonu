import type { FastifyInstance } from "fastify";
import { domainEventTypeSchema, paginationQuerySchema } from "@atlas/shared";
import { z } from "zod";
import { osStore } from "../store/os-store.js";

export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/events", async (request) => {
    const q = paginationQuerySchema
      .extend({
        type: domainEventTypeSchema.optional(),
        projectId: z.string().uuid().optional(),
      })
      .parse(request.query ?? {});
    let items = osStore.listDomainEvents();
    if (q.type) items = items.filter((e) => e.type === q.type);
    if (q.projectId) {
      items = items.filter((e) => e.projectId === q.projectId);
    }
    const total = items.length;
    const start = (q.page - 1) * q.pageSize;
    const pageItems = items.slice(start, start + q.pageSize);
    return {
      items: pageItems,
      page: q.page,
      pageSize: q.pageSize,
      total,
      pipeline:
        "Event → Observation → Claim → Decision → Evidence → Evaluation → Resolution",
    };
  });
}
