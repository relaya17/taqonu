import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

// Same isolation pattern as
// apps/api/src/services/cost-intelligence.test.ts — a per-file temp store
// path plus skip-persist/skip-audit-log flags, set before osStore (or
// anything importing it) is first loaded.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-cost-intelligence-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const { osStore } = await import("../store/os-store.js");
const { registerCostIntelligenceRoutes } = await import("./cost-intelligence.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

let app: FastifyInstance;

const PROJECT_A = "11111111-1111-4111-8111-111111111111";

function seedDispatchAuditAt(entry: {
  projectId: string | null;
  costUsd: number;
  at: string;
}): void {
  osStore.appendAudit({
    type: "agents.dispatch",
    id: crypto.randomUUID(),
    traceId: `trace_${crypto.randomUUID().slice(0, 8)}`,
    projectId: entry.projectId,
    judge: "APPROVE",
    runs: 1,
    failed: 0,
    costUsd: entry.costUsd,
    at: entry.at,
  });
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerCostIntelligenceRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  osStore.unloadForTests();
});

describe("GET /api/v1/cost-intelligence/anomalies", () => {
  it("returns an empty byProject list when there is no audit data", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cost-intelligence/anomalies",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.byProject).toEqual([]);
    expect(body.method).toBe("zscore");
    expect(typeof body.generatedAt).toBe("string");
  });

  it("reports INSUFFICIENT_DATA for a project with fewer than MIN_SAMPLE_SIZE days of cost data", async () => {
    for (let day = 1; day <= 3; day++) {
      seedDispatchAuditAt({
        projectId: PROJECT_A,
        costUsd: 0.05,
        at: `2026-01-0${day}T00:00:00.000Z`,
      });
    }

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cost-intelligence/anomalies",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.byProject).toHaveLength(1);
    expect(body.byProject[0].projectId).toBe(PROJECT_A);
    expect(body.byProject[0].sampleSize).toBe(3);
    expect(body.byProject[0].anomalies).toEqual([
      expect.objectContaining({ status: "INSUFFICIENT_DATA" }),
    ]);
  });

  it("flags a real cost spike once enough daily history exists", async () => {
    // 7 flat days at $0.01, then a $10 spike on day 8 — well past MIN_SAMPLE_SIZE (7).
    for (let day = 1; day <= 7; day++) {
      seedDispatchAuditAt({
        projectId: PROJECT_A,
        costUsd: 0.01,
        at: `2026-01-0${day}T00:00:00.000Z`,
      });
    }
    seedDispatchAuditAt({
      projectId: PROJECT_A,
      costUsd: 10,
      at: "2026-01-08T00:00:00.000Z",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cost-intelligence/anomalies",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.byProject).toHaveLength(1);
    const projectResult = body.byProject[0];
    expect(projectResult.sampleSize).toBe(8);
    expect(projectResult.anomalies).toHaveLength(1);
    expect(projectResult.anomalies[0].status).toBe("ANOMALY");
    expect(projectResult.anomalies[0].point.value).toBe(10);
    expect(projectResult.anomalies[0].severity).toBe("HIGH");
  });

  it("filters to a single project when projectId is provided", async () => {
    const PROJECT_B = "22222222-2222-4222-8222-222222222222";
    for (let day = 1; day <= 3; day++) {
      seedDispatchAuditAt({
        projectId: PROJECT_A,
        costUsd: 0.01,
        at: `2026-01-0${day}T00:00:00.000Z`,
      });
    }
    seedDispatchAuditAt({
      projectId: PROJECT_B,
      costUsd: 0.02,
      at: "2026-01-01T00:00:00.000Z",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/cost-intelligence/anomalies?projectId=${PROJECT_A}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.byProject).toHaveLength(1);
    expect(body.byProject[0].projectId).toBe(PROJECT_A);
  });

  it("accepts an explicit method=iqr query param", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cost-intelligence/anomalies?method=iqr",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().method).toBe("iqr");
  });
});
