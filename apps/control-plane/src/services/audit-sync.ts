/**
 * Audit Sync — Forward Control Plane audit entries to the canonical API audit file.
 *
 * This service periodically flushes Control Plane audit entries to the API's
 * POST /api/v1/audit/cp-import endpoint, merging the CP hash chain into the
 * canonical API audit trail.
 */

import { listAuditEntries, type AuditEntry } from "./governance-state.js";
import { assertControlPlaneApiEgress } from "./control-plane-egress.js";

let lastSyncedSeq = 0;
let apiBaseUrl = process.env.ATLAS_API_URL ?? "http://localhost:4000";
let syncEnabled = process.env.ATLAS_CP_AUDIT_SYNC !== "0";
let adminToken: string | null = null;

export function setAuditSyncConfig(config: {
  apiBaseUrl?: string;
  enabled?: boolean;
  adminToken?: string;
}): void {
  if (config.apiBaseUrl !== undefined) apiBaseUrl = config.apiBaseUrl;
  if (config.enabled !== undefined) syncEnabled = config.enabled;
  if (config.adminToken !== undefined) adminToken = config.adminToken;
}

export function getAuditSyncStatus(): {
  enabled: boolean;
  lastSyncedSeq: number;
  apiBaseUrl: string;
} {
  return {
    enabled: syncEnabled,
    lastSyncedSeq,
    apiBaseUrl,
  };
}

/**
 * Get entries that haven't been synced yet.
 */
function getUnsyncedEntries(): AuditEntry[] {
  const all = listAuditEntries({});
  return all.filter(e => e.seq > lastSyncedSeq);
}

/**
 * Sync pending audit entries to the API.
 * Returns the number of entries synced.
 */
export async function syncAuditToApi(): Promise<{
  synced: number;
  error: string | null;
}> {
  if (!syncEnabled) {
    return { synced: 0, error: "Sync disabled" };
  }

  const pending = getUnsyncedEntries();
  if (pending.length === 0) {
    return { synced: 0, error: null };
  }

  const denied = assertControlPlaneApiEgress("cp-audit-import");
  if (denied) {
    return { synced: 0, error: denied };
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token =
      adminToken ??
      process.env["ATLAS_CONTROL_PLANE_TOKEN"]?.trim() ??
      process.env["ATLAS_CONTROL_PLANE_TOKEN_PREVIOUS"]?.trim() ??
      "";
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${apiBaseUrl}/api/v1/audit/cp-import`, {
      method: "POST",
      headers,
      body: JSON.stringify({ entries: pending }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { synced: 0, error: `API returned ${response.status}: ${text}` };
    }

    const result = (await response.json()) as { imported: number };
    const maxSeq = Math.max(...pending.map(e => e.seq));
    lastSyncedSeq = maxSeq;
    
    return { synced: result.imported, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { synced: 0, error: message };
  }
}

/**
 * Manual sync trigger for immediate flush.
 */
export async function flushAuditSync(): Promise<{
  synced: number;
  error: string | null;
}> {
  return syncAuditToApi();
}

/**
 * Reset sync state (for tests).
 */
export function resetAuditSyncState(): void {
  lastSyncedSeq = 0;
}

let syncInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic sync (every 30 seconds by default).
 */
export function startPeriodicSync(intervalMs = 30_000): void {
  if (syncInterval) return;
  syncInterval = setInterval(() => {
    void syncAuditToApi().catch(() => {
      // Silently ignore sync errors — will retry next interval
    });
  }, intervalMs);
}

/**
 * Stop periodic sync.
 */
export function stopPeriodicSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
