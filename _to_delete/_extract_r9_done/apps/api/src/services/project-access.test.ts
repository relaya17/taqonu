import { describe, expect, it, beforeEach, vi } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AtlasError, type AuthUser } from "@atlas/shared";

const getRequestUser = vi.fn();
const getProject = vi.fn();
const getMeta = vi.fn();
const setMeta = vi.fn();
const ensureLoaded = vi.fn();

vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

vi.mock("../store/os-store.js", () => ({
  osStore: {
    ensureLoaded: () => ensureLoaded(),
    getProject: (id: string) => getProject(id),
    getMeta: (key: string) => getMeta(key),
    setMeta: (key: string, value: string) => setMeta(key, value),
  },
}));

const {
  assertProjectWriteAccess,
  bindProjectOwner,
  getProjectOwnerId,
  isolationAuditSummary,
} = await import("./project-access.js");

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

describe("project-access", () => {
  const app = {} as FastifyInstance;
  const request = {} as FastifyRequest;
  let meta: Record<string, string>;

  beforeEach(() => {
    meta = {};
    getRequestUser.mockReset();
    getProject.mockReset();
    getMeta.mockImplementation((key: string) => meta[key]);
    setMeta.mockImplementation((key: string, value: string) => {
      meta[key] = value;
    });
    getProject.mockReturnValue({
      id: "22222222-2222-4222-8222-222222222222",
      slug: "demo",
      name: "Demo",
    });
  });

  it("claims unowned project for signed-in user", async () => {
    const u = user();
    getRequestUser.mockReturnValue(u);
    const out = await assertProjectWriteAccess(
      app,
      request,
      "22222222-2222-4222-8222-222222222222",
    );
    expect(out.id).toBe(u.id);
    expect(getProjectOwnerId("22222222-2222-4222-8222-222222222222")).toBe(
      u.id,
    );
    expect(isolationAuditSummary().claimed).toBeGreaterThan(0);
  });

  it("denies mismatched owner and audits", async () => {
    bindProjectOwner(
      "22222222-2222-4222-8222-222222222222",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bound_on_create",
    );
    getRequestUser.mockReturnValue(user());
    try {
      await assertProjectWriteAccess(
        app,
        request,
        "22222222-2222-4222-8222-222222222222",
      );
      expect.fail("expected FORBIDDEN");
    } catch (e) {
      expect(e).toBeInstanceOf(AtlasError);
      expect((e as AtlasError).code).toBe("FORBIDDEN");
      expect(isolationAuditSummary().denied).toBeGreaterThan(0);
    }
  });

  it("allows admin across owners", async () => {
    bindProjectOwner(
      "22222222-2222-4222-8222-222222222222",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bound_on_create",
    );
    const admin = user({ role: "admin" });
    getRequestUser.mockReturnValue(admin);
    expect(
      (
        await assertProjectWriteAccess(
          app,
          request,
          "22222222-2222-4222-8222-222222222222",
        )
      ).role,
    ).toBe("admin");
  });
});
