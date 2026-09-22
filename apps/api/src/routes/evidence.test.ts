import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { authUserSchema, parseEvidenceRecord } from "@atlas/shared";

/** Tied to the value import so this is not a second, unrelated `AuthUser`. */
type AuthUser = ReturnType<typeof authUserSchema.parse>;

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as memory.test.ts / events.test.ts).
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-evidence-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

// evidence.ts (POST) resolves the record's ownerId via `resolveCloudIdentity`
// (not `getRequestUser` directly) — same pattern as memory.test.ts /
// billing.test.ts, and the reason a route test can assert which tenant a
// created record actually lands in.
const resolveCloudIdentity = vi.fn();
vi.mock("../services/cloud-identity.js", () => ({
  resolveCloudIdentity: (...args: unknown[]) => resolveCloudIdentity(...args),
}));

// Same stubbing mechanism as memory.test.ts / connections.test.ts: spread
// the real `@atlas/agent-core` module and only stub `authorizeEntityAction`
// so individual tests can force a DENIED decision.
const authorizeEntityActionMock = vi.fn();
vi.mock("@atlas/agent-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/agent-core")>();
  return {
    ...actual,
    authorizeEntityAction: (
      ...args: Parameters<typeof actual.authorizeEntityAction>
    ) => authorizeEntityActionMock(...args) ?? actual.authorizeEntityAction(...args),
  };
});

const { registerEvidenceRoutes } = await import("./evidence.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");

function signedInUser(
  partial: Pick<Partial<AuthUser>, "id" | "email" | "role"> = {},
): AuthUser {
  return authUserSchema.parse({
    id: "22222222-2222-4222-8222-222222222222",
    email: "caller@example.com",
    displayName: "Caller",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  });
}

const ownerA = signedInUser();
const ownerB = signedInUser({
  id: "33333333-3333-4333-8333-333333333333",
  email: "other@example.com",
});
const adminUser = signedInUser({
  id: "44444444-4444-4444-8444-444444444444",
  email: "admin@example.com",
  role: "admin",
});

/** Shape `resolveCloudIdentity` returns for a signed-in, offline/local caller. */
function cloudIdentityFor(user: AuthUser) {
  return {
    ownerId: user.id,
    userAccessToken: null,
    setCookie: null,
    source: "local_session" as const,
  };
}

/** The shared placeholder owner every record used to be stamped with. */
const LEGACY_STUB_OWNER_ID = "00000000-0000-4000-8000-000000000001";

const validPayload = {
  source: "unit-test",
  sourceType: "USER" as const,
  excerpt: "Something observed.",
  epistemicState: "OBSERVED" as const,
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerEvidenceRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Default: whoever the test signs in as, POST resolves that same caller as
  // the record's owner. Tenant-isolation tests below override per case.
  resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(ownerA));
});

afterEach(() => {
  authorizeEntityActionMock.mockReset();
});

describe("GET /api/v1/evidence auth", () => {
  it("401s when not signed in (security fix — this route was previously fully public)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/evidence" });
    expect(res.statusCode).toBe(401);
  });

  it("200s for any signed-in caller (backs the regular user's own PersonalDesk dashboard, not admin-only)", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({ method: "GET", url: "/api/v1/evidence" });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/v1/evidence auth", () => {
  it("401s when not signed in (security fix — anonymous evidence injection was previously possible)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("201s for a signed-in caller", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      payload: validPayload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().source).toBe("unit-test");
    expect(res.json().epistemicState).toBe("OBSERVED");
  });

  it("400s when epistemicState is omitted — does not default to FACT", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      payload: {
        source: "unit-test",
        sourceType: "USER",
        excerpt: "Something observed.",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/"epistemicState":"FACT"/);
  });

  it("403s when the Policy Engine denies DOCUMENT.CREATE (entity-policy gate wiring)", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      payload: validPayload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/test-forced denial/);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "DOCUMENT",
      "CREATE",
      expect.objectContaining({ mode: "WRITE" }),
    );
  });
});

/**
 * Cross-tenant isolation (P0). Before this fix `GET /api/v1/evidence`
 * returned every record from every tenant — `excerpt` included — to any
 * signed-in caller, because `requireUser`'s result was discarded and every
 * record was stamped with the same hard-coded placeholder owner, leaving
 * nothing to filter on. Both halves are asserted here: the write binds a
 * real owner, and the read is scoped to it.
 */
describe("evidence tenant isolation", () => {
  const projectId = "55555555-5555-4555-8555-555555555555";
  const secretExcerpt = "OWNER-A-CONFIDENTIAL-EXCERPT-9f3c";

  beforeEach(() => {
    const now = new Date().toISOString();
    osStore.ensureLoaded();
    osStore.upsertProject({
      id: projectId,
      slug: "evidence-iso-a",
      name: "Evidence Iso A",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    bindProjectOwner(projectId, ownerA.id, "bound_on_create");
  });

  async function postAs(user: AuthUser, payload: Record<string, unknown>) {
    getRequestUser.mockReturnValue(user);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(user));
    return app.inject({ method: "POST", url: "/api/v1/evidence", payload });
  }

  async function getAs(user: AuthUser) {
    getRequestUser.mockReturnValue(user);
    return app.inject({ method: "GET", url: "/api/v1/evidence" });
  }

  it("POST stamps the session-derived ownerId, not the old hard-coded placeholder", async () => {
    const res = await postAs(ownerA, {
      ...validPayload,
      projectId,
      excerpt: secretExcerpt,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ownerId).toBe(ownerA.id);
    expect(res.json().ownerId).not.toBe(LEGACY_STUB_OWNER_ID);
  });

  it("a body-supplied ownerId cannot override the session-derived one", async () => {
    const res = await postAs(ownerA, {
      ...validPayload,
      projectId,
      excerpt: "owner-a-cannot-forge-owner",
      ownerId: ownerB.id,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ownerId).toBe(ownerA.id);
    expect(res.json().ownerId).not.toBe(ownerB.id);
  });

  it("owner A's own GET still returns A's record (the feature must keep working)", async () => {
    const res = await getAs(ownerA);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(
      body.items.some(
        (item: { excerpt: string | null }) => item.excerpt === secretExcerpt,
      ),
    ).toBe(true);
    expect(
      body.items.every(
        (item: { ownerId: string }) => item.ownerId === ownerA.id,
      ),
    ).toBe(true);
  });

  it("owner B's GET returns none of owner A's records, and leaks no excerpt text", async () => {
    const res = await getAs(ownerB);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(
      body.items.some((item: { ownerId: string }) => item.ownerId === ownerA.id),
    ).toBe(false);
    // Not just absent from `items`: absent from the whole serialized
    // response, so neither `byCategory` nor any rollup re-exposes it.
    expect(res.body).not.toContain(secretExcerpt);
    // `total` and `byCategory` are computed from the scoped list, so B
    // cannot even infer how much foreign evidence exists.
    expect(body.total).toBe(body.items.length);
    expect(
      body.byCategory.flatMap(
        (bucket: { items: unknown[] }) => bucket.items,
      ),
    ).toHaveLength(body.items.length);
  });

  it("a foreign project owner cannot plant Evidence into another project's bucket", async () => {
    const res = await postAs(ownerB, {
      ...validPayload,
      projectId,
      excerpt: "owner-b-attempted-injection",
      ownerId: ownerA.id,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");

    expect(
      osStore
        .getEvidence(projectId)
        .some((row) => row.excerpt === "owner-b-attempted-injection"),
    ).toBe(false);

    const aList = await getAs(ownerA);
    expect(aList.body).not.toContain("owner-b-attempted-injection");
  });

  it("admin may write Evidence into another principal's project", async () => {
    const res = await postAs(adminUser, {
      ...validPayload,
      projectId,
      excerpt: "admin-authored-row",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ownerId).toBe(adminUser.id);
    expect(
      osStore
        .getEvidence(projectId)
        .some((row) => row.excerpt === "admin-authored-row"),
    ).toBe(true);
  });

  it("unknown projectId is 404, not a silent plant into a new bucket", async () => {
    const missing = "66666666-6666-4666-8666-666666666666";
    const res = await postAs(ownerA, {
      ...validPayload,
      projectId: missing,
      excerpt: "should-not-land",
    });
    expect(res.statusCode).toBe(404);
    expect(osStore.getEvidence(missing)).toHaveLength(0);
  });

  it("pre-existing records stamped with the legacy placeholder owner are invisible to a normal caller", async () => {
    // Documented decision (see `scopeEvidenceToCaller`): legacy/system rows
    // belong to no real account, so they match no caller and are dropped
    // rather than grandfathered into everyone's results.
    osStore.addEvidence(projectId, [
      parseEvidenceRecord({
        id: crypto.randomUUID(),
        ownerId: LEGACY_STUB_OWNER_ID,
        projectId,
        source: "legacy-system-feed",
        sourceType: "SYSTEM",
        sourceId: null,
        uri: null,
        excerpt: "LEGACY-STUB-OWNED-EXCERPT",
        version: null,
        observedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        confidence: 1,
        epistemicState: "FACT",
        metadata: {},
      }),
    ]);

    const res = await getAs(ownerA);
    expect(res.body).not.toContain("LEGACY-STUB-OWNED-EXCERPT");

    // Admins keep the same bypass every other read surface in this codebase
    // grants them, so the rows are not unreachable — just not everyone's.
    const adminRes = await getAs(adminUser);
    expect(adminRes.body).toContain("LEGACY-STUB-OWNED-EXCERPT");
  });

  it("GET is owner-scoped across the caller's projects, not a single projectId filter", async () => {
    const now = new Date().toISOString();
    const projectB = crypto.randomUUID();
    osStore.upsertProject({
      id: projectB,
      slug: `evidence-iso-b-${projectB.slice(0, 8)}`,
      name: "Evidence Iso B",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    bindProjectOwner(projectB, ownerA.id, "bound_on_create");
    const second = await postAs(ownerA, {
      ...validPayload,
      projectId: projectB,
      excerpt: "OWNER-A-SECOND-PROJECT",
    });
    expect(second.statusCode).toBe(201);

    const res = await getAs(ownerA);
    expect(res.statusCode).toBe(200);
    const excerpts = res
      .json()
      .items.map((item: { excerpt: string | null }) => item.excerpt);
    expect(excerpts).toContain(secretExcerpt);
    expect(excerpts).toContain("OWNER-A-SECOND-PROJECT");
    expect(
      res.json().items.every((item: { ownerId: string }) => item.ownerId === ownerA.id),
    ).toBe(true);
  });

  it("there is no by-id read surface: a foreign record's id 404s exactly like an unknown one", async () => {
    // The list is the only read path in this file, so a caller cannot fall
    // back to fetching a known-foreign id directly to confirm it exists.
    getRequestUser.mockReturnValue(ownerB);
    const known = await app.inject({
      method: "GET",
      url: `/api/v1/evidence/${crypto.randomUUID()}`,
    });
    const unknown = await app.inject({
      method: "GET",
      url: `/api/v1/evidence/${crypto.randomUUID()}`,
    });
    expect(known.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
  });
});
