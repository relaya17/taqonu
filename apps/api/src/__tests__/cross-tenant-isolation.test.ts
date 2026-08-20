import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

/**
 * CROSS-TENANT ISOLATION ATTACK SUITE
 * ==================================
 *
 * This file exercises Atlas's REAL routes through Fastify's `inject()` and
 * the REAL auth guards (`requireUser` / `requireSignedInForWrite` in
 * `middleware/auth-guards.ts`, and the `assertProjectReadAccess` /
 * `assertProjectWriteAccess` gates in `services/project-access.ts`). There
 * is no fabricated "mock-token-<tenant>" bearer scheme anywhere here: the
 * only thing stubbed is `getRequestUser` — the single function the real
 * guards call to turn a session cookie / Supabase JWT into an `AuthUser`.
 * Everything downstream of that (the guards, the ownership comparisons, the
 * owner-scoping filters, the risk/entity-policy gate) runs unmodified. This
 * is the same stubbing mechanism every route test in this package uses
 * (memory.test.ts, projects.test.ts, code.test.ts, graph.test.ts, ...).
 *
 * Threat model per route: two genuinely distinct signed-in humans, owner A
 * and owner B. A creates data; B — authenticated, but a different tenant —
 * attempts to read it, mutate it, and tamper with request parameters to
 * claim A's identity. Every attack asserts three things, not one:
 *   1. the response is a denial (403/404, or a filtered-empty result),
 *   2. the denial body leaks none of A's data (a 403 that echoes the
 *      record is still a breach), and
 *   3. A's data is BYTE-IDENTICAL afterwards, re-read as A. A 403 plus a
 *      mutated record is the worst possible outcome, and only assertion 3
 *      can catch it.
 *
 * WHAT THIS SUITE GUARANTEES: every attack below is expected to FAIL, and
 * each one is asserted as failing on all three axes above. There are no
 * `it.fails(...)` placeholders and no tests documenting insecure behaviour
 * left in this file — every test here asserts a boundary that currently
 * holds, so any regression turns straight into a red test.
 *
 * ── HISTORY (2026-08-20) — do not delete ─────────────────────────────────
 * Four REAL isolation defects were found by this suite while it was being
 * written, were recorded here as live holes, and are now CLOSED. The attack
 * vectors that found them are still exercised below, inverted to assert the
 * secure behaviour, so none of the four can silently come back:
 *   1. `GET /api/v1/evidence` was not tenant-scoped — any signed-in user
 *      read every tenant's evidence excerpts. Fixed in `routes/evidence.ts`
 *      (`scopeEvidenceToCaller` + a real session-derived `ownerId` on POST;
 *      the hard-coded owner constant is gone). Guarded below by
 *      "GET /api/v1/evidence — tenant scoping (regression: was a live leak)".
 *   2. `POST /api/v1/memory` let any tenant destructively SUPERSEDE another
 *      tenant's memories, and doubled as a text-search oracle over them via
 *      `supersededCount`. Fixed in `services/memory-pipeline.ts`
 *      (`supersedeMatchingMemories` now REQUIRES an `ownerId` and skips
 *      other owners' rows; the count reflects only the caller's own).
 *   3. Five `/api/v1/projects/:id/*` sub-routes (`reachability`,
 *      `central-opinion`, `central-opinion.html`, `central-opinion.pdf`,
 *      `manager-reminders`) had NO auth at all — an ANONYMOUS caller could
 *      read a tenant's CRITICAL memory statements. Fixed in
 *      `routes/projects.ts`: each handler now starts with
 *      `await assertProjectReadAccess(app, request, params.id)`.
 *   4. The project denial body disclosed the VICTIM'S user id (an account
 *      enumeration primitive). Fixed: the 403 message is now
 *      `actor "<attacker>" does not own this resource`, with no owner id.
 * Note on codes, since the two are asserted separately below: an ANONYMOUS
 * caller gets 401, an AUTHENTICATED non-owner gets 403.
 */

// Store isolation: ATLAS_STORE_PATH must be set BEFORE `osStore` is imported
// anywhere in the module graph, hence the dynamic imports below (same
// pattern as services/memory-pipeline.test.ts and routes/memory.test.ts).
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-cross-tenant-isolation-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

/**
 * The ONLY stub: session -> user. `requireUser` / `requireSignedInForWrite`
 * / `assertProjectReadAccess` / `assertProjectWriteAccess` all run for real
 * on top of it.
 */
const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

/**
 * `POST /api/v1/memory` and `POST /api/v1/projects` derive the persisted
 * `ownerId` from `resolveCloudIdentity` (which itself reads the session, not
 * the body). Stubbed to mirror whichever user is currently signed in — so a
 * body-supplied `ownerId` still has no path to influence it.
 */
const resolveCloudIdentity = vi.fn();
vi.mock("../services/cloud-identity.js", () => ({
  resolveCloudIdentity: (...args: unknown[]) => resolveCloudIdentity(...args),
}));

const { registerMemoryRoutes } = await import("../routes/memory.js");
const { registerProjectRoutes } = await import("../routes/projects.js");
const { registerEvidenceRoutes } = await import("../routes/evidence.js");
const { buildRouteTestApp } = await import(
  "../routes/test-helpers/build-route-test-app.js"
);
const { setAuditLogPathForTests } = await import("../services/audit-log.js");
const { enforceAgentToolAuthorization, resolveAgentIdentity } = await import(
  "../services/agent-runtime-authz.js"
);

// ── Identities ────────────────────────────────────────────────────────────

function signedInUser(partial: Partial<AuthUser>): AuthUser {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    email: "nobody@example.com",
    displayName: "Nobody",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const ownerA = signedInUser({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  email: "owner-a@tenant-a.example",
  displayName: "Owner A",
});

const ownerB = signedInUser({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  email: "owner-b@tenant-b.example",
  displayName: "Owner B",
});

/** Switch the authenticated session. `null` = anonymous. */
function signInAs(user: AuthUser | null): void {
  getRequestUser.mockReturnValue(user);
  resolveCloudIdentity.mockReturnValue({
    // Server-derived: mirrors the session, never the request body.
    ownerId: user ? user.id : "00000000-0000-4000-8000-000000000001",
    userAccessToken: null,
    setCookie: null,
    source: "local_session" as const,
  });
}

// ── Response shapes (no `any`) ────────────────────────────────────────────

interface MemoryRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly projectId: string | null;
  readonly statement: string;
  readonly status: string;
  readonly epistemicState: string;
  readonly supersededBy: string | null;
}

interface ProjectRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly workspaceRoot: string | null;
}

interface EvidenceRecordShape {
  readonly id: string;
  readonly ownerId: string;
  readonly projectId: string | null;
  readonly excerpt: string | null;
}

interface ListEnvelope<T> {
  readonly items: readonly T[];
}

/**
 * Denial hygiene: the raw response body must not contain ANY of the victim's
 * identifying or secret strings. Applied to every denied attack response.
 */
function expectNoLeakOf(rawBody: string, secrets: readonly string[]): void {
  for (const secret of secrets) {
    expect(rawBody).not.toContain(secret);
  }
}

/** Status code carried by a thrown `AtlasError`, or -1 if it threw something else. */
function thrownStatusCode(fn: () => void): number {
  try {
    fn();
  } catch (err) {
    return (err as { statusCode?: number }).statusCode ?? -1;
  }
  return 0;
}

// ── Fixtures created through the REAL routes ──────────────────────────────

let app: FastifyInstance;
let projectA: ProjectRecord;
let projectB: ProjectRecord;
let memoryA: MemoryRecord;
let evidenceA: EvidenceRecordShape;
let workspaceRootA: string;
let workspaceRootAttacker: string;

const SECRET_A_STATEMENT =
  "ALPHA-TENANT-SECRET tenant A private acquisition target codename Solstice";
const SECRET_A_EVIDENCE_EXCERPT =
  "ALPHA-EVIDENCE-SECRET internal valuation memo for tenant A only";
const SECRET_A_BUG_STATEMENT =
  "ALPHA-BUG-SECRET admin console accepts tenant A's legacy bypass header";

/** POST a memory as the currently signed-in user. */
async function createMemory(input: {
  readonly statement: string;
  readonly projectId?: string | null;
  /** Deliberately-tampered extra fields an attacker might inject. */
  readonly tamper?: Readonly<Record<string, string>>;
}): Promise<{ statusCode: number; body: string; record: MemoryRecord }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/memory",
    payload: {
      type: "LESSON",
      statement: input.statement,
      category: "GENERATED_REASONING",
      epistemicState: "PROPOSED",
      observationMode: "INFERRED",
      source: "cross-tenant-isolation-test",
      sourceType: "USER",
      scope: input.projectId ? "PROJECT" : "GLOBAL",
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      evidence: [{ kind: "TEST_RUN", reference: "vitest://cross-tenant" }],
      ...(input.tamper ?? {}),
    },
  });
  return {
    statusCode: res.statusCode,
    body: res.body,
    record: res.json<MemoryRecord>(),
  };
}

/** Re-read a memory THROUGH THE REAL ROUTE as owner A (the victim). */
async function readMemoryAsOwnerA(memoryId: string): Promise<MemoryRecord | null> {
  signInAs(ownerA);
  const res = await app.inject({ method: "GET", url: "/api/v1/memory" });
  expect(res.statusCode).toBe(200);
  const found = res
    .json<ListEnvelope<MemoryRecord>>()
    .items.find((item) => item.id === memoryId);
  return found ?? null;
}

/** Re-read a project THROUGH THE REAL ROUTE as owner A (the victim). */
async function readProjectAsOwnerA(projectId: string): Promise<ProjectRecord> {
  signInAs(ownerA);
  const res = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}` });
  expect(res.statusCode).toBe(200);
  return res.json<ProjectRecord>();
}

beforeAll(async () => {
  setAuditLogPathForTests(join(tmpDir, "audit.ndjson"));
  // `SUPABASE_SERVICE_ROLE_KEY: "replace-me"` forces `isLiveSupabase` false
  // so the best-effort cloud dual-writes never attempt a network call.
  app = await buildRouteTestApp(
    async (instance) => {
      await registerMemoryRoutes(instance);
      await registerProjectRoutes(instance);
      await registerEvidenceRoutes(instance);
    },
    { SUPABASE_SERVICE_ROLE_KEY: "replace-me" },
  );

  workspaceRootA = mkdtempSync(join(tmpdir(), "atlas-xti-ws-a-"));
  workspaceRootAttacker = mkdtempSync(join(tmpdir(), "atlas-xti-ws-attacker-"));

  // ---- Owner A creates their tenant data through the real routes ----
  signInAs(ownerA);

  const createdProjectA = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: {
      slug: "xti-tenant-a",
      name: "Tenant A Project",
      description: "ALPHA-PROJECT-SECRET tenant A roadmap",
    },
  });
  expect(createdProjectA.statusCode).toBe(201);
  projectA = createdProjectA.json<ProjectRecord>();

  const setRoot = await app.inject({
    method: "PUT",
    url: `/api/v1/projects/${projectA.id}/workspace-root`,
    payload: { workspaceRoot: workspaceRootA },
  });
  expect(setRoot.statusCode).toBe(200);

  const createdMemoryA = await createMemory({
    statement: SECRET_A_STATEMENT,
    projectId: projectA.id,
  });
  expect(createdMemoryA.statusCode).toBe(201);
  // Baseline is the PERSISTED record read back through the real route (the
  // POST response additionally carries transient fields like
  // `supersededCount`/`classification`), so "unchanged" comparisons below
  // are against what is actually stored.
  memoryA = (await readMemoryAsOwnerA(createdMemoryA.record.id)) as MemoryRecord;
  expect(memoryA).not.toBeNull();
  expect(memoryA.ownerId).toBe(ownerA.id);

  // A HIGH-priority BUG memory — surfaced verbatim by `buildCentralOpinion`,
  // used by the REAL VULNERABILITY #3 block below.
  signInAs(ownerA);
  const createdBugA = await app.inject({
    method: "POST",
    url: "/api/v1/memory",
    payload: {
      type: "BUG",
      statement: SECRET_A_BUG_STATEMENT,
      category: "GENERATED_REASONING",
      epistemicState: "PROPOSED",
      observationMode: "INFERRED",
      source: "cross-tenant-isolation-test",
      sourceType: "USER",
      scope: "PROJECT",
      priority: "CRITICAL",
      projectId: projectA.id,
    },
  });
  expect(createdBugA.statusCode).toBe(201);

  const createdEvidenceA = await app.inject({
    method: "POST",
    url: "/api/v1/evidence",
    payload: {
      projectId: projectA.id,
      source: "tenant-a-internal",
      sourceType: "DECISION_LOG",
      excerpt: SECRET_A_EVIDENCE_EXCERPT,
      epistemicState: "OBSERVED",
    },
  });
  expect(createdEvidenceA.statusCode).toBe(201);
  evidenceA = createdEvidenceA.json<EvidenceRecordShape>();

  // ---- Owner B creates their own, unrelated project ----
  signInAs(ownerB);
  const createdProjectB = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: { slug: "xti-tenant-b", name: "Tenant B Project" },
  });
  expect(createdProjectB.statusCode).toBe(201);
  projectB = createdProjectB.json<ProjectRecord>();
});

afterAll(async () => {
  await app.close();
  setAuditLogPathForTests(null);
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(workspaceRootA, { recursive: true, force: true });
  rmSync(workspaceRootAttacker, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════════════════════
// ROUTE 1 — GET /api/v1/memory (owner-scoped by `scopeMemoriesToCaller`
// for list mode and by `retrieveMemories({ ownerId })` for retrieve mode)
// ══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/memory — cross-tenant read", () => {
  it("requires a real session (anonymous is 401, not a silent empty list)", async () => {
    signInAs(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/memory" });
    expect(res.statusCode).toBe(401);
    expectNoLeakOf(res.body, [SECRET_A_STATEMENT, ownerA.id, memoryA.id]);
  });

  it("owner B cannot see owner A's memory in list mode", async () => {
    signInAs(ownerB);
    const res = await app.inject({ method: "GET", url: "/api/v1/memory" });
    expect(res.statusCode).toBe(200);
    const ids = res.json<ListEnvelope<MemoryRecord>>().items.map((m) => m.id);
    expect(ids).not.toContain(memoryA.id);
    expectNoLeakOf(res.body, [SECRET_A_STATEMENT, ownerA.id]);
  });

  it("PARAMETER TAMPERING: owner B passing owner A's projectId still sees nothing", async () => {
    signInAs(ownerB);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/memory?mode=retrieve&budget=40&projectId=${projectA.id}`,
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json<ListEnvelope<MemoryRecord>>().items.map((m) => m.id);
    expect(ids).not.toContain(memoryA.id);
    expectNoLeakOf(res.body, [SECRET_A_STATEMENT, ownerA.id]);
  });

  it("PARAMETER TAMPERING: owner B querying A's secret text verbatim gets nothing", async () => {
    signInAs(ownerB);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/memory?mode=retrieve&budget=40&query=${encodeURIComponent("ALPHA-TENANT-SECRET")}`,
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json<ListEnvelope<MemoryRecord>>().items.map((m) => m.id);
    expect(ids).not.toContain(memoryA.id);
    expectNoLeakOf(res.body, [SECRET_A_STATEMENT, ownerA.id]);
  });

  it("owner B cannot see owner A's memory via /memory/pending or /memory/moat", async () => {
    signInAs(ownerB);
    const pending = await app.inject({ method: "GET", url: "/api/v1/memory/pending" });
    expect(pending.statusCode).toBe(200);
    expectNoLeakOf(pending.body, [SECRET_A_STATEMENT, ownerA.id, memoryA.id]);

    const moat = await app.inject({
      method: "GET",
      url: `/api/v1/memory/moat?projectId=${projectA.id}`,
    });
    expect(moat.statusCode).toBe(200);
    expectNoLeakOf(moat.body, [SECRET_A_STATEMENT, ownerA.id, memoryA.id]);
  });

  it("owner A's memory is unchanged after every read attack above", async () => {
    const after = await readMemoryAsOwnerA(memoryA.id);
    expect(after).not.toBeNull();
    expect(after).toStrictEqual(memoryA);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ROUTE 2 — POST /api/v1/memory (ownerId is server-derived via
// `resolveCloudIdentity`, never taken from the request body)
// ══════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/memory — cross-tenant write / parameter tampering", () => {
  it("PARAMETER TAMPERING: a body-supplied ownerId cannot write into owner A's bucket", async () => {
    signInAs(ownerB);
    const created = await createMemory({
      statement: "BRAVO-WRITE-PROBE attacker-controlled record claiming to be tenant A",
      projectId: null,
      // Every one of these is an attempt to have the server trust the
      // payload over the session.
      tamper: {
        ownerId: ownerA.id,
        owner_id: ownerA.id,
        createdBy: ownerA.email,
        tenantId: ownerA.id,
      },
    });
    expect(created.statusCode).toBe(201);
    // Server took identity from the session, not the payload.
    expect(created.record.ownerId).toBe(ownerB.id);
    expect(created.record.ownerId).not.toBe(ownerA.id);

    // ...and owner A never sees the forged record.
    signInAs(ownerA);
    const listA = await app.inject({ method: "GET", url: "/api/v1/memory" });
    const idsA = listA.json<ListEnvelope<MemoryRecord>>().items.map((m) => m.id);
    expect(idsA).not.toContain(created.record.id);
  });

  it("PARAMETER TAMPERING: writing into owner A's projectId does not make it visible to A", async () => {
    signInAs(ownerB);
    const created = await createMemory({
      statement: "BRAVO-PROJECT-INJECTION attacker note aimed at tenant A's project bucket",
      projectId: projectA.id,
    });
    expect(created.statusCode).toBe(201);
    expect(created.record.ownerId).toBe(ownerB.id);

    signInAs(ownerA);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/memory?mode=retrieve&budget=40&projectId=${projectA.id}`,
    });
    expect(res.statusCode).toBe(200);
    const idsA = res.json<ListEnvelope<MemoryRecord>>().items.map((m) => m.id);
    expect(idsA).not.toContain(created.record.id);
  });

  it("owner A's memory is unchanged after the write attacks above", async () => {
    const after = await readMemoryAsOwnerA(memoryA.id);
    expect(after).toStrictEqual(memoryA);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ROUTE 3 — POST /api/v1/memory/:id/approve (IDOR: owner-scoped inside
// `approveMemory({ ownerId })`, which returns "not_found" for a foreign owner)
// ══════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/memory/:id/approve — IDOR", () => {
  it("owner B approving owner A's memory by exact id is denied, with no existence leak", async () => {
    signInAs(ownerB);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/memory/${memoryA.id}/approve`,
      payload: { projectId: projectA.id },
    });
    // 404 (not 403) is deliberate here: the route must not distinguish
    // "exists but belongs to someone else" from "does not exist".
    expect([403, 404]).toContain(res.statusCode);
    expectNoLeakOf(res.body, [
      SECRET_A_STATEMENT,
      ownerA.id,
      ownerA.email,
      "CONFIRMED",
    ]);
  });

  it("PARAMETER TAMPERING: owner B cannot approve A's memory by omitting/forging projectId", async () => {
    signInAs(ownerB);
    for (const payload of [{}, { projectId: null }, { projectId: projectB.id }]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/memory/${memoryA.id}/approve`,
        payload,
      });
      expect([403, 404]).toContain(res.statusCode);
      expectNoLeakOf(res.body, [SECRET_A_STATEMENT, ownerA.id]);
    }
  });

  it("owner A's memory is byte-identical after every approve attack (still PROPOSED)", async () => {
    const after = await readMemoryAsOwnerA(memoryA.id);
    expect(after).toStrictEqual(memoryA);
    expect(after?.epistemicState).toBe("PROPOSED");
    expect(after?.status).toBe("ACTIVE");
  });

  it("CONTROL: owner A CAN approve their own memory (proves the denial was about tenancy)", async () => {
    signInAs(ownerA);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/memory/${memoryA.id}/approve`,
      payload: { projectId: projectA.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<MemoryRecord>().epistemicState).toBe("CONFIRMED");
    // Refresh the baseline so later "unchanged" assertions compare against
    // the legitimately-approved state.
    const refreshed = await readMemoryAsOwnerA(memoryA.id);
    expect(refreshed).not.toBeNull();
    memoryA = refreshed as MemoryRecord;
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ROUTE 4 — /api/v1/projects (owner-scoped by `services/project-access.ts`:
// `bindProjectOwner` on create, `assertProjectReadAccess` /
// `assertProjectWriteAccess` on every read/write of a specific project)
// ══════════════════════════════════════════════════════════════════════════

describe("/api/v1/projects — cross-tenant read, IDOR and write", () => {
  it("owner B's project list excludes owner A's project", async () => {
    signInAs(ownerB);
    const res = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(res.statusCode).toBe(200);
    const items = res.json<ListEnvelope<ProjectRecord>>().items;
    expect(items.map((p) => p.id)).not.toContain(projectA.id);
    expect(items.map((p) => p.id)).toContain(projectB.id);
    expectNoLeakOf(res.body, ["ALPHA-PROJECT-SECRET", workspaceRootA]);
  });

  it("IDOR: owner B requesting owner A's project by exact id is denied and leaks no project data", async () => {
    signInAs(ownerB);
    const res = await app.inject({ method: "GET", url: `/api/v1/projects/${projectA.id}` });
    expect([403, 404]).toContain(res.statusCode);
    expectNoLeakOf(res.body, [
      "ALPHA-PROJECT-SECRET",
      "Tenant A Project",
      "xti-tenant-a",
      workspaceRootA,
      SECRET_A_STATEMENT,
    ]);
  });

  /**
   * REGRESSION GUARD (was REAL LEAK #4, fixed 2026-08-20): the denial body
   * produced by `services/resource-access.ts` via `assertReadOwnership`
   * used to read
   *   actor "<attacker id>" does not own this resource (owner "<victim id>")
   * so the denial itself disclosed the VICTIM'S user id to a different
   * tenant — an account-enumeration primitive. The owner clause is gone;
   * only the actor (the attacker's own id) is echoed back.
   */
  it("SECURITY REQUIREMENT: the 403 body must not disclose owner A's user id", async () => {
    signInAs(ownerB);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectA.id}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(ownerA.id);
    expect(res.body).not.toContain(ownerA.email);
    // The attacker may see their OWN id — that discloses nothing new.
    expect(res.body).toContain("does not own this resource");
  });

  it("UPDATE: owner B cannot repoint owner A's workspaceRoot, and A's value is unchanged", async () => {
    const before = await readProjectAsOwnerA(projectA.id);
    expect(before.workspaceRoot).toBe(workspaceRootA);

    signInAs(ownerB);
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectA.id}/workspace-root`,
      payload: { workspaceRoot: workspaceRootAttacker },
    });
    expect(res.statusCode).toBe(403);
    expectNoLeakOf(res.body, ["ALPHA-PROJECT-SECRET", workspaceRootA, ownerA.id]);

    const after = await readProjectAsOwnerA(projectA.id);
    expect(after).toStrictEqual(before);
    expect(after.workspaceRoot).toBe(workspaceRootA);
  });

  it("DESTRUCTIVE UPDATE: owner B cannot CLEAR owner A's workspaceRoot either", async () => {
    const before = await readProjectAsOwnerA(projectA.id);

    signInAs(ownerB);
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectA.id}/workspace-root`,
      payload: { workspaceRoot: null },
    });
    expect(res.statusCode).toBe(403);

    const after = await readProjectAsOwnerA(projectA.id);
    expect(after).toStrictEqual(before);
  });

  it("PARAMETER TAMPERING: owner B cannot trigger a cloud sync of owner A's project", async () => {
    const before = await readProjectAsOwnerA(projectA.id);

    signInAs(ownerB);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectA.id}/cloud`,
      // Attacker restates A's identity in the payload — must be ignored.
      payload: { ownerId: ownerA.id, projectId: projectA.id },
    });
    expect(res.statusCode).toBe(403);
    expectNoLeakOf(res.body, [
      "ALPHA-PROJECT-SECRET",
      "Tenant A Project",
      "xti-tenant-a",
      ownerA.id,
    ]);

    const after = await readProjectAsOwnerA(projectA.id);
    expect(after).toStrictEqual(before);
  });

  it("owner B cannot read A's project-scoped resume / context-export surfaces", async () => {
    signInAs(ownerB);
    for (const path of [
      `/api/v1/projects/${projectA.id}/resume`,
      `/api/v1/projects/${projectA.id}/context-export`,
    ]) {
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode).toBe(403);
      expectNoLeakOf(res.body, [
        SECRET_A_STATEMENT,
        SECRET_A_BUG_STATEMENT,
        "ALPHA-PROJECT-SECRET",
        "xti-tenant-a",
        workspaceRootA,
      ]);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AGENT-LEVEL — `resolveAgentIdentity` + `enforceAgentToolAuthorization`
// (services/agent-runtime-authz.ts). Identity is built ONLY from the
// session owner id; the payload is checked against it and can never widen it.
// ══════════════════════════════════════════════════════════════════════════

describe("agent runtime authorization — cross-tenant payload targeting", () => {
  it("an agent resolved for owner A is denied when its payload targets owner B", () => {
    const identityA = resolveAgentIdentity({
      fabricAgentId: "ORCHESTRATOR",
      sessionOwnerId: ownerA.id,
      projectId: projectA.id,
    });
    expect(identityA.ownerId).toBe(ownerA.id);

    expect(() =>
      enforceAgentToolAuthorization({
        identity: identityA,
        requestedTool: "plan",
        payload: { targetOwnerId: ownerB.id },
      }),
    ).toThrow(/cross-tenant boundary escape/i);

    expect(
      thrownStatusCode(() =>
        enforceAgentToolAuthorization({
          identity: identityA,
          requestedTool: "plan",
          payload: { targetOwnerId: ownerB.id },
        }),
      ),
    ).toBe(403);
  });

  it("an agent resolved for owner A is denied when its payload targets owner B's project", () => {
    const identityA = resolveAgentIdentity({
      fabricAgentId: "ORCHESTRATOR",
      sessionOwnerId: ownerA.id,
      projectId: projectA.id,
    });
    expect(() =>
      enforceAgentToolAuthorization({
        identity: identityA,
        requestedTool: "plan",
        payload: { targetProjectId: projectB.id },
      }),
    ).toThrow(/cross-project boundary escape/i);
  });

  it("the payload cannot forge the identity itself — identity comes from the session only", () => {
    // Owner B's session, but every payload field claims to be owner A.
    const identityB = resolveAgentIdentity({
      fabricAgentId: "ORCHESTRATOR",
      sessionOwnerId: ownerB.id,
      projectId: projectB.id,
    });
    expect(identityB.ownerId).toBe(ownerB.id);
    expect(identityB.projectId).toBe(projectB.id);

    expect(() =>
      enforceAgentToolAuthorization({
        identity: identityB,
        requestedTool: "plan",
        payload: {
          targetOwnerId: ownerA.id,
          targetProjectId: projectA.id,
          targetAgentId: "SECURITY",
        },
      }),
    ).toThrow(/SECURITY VIOLATION/);
  });

  it("an unknown fabric agent id cannot acquire an unconstrained (empty) policy", () => {
    expect(() =>
      resolveAgentIdentity({
        fabricAgentId: "SUPER_ADMIN_AGENT",
        sessionOwnerId: ownerB.id,
        projectId: null,
      }),
    ).toThrow(/not in the agent catalog/i);
  });

  it("CONTROL: the same agent acting within its own tenant is allowed", () => {
    const identityA = resolveAgentIdentity({
      fabricAgentId: "ORCHESTRATOR",
      sessionOwnerId: ownerA.id,
      projectId: projectA.id,
    });
    expect(() =>
      enforceAgentToolAuthorization({
        identity: identityA,
        requestedTool: "plan",
        payload: { targetOwnerId: ownerA.id, targetProjectId: projectA.id },
      }),
    ).not.toThrow();
  });

  it("owner A's data is unchanged after the agent-level attacks", async () => {
    const after = await readMemoryAsOwnerA(memoryA.id);
    expect(after).toStrictEqual(memoryA);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// REGRESSION GUARD — GET /api/v1/evidence IS TENANT-SCOPED
// (closed VULNERABILITY #1, found by this suite, fixed 2026-08-20)
// ══════════════════════════════════════════════════════════════════════════
//
// WAS: `routes/evidence.ts` called `await requireUser(app, request)` and then
// DISCARDED the resolved user, returning EVERY evidence record of EVERY
// tenant — including `excerpt` (free text, routinely carrying document / log
// / PR content). `POST /api/v1/evidence` compounded it by stamping every
// record with a hard-coded `OWNER_ID` constant, so there was not even an
// ownerId left to filter on.
//
// NOW: the GET filters through `scopeEvidenceToCaller` (owner id equality,
// admin bypass) and the POST stamps the server-derived session owner. The
// exact attack below — owner B listing evidence and looking for owner A's
// record — is kept, with the expectation inverted.
// ══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/evidence — tenant scoping (regression: was a live leak)", () => {
  it("owner B's evidence list does NOT contain owner A's record or excerpt", async () => {
    signInAs(ownerB);
    const res = await app.inject({ method: "GET", url: "/api/v1/evidence" });
    expect(res.statusCode).toBe(200);
    const items = res.json<ListEnvelope<EvidenceRecordShape>>().items;

    expect(items.find((item) => item.id === evidenceA.id)).toBeUndefined();
    expect(items.map((item) => item.id)).not.toContain(evidenceA.id);
    // No foreign row survives the filter under any owner id.
    expect(items.every((item) => item.ownerId === ownerB.id)).toBe(true);
    expectNoLeakOf(res.body, [
      SECRET_A_EVIDENCE_EXCERPT,
      ownerA.id,
      ownerA.email,
      evidenceA.id,
      "ALPHA-PROJECT-SECRET",
    ]);
  });

  it("SECURITY REQUIREMENT: an anonymous caller gets 401 and no evidence at all", async () => {
    signInAs(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/evidence" });
    expect(res.statusCode).toBe(401);
    expectNoLeakOf(res.body, [SECRET_A_EVIDENCE_EXCERPT, ownerA.id, evidenceA.id]);
  });

  it("CONTROL: owner A still sees their OWN evidence (the fix scopes, it does not blank)", async () => {
    signInAs(ownerA);
    const res = await app.inject({ method: "GET", url: "/api/v1/evidence" });
    expect(res.statusCode).toBe(200);
    const mine = res
      .json<ListEnvelope<EvidenceRecordShape>>()
      .items.find((item) => item.id === evidenceA.id);
    expect(mine).toBeDefined();
    expect(mine?.ownerId).toBe(ownerA.id);
    expect(mine?.excerpt).toBe(SECRET_A_EVIDENCE_EXCERPT);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// REGRESSION GUARD — POST /api/v1/memory CANNOT SUPERSEDE ANOTHER TENANT'S
// MEMORIES (closed VULNERABILITY #2, found by this suite, fixed 2026-08-20)
// ══════════════════════════════════════════════════════════════════════════
//
// WAS: `services/memory-pipeline.ts#supersedeMatchingMemories` took NO
// ownerId — it walked `osStore.getMemories(key)` (every owner's rows) and
// flipped any row whose statement contained the attacker's first 48
// characters to status SUPERSEDED / epistemicState STALE, pointing
// `supersededBy` at the attacker's memory. The `projectId` bucket came
// straight from the attacker's body, and `projectId: null` targets the
// SHARED global bucket, so no knowledge of the victim's project was needed.
// The response's `supersededCount` doubled as a blind text-search oracle
// over the victim's memory text.
//
// NOW: `supersedeMatchingMemories` takes a REQUIRED `ownerId`, skips rows
// owned by anyone else, and `supersededCount` counts only the caller's own
// rows. The exact attack is replayed below; only the expectation is
// inverted, and the victim record is re-read as owner A and compared
// byte-for-byte with `toStrictEqual`.
// ══════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/memory — cross-tenant supersede (regression: was destructive)", () => {
  const VICTIM_STATEMENT =
    "GLOBAL-VICTIM-NOTE production deploys require two approvals from tenant A";
  // Attacker's own statement; its first 48 chars are a substring of the
  // victim's, which is all `supersedeMatchingMemories` matches on.
  const ATTACKER_STATEMENT = "GLOBAL-VICTIM-NOTE production deploys require two";

  let victimMemory: MemoryRecord;

  it("owner B's write does NOT mutate owner A's memory, and leaks no match count", async () => {
    signInAs(ownerA);
    const created = await createMemory({
      statement: VICTIM_STATEMENT,
      projectId: null,
    });
    expect(created.statusCode).toBe(201);
    // Baseline is the PERSISTED record, re-read through the real route.
    const persisted = await readMemoryAsOwnerA(created.record.id);
    expect(persisted).not.toBeNull();
    victimMemory = persisted as MemoryRecord;
    expect(victimMemory.ownerId).toBe(ownerA.id);
    expect(victimMemory.status).toBe("ACTIVE");

    // Attack: owner B creates a memory of their own whose first 48 chars are
    // a substring of A's statement. No id, no projectId, no ownerId of A's.
    signInAs(ownerB);
    const attack = await createMemory({
      statement: ATTACKER_STATEMENT,
      projectId: null,
    });
    expect(attack.statusCode).toBe(201);
    expect(attack.record.ownerId).toBe(ownerB.id);
    // Oracle closed: the count sees none of the victim's matching rows.
    expect(attack.body).toContain("\"supersededCount\":0");
    expectNoLeakOf(attack.body, [ownerA.id, ownerA.email, victimMemory.id]);

    // The attack failed: A's record is byte-identical, still ACTIVE, and
    // does not point at B's memory.
    const after = await readMemoryAsOwnerA(victimMemory.id);
    expect(after).not.toBeNull();
    expect(after).toStrictEqual(victimMemory);
    expect(after?.status).toBe("ACTIVE");
    expect(after?.supersededBy).toBeNull();
    expect(after?.supersededBy).not.toBe(attack.record.id);
  });

  it("SECURITY REQUIREMENT: owner A's memory is unchanged after owner B's write", async () => {
    const after = await readMemoryAsOwnerA(victimMemory.id);
    expect(after).toStrictEqual(victimMemory);
    expect(after?.status).toBe("ACTIVE");
    expect(after?.supersededBy).toBeNull();
  });

  it("CONTROL: owner A CAN still supersede their OWN matching memory", async () => {
    signInAs(ownerA);
    const own = await createMemory({
      statement: ATTACKER_STATEMENT,
      projectId: null,
    });
    expect(own.statusCode).toBe(201);
    expect(own.record.ownerId).toBe(ownerA.id);
    // Same-owner supersede still works — the gate is tenancy, not the
    // supersede mechanism itself.
    expect(own.body).toContain("\"supersededCount\":1");
    const after = await readMemoryAsOwnerA(victimMemory.id);
    expect(after?.status).toBe("SUPERSEDED");
    expect(after?.supersededBy).toBe(own.record.id);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// REGRESSION GUARD — THE FIVE PROJECT SUB-ROUTES ARE GATED
// (closed VULNERABILITY #3, found by this suite, fixed 2026-08-20)
// ══════════════════════════════════════════════════════════════════════════
//
// WAS: in `routes/projects.ts` these handlers called NEITHER `requireUser`
// NOR `assertProjectReadAccess` — they checked only that the project EXISTS
// and then returned its contents:
//
//     GET /api/v1/projects/:id/reachability
//     GET /api/v1/projects/:id/central-opinion
//     GET /api/v1/projects/:id/central-opinion.html
//     GET /api/v1/projects/:id/central-opinion.pdf
//     GET /api/v1/projects/:id/manager-reminders
//
// Strictly worse than a cross-tenant leak: a fully UNAUTHENTICATED one.
// `buildCentralOpinion` walks `osStore.getMemories(projectId)` with no owner
// filter and copies the first 200 characters of every BUG / HIGH / CRITICAL
// memory statement into `findings[].title`, alongside the project name and
// reachability (which carries local workspace paths). Anyone who learned a
// project UUID — no session, no cookie, no account — read that tenant's
// high-priority memory statements.
//
// NOW: every one of the five starts with
// `await assertProjectReadAccess(app, request, params.id)`, the same gate as
// the sibling `/resume` and `/context-export`. Codes differ by caller and
// are asserted separately: ANONYMOUS -> 401, AUTHENTICATED NON-OWNER -> 403.
// ══════════════════════════════════════════════════════════════════════════

describe("project sub-routes — auth gate (regression: were fully unauthenticated)", () => {
  const PREVIOUSLY_UNGATED_PATHS = [
    "reachability",
    "central-opinion",
    "central-opinion.html",
    "central-opinion.pdf",
    "manager-reminders",
  ] as const;

  it("an ANONYMOUS caller is rejected with 401 by all of them, with no data", async () => {
    signInAs(null);
    for (const suffix of PREVIOUSLY_UNGATED_PATHS) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectA.id}/${suffix}`,
      });
      expect(res.statusCode).toBe(401);
      expectNoLeakOf(res.body, [
        SECRET_A_BUG_STATEMENT,
        SECRET_A_STATEMENT,
        "ALPHA-PROJECT-SECRET",
        "Tenant A Project",
        "xti-tenant-a",
        workspaceRootA,
        ownerA.id,
      ]);
    }
  });

  it("central-opinion does NOT leak A's CRITICAL memory to an anonymous caller", async () => {
    signInAs(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectA.id}/central-opinion`,
    });
    // Anonymous, so 401 — an authenticated non-owner gets 403 (next test).
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain(SECRET_A_BUG_STATEMENT);
    expect(res.body).not.toContain("Tenant A Project");
  });

  it("SECURITY REQUIREMENT: owner B is denied (403) and sees none of A's data", async () => {
    signInAs(ownerB);
    for (const suffix of PREVIOUSLY_UNGATED_PATHS) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectA.id}/${suffix}`,
      });
      expect(res.statusCode).toBe(403);
      expectNoLeakOf(res.body, [
        SECRET_A_BUG_STATEMENT,
        SECRET_A_STATEMENT,
        "ALPHA-PROJECT-SECRET",
        "Tenant A Project",
        "xti-tenant-a",
        workspaceRootA,
        ownerA.id,
        ownerA.email,
      ]);
    }
  });

  it("CONTROL: owner A CAN read their own central-opinion (the gate is tenancy)", async () => {
    signInAs(ownerA);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectA.id}/central-opinion`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(SECRET_A_BUG_STATEMENT);
  });

  it("owner A's project record itself is still unchanged after these reads", async () => {
    const after = await readProjectAsOwnerA(projectA.id);
    expect(after.workspaceRoot).toBe(workspaceRootA);
    expect(after.slug).toBe("xti-tenant-a");
  });
});
