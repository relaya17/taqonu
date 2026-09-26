import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { domainEventSchema, type AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-recurrence-route-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

const { registerRecurrenceRoutes } = await import("./recurrence.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");

const owner = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "owner@example.com",
  displayName: "Owner",
  role: "user",
  locale: "en",
  provider: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
} as AuthUser;

describe("GET /api/v1/recurrence", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildRouteTestApp(registerRecurrenceRoutes);
    osStore.ensureLoaded();
    for (const id of [
      "66666666-6666-4666-8666-666666666661",
      "66666666-6666-4666-8666-666666666662",
    ]) {
      osStore.appendDomainEvent(
        domainEventSchema.parse({
          id,
          type: "evaluation.completed",
          occurredAt: "2026-09-26T00:00:00.000Z",
          ownerId: owner.id,
          projectId: "44444444-4444-4444-8444-444444444444",
          correlationId: "55555555-5555-4555-8555-555555555555",
          causationId: null,
          epistemicState: "CONFLICTED",
          payload: {
            ok: false,
            sourceIssueId: "auth-timeout",
            patchVerifyStatus: "FAIL",
          },
        }),
      );
    }
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an inferred recommendation for the signed-in owner", async () => {
    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/recurrence?projectId=44444444-4444-4444-8444-444444444444",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ epistemicState: string; occurrences: number }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.epistemicState).toBe("INFERRED");
    expect(body.items[0]?.occurrences).toBe(2);
  });

  it("401s when signed out", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/recurrence" });
    expect(res.statusCode).toBe(401);
  });
});
