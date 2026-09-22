import type { FastifyInstance } from "fastify";
import { AtlasError } from "@atlas/shared";
import { z } from "zod";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import { dismissInboxItem, listInboxItems } from "../services/inbox.js";

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/notifications", async (request) => {
    const user = await requireUser(app, request);
    const query = z
      .object({ unread: z.enum(["0", "1"]).optional() })
      .parse(request.query ?? {});
    const items = await listInboxItems(user.id);
    const visible = query.unread === "1" ? items.filter((item) => !item.dismissed) : items;
    return {
      items: visible,
      unreadCount: items.filter((item) => !item.dismissed).length,
      channel: "in-app",
    };
  });

  app.post("/api/v1/notifications/dismiss", async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const body = z.object({ id: z.string().uuid() }).parse(request.body ?? {});
    const owned = (await listInboxItems(user.id)).some((item) => item.id === body.id);
    if (!owned) {
      throw new AtlasError("NOT_FOUND", "Notification not found", { statusCode: 404 });
    }
    dismissInboxItem(user.id, body.id);
    return { dismissed: true, id: body.id };
  });
}
