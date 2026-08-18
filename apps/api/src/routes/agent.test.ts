import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

// Isolate the singleton osStore before it's ever imported/loaded.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-agent-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const { registerAgentRoutes } = await import("./agent.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerAgentRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("POST /api/v1/agent/runs", () => {
  it("400s with VALIDATION_ERROR when userRequest is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("400s when userRequest exceeds the 10000-char limit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: { userRequest: "x".repeat(10001) },
    });
    expect(res.statusCode).toBe(400);
  });

  // NOTE: createAgentRunSchema's aiProviderId enum only lists the 12
  // "agent"-kind catalog entries — the two "assist"-kind ids
  // (local-checklist, gpt-4o-vision) aren't in it at all. So the route's own
  // `catalog.kind === "assist"` guard (with its friendlier "Provider is
  // assist-only" message) is unreachable dead code: any assist-only id gets
  // rejected by the Zod schema first, as a generic VALIDATION_ERROR.
  it("400s for an assist-only aiProviderId — rejected by the Zod enum before the route's own assist-only guard ever runs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: { userRequest: "hello", aiProviderId: "local-checklist" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("201s for a normal READ request on the free included provider and returns a well-formed run", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: { userRequest: "what is the current project status?" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.run.id).toBeDefined();
    expect(body.run.userRequest).toBe("what is the current project status?");
    expect(body.catalog.id).toBe("arletos-included");
    expect(body.authorizationPreview).toBeDefined();
  });

  it("appends a WRITE-approval-gated note when the request implies a write change", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: { userRequest: "please commit and push this fix to the repo" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.run.status).toBe("AWAITING_APPROVAL");
    expect(body.run.answer).toMatch(/approval-gated/);
  });

  it("GET /api/v1/agent/runs lists previously created runs", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/agent/runs" });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("400s when the request body isn't valid JSON-shaped for the schema (wrong type)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: { userRequest: 12345 },
    });
    expect(res.statusCode).toBe(400);
  });
});
