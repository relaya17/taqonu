import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

// Isolate the singleton osStore + keep every cloud/local bootstrap step in
// buildApp() offline and side-effect-free (same pattern as health.test.ts /
// events.test.ts). VERCEL=1 skips the daily knowledge-refresh setInterval so
// vitest can exit cleanly once the app is closed.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-create-app-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.VERCEL = "1";

const { buildApp } = await import("./create-app.js");
const { buildTestEnv } = await import("./routes/test-helpers/build-route-test-app.js");
const { atlasMetrics } = await import("./routes/metrics.js");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function buildFullTestApp(): Promise<FastifyInstance> {
  const env = buildTestEnv({ SUPABASE_SERVICE_ROLE_KEY: "replace-me" });
  return buildApp(env);
}

describe("buildApp global rate limiting", () => {
  it("allows requests under the limit and rejects with 429 once the per-IP window is exceeded", async () => {
    const app = await buildFullTestApp();
    try {
      // Drive the limiter's max down for this instance-under-test isn't
      // possible post-registration, so exercise the real configured max
      // (300/min) by hammering a cheap route past it from a single fixed
      // "IP" (app.inject's default remoteAddress is stable per call).
      let lastRes: Awaited<ReturnType<typeof app.inject>> | undefined;
      let sawTooManyRequests = false;
      for (let i = 0; i < 305; i += 1) {
        lastRes = await app.inject({ method: "GET", url: "/health" });
        if (lastRes.statusCode === 429) {
          sawTooManyRequests = true;
          break;
        }
      }

      expect(sawTooManyRequests).toBe(true);
      expect(lastRes?.statusCode).toBe(429);
      const body = lastRes?.json();
      // Routed through the shared errorHandler (see middleware/error-handler.ts),
      // which surfaces @fastify/rate-limit's thrown error under statusCode.
      expect(body?.error ?? body?.message).toBeTruthy();
    } finally {
      await app.close();
    }
  }, 20_000);

  it("still enforces the tighter auth-endpoint limiter independently of the global one", async () => {
    // The global rate-limit hook is a backstop, not a replacement: routes/auth.ts's
    // own assertAuthRateLimit(...) call (services/auth-rate-limit.ts) still runs
    // and can reject a request long before 300/min is hit. We only assert here
    // that registering the global plugin doesn't remove/short-circuit that code
    // path — a normal, well-under-limit auth request still reaches the route
    // handler rather than being swallowed by the global limiter.
    const app = await buildFullTestApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "not-a-real-user@example.com", password: "wrong-password" },
      });
      // Not rate-limited (429 would mean the global limiter ate it before the
      // route ran) — the real auth route runs and rejects the bad credentials.
      expect(res.statusCode).not.toBe(429);
    } finally {
      await app.close();
    }
  });
});

describe("buildApp global latency hook", () => {
  it("records an http_request_duration_ms sample for every request, not just self-instrumented routes", async () => {
    const app = await buildFullTestApp();
    try {
      const before = atlasMetrics.list().length;
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);

      const after = atlasMetrics.list();
      expect(after.length).toBeGreaterThan(before);

      const sample = after[after.length - 1];
      expect(sample?.name).toBe("http_request_duration_ms");
      expect(typeof sample?.value).toBe("number");
      expect(sample?.value).toBeGreaterThanOrEqual(0);
      expect(sample?.tags?.method).toBe("GET");
      expect(sample?.tags?.route).toBe("/health");
      expect(sample?.tags?.statusCode).toBe("200");
    } finally {
      await app.close();
    }
  });
});
