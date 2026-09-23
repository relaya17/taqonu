import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { lookupControlPlaneAgentRuntimeStatus } from "./control-plane-bridge.js";

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
