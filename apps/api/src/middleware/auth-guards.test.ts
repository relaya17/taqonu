import { describe, expect, it, vi, beforeEach } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AtlasError, type AuthUser } from "@atlas/shared";

const getRequestUser = vi.fn();

vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

const {
  requireUser,
  requireAdmin,
  requireOperator,
  requireOwner,
  requireSignedInForWrite,
} = await import("./auth-guards.js");

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

describe("auth-guards", () => {
  const app = {} as FastifyInstance;
  const request = {} as FastifyRequest;

  beforeEach(() => {
    getRequestUser.mockReset();
  });

  it("requireUser throws 401 when anonymous", async () => {
    getRequestUser.mockReturnValue(null);
    try {
      await requireUser(app, request);
      expect.fail("expected UNAUTHORIZED");
    } catch (e) {
      expect(e).toBeInstanceOf(AtlasError);
      expect((e as AtlasError).code).toBe("UNAUTHORIZED");
      expect((e as AtlasError).statusCode).toBe(401);
    }
  });

  it("requireUser returns the session user", async () => {
    const u = user();
    getRequestUser.mockReturnValue(u);
    expect(await requireUser(app, request)).toEqual(u);
  });

  it("requireSignedInForWrite mirrors requireUser (WRITE gate)", async () => {
    getRequestUser.mockReturnValue(null);
    await expect(requireSignedInForWrite(app, request)).rejects.toThrow(/Not signed in/);

    const u = user({ role: "admin" });
    getRequestUser.mockReturnValue(u);
    expect(await requireSignedInForWrite(app, request)).toEqual(u);
  });

  it("requireAdmin throws 403 for non-admin users", async () => {
    getRequestUser.mockReturnValue(user({ role: "user" }));
    try {
      await requireAdmin(app, request);
      expect.fail("expected FORBIDDEN");
    } catch (e) {
      expect(e).toBeInstanceOf(AtlasError);
      expect((e as AtlasError).code).toBe("FORBIDDEN");
      expect((e as AtlasError).statusCode).toBe(403);
    }
  });

  it("requireAdmin allows admin role", async () => {
    const admin = user({ role: "admin" });
    getRequestUser.mockReturnValue(admin);
    expect(await requireAdmin(app, request)).toEqual(admin);
  });

  it("requireOperator rejects customer admin and allows owner", async () => {
    getRequestUser.mockReturnValue(user({ role: "admin" }));
    await expect(requireOperator(app, request)).rejects.toThrow(/operator or owner/);
    const owner = user({ role: "owner" });
    getRequestUser.mockReturnValue(owner);
    expect(await requireOperator(app, request)).toEqual(owner);
  });

  it("requireOwner rejects operator and allows owner", async () => {
    getRequestUser.mockReturnValue(user({ role: "operator" }));
    await expect(requireOwner(app, request)).rejects.toThrow(/owner role required/);
    const owner = user({ role: "owner" });
    getRequestUser.mockReturnValue(owner);
    expect(await requireOwner(app, request)).toEqual(owner);
  });
});
