import type { FastifyInstance } from "fastify";
import { domainEventTypeSchema, paginationQuerySchema } from "@atlas/shared";
import { z } from "zod";
import { applyFilters, type FilterCriterion } from "@atlas/agent-core";
import { osStore } from "../store/os-store.js";
import { requireAdmin } from "../middleware/auth-guards.js";

export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/events", async (request) => {
    // Admin-only (P0 fix): domain events embed full memory `statement` text
    // and other sensitive payload content, but every event currently gets
    // written via memory-pipeline's `appendDomainEvent` with a hardcoded
    // `ownerId: STUB_OWNER_ID` (see services/memory-pipeline.ts) — so there
    // is no reliable per-caller tenant field to filter this list by yet.
    // Filtering on `ownerId` today would either leak all tenants' events to
    // any signed-in user (if compared against the shared stub id) or hide
    // everything from everyone (if compared against the real caller id).
    // Until domain events carry a real per-tenant `ownerId`, gate this
    // cross-tenant surface behind `requireAdmin` rather than pretending to
    // scope it.
    await requireAdmin(app, request);
    const q = paginationQuerySchema
      .extend({
        type: domainEventTypeSchema.optional(),
        projectId: z.string().uuid().optional(),
        // Milliseconds, e.g. ?since=86400000 for "last 24h". Uses the new
        // Universal Filter Engine (@atlas/agent-core) against `occurredAt`.
        since: z.coerce.number().int().positive().optional(),
      })
      .parse(request.query ?? {});
    let items = osStore.listDomainEvents();
    // `type` / `projectId` remain hand-rolled `if` checks for now; they
    // could be migrated to the Universal Filter Engine (applyFilters) over
    // time, alongside the `since` criterion below.
    if (q.type) items = items.filter((e) => e.type === q.type);
    if (q.projectId) {
      items = items.filter((e) => e.projectId === q.projectId);
    }
    if (q.since !== undefined) {
      const criteria: FilterCriterion[] = [
        { field: "occurredAt", op: "since", value: q.since },
      ];
      items = applyFilters(items, criteria);
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
