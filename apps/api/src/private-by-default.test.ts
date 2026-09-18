import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-private-default-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.VERCEL = "1";

const { buildApp } = await import("./create-app.js");
const { buildTestEnv } = await import("./routes/test-helpers/build-route-test-app.js");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("private-by-default API hook (ADR-021)", () => {
  it("keeps health public and 401s studio/memory/graph without a session", async () => {
    const app = await buildApp(buildTestEnv({ SUPABASE_SERVICE_ROLE_KEY: "replace-me" }));
    try {
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
      expect((await app.inject({ method: "HEAD", url: "/health" })).statusCode).toBe(200);
      expect(
        (await app.inject({ method: "HEAD", url: "/api/v1/memory" })).statusCode,
      ).toBe(401);
      expect(
        (await app.inject({ method: "HEAD", url: "/api/v1/metrics" })).statusCode,
      ).toBe(401);
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/studio/tree" })).statusCode,
      ).toBe(401);
      expect((await app.inject({ method: "GET", url: "/api/v1/memory" })).statusCode).toBe(
        401,
      );
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/graph/nodes" })).statusCode,
      ).toBe(401);
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/admin/command-center" }))
          .statusCode,
      ).toBe(401);
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/systems" })).statusCode,
      ).toBe(401);
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/metrics" })).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/synthetic/scenarios/run",
            payload: {
              tenantId: "TEST-REALTY-001",
              scenarioId: "real-estate-deal-completion",
            },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/synthetic/scenarios/closed-loop",
            payload: {
              tenantId: "TEST-REALTY-001",
              scenarioId: "real-estate-deal-incomplete-payment",
            },
          })
        ).statusCode,
      ).toBe(401);

      expect(
        (await app.inject({ method: "HEAD", url: "/api/v1/knowledge" }))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "OPTIONS",
            url: "/api/v1/memory",
            headers: {
              origin: "http://localhost:3000",
              "access-control-request-method": "GET",
            },
          })
        ).statusCode,
      ).not.toBe(401);

      const email = `head-gate-${Date.now()}@atlas.local`;
      const password = "AtlasHeadGate1!";
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/auth/register",
            payload: { email, password, displayName: "HEAD gate" },
          })
        ).statusCode,
      ).toBe(201);
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password },
      });
      expect(login.statusCode).toBe(200);
      const cookie = String(login.headers["set-cookie"] ?? "");
      expect(cookie).toMatch(/atlas_session=/);
      expect(
        (
          await app.inject({
            method: "HEAD",
            url: "/api/v1/metrics",
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });
});
