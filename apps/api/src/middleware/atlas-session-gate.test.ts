import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { KILL_SWITCH_CONTROL_PATH } from "@atlas/shared";
import { errorHandler } from "./error-handler.js";
import { registerAtlasSessionGate } from "./atlas-session-gate.js";
import { buildTestEnv } from "../routes/test-helpers/build-route-test-app.js";

/**
 * Reproduction + regression: Control SERVICE bearer against `/api/v1/internal/*`
 * must use the SAME onRequest gate as `buildApp()`, not `buildRouteTestApp`
 * (which skipped the hook and hid a 401).
 */
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-internal-gate-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const CP_TOKEN = "control-plane-operator-token-32chars!!";

const { registerKillSwitchRoutes } = await import("../routes/kill-switches.js");

describe("Control internal hops under the real session gate", () => {
  let app: FastifyInstance;
  const previousToken = process.env.ATLAS_CONTROL_PLANE_TOKEN;

  beforeAll(async () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = CP_TOKEN;
    app = Fastify({
      logger: false,
      requestIdHeader: "x-request-id",
      genReqId: () => randomUUID(),
    });
    app.setErrorHandler(errorHandler);
    app.decorate("atlasEnv", buildTestEnv());
    registerAtlasSessionGate(app);
    await registerKillSwitchRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (previousToken === undefined) {
      delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    } else {
      process.env.ATLAS_CONTROL_PLANE_TOKEN = previousToken;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("CP bearer-only GET reaches the kill-switch control hop", async () => {
    const res = await app.inject({
      method: "GET",
      url: KILL_SWITCH_CONTROL_PATH,
      headers: { authorization: `Bearer ${CP_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      categories: expect.any(Array),
      status: expect.any(Array),
    });
  });

  it("missing bearer is 401, not a session-cookie demand that Control cannot satisfy", async () => {
    const res = await app.inject({
      method: "GET",
      url: KILL_SWITCH_CONTROL_PATH,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toMatch(
      /Control Plane service authentication failed/i,
    );
    expect(res.json().error.message).not.toMatch(/Not signed in/i);
  });

  it("tenant session without CP bearer cannot use internal hops", async () => {
    const res = await app.inject({
      method: "GET",
      url: KILL_SWITCH_CONTROL_PATH,
      headers: { cookie: "atlas_session=not-a-control-token" },
    });
    expect(res.statusCode).toBe(401);
  });
});
