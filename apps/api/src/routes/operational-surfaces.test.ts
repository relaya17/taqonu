import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-ops-surface-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerMetricsRoutes } = await import("./metrics.js");
const { registerPerformanceRoutes } = await import("./performance.js");
const { registerReadinessRoutes } = await import("./readiness.js");
const { registerCommercialValidationRoutes } = await import("./commercial.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");

function user(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "user@example.com",
    displayName: "User",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const admin = user({
  id: "22222222-2222-4222-8222-222222222222",
  email: "admin@example.com",
  role: "admin",
});
const ownerA = user({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "a@example.com",
});
const ownerB = user({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  email: "b@example.com",
});

let app: FastifyInstance;

beforeAll(async () => {
  const appMetrics = await buildRouteTestApp(async (instance) => {
    await registerMetricsRoutes(instance);
    await registerPerformanceRoutes(instance);
    await registerReadinessRoutes(instance);
    await registerCommercialValidationRoutes(instance);
  });
  app = appMetrics;
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  osStore.resetInMemoryForTests();
});

describe("process-global operational surfaces require admin", () => {
  const opsGets = [
    "/api/v1/metrics",
    "/api/v1/performance",
    "/api/v1/performance/cache",
    "/api/v1/analytics/usage",
  ];

  it.each(opsGets)("401s unauthenticated GET %s", async (url) => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
  });

  it.each(opsGets)("403s signed-in non-admin GET %s", async (url) => {
    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(403);
  });

  it.each(opsGets)("200s admin GET %s", async (url) => {
    getRequestUser.mockReturnValue(admin);
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
  });

  it("403s signed-in non-admin POST metrics/record and cache/clear", async () => {
    getRequestUser.mockReturnValue(ownerA);
    const record = await app.inject({
      method: "POST",
      url: "/api/v1/metrics/record",
      payload: { name: "agent_run_duration", value: 1 },
    });
    expect(record.statusCode).toBe(403);
    const clear = await app.inject({
      method: "POST",
      url: "/api/v1/performance/cache/clear",
    });
    expect(clear.statusCode).toBe(403);
  });
});

describe("readiness certificates are project-scoped", () => {
  it("user B cannot list or get user A's project certificate", async () => {
    const now = new Date().toISOString();
    const projectA = crypto.randomUUID();
    osStore.upsertProject({
      id: projectA,
      slug: "proj-a",
      name: "A",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    bindProjectOwner(projectA, ownerA.id, "bound_on_create");
    osStore.addReadinessCertificate({
      id: crypto.randomUUID(),
      projectId: projectA,
      projectName: "A",
      overallScore: 80,
      dimensions: [
        {
          key: "security",
          score: 80,
          epistemicState: "OBSERVED",
          evidenceRefs: [],
          notes: "ok",
        },
      ],
      blockers: 0,
      highRisks: 0,
      unknownClaims: 0,
      blockerSummaries: [],
      highRiskSummaries: [],
      unknownSummaries: [],
      lastVerifiedAt: now,
      plainLanguageSummary: "ok",
      gateGraphId: null,
      createdAt: now,
    });
    const certId = osStore.listReadinessCertificates()[0]!.id;

    getRequestUser.mockReturnValue(ownerB);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/readiness/certificates",
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(0);

    const got = await app.inject({
      method: "GET",
      url: `/api/v1/readiness/certificates/${certId}`,
    });
    expect(got.statusCode).toBe(403);

    getRequestUser.mockReturnValue(ownerA);
    const listedA = await app.inject({
      method: "GET",
      url: "/api/v1/readiness/certificates",
    });
    expect(listedA.json().items).toHaveLength(1);
  });
});
