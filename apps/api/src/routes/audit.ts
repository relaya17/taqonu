import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AtlasError, AUDIT_VERIFY_CONTROL_PATH } from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { requireAdmin, requireUser } from "../middleware/auth-guards.js";
import {
  isControlPlaneServiceAuthorization,
  requireControlPlaneService,
} from "../services/governed-lifecycle-handoff.js";
import {
  AUDIT_GENESIS_HASH,
  countAuditLogLines,
  pageUnifiedAuditEntries,
  pageUnifiedAuditIndex,
  resolveAuditLogPath,
  verifyAuditLogChain,
} from "../services/audit-log.js";
import {
  cpAuditEntrySchema,
  importCpAuditBatch,
} from "../services/audit-bridge.js";

const querySchema = z.object({
  actorId: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  cursor: z.string().min(1).max(200).optional(),
});

function sortUnifiedNewestFirst<T extends { at?: string | undefined }>(
  entries: T[],
): T[] {
  return [...entries].sort(
    (a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime(),
  );
}

/**
 * SECURITY FIX (found while scoping the Command Center Audit/Event Log
 * panel): this route had ZERO auth — the full audit trail (WHO/WHAT/WHEN/
 * WHY/INPUT/OUTPUT/POLICY/RISK/APPROVAL/RESULT for every tenant) was
 * publicly readable by anyone, unauthenticated. Same class of bug as the
 * `GET /events` fix from the prior round. `requireAdmin` (not just
 * `requireUser`) because this is cross-tenant audit data — it deliberately
 * is NOT filtered to the caller's own ownerId (unlike most other routes),
 * since an admin reviewing the platform's audit trail legitimately needs to
 * see every tenant's entries. A future per-tenant "my audit trail" view
 * should be a separate, `requireUser`-gated route rather than loosening
 * this one.
 *
 * Also adds optional `actorId` filtering (exact match against the
 * structured `unifiedAuditEntrySchema` entries — the freeform ring-buffer
 * `items` below predate that schema and aren't filterable this way) and a
 * `limit` cap, both driven by `listUnifiedAuditEntries()` — additive, does
 * not change the existing `items`/`durableCount` response shape.
 */
export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/audit", async (request) => {
    await requireAdmin(app, request);
    const query = querySchema.parse(request.query ?? {});
    osStore.ensureLoaded();
    const items = [...osStore.listAudit()].reverse();
    const logPath = resolveAuditLogPath();
    const durableCount = countAuditLogLines();
    const paged = pageUnifiedAuditEntries({
      limit: query.limit ?? 200,
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    if (!paged.ok) {
      throw new AtlasError("VALIDATION_ERROR", "Invalid audit cursor", {
        statusCode: 400,
      });
    }
    const unifiedSorted = sortUnifiedNewestFirst(paged.entries);
    return {
      items,
      total: items.length,
      durableCount,
      durablePath: logPath,
      unified: unifiedSorted,
      nextCursor: paged.nextCursor,
      note:
        "Recent ring in memory/store.json; full append-only hash-chained log at .atlas/audit/audit.ndjson (never truncated). `unified` is the standardized WHO/WHAT/WHEN/WHY/INPUT/OUTPUT/POLICY/RISK/APPROVAL/RESULT subset (only entries written via appendUnifiedAuditEntry parse into it), optionally filtered by actorId.",
    };
  });

  /**
   * Per-tenant audit visibility (C1): signed-in callers see only unified
   * entries they themselves performed. Does not loosen GET /audit, which
   * remains admin/operator and cross-tenant by design.
   */
  app.get("/api/v1/audit/mine", async (request) => {
    const user = await requireUser(app, request);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(2000).optional(),
        cursor: z.string().min(1).max(200).optional(),
      })
      .parse(request.query ?? {});
    const paged = pageUnifiedAuditEntries({
      actorId: user.id,
      limit: query.limit ?? 200,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    if (!paged.ok) {
      throw new AtlasError("VALIDATION_ERROR", "Invalid audit cursor", {
        statusCode: 400,
      });
    }
    const unifiedSorted = sortUnifiedNewestFirst(paged.entries);
    return {
      items: [],
      total: 0,
      unified: unifiedSorted,
      nextCursor: paged.nextCursor,
      note: "Caller-scoped unified audit only. Platform-wide trail remains GET /api/v1/audit (admin).",
    };
  });

  /**
   * R06 — admin export stream from the same R04/R18 index.
   * Canonical NDJSON remains the SoR; this is a projection with chain hashes.
   */
  app.get("/api/v1/audit/export", async (request, reply) => {
    await requireAdmin(app, request);
    const query = querySchema.parse(request.query ?? {});
    const paged = pageUnifiedAuditIndex({
      limit: query.limit ?? 200,
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    if (!paged.ok) {
      throw new AtlasError("VALIDATION_ERROR", "Invalid audit cursor", {
        statusCode: 400,
      });
    }
    const manifest = {
      kind: "atlas.audit.export.manifest" as const,
      schemaVersion: 1,
      canonical: "ndjson" as const,
      hashedWith: "sha256",
      genesis: AUDIT_GENESIS_HASH,
      durablePath: resolveAuditLogPath(),
      durableCount: countAuditLogLines(),
      exported: paged.rows.length,
      nextCursor: paged.nextCursor,
    };
    const lines = [
      JSON.stringify(manifest),
      ...paged.rows.map((row) =>
        JSON.stringify({
          kind: "atlas.audit.export.entry",
          seq: row.seq,
          hash: row.hash,
          prevHash: row.prevHash,
          entry: row.entry,
        }),
      ),
    ];
    return reply
      .header("content-type", "application/x-ndjson; charset=utf-8")
      .header("content-disposition", 'attachment; filename="atlas-audit.ndjson"')
      .send(`${lines.join("\n")}\n`);
  });

  /**
   * POST /api/v1/audit/cp-import
   *
   * Import Control Plane observational entries into the canonical API file.
   * CP hashes are provenance (`cpHash`); the API chain remains the SoR.
   * Control Plane SERVICE bearer or customer admin.
   */
  app.post("/api/v1/audit/cp-import", async (request, reply) => {
    if (!isControlPlaneServiceAuthorization(request.headers.authorization)) {
      await requireAdmin(app, request);
    }
    const body = z.object({
      entries: z.array(cpAuditEntrySchema),
    }).parse(request.body);

    if (body.entries.length === 0) {
      return { imported: 0, skipped: 0, records: [] };
    }

    try {
      const result = importCpAuditBatch(body.entries);
      return reply.status(201).send({
        imported: result.imported,
        skipped: result.skipped,
        records: result.records.map((r) => ({ id: r.id, type: r.type, hash: r.hash })),
        note: "Control Plane entries merged into canonical API audit file.",
      });
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Control Plane audit import rejected",
        { statusCode: 400 },
      );
    }
  });

  /**
   * CP SERVICE → canonical NDJSON chain verification.
   * Control Plane in-memory hashes are observational and must not be
   * reported as VALID/BROKEN for the operator-facing verify route.
   */
  app.get(AUDIT_VERIFY_CONTROL_PATH, async (request) => {
    requireControlPlaneService(request.headers.authorization);
    const verification = verifyAuditLogChain();
    return {
      ...verification,
      canonical: true as const,
      path: resolveAuditLogPath(),
    };
  });
}
