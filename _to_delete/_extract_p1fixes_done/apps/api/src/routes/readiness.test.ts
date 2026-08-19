import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

/**
 * P0 fix: `readiness.ts` previously had NO auth guard at all — any
 * unauthenticated caller could issue a production-readiness certificate.
 * This proves: (1) an unauthenticated caller is now rejected, (2) the route
 * genuinely enforces whatever `authorizeEntityAction` decides, and (3) a
 * properly authorized caller still succeeds, with the real actor id threaded
 * into the published `evaluation.completed` domain event (see
 * `automation-rules.ts`'s `onReadinessCertificateBlocked`, which was
 * already anticipating this fix).
 */

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-readiness-route-test-"));
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

const { registerReadinessRoutes } = await import("./readiness.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");

let app: FastifyInstance;

function testUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    email: "readiness-ops@example.com",
    displayName: "Readiness Ops",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerReadinessRoutes);
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

describe("POST /api/v1/readiness/certificate", () => {
  it("401s for an unauthenticated caller (no auth guard previously existed here)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/readiness/certificate",
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
      url: "/api/v1/readiness/certificate",
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(res.json().error.message).toMatch(/test-forced denial/);
  });

  it("201s for a signed-in caller and threads the real actor id into the evaluation.completed domain event", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/readiness/certificate",
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const cert = res.json().certificate;
    expect(cert.id).toBeDefined();

    const events = osStore.listDomainEvents();
    const certEvent = [...events]
      .reverse()
      .find(
        (e) =>
          e.type === "evaluation.completed" &&
          (e.payload as { kind?: string }).kind ===
            "production-readiness-certificate",
      );
    expect(certEvent).toBeDefined();
    expect((certEvent?.payload as { actorId?: string }).actorId).toBe(
      testUser().id,
    );
  });
});
