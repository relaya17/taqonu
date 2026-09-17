import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { KILL_SWITCH_CONTROL_PATH } from "@atlas/shared";
import { buildRouteTestApp } from "./test-helpers/build-route-test-app.js";

const CP_TOKEN = "control-plane-operator-token-32chars!!";

/**
 * Task 7 -- Runtime Kill Switch Control API route tests. Mirrors
 * `agent-runtime-controls.test.ts`'s structure exactly (same
 * Control-Plane-service-authenticated write-surface contract), plus the
 * kill-switch-specific effective-state assertions (env baseline vs.
 * runtime override vs. effective) Task 7 requires.
 *
 * `osStore` is a module-level singleton, so -- exactly like
 * `remediation.test.ts` -- `ATLAS_STORE_PATH` is redirected to a fresh temp
 * file BEFORE the module graph (and therefore `osStore`) is imported, so
 * this file's runtime overrides never touch the real repo's `.atlas/store.json`.
 */
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-kill-switch-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
// Mirrors remediation.test.ts's isolation convention: skip real disk
// persistence so `osStore.unloadForTests()` between tests yields a truly
// blank in-memory store (nothing was ever written to `store.json` to
// reload), rather than accumulating runtime overrides across tests.
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { osStore } = await import("../store/os-store.js");
const { registerKillSwitchRoutes } = await import("./kill-switches.js");

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    category: "payments",
    action: "activate",
    setBy: "owner-1",
    reason: "route-level test",
    ...overrides,
  };
}

describe("kill switch control routes", () => {
  let app: FastifyInstance;
  const ORIGINAL_ENV = process.env.ATLAS_KILL_SWITCHES;

  beforeEach(async () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = CP_TOKEN;
    delete process.env.ATLAS_KILL_SWITCHES;
    osStore.unloadForTests();
    app = await buildRouteTestApp(registerKillSwitchRoutes);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    if (ORIGINAL_ENV === undefined) {
      delete process.env.ATLAS_KILL_SWITCHES;
    } else {
      process.env.ATLAS_KILL_SWITCHES = ORIGINAL_ENV;
    }
  });

  function post(body: Record<string, unknown>, token: string = CP_TOKEN) {
    return app.inject({
      method: "POST",
      url: KILL_SWITCH_CONTROL_PATH,
      headers: {
        authorization: token ? `Bearer ${token}` : "",
        "content-type": "application/json",
      },
      payload: body,
    });
  }

  function get(token: string = CP_TOKEN) {
    return app.inject({
      method: "GET",
      url: KILL_SWITCH_CONTROL_PATH,
      headers: { authorization: token ? `Bearer ${token}` : "" },
    });
  }

  it("GET without valid Control Plane service authentication is rejected (401), before any state is read", async () => {
    const missing = await get("");
    expect(missing.statusCode).toBe(401);
    const wrong = await get("not-the-token");
    expect(wrong.statusCode).toBe(401);
  });

  it("GET returns the full canonical category list with env/runtime/effective status for each", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.categories).toContain("agentDispatch");
    expect(body.categories).toContain("payments");
    const entry = body.status.find((s: { category: string }) => s.category === "payments");
    expect(entry).toMatchObject({
      category: "payments",
      envActive: false,
      runtimeOverrideActive: false,
      effectiveActive: false,
      override: null,
    });
  });

  it("valid activate POST succeeds, persists a runtime override, and is reflected in the next GET", async () => {
    const res = await post(validBody());
    expect(res.statusCode).toBe(200);
    expect(res.json().override).toMatchObject({ reason: "route-level test", setBy: "owner-1" });

    const statusRes = await get();
    const entry = statusRes.json().status.find((s: { category: string }) => s.category === "payments");
    expect(entry).toMatchObject({
      envActive: false,
      runtimeOverrideActive: true,
      effectiveActive: true,
    });
  });

  it("deactivate clears the runtime override", async () => {
    await post(validBody());
    const res = await post(validBody({ action: "deactivate", reason: "no longer needed" }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ category: "payments", cleared: true });

    const statusRes = await get();
    const entry = statusRes.json().status.find((s: { category: string }) => s.category === "payments");
    expect(entry).toMatchObject({ runtimeOverrideActive: false, effectiveActive: false });
  });

  it("deactivate cannot force an env-active category to appear inactive", async () => {
    process.env.ATLAS_KILL_SWITCHES = "payments";
    await post(validBody());
    await post(validBody({ action: "deactivate", reason: "attempted clear" }));

    const statusRes = await get();
    const entry = statusRes.json().status.find((s: { category: string }) => s.category === "payments");
    // Runtime override is gone, but env baseline alone keeps it effective.
    expect(entry).toMatchObject({
      envActive: true,
      runtimeOverrideActive: false,
      effectiveActive: true,
    });
  });

  it("POST with an unknown category is rejected (400) and mutates nothing", async () => {
    const res = await post(validBody({ category: "not-a-real-category" }));
    expect(res.statusCode).toBe(400);
    const statusRes = await get();
    expect(statusRes.json().status.every((s: { runtimeOverrideActive: boolean }) => !s.runtimeOverrideActive)).toBe(true);
  });

  it("POST with a missing/empty reason is rejected (400) and mutates nothing", async () => {
    const res = await post(validBody({ reason: "" }));
    expect(res.statusCode).toBe(400);
    const statusRes = await get();
    const entry = statusRes.json().status.find((s: { category: string }) => s.category === "payments");
    expect(entry.runtimeOverrideActive).toBe(false);
  });

  it("POST without valid Control Plane service authentication is rejected (401) and mutates nothing", async () => {
    const res = await post(validBody(), "not-the-token");
    expect(res.statusCode).toBe(401);
    const statusRes = await get();
    const entry = statusRes.json().status.find((s: { category: string }) => s.category === "payments");
    expect(entry.runtimeOverrideActive).toBe(false);
  });
});
