import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-notifications-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

const { registerNotificationRoutes } = await import("./notifications.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { createApprovalRequest } = await import("../services/approvals.js");
const { resetApprovalsForTests } = await import("../services/approvals-test-store.js");

function user(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "owner@example.com",
    displayName: "Owner",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const ownerA = user();
const ownerB = user({
  id: "33333333-3333-4333-8333-333333333333",
  email: "other@example.com",
});

function seedPendingMemory(ownerId: string, statement: string) {
  const now = new Date().toISOString();
  osStore.addMemory({
    id: crypto.randomUUID(),
    ownerId,
    type: "LESSON",
    projectId: null,
    statement,
    reason: [],
    status: "ACTIVE",
    confidence: 0.5,
    category: "GENERATED_REASONING",
    epistemicState: "PROPOSED",
    observationMode: "INFERRED",
    source: "seed",
    sourceType: "SYSTEM",
    sourceId: null,
    evidence: [],
    supersededBy: null,
    validFrom: null,
    validUntil: null,
    observedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: "seed",
    scope: "GLOBAL",
    priority: "MEDIUM",
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerNotificationRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/v1/notifications", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/notifications" });
    expect(res.statusCode).toBe(401);
  });

  it("returns only the caller's pending memories and waiting approvals", async () => {
    osStore.resetInMemoryForTests();
    resetApprovalsForTests();
    seedPendingMemory(ownerA.id, "owner A pending inbox note");
    seedPendingMemory(ownerB.id, "owner B pending inbox note");
    const mine = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "EXECUTE",
      requestedBy: ownerA.id,
      reason: "apply patch for owner A inbox",
    });
    await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "EXECUTE",
      requestedBy: ownerB.id,
      reason: "apply patch for owner B inbox",
    });

    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({ method: "GET", url: "/api/v1/notifications" });
    expect(res.statusCode).toBe(200);
    const titles = (res.json().items as Array<{ title: string }>).map((row) => row.title);
    expect(titles).toContain("owner A pending inbox note");
    expect(titles).toContain("apply patch for owner A inbox");
    expect(titles).not.toContain("owner B pending inbox note");
    expect(titles).not.toContain("apply patch for owner B inbox");
    expect(res.json().channel).toBe("in-app");
    expect(res.json().unreadCount).toBeGreaterThanOrEqual(2);

    getRequestUser.mockReturnValue(ownerB);
    const steal = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/dismiss",
      payload: { id: mine.id },
    });
    expect(steal.statusCode).toBe(404);
  });

  it("dismisses an owned item and drops it from unread", async () => {
    osStore.resetInMemoryForTests();
    resetApprovalsForTests();
    seedPendingMemory(ownerA.id, "dismiss this inbox row");
    const memory = [...osStore.memories.values()]
      .flat()
      .find((row) => row.statement === "dismiss this inbox row");
    getRequestUser.mockReturnValue(ownerA);
    const dismiss = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/dismiss",
      payload: { id: memory!.id },
    });
    expect(dismiss.statusCode).toBe(200);
    const unread = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?unread=1",
    });
    const titles = (unread.json().items as Array<{ title: string }>).map((row) => row.title);
    expect(titles).not.toContain("dismiss this inbox row");
    expect(unread.json().unreadCount).toBe(0);
  });
});
