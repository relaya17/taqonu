import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditSyncState,
  setAuditSyncConfig,
  syncAuditToApi,
} from "../services/audit-sync.js";
import { appendAuditEntry, resetGovernanceStateForTests } from "../services/governance-state.js";

describe("Control Plane audit sync", () => {
  afterEach(() => {
    resetAuditSyncState();
    resetGovernanceStateForTests();
    setAuditSyncConfig({ enabled: true, apiBaseUrl: "http://127.0.0.1:4000" });
    vi.unstubAllGlobals();
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
  });

  it("posts unsynced entries with the Control Plane service bearer", async () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "cp-sync-token";
    appendAuditEntry({
      seq: 1,
      timestamp: "2026-09-04T00:00:00.000Z",
      type: "gateway.decision",
      actorId: "cp:service",
      actorKind: "SYSTEM",
      reason: "sync",
      policy: "DOCUMENT.READ",
      risk: "LOW",
      approval: "NOT_REQUIRED",
      result: "SUCCESS",
      ownerId: "owner",
      projectId: null,
      hash: "cp-hash-1",
      prevHash: "GENESIS",
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer cp-sync-token");
      const body = JSON.parse(String(init?.body)) as { entries: unknown[] };
      expect(body.entries.length).toBe(1);
      return { ok: true, json: async () => ({ imported: 1 }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await syncAuditToApi();
    expect(result.error).toBeNull();
    expect(result.synced).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
