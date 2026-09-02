import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerPlatformSupervisionRoutes } = await import(
  "./platform-supervision.js"
);
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

let app: FastifyInstance;

function user(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "owner@example.com",
    displayName: "Owner",
    role: "owner",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    emailVerified: true,
    disabled: false,
    hasPassword: true,
    mfaEnabled: false,
    ...partial,
  };
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerPlatformSupervisionRoutes);
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/v1/platform/studio-supervision", () => {
  it("rejects an unauthenticated caller", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/platform/studio-supervision",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects customer admin — tenant admin is not Atlas Admin", async () => {
    getRequestUser.mockReturnValue(user({ role: "admin" }));
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/platform/studio-supervision",
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns a Studio snapshot for owner", async () => {
    getRequestUser.mockReturnValue(user({ role: "owner" }));
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/platform/studio-supervision",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      surface: string;
      parentSurface: string;
      role: string;
      runtime: string;
      metrics: { projects: number; linkedWorkspaces: number };
    };
    expect(body.surface).toBe("STUDIO");
    expect(body.parentSurface).toBe("ADMIN");
    expect(body.role).toBe("developer_workspace");
    expect(body.runtime).toBe("apps/web");
    expect(typeof body.metrics.projects).toBe("number");
    expect(typeof body.metrics.linkedWorkspaces).toBe("number");
  });
});
