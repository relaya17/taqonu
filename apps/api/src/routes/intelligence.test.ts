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

// ─────────────────────────────────────────────────────────────────────────────
// Unit 6 — Golden Projects: control-plane CONFIGURATION writes (admin-gated).
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_ID = "55555555-5555-4555-8555-555555555555";

function adminUser(partial: Partial<AuthUser> = {}): AuthUser {
  return { ...regularUser(), id: ADMIN_ID, email: "admin@example.com", role: "admin", ...partial };
}

function validGoldenProjectBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Reference API",
    description: "A golden reference project",
    rootPath: "fixtures/golden-brokeros",
    goldenReason: "Exemplifies clean API design and error handling.",
    domains: ["API_DESIGN"],
    ...overrides,
  };
}

describe("POST /api/v1/intelligence/golden-projects (CONFIGURATION.CREATE, admin only)", () => {
  it("401s when no user is signed in", async () => {
    getRequestUser.mockReturnValue(undefined);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/golden-projects",
      payload: validGoldenProjectBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for an authenticated non-admin user", async () => {
    getRequestUser.mockReturnValue(regularUser());
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/golden-projects",
      payload: validGoldenProjectBody(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("registers a golden project for an admin and audits CONFIGURATION.CREATE", async () => {
    getRequestUser.mockReturnValue(adminUser());
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/golden-projects",
      payload: validGoldenProjectBody(),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("Reference API");

    const entry = listUnifiedAuditEntries().find(
      (e) => e.type === "intelligence.goldenProjects.register",
    );
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(ADMIN_ID);
    expect(entry?.policy).toBe("CONFIGURATION.CREATE");
    expect(entry?.result).toBe("SUCCESS");
  });
});

describe("PATCH /api/v1/intelligence/golden-projects/:id/status (CONFIGURATION.UPDATE, admin only)", () => {
  const validId = "00000000-0000-4000-8000-000000000000";

  it("401s when no user is signed in", async () => {
    getRequestUser.mockReturnValue(undefined);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/intelligence/golden-projects/${validId}/status`,
      payload: { status: "VERIFIED" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for an authenticated non-admin user", async () => {
    getRequestUser.mockReturnValue(regularUser());
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/intelligence/golden-projects/${validId}/status`,
      payload: { status: "VERIFIED" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400s for a malformed golden-project id (admin) without reaching the mutation service", async () => {
    getRequestUser.mockReturnValue(adminUser());
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/intelligence/golden-projects/not-a-uuid/status",
      payload: { status: "VERIFIED" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("updates status for an admin and audits CONFIGURATION.UPDATE", async () => {
    getRequestUser.mockReturnValue(adminUser());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/golden-projects",
      payload: validGoldenProjectBody(),
    });
    const projectId = createRes.json().id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/intelligence/golden-projects/${projectId}/status`,
      payload: { status: "VERIFIED" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("VERIFIED");

    const entry = listUnifiedAuditEntries().find(
      (e) => e.type === "intelligence.goldenProjects.updateStatus",
    );
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(ADMIN_ID);
    expect(entry?.policy).toBe("CONFIGURATION.UPDATE");
    expect(entry?.result).toBe("SUCCESS");
  });
});

describe("PATCH /api/v1/intelligence/golden-projects/:id/scores (CONFIGURATION.UPDATE, admin only)", () => {
  const validId = "00000000-0000-4000-8000-000000000000";

  it("401s when no user is signed in", async () => {
    getRequestUser.mockReturnValue(undefined);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/intelligence/golden-projects/${validId}/scores`,
      payload: { codeQuality: 0.9 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for an authenticated non-admin user", async () => {
    getRequestUser.mockReturnValue(regularUser());
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/intelligence/golden-projects/${validId}/scores`,
      payload: { codeQuality: 0.9 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400s for a malformed golden-project id (admin) without reaching the mutation service", async () => {
    getRequestUser.mockReturnValue(adminUser());
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/intelligence/golden-projects/not-a-uuid/scores",
      payload: { codeQuality: 0.9 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("updates scores for an admin and audits CONFIGURATION.UPDATE", async () => {
    getRequestUser.mockReturnValue(adminUser());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/intelligence/golden-projects",
      payload: validGoldenProjectBody(),
    });
    const projectId = createRes.json().id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/intelligence/golden-projects/${projectId}/scores`,
      payload: { codeQuality: 0.95, security: 0.9 },
    });
    expect(res.statusCode).toBe(200);

    const entry = listUnifiedAuditEntries().find(
      (e) => e.type === "intelligence.goldenProjects.updateScores",
    );
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(ADMIN_ID);
    expect(entry?.policy).toBe("CONFIGURATION.UPDATE");
    expect(entry?.result).toBe("SUCCESS");
  });
});

describe("Unit 6 read regression: public GET routes remain readable and unauthenticated", () => {
  it("GET /golden-projects does not require a signed-in user", async () => {
    getRequestUser.mockReturnValue(undefined);
    const res = await app.inject({ method: "GET", url: "/api/v1/intelligence/golden-projects" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("GET /marketplace does not require a signed-in user", async () => {
    getRequestUser.mockReturnValue(undefined);
    const res = await app.inject({ method: "GET", url: "/api/v1/intelligence/marketplace" });
    expect(res.statusCode).toBe(200);
  });
});
