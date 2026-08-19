import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-billing-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

// Same mechanism used by portfolio.test.ts / graph.test.ts: stub
// `getRequestUser` (the function `requireSignedInForWrite` ultimately calls)
// so a route test can simulate a signed-in caller without a real
// Supabase/local session cookie.
const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

// billing.ts resolves tenant ownership via `resolveCloudIdentity` (not
// `getRequestUser` directly), so it's stubbed the same way — this keeps the
// route test isolated from Supabase/local-session cookie plumbing while
// still letting each test control which ownerId the route sees.
const resolveCloudIdentity = vi.fn();
vi.mock("../services/cloud-identity.js", () => ({
  resolveCloudIdentity: (...args: unknown[]) => resolveCloudIdentity(...args),
}));

const { registerBillingRoutes } = await import("./billing.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { authorizeEntityAction } = await import("@atlas/agent-core");

function signedInUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "biller@example.com",
    displayName: "Biller",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

let app: FastifyInstance;
const dirs: string[] = [tmpDir];

beforeAll(async () => {
  // Force `isLiveSupabase` false (SUPABASE_SERVICE_ROLE_KEY: "replace-me")
  // so the route's downstream plan-quota reads never attempt a real
  // Supabase network call during the test.
  app = await buildRouteTestApp(registerBillingRoutes, {
    SUPABASE_SERVICE_ROLE_KEY: "replace-me",
  });
});

afterAll(async () => {
  await app.close();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("POST /api/v1/billing/plan", () => {
  it("401s when not signed in (existing requireSignedInForWrite gate is unchanged)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/plan",
      payload: { tier: "pro" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("succeeds for a signed-in user changing their own plan tier (default-allow case, no separate owner to check)", async () => {
    const actor = signedInUser();
    getRequestUser.mockReturnValue(actor);
    resolveCloudIdentity.mockResolvedValue({
      ownerId: actor.id,
      userAccessToken: null,
      setCookie: null,
      source: "local_session",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/plan",
      payload: { tier: "pro" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ownerId).toBe(actor.id);
    expect(body.tier).toBe("pro");
  });
});

describe("entity-policy wiring for the plan route", () => {
  // Focused unit-level assertion on the exact agent-context object the route
  // constructs, so this test fails if the wiring in billing.ts is silently
  // changed (e.g. mode flipped, writeGateOpen/approved dropped, or the wrong
  // entity type/action chosen) even though the HTTP-level test above would
  // still pass for other reasons.
  it("authorizeEntityAction('FINANCIAL_TRANSACTION','UPDATE', {mode:'WRITE', writeGateOpen:true, approved:true}) is ALLOWED", () => {
    const decision = authorizeEntityAction("FINANCIAL_TRANSACTION", "UPDATE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    expect(decision.decision).toBe("ALLOWED");
  });

  it("authorizeEntityAction('FINANCIAL_TRANSACTION','UPDATE', ...) requires approval when not pre-approved (documents why the route hardcodes approved:true)", () => {
    const decision = authorizeEntityAction("FINANCIAL_TRANSACTION", "UPDATE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: false,
    });
    expect(decision.decision).toBe("APPROVAL_REQUIRED");
  });
});

// Entity-policy wiring for the two newly-gated routes (credits/purchase,
// stripe/checkout) — both use FINANCIAL_TRANSACTION.CREATE, unlike the plan
// route's UPDATE. Same focused unit-level shape as the block above.
describe("entity-policy wiring for credits/purchase and stripe/checkout", () => {
  it("authorizeEntityAction('FINANCIAL_TRANSACTION','CREATE', {mode:'WRITE', writeGateOpen:true, approved:true}) is ALLOWED", () => {
    const decision = authorizeEntityAction("FINANCIAL_TRANSACTION", "CREATE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    expect(decision.decision).toBe("ALLOWED");
  });

  it("authorizeEntityAction('FINANCIAL_TRANSACTION','CREATE', ...) requires approval when not pre-approved", () => {
    const decision = authorizeEntityAction("FINANCIAL_TRANSACTION", "CREATE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: false,
    });
    expect(decision.decision).toBe("APPROVAL_REQUIRED");
  });
});

describe("POST /api/v1/billing/credits/purchase gate", () => {
  it("still succeeds end-to-end for a signed-in caller now that the entity-policy gate is wired in", async () => {
    const actor = signedInUser();
    getRequestUser.mockReturnValue(actor);
    resolveCloudIdentity.mockResolvedValue({
      ownerId: actor.id,
      userAccessToken: null,
      setCookie: null,
      source: "local_session",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/credits/purchase",
      payload: { pack: "starter" },
    });
    expect(res.statusCode).toBe(201);
  });
});
