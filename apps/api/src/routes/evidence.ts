import {
  createEvidenceRecordSchema,
  groupEvidenceByCategory,
  parseEvidenceRecord,
} from "@atlas/shared";
import type { FastifyInstance } from "fastify";
import { osStore } from "../store/os-store.js";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";

/**
 * SECURITY FIX (found while widening Policy Engine coverage): both routes
 * had ZERO auth — every evidence record across every tenant/project was
 * publicly listable, and anyone could inject a fabricated evidence record.
 * `requireUser` (not `requireAdmin`) on the read: unlike `GET /events`
 * (the prior round's equivalent fix, which went `requireAdmin` because its
 * only real consumer is the admin Command Center), this endpoint backs
 * `DecisionsPanel` on the regular signed-in user's own dashboard
 * (`apps/web/app/[locale]/page.tsx` -> `PersonalDesk`) — `requireAdmin`
 * here would break that page for every non-admin user. `requireUser` still
 * closes the "fully public, anyone on the internet" hole.
 *
 * KNOWN LIMITATION (not fixed here, same class as the `GET /events` /
 * `connections.ts` limitations already documented): evidence records
 * created through most of the codebase's system/webhook-driven pathways
 * (db-feeds.ts, provider-adapters.ts, deploy-feeds.ts, security-sarif.ts,
 * engineering-loop.ts, ...) are stamped with a shared `STUB_OWNER_ID`
 * rather than a real per-tenant owner, so this list is not genuinely
 * tenant-scoped yet — `requireUser` blocks anonymous access but does not
 * by itself deliver per-tenant isolation. Reworking that would mean
 * touching every one of those call sites, a larger change than fits this
 * pass.
 */
export async function registerEvidenceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/evidence", async (request) => {
    await requireUser(app, request);
    const items = [...osStore.evidence.values()]
      .flat()
      .map((item) => parseEvidenceRecord(item));
    const byCategory = groupEvidenceByCategory(items);
    return {
      items,
      byCategory,
      page: 1,
      pageSize: 20,
      total: items.length,
    };
  });

  app.post("/api/v1/evidence", async (request, reply) => {
    const user = await requireSignedInForWrite(app, request);
    const body = createEvidenceRecordSchema.parse(request.body);

    // Entity-policy gate + numeric Risk Engine + unified audit log:
    // recording a new evidence excerpt is DOCUMENT.CREATE (unstructured/
    // semi-structured content, per `BusinessEntityType`'s own doc comment)
    // — LOW_RISK_WRITE, no approval required by default. Same
    // self-approved signed-in-human-write rationale used by
    // memory.ts/billing.ts/connections.ts.
    enforceEntityWrite({
      entityType: "DOCUMENT",
      action: "CREATE",
      routeLabel: "evidence.create",
      actorId: user.id,
      projectId: body.projectId ?? null,
    });
    const now = new Date().toISOString();
    const record = parseEvidenceRecord({
      id: crypto.randomUUID(),
      ownerId: OWNER_ID,
      projectId: body.projectId ?? null,
      source: body.source,
      sourceType: body.sourceType,
      sourceId: body.sourceId ?? null,
      uri: body.uri ?? null,
      excerpt: body.excerpt ?? null,
      version: body.version ?? null,
      observedAt: body.observedAt ?? now,
      createdAt: now,
      confidence: body.confidence ?? 1,
      epistemicState: body.epistemicState,
      ...(body.category ? { category: body.category } : {}),
      metadata: body.metadata ?? {},
    });
    if (record.projectId) {
      osStore.addEvidence(record.projectId, [record]);
    }
    osStore.recordEvent({
      type: "evidence.recorded",
      evidenceId: record.id,
      projectId: record.projectId,
      occurredAt: now,
      category: record.category,
    });
    return reply.status(201).send(record);
  });
}
