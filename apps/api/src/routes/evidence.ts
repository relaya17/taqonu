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
import { assertProjectWriteAccess } from "../services/project-access.js";

/**
 * Tenant-scoped evidence list. POST stamps the session owner. Other
 * production writers (provider adapters, feeds, patches, observe cycles)
 * stamp the authenticated request owner, the bound project owner, or the
 * explicit `SYSTEM_OWNER_ID` platform actor — never `STUB_OWNER_ID`.
 * Non-admin GET still returns only the caller's own records, so
 * system-owned rows stay admin-visible rather than leaking into every tenant.
 */
export async function registerEvidenceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Tenant-scoped evidence list (P0 fix): only returns evidence owned by the
   * caller. Without this, any signed-in user could read any tenant's excerpts.
   * Admins bypass the filter to see all evidence (including legacy stub-owned
   * records for system/migration visibility).
   */
  app.get("/api/v1/evidence", async (request) => {
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
   * session owner's ID, not a shared stub. When `projectId` is present the
   * write uses the same `assertProjectWriteAccess` gate as SARIF / DB /
   * deploy feeds and provider observe (admin/control-plane bypass; unowned
   * projects are claimed). Project-less POSTs stay allowed and are not
   * stored under a project key.
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
    if (body.projectId) {
      await assertProjectWriteAccess(app, request, body.projectId);
    }
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
