import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

// Same isolation + identity-stubbing pattern as `apps/api/src/routes/approvals.test.ts`:
// a per-file temp store path (skip-persist / skip-audit-log at import time so the
// service modules never touch a real store), plus mocking `getRequestUser` from the
// identity-resolution module so `requireUser` sees a fake signed-in user without real
// Supabase/local-session cookies.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-intelligence-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const getRequestUser = vi.fn();

vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerIntelligenceRoutes } = await import("./intelligence.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { setAuditLogPathForTests, listUnifiedAuditEntries } = await import(
  "../services/audit-log.js"
);

let app: FastifyInstance;
let auditDir: string;

const USER_ID = "44444444-4444-4444-8444-444444444444";

function regularUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: USER_ID,
    email: "engineer@example.com",
    displayName: "Engineer",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function validHypothesisBody(overrides: Record<string, unknown> = {}) {
  return {
    statement: "Increasing the connection pool size will reduce p99 latency.",
    domain: "PERFORMANCE",
    verificationCriteria: ["p99 latency drops below 200ms under load test"],
    ...overrides,
  };
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerIntelligenceRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(regularUser());
  // Point the unified audit log at a real temp file (not skipped) so these
  // tests can assert on the audit entries `enforceEntityWrite` writes —
  // same mechanism as `agent-dispatch-guard.test.ts`.
  auditDir = mkdtempSync(join(tmpdir(), `atlas-intelligence-audit-${Math.random().toString(16).slice(2)}`));
  setAuditLogPathForTests(join(auditDir, "audit.ndjson"));
  delete process.env.ATLAS_SKIP_AUDIT_LOG;
});

afterEach(() => {
  setAuditLogPathForTests(null);
  rmSync(auditDir, { recursive: true, force: true });
});

describe("POST /api/v1/intelligence/hypotheses", () => {
  it("401s when no user is signed in (regression: this route previously had no identity check at all)", async () => {
    getRequestUser.mockReturnValue(undefined);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/hypotheses",
      payload: validHypothesisBody(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("creates a hypothesis for a signed-in user and writes a low-risk RECORD.CREATE audit entry", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/hypotheses",
      payload: validHypothesisBody(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.statement).toBe(validHypothesisBody().statement);
    expect(body.createdBy).toBe(USER_ID);
    expect(body.status).toBe("PROPOSED");

    const entries = listUnifiedAuditEntries();
    const entry = entries.find((e) => e.type === "intelligence.hypotheses.create");
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(USER_ID);
    expect(entry?.policy).toBe("RECORD.CREATE");
    expect(entry?.result).toBe("SUCCESS");
    // RECORD.CREATE is LOW_RISK_WRITE / requiresApproval:false, so the
    // self-approved-write pattern records NOT_REQUIRED, not APPROVED.
    expect(entry?.approval).toBe("NOT_REQUIRED");
  });
});

describe("PATCH /api/v1/intelligence/hypotheses/:id/status", () => {
  it("401s when no user is signed in", async () => {
    getRequestUser.mockReturnValue(undefined);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/intelligence/hypotheses/00000000-0000-4000-8000-000000000000/status",
      payload: { status: "TESTING" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("404s for an unknown hypothesis id (for a signed-in user)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/intelligence/hypotheses/00000000-0000-4000-8000-000000000000/status",
      payload: { status: "TESTING" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("updates status for an existing hypothesis and writes a high-risk RECORD.UPDATE audit entry (self-approved write, never a silent pass)", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/hypotheses",
      payload: validHypothesisBody(),
    });
    const hypothesisId = createRes.json().id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/intelligence/hypotheses/${hypothesisId}/status`,
      payload: { status: "TESTING" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("TESTING");

    const entries = listUnifiedAuditEntries();
    const entry = entries.find((e) => e.type === "intelligence.hypotheses.updateStatus");
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(USER_ID);
    expect(entry?.policy).toBe("RECORD.UPDATE");
    expect(entry?.result).toBe("SUCCESS");
    // RECORD.UPDATE is HIGH_RISK_WRITE / requiresApproval:true, so the
    // self-approved-write pattern records APPROVED (never APPROVAL_REQUIRED
    // or a silent pass — see risk-audit.ts's fail-safe branch).
    expect(entry?.approval).toBe("APPROVED");
  });
});

describe("POST /api/v1/intelligence/hypotheses/:id/evidence/supporting", () => {
  it("401s when no user is signed in", async () => {
    getRequestUser.mockReturnValue(undefined);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/hypotheses/00000000-0000-4000-8000-000000000000/evidence/supporting",
      payload: { evidenceId: crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(401);
  });

  it("404s for an unknown hypothesis id (for a signed-in user)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/hypotheses/00000000-0000-4000-8000-000000000000/evidence/supporting",
      payload: { evidenceId: crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });

  it("adds supporting evidence for an existing hypothesis and audits RECORD.UPDATE", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/hypotheses",
      payload: validHypothesisBody(),
    });
    const hypothesisId = createRes.json().id as string;
    const evidenceId = crypto.randomUUID();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/intelligence/hypotheses/${hypothesisId}/evidence/supporting`,
      payload: { evidenceId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().supportingEvidenceIds).toContain(evidenceId);

    const entry = listUnifiedAuditEntries().find(
      (e) => e.type === "intelligence.hypotheses.addSupportingEvidence",
    );
    expect(entry).toBeDefined();
    expect(entry?.policy).toBe("RECORD.UPDATE");
    expect(entry?.result).toBe("SUCCESS");
  });
});

describe("POST /api/v1/intelligence/hypotheses/:id/evidence/contradicting", () => {
  it("401s when no user is signed in", async () => {
    getRequestUser.mockReturnValue(undefined);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/hypotheses/00000000-0000-4000-8000-000000000000/evidence/contradicting",
      payload: { evidenceId: crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(401);
  });

  it("404s for an unknown hypothesis id (for a signed-in user)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/hypotheses/00000000-0000-4000-8000-000000000000/evidence/contradicting",
      payload: { evidenceId: crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });

  it("adds contradicting evidence for an existing hypothesis and audits RECORD.UPDATE", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/hypotheses",
      payload: validHypothesisBody(),
    });
    const hypothesisId = createRes.json().id as string;
    const evidenceId = crypto.randomUUID();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/intelligence/hypotheses/${hypothesisId}/evidence/contradicting`,
      payload: { evidenceId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().contradictingEvidenceIds).toContain(evidenceId);

    const entry = listUnifiedAuditEntries().find(
      (e) => e.type === "intelligence.hypotheses.addContradictingEvidence",
    );
    expect(entry).toBeDefined();
    expect(entry?.policy).toBe("RECORD.UPDATE");
    expect(entry?.result).toBe("SUCCESS");
  });
});

describe("GET /api/v1/intelligence/hypotheses (regression: read path untouched by the write-authorization fix)", () => {
  it("does not require a signed-in user", async () => {
    getRequestUser.mockReturnValue(undefined);
    const res = await app.inject({ method: "GET", url: "/api/v1/intelligence/hypotheses" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});
