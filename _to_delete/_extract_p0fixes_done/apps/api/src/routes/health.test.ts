import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

// Isolate the singleton osStore from the repo's real .atlas/store.json before
// it's ever imported/loaded (same pattern as events.test.ts / graph.test.ts) —
// checkSystemHealth's local-store branch reads through osStore, and this
// keeps the "HEALTHY local store" assertions independent of whatever this
// checkout's real store currently contains.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-health-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { registerHealthRoutes } = await import("./health.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /health", () => {
  it("stays a cheap static liveness probe (no dependency checks)", async () => {
    const app: FastifyInstance = await buildRouteTestApp(registerHealthRoutes);
    try {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({
        status: "ok",
        product: body.product,
        codename: body.codename,
      });
      // No component rollup on the cheap probe — by design (see health.ts).
      expect(body.components).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe("GET /api/v1/health", () => {
  it(
    "reports a real per-component rollup: HEALTHY local store + WARNING " +
      "(no AI provider key configured) when Supabase isn't live",
    async () => {
      // SUPABASE_SERVICE_ROLE_KEY: "replace-me" is the documented offline
      // sentinel (see packages/database/src/persist.ts isLiveSupabase and
      // packages/database/src/cloud-hydrate.test.ts) — this is the realistic
      // local-only dev mode this container actually runs in, since there is
      // no reachable Supabase instance here.
      const app: FastifyInstance = await buildRouteTestApp(registerHealthRoutes, {
        SUPABASE_SERVICE_ROLE_KEY: "replace-me",
      });
      try {
        const res = await app.inject({ method: "GET", url: "/api/v1/health" });
        expect(res.statusCode).toBe(200);
        const body = res.json();

        expect(body.version).toBe("v1");
        expect(body.components.database.status).toBe("HEALTHY");
        expect(body.components.database.detail).toMatch(/local json store/i);
        expect(typeof body.components.database.latencyMs).toBe("number");

        // buildTestEnv sets LLM_PROVIDER=echo and no provider API keys, so
        // this is an honest WARNING, not a fabricated pass.
        expect(body.components.llmProviders.status).toBe("WARNING");

        // Worker liveness genuinely can't be checked from the API process —
        // assert it stays UNKNOWN rather than a faked HEALTHY/CRITICAL.
        expect(body.components.worker.status).toBe("UNKNOWN");

        // Overall rollup = worst of the *known* statuses (UNKNOWN excluded)
        // = WARNING here, since database is HEALTHY and llmProviders is WARNING.
        expect(body.status).toBe("WARNING");
      } finally {
        await app.close();
      }
    },
  );

  it("reports HEALTHY llmProviders once a provider API key is configured", async () => {
    const app: FastifyInstance = await buildRouteTestApp(registerHealthRoutes, {
      SUPABASE_SERVICE_ROLE_KEY: "replace-me",
      ANTHROPIC_API_KEY: "sk-test-key",
    });
    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/health" });
      const body = res.json();
      expect(body.components.llmProviders.status).toBe("HEALTHY");
      expect(body.components.llmProviders.detail).toMatch(/anthropic/i);
      expect(body.status).toBe("HEALTHY");
    } finally {
      await app.close();
    }
  });

  it(
    "returns CRITICAL + HTTP 503 when Supabase is 'configured' but " +
      "unreachable (best-effort: exercises the real failure branch via a " +
      "real network attempt to a non-existent host in this sandboxed " +
      "container, not a mocked client — see health-check.ts checkDatabase)",
    async () => {
      // buildTestEnv's default SUPABASE_URL (https://example.supabase.co)
      // + a non-"replace-me" service role key makes isLiveSupabase() true,
      // so checkSystemHealth attempts a real Supabase query. This container
      // has no outbound network, so the query genuinely fails (DNS/connect
      // error or the 2s timeout) — this is a real exercise of the CRITICAL
      // path, not a fake. It is "best-effort" in the sense that it depends
      // on this environment having no route to example.supabase.co rather
      // than on a mocked rejection; a real Supabase outage would hit the
      // same code path.
      const app: FastifyInstance = await buildRouteTestApp(registerHealthRoutes);
      try {
        const res = await app.inject({ method: "GET", url: "/api/v1/health" });
        const body = res.json();

        expect(body.components.database.status).toBe("CRITICAL");
        expect(typeof body.components.database.detail).toBe("string");
        expect(typeof body.components.database.latencyMs).toBe("number");

        expect(body.status).toBe("CRITICAL");
        expect(res.statusCode).toBe(503);
      } finally {
        await app.close();
      }
    },
    10_000,
  );
});
