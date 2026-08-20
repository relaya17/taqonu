import {
  createEvidenceRecordSchema,
  groupEvidenceByCategory,
  parseEvidenceRecord,
  type AuthUser,
  type EvidenceRecord,
} from "@atlas/shared";
import type { FastifyInstance } from "fastify";
import { osStore } from "../store/os-store.js";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

/**
 * Tenant boundary (P0 fix): a signed-in user only sees evidence they own;
 * admins bypass. Mirrors `scopeMemoriesToCaller` in `routes/memory.ts` —
 * deliberately the same shape, because evidence `excerpt`s carry the same
 * (often higher) sensitivity as memory statements: raw source text pulled
 * from another tenant's repositories, CI output, and connectors.
 *
 * PRE-EXISTING DATA (deliberate, not an oversight): records written before
 * this fix — and records still written by the system/webhook-driven
 * pathways (db-feeds.ts, provider-adapters.ts, deploy-feeds.ts,
 * security-sarif.ts, engineering-loop.ts, observe-cycle.ts, ...) — carry
 * the shared `STUB_OWNER_ID` placeholder rather than a real account id.
 * They are NOT grandfathered into every caller's results: no real signed-in
 * user's `id` is ever the stub uuid, so for a normal caller those rows
 * simply do not match and are invisible. That is the safe reading and the
 * intended one — grandfathering them in would preserve exactly the breach
 * this fix closes. The cost is that legacy/system-authored evidence
 * disappears from non-admin lists until its producing call site is
 * reworked to stamp a real owner; losing visibility of unattributable rows
 * is strictly preferable to leaking attributable ones. Admins still see
 * them, via the same role bypass every other read surface in this codebase
 * uses.
 */
function scopeEvidenceToCaller(
  items: readonly EvidenceRecord[],
  user: AuthUser,
): EvidenceRecord[] {
  if (user.role === "admin") return [...items];
  return items.filter((item) => item.ownerId === user.id);
}

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
 * ENFORCED NOW (P0 follow-up — what used to be filed here as a "KNOWN
 * LIMITATION" was a live cross-tenant breach, not a limitation):
 *  - `POST` stamps every record with the server-derived owner of the
 *    authenticated session (`resolveCloudIdentity`, the same mechanism
 *    `routes/memory.ts` uses), never a shared placeholder constant and
 *    never anything from the request body — `createEvidenceRecordSchema`
 *    has no `ownerId` field, so a body that supplies one is dropped at
 *    parse time and cannot write into another tenant's bucket.
 *  - `GET` returns only the caller's own records (`scopeEvidenceToCaller`).
 *    Before this, any signed-in user of any tenant could read every other
 *    tenant's evidence `excerpt`s.
 * Per `approveMemory()`'s no-cross-tenant-enumeration convention, a record
 * owned by someone else is indistinguishable from one that does not exist:
 * it is absent from the list, absent from `byCategory`, and uncounted in
 * `total`, so a caller cannot even infer how much foreign evidence exists.
 * There is deliberately no by-id read route here — the list is the only
 * read surface, so there is no second path to keep in sync.
 */
export async function registerEvidenceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/evidence", async (request) => {
    const user = await requireUser(app, request);
    const items = scopeEvidenceToCaller(
      [...osStore.evidence.values()].flat().map((item) => parseEvidenceRecord(item)),
      user,
    );
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
    // Server-derived ownerId — never client-supplied, so a caller cannot
    // write evidence into another tenant's bucket (nor into the old shared
    // placeholder bucket, which is what made the read side leak).
    const identity = await resolveCloudIdentity(app, request);
    if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);

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
