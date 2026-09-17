import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ERROR_AGGREGATE_CONTROL_PATH } from "@atlas/shared";
import { defaultErrorAggregator } from "@atlas/observability";
import { buildRouteTestApp } from "./test-helpers/build-route-test-app.js";

const CP_TOKEN = "error-aggregate-cp-token-32chars!!!!";

const { registerErrorAggregateControlRoutes } = await import(
  "./error-aggregates-control.js"
);

let app: FastifyInstance;

beforeAll(async () => {
  process.env.ATLAS_CONTROL_PLANE_TOKEN = CP_TOKEN;
  app = await buildRouteTestApp(registerErrorAggregateControlRoutes);
});

afterAll(async () => {
  await app.close();
  delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
});

afterEach(() => {
  defaultErrorAggregator.reset();
});

describe("GET canonical error aggregates (CP SERVICE)", () => {
  it("401s without a Control Plane service token", async () => {
    const res = await app.inject({
      method: "GET",
      url: ERROR_AGGREGATE_CONTROL_PATH,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns recorded aggregates for a valid Control Plane service token", async () => {
    defaultErrorAggregator.record("NOT_FOUND", "project abc123 missing", {
      requestId: "req-1",
    });
    const res = await app.inject({
      method: "GET",
      url: ERROR_AGGREGATE_CONTROL_PATH,
      headers: { authorization: `Bearer ${CP_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      totalUniqueErrors: number;
      totalOccurrences: number;
      entries: Array<{ code: string; count: number }>;
    };
    expect(body.totalOccurrences).toBe(1);
    expect(body.entries[0]?.code).toBe("NOT_FOUND");
  });
});
