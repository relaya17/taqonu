import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AuthUser, DomainEvent } from "@atlas/shared";

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as graph.test.ts / event-rules.test.ts).
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-events-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

// Same stubbing mechanism as admin-ops.test.ts / auth-guards.test.ts: mock
// `getRequestUser` (the function `requireAdmin`/`requireUser` ultimately
// call) so a route test can simulate signed-in / admin callers without a
// real Supabase/local session cookie.
const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerEventRoutes } = await import("./events.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_A = "22222222-2222-4222-8222-222222222222";
const PROJECT_B = "33333333-3333-4333-8333-333333333333";

function makeUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    email: "admin@example.com",
    displayName: "Admin",
    role: "admin",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const adminUser = makeUser();
const regularUser = makeUser({
  id: "55555555-5555-4555-8555-555555555555",
  email: "user@example.com",
  role: "user",
});

/**
 * Seed a domain event directly into the store with a fully-controlled
 * `occurredAt` timestamp, bypassing memory-pipeline's appendDomainEvent
 * (which always stamps `now`) so `since` boundary tests are deterministic.
 */
function seedEvent(partial: {
  type: DomainEvent["type"];
  occurredAt: string;
  projectId?: string | null;
}): DomainEvent {
  const event: DomainEvent = {
    id: randomUUID(),
    type: partial.type,
    occurredAt: partial.occurredAt,
    ownerId: OWNER_ID,
    projectId: partial.projectId ?? null,
    correlationId: randomUUID(),
    causationId: null,
    epistemicState: "OBSERVED",
    payload: {},
  };
  osStore.appendDomainEvent(event);
  return event;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerEventRoutes);

  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();

  seedEvent({ type: "patch.applied", occurredAt: hoursAgo(1), projectId: PROJECT_A });
  seedEvent({ type: "patch.proposed", occurredAt: hoursAgo(1), projectId: PROJECT_B });
  seedEvent({ type: "patch.applied", occurredAt: hoursAgo(48), projectId: PROJECT_A });
  seedEvent({ type: "evidence.recorded", occurredAt: hoursAgo(2), projectId: PROJECT_A });
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  // Default to an admin caller so the pre-existing filter/pagination tests
  // below continue to exercise the route's behavior once auth is required.
  getRequestUser.mockReturnValue(adminUser);
});

describe("GET /api/v1/events auth", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/events" });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a signed-in non-admin user", async () => {
    getRequestUser.mockReturnValue(regularUser);
    const res = await app.inject({ method: "GET", url: "/api/v1/events" });
    expect(res.statusCode).toBe(403);
  });

  it("200s for an admin caller", async () => {
    getRequestUser.mockReturnValue(adminUser);
    const res = await app.inject({ method: "GET", url: "/api/v1/events" });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/v1/events", () => {
  it("returns all seeded events with no filters", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/events" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(4);
  });

  it("filters by type (existing hand-rolled filter still works)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/events?type=patch.applied",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items.every((e: DomainEvent) => e.type === "patch.applied")).toBe(true);
  });

  it("filters by projectId (existing hand-rolled filter still works)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/events?projectId=${PROJECT_B}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].projectId).toBe(PROJECT_B);
  });

  it("filters by since (new Universal-Filter-Engine-backed param): includes recent, excludes old", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/events?since=${24 * 60 * 60 * 1000}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 3 of the 4 seeded events are within the last 24h; the 48h-old
    // patch.applied event must be excluded.
    expect(body.total).toBe(3);
    expect(
      body.items.some(
        (e: DomainEvent) => e.type === "patch.applied" && e.projectId === PROJECT_A && Date.now() - Date.parse(e.occurredAt) > 24 * 60 * 60 * 1000,
      ),
    ).toBe(false);
  });

  it("composes since with type/projectId filters", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/events?type=patch.applied&projectId=${PROJECT_A}&since=${24 * 60 * 60 * 1000}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Only the recent (1h-old) patch.applied/PROJECT_A event qualifies; the
    // 48h-old one is excluded by `since`.
    expect(body.total).toBe(1);
  });

  it("a since window that excludes everything returns an empty page", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/events?since=1",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });
});
