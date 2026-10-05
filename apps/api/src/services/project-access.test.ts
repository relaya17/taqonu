import { describe, expect, it, beforeEach, vi } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AtlasError, type AuthUser } from "@atlas/shared";

const getRequestUser = vi.fn();
const getProject = vi.fn();
const getMeta = vi.fn();
const setMeta = vi.fn();
const ensureLoaded = vi.fn();
const getLoadSource = vi.fn();

vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

vi.mock("../store/os-store.js", () => ({
  osStore: {
    ensureLoaded: () => ensureLoaded(),
    getLoadSource: () => getLoadSource(),
    getProject: (id: string) => getProject(id),
    getMeta: (key: string) => getMeta(key),
    setMeta: (key: string, value: string) => setMeta(key, value),
    getKillSwitchOverrides: () => ({}),
  },
}));

const {
  assertProjectOwnerOrClaim,
  assertProjectWriteAccess,
  bindProjectOwner,
  getProjectOwnerId,
  isolationAuditSummary,
  lookupProjectOwner,
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

  it("claims an unowned project and denies a foreign owner", () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const owner = user();
    assertProjectOwnerOrClaim(projectId, owner.id);
    expect(getProjectOwnerId(projectId)).toBe(owner.id);
    expect(() =>
      assertProjectOwnerOrClaim(projectId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    ).toThrow(/not owned by this user/);
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

describe("lookupProjectOwner (strict, non-mutating ownership provenance)", () => {
  const PROJECT = "22222222-2222-4222-8222-222222222222";
  const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let meta: Record<string, string>;

  beforeEach(() => {
    meta = {};
    getLoadSource.mockReset();
    getLoadSource.mockReturnValue("PRIMARY");
    setMeta.mockReset();
    getMeta.mockImplementation((key: string) => meta[key]);
    setMeta.mockImplementation((key: string, value: string) => {
      meta[key] = value;
    });
  });

  const setOwners = (value: string) => {
    meta["g5.projectOwners.v1"] = value;
  };

  it("VERIFIED: a usable owner record from authorization-grade state", () => {
    setOwners(JSON.stringify({ [PROJECT]: OWNER }));
    expect(lookupProjectOwner(PROJECT)).toEqual({ state: "VERIFIED", ownerId: OWNER });
  });

  it("ABSENT: no ownership metadata at all", () => {
    expect(lookupProjectOwner(PROJECT)).toEqual({ state: "ABSENT", ownerId: null });
  });

  it("ABSENT: metadata exists but has no record for this project", () => {
    setOwners(JSON.stringify({ "some-other-project": OWNER }));
    expect(lookupProjectOwner(PROJECT)).toEqual({ state: "ABSENT", ownerId: null });
  });

  it("ABSENT is also reported when the store was freshly initialised with no file", () => {
    getLoadSource.mockReturnValue("ABSENT");
    expect(lookupProjectOwner(PROJECT).state).toBe("ABSENT");
    setOwners(JSON.stringify({ [PROJECT]: OWNER }));
    expect(lookupProjectOwner(PROJECT).state).toBe("VERIFIED");
  });

  it.each([
    ["unparseable JSON", "{not-json"],
    ["an empty string", ""],
    ["a JSON array", "[]"],
    ["JSON null", "null"],
    ["a JSON string", '"x"'],
  ])("MALFORMED: ownership metadata that is %s", (_label, value) => {
    setOwners(value);
    expect(lookupProjectOwner(PROJECT)).toEqual({ state: "MALFORMED", ownerId: null });
  });

  it.each([
    ["a non-string owner", { [PROJECT]: 42 }],
    ["an empty owner", { [PROJECT]: "" }],
    ["a null owner", { [PROJECT]: null }],
  ])("MALFORMED: a record for the project that holds %s", (_label, value) => {
    setOwners(JSON.stringify(value));
    expect(lookupProjectOwner(PROJECT)).toEqual({ state: "MALFORMED", ownerId: null });
  });

  it("RECOVERED_FROM_BACKUP: evidence only, the owner id is withheld even when a record exists", () => {
    getLoadSource.mockReturnValue("BACKUP");
    setOwners(JSON.stringify({ [PROJECT]: OWNER }));
    expect(lookupProjectOwner(PROJECT)).toEqual({ state: "RECOVERED_FROM_BACKUP", ownerId: null });
  });

  it("MALFORMED / UNAVAILABLE persisted state is reported even if in-memory metadata names an owner", () => {
    setOwners(JSON.stringify({ [PROJECT]: OWNER }));
    getLoadSource.mockReturnValue("MALFORMED");
    expect(lookupProjectOwner(PROJECT).state).toBe("MALFORMED");
    getLoadSource.mockReturnValue("UNAVAILABLE");
    expect(lookupProjectOwner(PROJECT).state).toBe("UNAVAILABLE");
  });

  it("UNAVAILABLE: a load source that was never established", () => {
    getLoadSource.mockReturnValue(null);
    setOwners(JSON.stringify({ [PROJECT]: OWNER }));
    expect(lookupProjectOwner(PROJECT)).toEqual({ state: "UNAVAILABLE", ownerId: null });
  });

  it("never mutates or claims, for any state", () => {
    for (const source of ["PRIMARY", "ABSENT", "BACKUP", "MALFORMED", "UNAVAILABLE", null]) {
      getLoadSource.mockReturnValue(source);
      lookupProjectOwner(PROJECT);
    }
    expect(setMeta).not.toHaveBeenCalled();
    expect(meta).toEqual({});
  });

  it("does not change the existing nullable helper: malformed metadata still reads as no owner", () => {
    setOwners("{not-json");
    expect(getProjectOwnerId(PROJECT)).toBeNull();
  });
});
