import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../middleware/auth-guards.js";
import { osStore } from "../store/os-store.js";
import { detectRecurringFailures } from "../services/recurring-failure.js";

export async function registerRecurrenceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/recurrence", async (request) => {
    const user = await requireUser(app, request);
    const query = z
      .object({ projectId: z.string().uuid().optional() })
      .parse(request.query ?? {});
    const events = osStore.listDomainEvents();
    const memories = [...osStore.memories.values()].flat();
    return {
      items: detectRecurringFailures({
        ownerId: user.id,
        projectId: query.projectId ?? null,
        events,
        memories,
      }),
    };
  });
}
