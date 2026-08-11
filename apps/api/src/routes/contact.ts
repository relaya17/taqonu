import type { FastifyInstance } from "fastify";
import {
  contactLeadSchema,
  createContactLeadSchema,
} from "@atlas/shared";
import { redactSecrets } from "@atlas/agent-core";
import { requireAdmin } from "../middleware/auth-guards.js";
import { osStore } from "../store/os-store.js";

export async function registerContactRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/contact", async (request, reply) => {
    const body = createContactLeadSchema.parse(request.body);
    const now = new Date().toISOString();
    const lead = contactLeadSchema.parse({
      id: crypto.randomUUID(),
      name: body.name.trim(),
      email: body.email.trim().toLowerCase(),
      company: body.company?.trim() || null,
      role: body.role?.trim() || null,
      message: redactSecrets(body.message.trim()),
      source: body.source ?? "investors",
      createdAt: now,
      ...(body.locale !== undefined ? { locale: body.locale } : {}),
    });
    osStore.addContactLead(lead);
    osStore.appendAudit({
      type: "contact.lead.created",
      leadId: lead.id,
      source: lead.source,
      at: now,
    });
    return reply.status(201).send({
      ok: true,
      id: lead.id,
      message: "Thanks — we received your note.",
    });
  });

  app.get("/api/v1/admin/leads", async (request) => {
    requireAdmin(app, request);
    const items = [...osStore.listContactLeads()].reverse();
    return { items, total: items.length };
  });
}
