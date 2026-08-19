import { createHmac } from "node:crypto";
import { test, expect } from "@playwright/test";
import { API_BASE, apiHealthy } from "./helpers";

/**
 * Failure-path API checks via Playwright request context.
 * Complements security.spec.ts (which covers auth/me, workspace-root,
 * billing/credits/purchase, patch approve, admin/leads, GitHub + Stripe
 * webhook signature rejection). This file covers the remaining gaps:
 * malformed/garbage session cookies, Zod-validation 4xx (not 500),
 * duplicate webhook delivery, permission-denied on a project-scoped write
 * route not already exercised by security.spec.ts, and 404 on a
 * well-formed-but-nonexistent resource id.
 *
 * Skips when API is down, same convention as security.spec.ts.
 */
test.describe("Failure paths (API)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiHealthy(request)), "API not reachable — skip failure-path suite");
  });

  test("malformed session cookie is treated as unauthenticated, not a crash", async ({
    request,
  }) => {
    // Atlas identity is cookie-based (atlas_session / atlas_sb_session) — there
    // is no bearer-token auth path to hit. A garbage value for the local
    // session cookie must fail closed (401 UNAUTHORIZED), the same as no
    // cookie at all — never a 500 from a cookie-parsing/signature exception.
    const res = await request.get(`${API_BASE}/api/v1/auth/me`, {
      headers: {
        cookie: "atlas_session=not-a-real-signed-session-token.garbage",
      },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("malformed Supabase session cookie also fails closed", async ({ request }) => {
    // atlas_sb_session is expected to be URI-encoded JSON with accessToken +
    // expiresAt; a corrupt value must be swallowed by the parser (returns
    // null) and fall through to "not signed in", not throw.
    const res = await request.get(`${API_BASE}/api/v1/auth/me`, {
      headers: {
        cookie: "atlas_sb_session=%7Bnot-valid-json%7D",
      },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("invalid input on memory creation → clean 400 VALIDATION_ERROR, not 500", async ({
    request,
  }) => {
    // createMemorySchema requires type/category/epistemicState/observationMode/
    // source/sourceType as enums and a non-empty `statement`. Send a body that
    // violates several of them at once (empty statement, bogus enum values,
    // missing required fields) and confirm the Zod error handler's 400 path
    // (see apps/api/src/middleware/error-handler.ts) — never a raw 500.
    const res = await request.post(`${API_BASE}/api/v1/memory`, {
      data: {
        type: "NOT_A_REAL_MEMORY_TYPE",
        statement: "",
        category: "NOT_A_REAL_CATEGORY",
        epistemicState: "NOT_A_REAL_STATE",
        // observationMode, source, sourceType intentionally omitted
      },
      headers: { "content-type": "application/json" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error?.details?.issues)).toBe(true);
    expect(body.error.details.issues.length).toBeGreaterThan(0);
  });

  test("invalid input on project creation → clean 400, not 500", async ({ request }) => {
    // createProjectSchema requires slug to match /^[a-z0-9-]+$/ and name to be
    // non-empty. An uppercase/space-containing slug plus an empty name should
    // fail validation before any store/auth logic runs.
    const res = await request.post(`${API_BASE}/api/v1/projects`, {
      data: {
        slug: "Not A Valid Slug!!",
        name: "",
      },
      headers: { "content-type": "application/json" },
    });
    // requireSignedInForWrite runs before body validation in this route, so
    // an unauthenticated caller legitimately gets 401 first; either way the
    // response must be a clean 4xx, never a 500.
    expect([400, 401]).toContain(res.status());
    const body = await res.json();
    expect(["VALIDATION_ERROR", "UNAUTHORIZED"]).toContain(body.error?.code);
  });

  test("duplicate GitHub webhook delivery is handled safely both times", async ({
    request,
  }) => {
    // There is no dedupe-by-delivery-id in POST /api/v1/github/webhooks today
    // (see apps/api/src/routes/github.ts — it verifies the signature, then
    // always tries to match+sync, with no idempotency-key/delivery-id check).
    // This does NOT assert dedupe (that would be asserting a behavior the
    // code does not implement, which would be dishonest and flaky the moment
    // dedupe ships). What it DOES assert, honestly, is the current safe
    // contract: replaying the identical signed payload twice is accepted
    // (202) both times and never 500s / never double-counts as a
    // *different* sync outcome — i.e. redelivery is a safe no-op-ish retry,
    // not a crash. If true delivery-id dedupe is added later, tighten this
    // test to assert the second call is a no-op via a delivery-id header.
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    test.skip(
      !secret,
      "GITHUB_WEBHOOK_SECRET not set in this environment — cannot sign a valid webhook payload",
    );

    const payload = JSON.stringify({
      zen: "duplicate-delivery-suite",
      repository: { full_name: "atlas-e2e/does-not-exist" },
    });
    const signature =
      "sha256=" + createHmac("sha256", secret as string).update(payload).digest("hex");

    const headers = {
      "content-type": "application/json",
      "x-github-event": "ping",
      "x-hub-signature-256": signature,
    };

    const first = await request.post(`${API_BASE}/api/v1/github/webhooks`, {
      data: payload,
      headers,
    });
    expect(first.status()).toBe(202);
    const firstBody = await first.json();
    expect(firstBody.accepted).toBe(true);

    // Replay the exact same signed payload — known current gap: no
    // delivery-id idempotency check, so this is expected to also 202,
    // not 500 or hang.
    const second = await request.post(`${API_BASE}/api/v1/github/webhooks`, {
      data: payload,
      headers,
    });
    expect(second.status()).toBe(202);
    const secondBody = await second.json();
    expect(secondBody.accepted).toBe(true);
  });

  test("webhook: duplicate signature-invalid delivery is rejected consistently both times", async ({
    request,
  }) => {
    // Companion to the above for environments without GITHUB_WEBHOOK_SECRET
    // (e.g. local dev): confirms a bad signature is rejected the same way on
    // replay too — not "fails open" on a second attempt.
    const data = { zen: "duplicate-invalid-suite" };
    const headers = {
      "content-type": "application/json",
      "x-github-event": "ping",
      "x-hub-signature-256": "sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    };
    const first = await request.post(`${API_BASE}/api/v1/github/webhooks`, {
      data,
      headers,
    });
    const second = await request.post(`${API_BASE}/api/v1/github/webhooks`, {
      data,
      headers,
    });
    expect([401, 500]).toContain(first.status());
    expect([401, 500]).toContain(second.status());
    expect(first.status()).toBe(second.status());
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(["WEBHOOK_INVALID", "CONFIG_ERROR"]).toContain(firstBody.error?.code);
    expect(firstBody.error?.code).toBe(secondBody.error?.code);
  });

  test("permission-denied: project sentinel scan requires session (write-gated resource route)", async ({
    request,
  }) => {
    // Distinct route from security.spec.ts's coverage (workspace-root,
    // billing/credits/purchase, patch approve, admin/leads): this hits
    // POST /api/v1/projects/:id/sentinel/scan, which is gated by
    // assertProjectWriteAccess (apps/api/src/services/project-access.ts).
    // Without a session, requireSignedInForWrite fires before any
    // ownership check, so an anonymous caller must get 401 UNAUTHORIZED —
    // never a 200 and never a leak of scan results for a project it does
    // not own.
    const res = await request.post(
      `${API_BASE}/api/v1/projects/00000000-0000-4000-8000-000000000002/sentinel/scan`,
      {
        data: {},
        headers: { "content-type": "application/json" },
      },
    );
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("404: GET a well-formed but nonexistent project id", async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/projects/00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error?.code).toBe("NOT_FOUND");
  });

  test("404: reachability lookup for a nonexistent project id", async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/projects/00000000-0000-0000-0000-000000000000/reachability`,
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error?.code).toBe("NOT_FOUND");
  });
});
