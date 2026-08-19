import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

/**
 * P0 fix: `gates.ts` previously had NO auth guard at all — any
 * unauthenticated caller could trigger a release-gate evaluation or waive a
 * gate. This proves: (1) an unauthenticated caller is now rejected, (2) the
 * route genuinely enforces whatever `authorizeEntityAction` decides (not
 * just the raw signed-in check), and (3) a properly authorized caller still
 * succeeds, with the real actor id threaded into the published
 * `gate.evaluated` domain event (see `automation-rules.ts`'s `onGateBlocked`,
 * which was already anticipating this fix).
 */

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-gates-route-test-"));
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

const authorizeEntityAction = vi.fn();

vi.mock("@atlas/agent-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/agent-core")>();
  return {
    ...actual,
    authorizeEntityAction: (
      ...args: Parameters<typeof actual.authorizeEntityAction>
    ) => authorizeEntityAction(...args) ?? actual.authorizeEntityAction(...args),
  };
});

const { registerGateRoutes } = await import("./gates.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");

let app: FastifyInstance;

function testUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    email: "release-ops@example.com",
    displayName: "Release Ops",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerGateRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(testUser());
  authorizeEntityAction.mockReset();
  authorizeEntityAction.mockReturnValue(undefined);
});

describe("POST /api/v1/gates/evaluate", () => {
  it("401s for an unauthenticated caller (no auth guard previously existed here)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s when the real authorizeEntityAction is engaged and denies the action", async () => {
    authorizeEntityAction.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(res.json().error.message).toMatch(/test-forced denial/);
  });

  it("200s for a signed-in caller and threads the real actor id into the gate.evaluated domain event", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().graph).toBeDefined();

    const events = osStore.listDomainEvents();
    const gateEvent = [...events].reverse().find((e) => e.type === "gate.evaluated");
    expect(gateEvent).toBeDefined();
    expect((gateEvent?.payload as { actorId?: string }).actorId).toBe(
      testUser().id,
    );
  });
});

describe("POST /api/v1/gates/:graphId/waive", () => {
  it("401s for an unauthenticated caller (no auth guard previously existed here)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/00000000-0000-4000-8000-000000000000/waive",
      payload: { gateId: "secrets-clean", waivedBy: "ops", reason: "known false positive" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s when the real authorizeEntityAction is engaged and denies the action", async () => {
    authorizeEntityAction.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/00000000-0000-4000-8000-000000000000/waive",
      payload: { gateId: "secrets-clean", waivedBy: "ops", reason: "known false positive" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("waives a gate for a signed-in caller once a graph exists", async () => {
    const evaluate = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: {},
    });
    const graphId = evaluate.json().graph.id as string;

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/gates/${graphId}/waive`,
      payload: { gateId: "secrets-clean", waivedBy: "ops", reason: "known false positive" },
    });
    expect(res.statusCode).toBe(200);
    const waived = res.json().graph.nodes.find(
      (n: { id: string }) => n.id === "secrets-clean",
    );
    expect(waived.status).toBe("WAIVED");
  });
});
