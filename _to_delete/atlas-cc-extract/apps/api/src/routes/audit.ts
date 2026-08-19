import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { requireAdmin } from "../middleware/auth-guards.js";
import {
  countAuditLogLines,
  listUnifiedAuditEntries,
  resolveAuditLogPath,
} from "../services/audit-log.js";

const querySchema = z.object({
  actorId: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

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
    const unified = listUnifiedAuditEntries({ limit: query.limit ?? 200 });
    const filteredUnified = query.actorId
      ? unified.filter((entry) => entry.actorId === query.actorId)
      : unified;
    const unifiedSorted = [...filteredUnified].sort(
      (a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime(),
    );
    return {
      items,
      total: items.length,
      durableCount,
      durablePath: logPath,
      unified: unifiedSorted,
      note:
        "Recent ring in memory/store.json; full append-only hash-chained log at .atlas/audit/audit.ndjson (never truncated). `unified` is the standardized WHO/WHAT/WHEN/WHY/INPUT/OUTPUT/POLICY/RISK/APPROVAL/RESULT subset (only entries written via appendUnifiedAuditEntry parse into it), optionally filtered by actorId.",
    };
  });
}
