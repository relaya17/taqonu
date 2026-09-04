import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";
import {
  SYNTHETIC_SCENARIO_CLOSED_LOOP_PATH,
  SYNTHETIC_SCENARIO_RUN_PATH,
} from "@atlas/synthetic-universe";
import { setAuditLogPathForTests } from "../services/audit-log.js";
import { listGovernanceDecisions } from "../services/governance-decision.js";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerSyntheticUniverseRoutes } = await import("./synthetic-universe.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { listUnifiedAuditEntries } = await import("../services/audit-log.js");

function signedInUser(partial: Partial<AuthUser> = {}): AuthUser {
  const {
    emailVerified = true,
    disabled = false,
    hasPassword = false,
    mfaEnabled = false,
    ...rest
  } = partial;
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "operator@example.com",
    displayName: "Operator",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    emailVerified,
    disabled,
    hasPassword,
    mfaEnabled,
    ...rest,
  };
}

describe("POST /api/v1/synthetic/scenarios/run", () => {
  let app: FastifyInstance;
  let dir: string;
  const user = signedInUser();

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "atlas-synthetic-route-"));
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    getRequestUser.mockReset();
    getRequestUser.mockResolvedValue(user);
    app = await buildRouteTestApp(registerSyntheticUniverseRoutes);
  });

  afterEach(async () => {
    await app.close();
    setAuditLogPathForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(payload: { tenantId: string; scenarioId: string }) {
    return app.inject({
      method: "POST",
      url: SYNTHETIC_SCENARIO_RUN_PATH,
      payload,
    });
  }

  it("rejects unauthenticated callers", async () => {
    getRequestUser.mockResolvedValue(null);
    const res = await run({
      tenantId: "TEST-REALTY-001",
      scenarioId: "real-estate-deal-completion",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects production tenant prod", async () => {
    const res = await run({
      tenantId: "prod",
      scenarioId: "real-estate-deal-completion",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.message).toMatch(/TEST-/);
  });

  it("rejects Atlas production identity def-000", async () => {
    const res = await run({
      tenantId: "def-000",
      scenarioId: "real-estate-deal-completion",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/TEST-|production/i);
  });

  it("rejects unknown scenarios and domain mismatches", async () => {
    const unknown = await run({
      tenantId: "TEST-REALTY-001",
      scenarioId: "not-a-registered-scenario",
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.message).toMatch(/not a registered/);

    const mismatch = await run({
      tenantId: "TEST-HOTEL-001",
      scenarioId: "real-estate-deal-completion",
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.message).toMatch(/HOTEL|REALTY/);
  });

  it("runs real-estate-deal-completion through Atlas HTTP and persists canonical audit", async () => {
    const res = await run({
      tenantId: "TEST-REALTY-001",
      scenarioId: "real-estate-deal-completion",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verdict).toBe("VERIFIED");
    expect(body.tenantId).toBe("TEST-REALTY-001");
    expect(body.scenarioId).toBe("real-estate-deal-completion");
    expect(body.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(body.evidenceId).toBe(body.runId);
    expect(body.realExternalExecuted).toBe(false);
    expect(body.process.failed).toBe(false);
    expect(body.events).toContain("DealCompleted");
    expect(body.assertions.every((row: { passed: boolean }) => row.passed)).toBe(true);

    const persisted = listUnifiedAuditEntries({ ownerId: user.id });
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.some((entry) => entry.type === "synthetic.scenario.run")).toBe(true);
    const runEntry = persisted.find((entry) => entry.type === "synthetic.scenario.run");
    expect(runEntry?.actorId).toBe(user.id);
    expect(runEntry?.input.tenantId).toBe("TEST-REALTY-001");
    expect(runEntry?.input.scenarioId).toBe("real-estate-deal-completion");
    expect(runEntry?.input.runId).toBe(body.runId);
    expect(runEntry?.output).toMatchObject({
      verdict: "VERIFIED",
      realExternalExecuted: false,
    });
    expect(runEntry?.correlationId).toBe(body.runId);
  });

  it("detects an incomplete process (missing payment transition) as PROCESS_FAILURE", async () => {
    const res = await run({
      tenantId: "TEST-REALTY-009",
      scenarioId: "real-estate-deal-incomplete-payment",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verdict).toBe("PROCESS_FAILURE");
    expect(body.process.failed).toBe(true);
    expect(body.process.explanation).toMatch(/payment|Process failure/i);
    expect(
      body.assertions.some(
        (row: { name: string; passed: boolean }) =>
          row.name === "invoice_paid" && row.passed === false,
      ),
    ).toBe(true);

    const persisted = listUnifiedAuditEntries({ ownerId: user.id });
    const runEntry = persisted.find((entry) => entry.type === "synthetic.scenario.run");
    expect(runEntry?.verificationVerdict).toBe("FAILED");
    expect(runEntry?.output).toMatchObject({ verdict: "PROCESS_FAILURE" });
  });

  it("blocks a real payment and records a synthetic payment (containment)", async () => {
    const res = await run({
      tenantId: "TEST-REALTY-001",
      scenarioId: "sandbox-containment-payment",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verdict).toBe("CONTAINED");
    expect(body.realExternalExecuted).toBe(false);
    expect(body.events).toContain("ExternalWriteDenied");
    expect(body.events).toContain("PaymentStateUpdated");
    expect(body.simulations.some((row: string) => /Payment simulated/i.test(row))).toBe(
      true,
    );

    const persisted = listUnifiedAuditEntries({ ownerId: user.id });
    expect(
      persisted.some((entry) => entry.type === "synthetic.security.external_write_denied"),
    ).toBe(true);
  });

  it("denies an unauthorized agent through the Atlas HTTP path", async () => {
    const res = await run({
      tenantId: "TEST-CRM-001",
      scenarioId: "atlas-self-test-unauthorized",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().verdict).toBe("DENIED");
  });

  it("does not convert injected failures into VERIFIED", async () => {
    const ids = [
      "TEST-001",
      "TEST-002",
      "TEST-003",
      "TEST-004",
      "TEST-005",
      "TEST-006",
      "TEST-007",
      "TEST-008",
      "TEST-009",
      "TEST-010",
    ] as const;
    for (const id of ids) {
      const res = await run({
        tenantId: `TEST-REALTY-${id.slice(-3)}`,
        scenarioId: `failure-${id}`,
      });
      expect(res.statusCode).toBe(200);
      expect(["INJECTED_FAILURE_DETECTED", "DENIED", "CONTAINED"]).toContain(
        res.json().verdict,
      );
      expect(res.json().verdict).not.toBe("VERIFIED");
    }
  });
});

describe("POST /api/v1/synthetic/scenarios/closed-loop", () => {
  let app: FastifyInstance;
  let dir: string;
  const user = signedInUser();

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "atlas-synthetic-loop-"));
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    getRequestUser.mockReset();
    getRequestUser.mockResolvedValue(user);
    app = await buildRouteTestApp(registerSyntheticUniverseRoutes);
  });

  afterEach(async () => {
    await app.close();
    setAuditLogPathForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  async function closedLoop(payload: { tenantId: string; scenarioId: string }) {
    return app.inject({
      method: "POST",
      url: SYNTHETIC_SCENARIO_CLOSED_LOOP_PATH,
      payload,
    });
  }

  it("rejects unauthenticated callers and production tenants", async () => {
    getRequestUser.mockResolvedValue(null);
    expect(
      (
        await closedLoop({
          tenantId: "TEST-REALTY-001",
          scenarioId: "real-estate-deal-incomplete-payment",
        })
      ).statusCode,
    ).toBe(401);

    getRequestUser.mockResolvedValue(user);
    const prod = await closedLoop({
      tenantId: "prod",
      scenarioId: "real-estate-deal-incomplete-payment",
    });
    expect(prod.statusCode).toBe(400);
  });

  it("detects incomplete payment, persists governance, and verifies recovery", async () => {
    const res = await closedLoop({
      tenantId: "TEST-REALTY-LOOP",
      scenarioId: "real-estate-deal-incomplete-payment",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.loopVerdict).toBe("RECOVERED");
    expect(body.diagnosis.detected).toBe(true);
    expect(body.diagnosis.failureClass).toBe("MISSING_PROCESS_TRANSITION");
    expect(body.plan.remediatingScenarioId).toBe("real-estate-deal-completion");
    expect(body.governance.decision).toBe("ALLOW");
    expect(body.governance.path).toBe("synthetic.authorizeEntityAction");
    expect(body.failure.verdict).toBe("PROCESS_FAILURE");
    expect(body.recovery.recovered).toBe(true);
    expect(body.recovery.verdict).toBe("VERIFIED");
    expect(body.realExternalExecuted).toBe(false);
    expect(body.governanceDecisionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const persisted = listUnifiedAuditEntries({ ownerId: user.id });
    expect(persisted.some((entry) => entry.type === "synthetic.closed_loop")).toBe(true);
    const decisions = listGovernanceDecisions();
    expect(decisions.some((row) => row.id === body.governanceDecisionId)).toBe(true);
    expect(
      decisions.some((row) => row.operation === "synthetic.closed_loop.remediate"),
    ).toBe(true);
  });

  it("returns ALREADY_VERIFIED when the healthy process needs no repair", async () => {
    const res = await closedLoop({
      tenantId: "TEST-REALTY-001",
      scenarioId: "real-estate-deal-completion",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().loopVerdict).toBe("ALREADY_VERIFIED");
    expect(res.json().recovery.recovered).toBe(true);
    expect(res.json().plan).toBeNull();
  });
});
