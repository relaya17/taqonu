import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadSeedSnapshot, buildPortfolioSummary } from "@atlas/shared";
import { issueAdminBrowserSession } from "./browser-session.js";
import { handleAdminRequest } from "./server.js";

function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no listen address"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

describe("Admin portfolio routes (Phase 11.9 Option A)", () => {
  const token = "admin-test-token";
  let previousToken: string | undefined;
  let previousControl: string | undefined;

  beforeEach(() => {
    previousToken = process.env["ATLAS_CONTROL_PLANE_TOKEN"];
    previousControl = process.env["ATLAS_CONTROL_PLANE_URL"];
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = token;
    process.env["ATLAS_CONTROL_PLANE_URL"] = "http://127.0.0.1:3100";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousToken === undefined) delete process.env["ATLAS_CONTROL_PLANE_TOKEN"];
    else process.env["ATLAS_CONTROL_PLANE_TOKEN"] = previousToken;
    if (previousControl === undefined) delete process.env["ATLAS_CONTROL_PLANE_URL"];
    else process.env["ATLAS_CONTROL_PLANE_URL"] = previousControl;
  });

  it("rejects unauthenticated and invalid bearer access", async () => {
    const { url, close } = await listen(handleAdminRequest);
    try {
      const unauth = await fetch(`${url}/portfolio`);
      expect(unauth.status).toBe(401);
      const invalid = await fetch(`${url}/portfolio`, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(invalid.status).toBe(401);
      const unauthJson = await fetch(`${url}/api/v1/portfolio-governance`);
      expect(unauthJson.status).toBe(401);
    } finally {
      await close();
    }
  });

  it("forwards an authorized Admin read to Control Plane, never the tenant API", async () => {
    const snapshot = loadSeedSnapshot();
    const fetched: string[] = [];
    const headersSeen: string[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const href = String(input instanceof Request ? input.url : input);
        if (!href.startsWith("http://127.0.0.1:3100/api/v1/portfolio-governance")) {
          return realFetch(input as Parameters<typeof realFetch>[0], init);
        }
        fetched.push(href);
        const headers = init?.headers;
        const auth =
          headers instanceof Headers
            ? (headers.get("Authorization") ?? "")
            : Array.isArray(headers)
              ? ""
              : String((headers as Record<string, string> | undefined)?.Authorization ?? "");
        headersSeen.push(auth);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            snapshot,
            summary: buildPortfolioSummary(snapshot),
          }),
        } as Response;
      },
    );

    const { url, close } = await listen(handleAdminRequest);
    try {
      const res = await fetch(`${url}/portfolio`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Portfolio governance");
      expect(html).toContain("atlas");
      expect(fetched).toEqual(["http://127.0.0.1:3100/api/v1/portfolio-governance"]);
      expect(headersSeen).toEqual([`Bearer ${token}`]);
      expect(fetched.every((href) => !href.includes(":4000"))).toBe(true);
      expect(html).not.toContain(token);

      const jsonRes = await fetch(`${url}/api/v1/portfolio-governance`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(jsonRes.status).toBe(200);
      const body = (await jsonRes.json()) as { reachability: string };
      expect(body.reachability).toBe("REACHABLE");
    } finally {
      await close();
    }
  });

  it("accepts an owner browser session and rejects a tampered cookie", async () => {
    const snapshot = loadSeedSnapshot();
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const href = String(input instanceof Request ? input.url : input);
        if (!href.includes("127.0.0.1:3100/api/v1/portfolio-governance")) {
          return realFetch(input as Parameters<typeof realFetch>[0], init);
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            snapshot,
            summary: buildPortfolioSummary(snapshot),
          }),
        } as Response;
      },
    );
    const cookie = issueAdminBrowserSession("owner-1").split(";")[0]!;
    const { url, close } = await listen(handleAdminRequest);
    try {
      const ok = await fetch(`${url}/portfolio`, { headers: { cookie } });
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain("Portfolio governance");

      const tampered = await fetch(`${url}/portfolio`, {
        headers: { cookie: `${cookie}x` },
      });
      expect(tampered.status).toBe(401);
    } finally {
      await close();
    }
  });

  it("does not expose a write/decisions surface on Admin", async () => {
    const { url, close } = await listen(handleAdminRequest);
    try {
      const res = await fetch(`${url}/api/v1/portfolio-governance/decisions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "KEEP_SOURCE_SPECIFIC",
          verdict: "APPROVED",
          rationale: "Admin must not decide here",
        }),
      });
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });
});
