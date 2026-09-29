import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  lookupControlPlaneAgentRuntimeStatus,
  checkControlPlaneAgentRegistration,
} from "./control-plane-bridge.js";

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

describe("lookupControlPlaneAgentRuntimeStatus", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    delete process.env.ATLAS_CONTROL_PLANE_URL;
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

  it("is not configured when the Control Plane URL is unset", async () => {
    delete process.env.ATLAS_CONTROL_PLANE_URL;
    const result = await lookupControlPlaneAgentRuntimeStatus("CODE_ENGINEER");
    expect(result).toEqual({ configured: false });
  });

  it("fail-closes as UNKNOWN when the URL is set but the hop fails", async () => {
    process.env.ATLAS_CONTROL_PLANE_URL = "http://127.0.0.1:1";
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "token";
    const result = await lookupControlPlaneAgentRuntimeStatus("CODE_ENGINEER");
    expect(result).toEqual({ configured: true, status: "UNKNOWN", unreachable: true });
  });

  it("treats a missing oversight overlay as ACTIVE", async () => {
    const { server, origin } = await listen((_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    servers.push(server);
    process.env.ATLAS_CONTROL_PLANE_URL = origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "token";
    const result = await lookupControlPlaneAgentRuntimeStatus("RESEARCHER");
    expect(result).toEqual({ configured: true, status: "ACTIVE", unreachable: false });
  });

  it("returns the Control Plane overlay status when present", async () => {
    const { server, origin } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ agentId: "CODE_ENGINEER", status: "QUARANTINED" }),
      );
    });
    servers.push(server);
    process.env.ATLAS_CONTROL_PLANE_URL = origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "token";
    const result = await lookupControlPlaneAgentRuntimeStatus("CODE_ENGINEER");
    expect(result).toEqual({
      configured: true,
      status: "QUARANTINED",
      unreachable: false,
    });
  });
});

// ── checkControlPlaneAgentRegistration ────────────────────────────────────

describe("checkControlPlaneAgentRegistration", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    delete process.env.ATLAS_CONTROL_PLANE_URL;
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

  it("returns configured:false when URL is not set", async () => {
    delete process.env.ATLAS_CONTROL_PLANE_URL;
    const result = await checkControlPlaneAgentRegistration("SECURITY");
    expect(result).toEqual({ configured: false });
  });

  it("returns CONTROL_NOT_REGISTERED when the new endpoint returns 404", async () => {
    const { server, origin } = await listen((_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ registered: false, status: "CONTROL_NOT_REGISTERED" }));
    });
    servers.push(server);
    process.env.ATLAS_CONTROL_PLANE_URL = origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "token";

    const result = await checkControlPlaneAgentRegistration("SECURITY");
    expect(result).toMatchObject({
      configured: true,
      registered: false,
      status: "CONTROL_NOT_REGISTERED",
    });
  });

  it("returns CONTROL_REGISTERED when agent is registered", async () => {
    const { server, origin } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        agentId: "SECURITY",
        status: "CONTROL_REGISTERED",
        registrationSource: "STATIC_CATALOG",
        ownerId: null,
        registeredAt: "2026-09-29T00:00:00.000Z",
        registeredBy: "atlas-api-bootstrap",
        evidence: "test",
        idempotencyKey: "SECURITY",
      }));
    });
    servers.push(server);
    process.env.ATLAS_CONTROL_PLANE_URL = origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "token";

    const result = await checkControlPlaneAgentRegistration("SECURITY");
    expect(result).toMatchObject({
      configured: true,
      registered: true,
      status: "CONTROL_REGISTERED",
    });
  });

  it("returns CONTROL_UNREACHABLE on network failure", async () => {
    process.env.ATLAS_CONTROL_PLANE_URL = "http://127.0.0.1:1";
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "token";

    const result = await checkControlPlaneAgentRegistration("CODE_ENGINEER");
    expect(result).toMatchObject({
      configured: true,
      registered: false,
      status: "CONTROL_UNREACHABLE",
    });
  });

  it("passes ownerId as query param for PSA lookup", async () => {
    let capturedUrl = "";
    const { server, origin } = await listen((req, res) => {
      capturedUrl = req.url ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        agentId: "psa:owner-xyz",
        status: "CONTROL_REGISTERED",
        registrationSource: "PSA_OWNER",
        ownerId: "owner-xyz",
        registeredAt: new Date().toISOString(),
        registeredBy: "test",
        evidence: "test",
        idempotencyKey: "psa:owner-xyz::owner::owner-xyz",
      }));
    });
    servers.push(server);
    process.env.ATLAS_CONTROL_PLANE_URL = origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "token";

    await checkControlPlaneAgentRegistration("psa:owner-xyz", "owner-xyz");
    expect(capturedUrl).toContain("ownerId=owner-xyz");
  });

  it("returns CONTROL_REVOKED when agent is revoked", async () => {
    const { server, origin } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        agentId: "SECURITY",
        status: "CONTROL_REVOKED",
        registrationSource: "STATIC_CATALOG",
        ownerId: null,
        registeredAt: new Date().toISOString(),
        registeredBy: "test",
        evidence: "test",
        idempotencyKey: "SECURITY",
      }));
    });
    servers.push(server);
    process.env.ATLAS_CONTROL_PLANE_URL = origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "token";

    const result = await checkControlPlaneAgentRegistration("SECURITY");
    expect(result).toMatchObject({
      configured: true,
      registered: false,
      status: "CONTROL_REVOKED",
    });
  });
});
