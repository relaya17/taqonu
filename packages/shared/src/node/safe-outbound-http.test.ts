import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SafeOutboundHttpError,
  safeOutboundFetch,
  type OutboundConnectRequest,
} from "./safe-outbound-http.js";

function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; origin: string; port: number }> {
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
        port: address.port,
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

describe("safeOutboundFetch", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((err) => (err ? reject(err) : resolve())),
          ),
      ),
    );
  });

  it("rejects loopback that is not an exact Atlas origin", async () => {
    await expect(
      safeOutboundFetch("http://127.0.0.1:9/", {
        method: "GET",
      }),
    ).rejects.toMatchObject({ code: "OUTBOUND_HTTPS_REQUIRED" });
    await expect(
      safeOutboundFetch("https://127.0.0.1/", {
        method: "GET",
      }),
    ).rejects.toMatchObject({ code: "OUTBOUND_BLOCKED_LOOPBACK" });
  });

  it("rejects private, metadata, mixed, and DNS64-private resolutions", async () => {
    await expect(
      safeOutboundFetch("https://intranet.example/", undefined, {
        resolve: async () => ["10.1.2.3"],
      }),
    ).rejects.toMatchObject({ code: "OUTBOUND_BLOCKED_RFC1918" });

    await expect(
      safeOutboundFetch("https://metadata.example/", undefined, {
        resolve: async () => ["169.254.169.254"],
      }),
    ).rejects.toMatchObject({ code: "OUTBOUND_METADATA" });

    await expect(
      safeOutboundFetch("https://mixed.example/", undefined, {
        resolve: async () => ["1.1.1.1", "10.0.0.1"],
      }),
    ).rejects.toMatchObject({ code: "OUTBOUND_MIXED_RESOLUTION" });

    await expect(
      safeOutboundFetch("https://nat64.example/", undefined, {
        resolve: async () => ["64:ff9b::7f00:1"],
      }),
    ).rejects.toMatchObject({ code: "OUTBOUND_BLOCKED_LOOPBACK" });
  });

  it("pins the classified public address and preserves Host/SNI hostname", async () => {
    const seen: OutboundConnectRequest[] = [];
    const res = await safeOutboundFetch("https://docs.example/path", undefined, {
      resolve: async () => ["203.0.113.10", "203.0.113.11"],
      connect: async (request) => {
        seen.push(request);
        return {
          status: 200,
          headers: { "content-type": "text/plain" },
          body: Buffer.from("ok"),
        };
      },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.pin.address).toBe("203.0.113.10");
    expect(seen[0]?.url.hostname).toBe("docs.example");
    expect(seen[0]?.url.protocol).toBe("https:");
  });

  it("does not fall back to hostname fetch when pin is missing", async () => {
    const connect = vi.fn();
    await expect(
      safeOutboundFetch("https://evil.example/", undefined, {
        resolve: async () => [],
        connect,
      }),
    ).rejects.toMatchObject({ code: "OUTBOUND_DNS_EMPTY" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("re-validates every redirect hop independently", async () => {
    const hops: string[] = [];
    await expect(
      safeOutboundFetch("https://public.example/start", undefined, {
        resolve: async (hostname) =>
          hostname === "public.example" ? ["203.0.113.8"] : ["169.254.169.254"],
        connect: async (request) => {
          hops.push(request.url.hostname);
          return {
            status: 302,
            headers: { location: "https://metadata.internal/" },
            body: Buffer.alloc(0),
          };
        },
      }),
    ).rejects.toMatchObject({ code: "OUTBOUND_METADATA" });
    expect(hops).toEqual(["public.example"]);
  });

  it("follows a safe public redirect after independent validation", async () => {
    const hops: string[] = [];
    const res = await safeOutboundFetch("https://a.example/", undefined, {
      resolve: async (hostname) =>
        hostname === "a.example" ? ["203.0.113.1"] : ["203.0.113.2"],
      connect: async (request) => {
        hops.push(request.url.href);
        if (request.url.hostname === "a.example") {
          return {
            status: 302,
            headers: { location: "https://b.example/final" },
            body: Buffer.alloc(0),
          };
        }
        return {
          status: 200,
          headers: { "content-type": "text/plain" },
          body: Buffer.from("final"),
        };
      },
    });
    expect(hops).toEqual(["https://a.example/", "https://b.example/final"]);
    expect(await res.text()).toBe("final");
    expect(res.url).toBe("https://b.example/final");
  });

  it("allows the exact configured Atlas origin on loopback and pins that address", async () => {
    const seenHosts: string[] = [];
    const { server, origin } = await listen((req, res) => {
      seenHosts.push(String(req.headers.host));
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("atlas");
    });
    servers.push(server);

    const res = await safeOutboundFetch(`${origin}/health`, undefined, {
      env: {
        ATLAS_API_URL: origin,
        ATLAS_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
      },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("atlas");
    expect(seenHosts[0]).toMatch(/^127\.0\.0\.1:/);
  });

  it("rejects a same-host redirect off the Atlas origin to a private address", async () => {
    const { server, origin, port } = await listen((_req, res) => {
      res.writeHead(302, { location: "https://169.254.169.254/latest/meta-data" });
      res.end();
    });
    servers.push(server);

    await expect(
      safeOutboundFetch(`${origin}/jump`, undefined, {
        env: {
          ATLAS_API_URL: `http://127.0.0.1:${port}`,
          ATLAS_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
        },
      }),
    ).rejects.toBeInstanceOf(SafeOutboundHttpError);
  });

  it("does not treat a generic private hostname as atlas_internal", async () => {
    await expect(
      safeOutboundFetch("http://10.0.0.8/admin", undefined, {
        env: {
          ATLAS_API_URL: "http://127.0.0.1:4000",
          ATLAS_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
        },
      }),
    ).rejects.toMatchObject({ code: "OUTBOUND_HTTPS_REQUIRED" });
  });
});
