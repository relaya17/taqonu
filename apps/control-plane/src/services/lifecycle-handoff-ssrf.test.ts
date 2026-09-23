import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { callAtlasApi } from "./lifecycle-handoff.js";

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

describe("callAtlasApi R11 pin path", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    delete process.env.ATLAS_API_URL;
    delete process.env.ATLAS_CONTROL_PLANE_URL;
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((err) => (err ? reject(err) : resolve())),
          ),
      ),
    );
  });

  it("uses the production pin path: exact Atlas origin, Host preserved, HMAC headers intact", async () => {
    const seen: { host?: string; authorization?: string; method?: string } = {};
    const { server, origin } = await listen((req, res) => {
      seen.host = req.headers.host;
      seen.authorization = req.headers.authorization;
      seen.method = req.method;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    servers.push(server);
    process.env.ATLAS_API_URL = origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "cp-token";

    const result = await callAtlasApi("/api/v1/gateway/fulfill", {
      method: "POST",
      body: { ping: true },
      requestId: "req-pin",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true });
    }
    expect(seen.host).toMatch(/^127\.0\.0\.1:/);
    expect(seen.authorization).toBe("Bearer cp-token");
    expect(seen.method).toBe("POST");
  });

  it("fails closed on metadata even when configured as ATLAS_API_URL", async () => {
    process.env.ATLAS_API_URL = "http://169.254.169.254";
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "cp-token";
    const result = await callAtlasApi("/api/v1/gateway/fulfill", {
      method: "GET",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/OUTBOUND_METADATA/);
  });

  it("does not follow a redirect off the Atlas origin into a private hop", async () => {
    const { server, origin } = await listen((_req, res) => {
      res.writeHead(302, { location: "http://10.1.2.3/steal" });
      res.end();
    });
    servers.push(server);
    process.env.ATLAS_API_URL = origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "cp-token";
    const result = await callAtlasApi("/api/v1/gateway/fulfill", {
      method: "GET",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/OUTBOUND_/);
  });
});
