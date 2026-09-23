import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetAuditSyncState,
  setAuditSyncConfig,
  syncAuditToApi,
} from "../services/audit-sync.js";
import { appendAuditEntry, resetGovernanceStateForTests } from "../services/governance-state.js";

function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; origin: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no listen address"));
        return;
      }
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

describe("Control Plane audit sync", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    resetAuditSyncState();
    resetGovernanceStateForTests();
    setAuditSyncConfig({ enabled: true, apiBaseUrl: "http://127.0.0.1:4000" });
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    delete process.env.ATLAS_API_URL;
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((err) => (err ? reject(err) : resolve())),
          ),
      ),
    );
  });

  it("posts unsynced entries with the Control Plane service bearer", async () => {
    const seen: { authorization?: string; entries: number } = {
      entries: 0,
    };
    const { server, origin } = await listen((req, res) => {
      seen.authorization = req.headers.authorization;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          entries: unknown[];
        };
        seen.entries = body.entries.length;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ imported: 1 }));
      });
    });
    servers.push(server);

    process.env.ATLAS_API_URL = origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "cp-sync-token";
    setAuditSyncConfig({ enabled: true, apiBaseUrl: origin });

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

    const result = await syncAuditToApi();
    expect(result.error).toBeNull();
    expect(result.synced).toBe(1);
    expect(seen.authorization).toBe("Bearer cp-sync-token");
    expect(seen.entries).toBe(1);
  });

  it("refuses a private apiBaseUrl that is not the exact Atlas origin", async () => {
    process.env.ATLAS_API_URL = "http://127.0.0.1:4000";
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "cp-sync-token";
    setAuditSyncConfig({
      enabled: true,
      apiBaseUrl: "http://127.0.0.1:59999",
    });
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
    const result = await syncAuditToApi();
    expect(result.synced).toBe(0);
    expect(result.error).toMatch(/OUTBOUND_/);
  });
});
