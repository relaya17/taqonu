import { test, expect } from "@playwright/test";
import { API_BASE, apiHealthy } from "./helpers";

/**
 * Security-focused API checks via Playwright request context.
 * Skips when API is down. Does not require live external secrets —
 * webhook rejection uses GITHUB_WEBHOOK_SECRET when set in CI/local;
 * otherwise asserts CONFIG_ERROR (secret required) still denies unsigned traffic.
 */
test.describe("Security (API)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiHealthy(request)), "API not reachable — skip security suite");
  });

  test("auth/me requires a session", async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/auth/me`);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("auth/session soft-probes anonymously", async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/auth/session`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.authenticated).toBe(false);
  });

  test("WRITE: workspace-root requires signed-in session", async ({ request }) => {
    const res = await request.put(
      `${API_BASE}/api/v1/projects/00000000-0000-4000-8000-000000000001/workspace-root`,
      {
        data: { workspaceRoot: null },
        headers: { "content-type": "application/json" },
      },
    );
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("WRITE: billing credit purchase requires session", async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/v1/billing/credits/purchase`, {
      data: { pack: "starter" },
      headers: { "content-type": "application/json" },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("WRITE: patch approve requires session", async ({ request }) => {
    const res = await request.post(
      `${API_BASE}/api/v1/code/patches/00000000-0000-4000-8000-000000000099/approve`,
      {
        data: {},
        headers: { "content-type": "application/json" },
      },
    );
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("authz: admin leads require admin session", async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/admin/leads`);
    expect([401, 403]).toContain(res.status());
    const body = await res.json();
    expect(["UNAUTHORIZED", "FORBIDDEN"]).toContain(body.error?.code);
  });

  test("webhook: GitHub rejects unsigned / bad signature traffic", async ({
    request,
  }) => {
    const res = await request.post(`${API_BASE}/api/v1/github/webhooks`, {
      data: { zen: "security-suite" },
      headers: {
        "content-type": "application/json",
        "x-github-event": "ping",
        "x-hub-signature-256": "sha256=deadbeef",
      },
    });

    // With secret configured → WEBHOOK_INVALID (401).
    // Without secret → CONFIG_ERROR (500) — still not accepted as valid.
    expect([401, 500]).toContain(res.status());
    const body = await res.json();
    expect(["WEBHOOK_INVALID", "CONFIG_ERROR"]).toContain(body.error?.code);
  });

  test("webhook: Stripe stub denies live verify without secret", async ({
    request,
  }) => {
    const res = await request.post(`${API_BASE}/api/v1/billing/stripe/webhook`, {
      data: { type: "checkout.session.completed" },
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=1,v1=deadbeef",
      },
    });
    // Default CI has no STRIPE_WEBHOOK_SECRET → stub no-op (not fulfilled).
    // If a secret is set, invalid signature must be rejected.
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.accepted === false || body.mode === "stub" || body.handled === false).toBeTruthy();
      expect(body.mode === "live" && body.handled === true).toBeFalsy();
    } else {
      expect([401, 400]).toContain(res.status());
    }
  });

  test("secret redaction smoke via eval golden suite", async ({ request }) => {
    // POST /eval/runs is not on the ADR-021 public allow-list (it writes
    // store + audit). Anonymous callers must get 401 before any suite runs.
    // Redaction itself is gated in CI by ci-eval-gate.ts; this test only
    // inspects SECURITY notes when a run actually executes (201).
    const res = await request.post(`${API_BASE}/api/v1/eval/runs`, {
      data: {
        suiteId: "11111111-1111-4111-8111-111111111111",
      },
      headers: { "content-type": "application/json" },
    });
    if (res.status() === 401) {
      const denied = await res.json();
      expect(denied.error?.code).toBe("UNAUTHORIZED");
      return;
    }
    if (res.status() === 402) {
      test.skip(true, "eval quota exceeded — skip redaction smoke");
      return;
    }
    expect(res.status()).toBe(201);
    const body = await res.json();
    const security = (body.results ?? []).find(
      (r: { dimension?: string }) => r.dimension === "SECURITY",
    );
    expect(security?.passed).toBe(true);
    expect(String(security?.notes ?? "")).toMatch(/redact/i);
  });
});
