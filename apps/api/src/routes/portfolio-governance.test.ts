import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { FABRIC_AGENT_IDS, type AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-portfolio-gov-route-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_PORTFOLIO_GOVERNANCE_PATH = join(tmpDir, "overlay.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerPortfolioGovernanceRoutes } = await import("./portfolio-governance.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { resetPortfolioOverlayForTests } = await import(
  "../services/portfolio-governance-store.js"
);

let app: FastifyInstance;

function ownerUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "owner@example.com",
    displayName: "Owner",
    role: "owner",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerPortfolioGovernanceRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(ownerUser());
  resetPortfolioOverlayForTests();
});

describe("GET /api/v1/portfolio-governance", () => {
  it("requires operator or owner", async () => {
    getRequestUser.mockReturnValue(null);
    const unauth = await app.inject({ method: "GET", url: "/api/v1/portfolio-governance" });
    expect(unauth.statusCode).toBe(401);

    getRequestUser.mockReturnValue(ownerUser({ role: "admin" }));
    const tenantAdmin = await app.inject({
      method: "GET",
      url: "/api/v1/portfolio-governance",
    });
    expect(tenantAdmin.statusCode).toBe(403);

    getRequestUser.mockReturnValue(ownerUser({ role: "operator" }));
    const operator = await app.inject({
      method: "GET",
      url: "/api/v1/portfolio-governance",
    });
    expect(operator.statusCode).toBe(200);
  });

  it("returns observational inventory without ingest or fabric mutation", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/portfolio-governance" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      notAnAgentRegistry: boolean;
      observational: boolean;
      snapshot: {
        sourceAgents: Array<{
          runtimeStatus: { state: string; probeKind: string; probedAt: string | null };
          atlasPromotionBlocked: boolean;
          provenance: { sourceCommit: string };
        }>;
        sourcePermissions: Array<{ atlasInheritance: string }>;
      };
      summary: {
        ingestEnabled: boolean;
        fabricCatalogMutated: boolean;
        knowledgeIngested: boolean;
        executionRegistry: string;
        allSourceRuntimesUnknown: boolean;
        sourceWriteNeverInherited: boolean;
      };
      governance: {
        ingestEnabled: boolean;
        sourceExecutionEnabled: boolean;
      };
    };
    expect(body.notAnAgentRegistry).toBe(true);
    expect(body.observational).toBe(true);
    expect(body.summary.executionRegistry).toBe("FABRIC_AGENT_CATALOG");
    expect(body.summary.ingestEnabled).toBe(false);
    expect(body.summary.fabricCatalogMutated).toBe(false);
    expect(body.summary.knowledgeIngested).toBe(false);
    expect(body.summary.allSourceRuntimesUnknown).toBe(true);
    expect(body.summary.sourceWriteNeverInherited).toBe(true);
    expect(body.governance.sourceExecutionEnabled).toBe(false);
    expect(body.snapshot.sourceAgents.length).toBeGreaterThan(0);
    expect(
      body.snapshot.sourceAgents.every(
        (a) =>
          a.runtimeStatus.state === "UNKNOWN" &&
          a.runtimeStatus.probeKind === "NONE" &&
          a.runtimeStatus.probedAt === null &&
          a.atlasPromotionBlocked === true &&
          /^[0-9a-f]{40}$/i.test(a.provenance.sourceCommit),
      ),
    ).toBe(true);
    expect(body.snapshot.sourcePermissions.every((p) => p.atlasInheritance === "NONE")).toBe(true);
  });
});

describe("POST /api/v1/portfolio-governance/decisions", () => {
  it("rejects operator — decisions are owner-controlled", async () => {
    getRequestUser.mockReturnValue(ownerUser({ role: "operator" }));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/portfolio-governance/decisions",
      payload: {
        action: "KEEP_SOURCE_SPECIFIC",
        verdict: "APPROVED",
        rationale: "Operator must not record portfolio decisions",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("records CREATE_NEW as pending fabric change without mutating FABRIC_AGENT_CATALOG", async () => {
    const snapRes = await app.inject({ method: "GET", url: "/api/v1/portfolio-governance" });
    const sourceAgentId = (
      snapRes.json() as { snapshot: { sourceAgents: Array<{ id: string }> } }
    ).snapshot.sourceAgents[0]?.id;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/portfolio-governance/decisions",
      payload: {
        action: "CREATE_NEW_ATLAS_SPECIALIST",
        verdict: "APPROVED",
        rationale: "Owner intent only — requires a separate catalog code change",
        sourceAgentId,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      decision: {
        status: string;
        fabricCatalogMutated: boolean;
        knowledgeIngested: boolean;
      };
      governance: { ingestExecuted: boolean };
    };
    expect(body.decision.status).toBe("APPROVED_PENDING_FABRIC_CHANGE");
    expect(body.decision.fabricCatalogMutated).toBe(false);
    expect(body.decision.knowledgeIngested).toBe(false);
    expect(body.governance.ingestExecuted).toBe(false);
    expect(FABRIC_AGENT_IDS).toHaveLength(16);
  });

  it("does not expose ingest, probe, or promote endpoints", async () => {
    for (const url of [
      "/api/v1/portfolio-governance/ingest",
      "/api/v1/portfolio-governance/probe",
      "/api/v1/portfolio-governance/promote",
    ]) {
      const res = await app.inject({ method: "POST", url, payload: {} });
      expect(res.statusCode).toBe(404);
    }
  });
});
