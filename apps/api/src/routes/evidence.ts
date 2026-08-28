import {
  AtlasError,
  createEvidenceRecordSchema,
  groupEvidenceByCategory,
  parseEvidenceRecord,
} from "@atlas/shared";
import type { FastifyInstance } from "fastify";
import { authorizeEntityAction } from "@atlas/agent-core";
import { osStore } from "../store/os-store.js";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js"; // POST still needs this

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
  /**
   * Tenant-scoped evidence list (P0 fix): only returns evidence owned by the
   * caller. Without this, any signed-in user could read any tenant's excerpts.
   * Admins bypass the filter to see all evidence (including legacy stub-owned
   * records for system/migration visibility).
   */
  app.get("/api/v1/evidence", async (request, reply) => {
    const user = await requireUser(app, request);

    const allItems = [...osStore.evidence.values()]
      .flat()
      .map((item) => parseEvidenceRecord(item));
    // Admin bypass: admins see all evidence; normal users see only their own.
    // Use user.id (from session/requireUser) not resolveCloudIdentity — the
    // latter is for cloud-sync scenarios, this is pure auth filtering.
    const isAdmin = user.role === "admin";
    const items = isAdmin
      ? allItems
      : allItems.filter((item) => item.ownerId === user.id);
    const byCategory = groupEvidenceByCategory(items);
    return {
      items,
      byCategory,
      page: 1,
      pageSize: 20,
      total: items.length,
    };
  });

  /**
   * Tenant-scoped evidence creation (P0 fix): stamps the record with the
   * session owner's ID, not a shared stub. This closes the write-side of
   * the cross-tenant leak.
   */
  app.post("/api/v1/evidence", async (request, reply) => {
    await requireSignedInForWrite(app, request);
    const identity = await resolveCloudIdentity(app, request);
    if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);

    // Entity-policy gate: recording a new evidence excerpt is
    // DOCUMENT.CREATE (unstructured/semi-structured content, per
    // `BusinessEntityType`'s own doc comment) — LOW_RISK_WRITE, no
    // approval required by default. `writeGateOpen`/`approved` hardcoded
    // `true` — same self-approved signed-in-human-write rationale used by
    // memory.ts/billing.ts/connections.ts.
    const entityDecision = authorizeEntityAction("DOCUMENT", "CREATE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityDecision.decision !== "ALLOWED") {
      const reason =
        entityDecision.decision === "DENIED"
          ? entityDecision.reason
          : "DOCUMENT.CREATE requires explicit approval";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

    const body = createEvidenceRecordSchema.parse(request.body);
    const now = new Date().toISOString();
    const record = parseEvidenceRecord({
      id: crypto.randomUUID(),
      ownerId: identity.ownerId,
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
