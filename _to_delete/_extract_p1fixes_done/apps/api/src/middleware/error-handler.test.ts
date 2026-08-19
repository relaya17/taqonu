import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AtlasError } from "@atlas/shared";
import { defaultErrorAggregator } from "@atlas/observability";
import { z } from "zod";
import { buildRouteTestApp } from "../routes/test-helpers/build-route-test-app.js";

async function buildThrowingApp(): Promise<FastifyInstance> {
  return buildRouteTestApp(async (app) => {
    app.get("/boom/atlas", async () => {
      throw new AtlasError("NOT_FOUND", "project 12345 not found");
    });
    app.get("/boom/zod", async () => {
      z.object({ name: z.string() }).parse({});
    });
    app.get("/boom/generic", async () => {
      throw new Error("unexpected failure");
    });
  });
}

describe("errorHandler", () => {
  beforeEach(() => {
    defaultErrorAggregator.reset();
  });

  it("[integration] AtlasError responses are unaffected by aggregation wiring", async () => {
    const app = await buildThrowingApp();
    try {
      const res = await app.inject({ method: "GET", url: "/boom/atlas" });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.message).toBe("project 12345 not found");
    } finally {
      await app.close();
    }
  });

  it("[integration] ZodError responses are unaffected by aggregation wiring", async () => {
    const app = await buildThrowingApp();
    try {
      const res = await app.inject({ method: "GET", url: "/boom/zod" });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    } finally {
      await app.close();
    }
  });

  it("[integration] generic Error responses are unaffected by aggregation wiring", async () => {
    const app = await buildThrowingApp();
    try {
      const res = await app.inject({ method: "GET", url: "/boom/generic" });
      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.message).toBe("Internal server error");
    } finally {
      await app.close();
    }
  });

  it("[integration] every handled error is recorded in the shared error aggregator", async () => {
    const app = await buildThrowingApp();
    try {
      await app.inject({ method: "GET", url: "/boom/atlas" });
      await app.inject({ method: "GET", url: "/boom/zod" });
      await app.inject({ method: "GET", url: "/boom/generic" });

      const summary = defaultErrorAggregator.summary();
      expect(summary.totalOccurrences).toBe(3);
      const codes = summary.entries.map((e) => e.code).sort();
      expect(codes).toEqual(["INTERNAL_ERROR", "NOT_FOUND", "VALIDATION_ERROR"]);
    } finally {
      await app.close();
    }
  });

  it("[integration] dedups repeated AtlasError occurrences that differ only by embedded id, into one aggregate entry", async () => {
    const app = await buildRouteTestApp(async (app) => {
      let counter = 0;
      app.get("/boom/varying", async () => {
        counter += 1;
        throw new AtlasError("NOT_FOUND", `project ${counter} not found`);
      });
    });
    try {
      await app.inject({ method: "GET", url: "/boom/varying" });
      await app.inject({ method: "GET", url: "/boom/varying" });
      await app.inject({ method: "GET", url: "/boom/varying" });

      const summary = defaultErrorAggregator.summary();
      const notFoundEntries = summary.entries.filter((e) => e.code === "NOT_FOUND");
      expect(notFoundEntries).toHaveLength(1);
      expect(notFoundEntries[0]?.count).toBe(3);
    } finally {
      await app.close();
    }
  });
});
