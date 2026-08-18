import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-agent-fabric-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const { registerAgentFabricRoutes } = await import("./agent-fabric.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerAgentFabricRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/v1/agents", () => {
  it("lists every fabric agent, including LEGAL_MEDIA_COMMS, without throwing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agents" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.some((a: { id: string }) => a.id === "LEGAL_MEDIA_COMMS")).toBe(
      true,
    );
  });
});

describe("GET /api/v1/agents/:id", () => {
  it("404s for an unknown agent id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agents/NOT_REAL" });
    expect(res.statusCode).toBe(404);
  });

  it("200s for a known agent id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agents/SECURITY" });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("SECURITY");
  });
});

describe("POST /api/v1/agents/plan", () => {
  it("400s when request is missing", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/agents/plan", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("200s and includes a memoryContext alongside the plan", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/plan",
      payload: { request: "fix the login bug" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.steps.length).toBeGreaterThan(0);
    expect(body.memoryContext).toBeDefined();
  });

  it("does not 400 for a long (>4000, <=8000 char) request — agentPlanRequestSchema.request has no internal-field mismatch like kernel/plan did", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/plan",
      payload: { request: "fix ".repeat(1500) }, // 7500 chars
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/v1/agents/dispatch", () => {
  it("201s and returns runs + a judge decision", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/dispatch",
      payload: { request: "fix the login bug" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.runs.length).toBeGreaterThan(0);
    expect(body.judge).toBeDefined();
  });

  it("400s for an empty request string", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/dispatch",
      payload: { request: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/v1/judge/evaluate", () => {
  it("400s when runs array is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/judge/evaluate",
      payload: { runs: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("200s and approves a clean, fully-evidenced run", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/judge/evaluate",
      payload: {
        runs: [
          {
            agentId: "ARCHITECT",
            status: "COMPLETED",
            summary: "architecture review complete",
            claims: ["c1"],
            evidenceRefs: ["e1"],
            epistemicState: "INFERRED",
            costUsd: 0.01,
            durationMs: 5,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("APPROVE");
  });
});

describe("knowledge routes", () => {
  it("GET /api/v1/knowledge/verified-sources 200s with an allow-list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/knowledge/verified-sources" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });

  it("POST /api/v1/knowledge/search 400s without a query", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/search",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // The route checks requireSignedInForWrite() before the URL allow-list, so
  // an unauthenticated request is correctly rejected with 401 first — the
  // allow-list's 403 only applies to signed-in callers. Covering the
  // allow-list rejection itself would need a full auth-session fixture,
  // which is out of scope for this route-level pass.
  it("POST /api/v1/knowledge/ingest 401s (not signed in) before ever reaching the URL allow-list check", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/ingest",
      payload: {
        title: "t",
        excerpt: "e",
        sourceClass: "BLOG",
        url: "https://some-random-blog.example.com/post",
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
