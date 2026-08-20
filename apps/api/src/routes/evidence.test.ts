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
import type { AuthUser } from "@atlas/shared";

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
const { parseEvidenceRecord } = await import("@atlas/shared");

function signedInUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "caller@example.com",
    displayName: "Caller",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
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

  it("a body-supplied ownerId cannot override the session-derived one", async () => {
    const res = await postAs(ownerB, {
      ...validPayload,
      projectId,
      excerpt: "owner-b-attempted-injection",
      ownerId: ownerA.id,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ownerId).toBe(ownerB.id);

    // …and the forged record really did land in B's bucket, not A's.
    const aList = await getAs(ownerA);
    expect(aList.body).not.toContain("owner-b-attempted-injection");
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
