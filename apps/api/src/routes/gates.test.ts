import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import {
  parseEvidenceRecord,
  qualityGateGraphSchema,
  type AuthUser,
  type Claim,
  type ProjectStateSnapshot,
} from "@atlas/shared";
import { errorHandler } from "../middleware/error-handler.js";
import { registerAtlasSessionGate } from "../middleware/atlas-session-gate.js";

/**
 * USER-plane Gates contract:
 * - GET/evaluate portfolio = caller-readable projects only
 * - GET/evaluate ?projectId=X requires read access
 * - null-key persisted graphs are never served as a portfolio
 */

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-gates-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
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

const authorizeEntityAction = vi.fn();

vi.mock("@atlas/agent-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/agent-core")>();
  return {
    ...actual,
    authorizeEntityAction: (
      ...args: Parameters<typeof actual.authorizeEntityAction>
    ) => authorizeEntityAction(...args) ?? actual.authorizeEntityAction(...args),
  };
});

const { registerGateRoutes } = await import("./gates.js");
const { buildRouteTestApp, buildTestEnv } = await import(
  "./test-helpers/build-route-test-app.js"
);
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");

const OWNER_A = "44444444-4444-4444-8444-444444444444";
const OWNER_B = "55555555-5555-4555-8555-555555555555";
const ADMIN_ID = "66666666-6666-4666-8666-666666666666";
const OPERATOR_ID = "77777777-7777-4777-8777-777777777777";

let app: FastifyInstance;

function testUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: OWNER_A,
    email: "release-ops@example.com",
    displayName: "Release Ops",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const ownerA = testUser();
const ownerB = testUser({
  id: OWNER_B,
  email: "owner-b@example.com",
  displayName: "Owner B",
});
const adminUser = testUser({
  id: ADMIN_ID,
  email: "admin@example.com",
  displayName: "Admin",
  role: "admin",
});
const operatorUser = testUser({
  id: OPERATOR_ID,
  email: "operator@example.com",
  displayName: "Operator",
  role: "operator",
});

function makeProject(owner: AuthUser): string {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  osStore.upsertProject({
    id,
    slug: `proj-${id.slice(0, 8)}`,
    name: `Project ${id.slice(0, 8)}`,
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  bindProjectOwner(id, owner.id, "bound_on_create");
  return id;
}

function evidenceRow(ownerId: string, projectId: string, excerpt: string) {
  const now = new Date().toISOString();
  return parseEvidenceRecord({
    id: crypto.randomUUID(),
    ownerId,
    projectId,
    source: "unit-test",
    sourceType: "USER",
    sourceId: null,
    uri: null,
    excerpt,
    version: null,
    observedAt: now,
    createdAt: now,
    confidence: 1,
    epistemicState: "FACT",
    classification: "INTERNAL",
    authorityRank: "REPOSITORY_CODE",
    category: "CODE",
    metadata: {},
  });
}

function makeClaim(projectId: string, overrides: Partial<Claim> = {}): Claim {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ownerId: OWNER_A,
    projectId,
    statement: "The service uses PostgreSQL.",
    epistemicState: "OBSERVED",
    confidence: 0.8,
    evidenceIds: [],
    derivedFrom: [],
    source: null,
    authorityRank: "DEVELOPER_STATEMENT",
    verification: { inCode: false, hasTest: false, liveVerified: false },
    observedAt: null,
    verifiedAt: null,
    expiresAt: null,
    asOf: now,
    version: null,
    conflictingClaimIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedOpenConflict(projectId: string) {
  const claimA = makeClaim(projectId, { authorityRank: "LIVE_PRODUCTION" });
  const claimB = makeClaim(projectId, {
    authorityRank: "LLM_INFERENCE",
    statement: "The service uses MySQL.",
  });
  osStore.claims.set(projectId, [claimA, claimB]);
  const now = new Date().toISOString();
  const snapshot: ProjectStateSnapshot = {
    id: crypto.randomUUID(),
    projectId,
    asOf: now,
    reconciledAt: now,
    slices: [],
    conflicts: [
      {
        id: crypto.randomUUID(),
        sliceKey: "DATABASE",
        claimAId: claimA.id,
        claimBId: claimB.id,
        resolution: null,
        epistemicState: "CONFLICTED",
        detectedAt: now,
      },
    ],
    overallEpistemicState: "UNKNOWN",
    sourceConnectors: ["github"],
  };
  osStore.setSnapshot(snapshot);
}

function seedDangerousPatch(projectId: string) {
  const now = new Date().toISOString();
  osStore.upsertPatch({
    id: crypto.randomUUID(),
    projectId,
    title: "Dangerous patch",
    reason: "Would mutate production",
    mode: "fix",
    status: "AWAITING_APPROVAL",
    risk: "HIGH",
    baseCommit: null,
    targetBranch: null,
    filesChanged: [
      { path: "src/index.ts", action: "modify", summary: "high-risk change" },
    ],
    evidenceIds: [],
    claimIds: [],
    expectedImpact: "none",
    tests: [],
    evaluationSummary: null,
    approvals: [],
    appliedAt: null,
    verifiedAt: null,
    rollbackRef: null,
    rollbackSnapshot: [],
    createdAt: now,
    updatedAt: now,
    createdBy: "test",
    epistemicState: "PROPOSED",
    confidence: 0.5,
    authorityHint: "LLM_INFERENCE",
  });
}

function nodeOf(
  graph: { nodes: { id: string; status: string; blockerReason: string | null }[] },
  id: string,
) {
  const node = graph.nodes.find((n) => n.id === id);
  expect(node).toBeDefined();
  return node!;
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerGateRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  osStore.resetInMemoryForTests();
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(ownerA);
  authorizeEntityAction.mockReset();
  authorizeEntityAction.mockReturnValue(undefined);
});

describe("GET /api/v1/gates authentication", () => {
  it("401s for an unauthenticated caller (handler requireUser)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/gates" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/v1/gates under real session middleware", () => {
  let gated: FastifyInstance;

  beforeAll(async () => {
    gated = Fastify({ logger: false });
    gated.setErrorHandler(errorHandler);
    gated.decorate("atlasEnv", buildTestEnv());
    registerAtlasSessionGate(gated);
    await registerGateRoutes(gated);
    await gated.ready();
  });

  afterAll(async () => {
    await gated.close();
  });

  it("401s anonymous GET /api/v1/gates via registerAtlasSessionGate", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await gated.inject({ method: "GET", url: "/api/v1/gates" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toMatch(/Not signed in/i);
  });
});

describe("GET /api/v1/gates?projectId= authorization", () => {
  it("200s for the project owner", async () => {
    const projectId = makeProject(ownerA);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/gates?projectId=${projectId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().graph.projectId).toBe(projectId);
  });

  it("403s for a foreign owner", async () => {
    const projectId = makeProject(ownerA);
    getRequestUser.mockReturnValue(ownerB);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/gates?projectId=${projectId}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("404s when the project does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/gates?projectId=00000000-0000-4000-8000-000000000099",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("admin may read a foreign project (existing bypass)", async () => {
    const projectId = makeProject(ownerA);
    getRequestUser.mockReturnValue(adminUser);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/gates?projectId=${projectId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().graph.projectId).toBe(projectId);
  });

  it("Control-plane operator may read a foreign project (existing bypass)", async () => {
    const projectId = makeProject(ownerA);
    getRequestUser.mockReturnValue(operatorUser);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/gates?projectId=${projectId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().graph.projectId).toBe(projectId);
  });
});

describe("GET /api/v1/gates portfolio caller-readable scope", () => {
  it("includes caller-readable DAG inputs and excludes foreign project state", async () => {
    const projectA = makeProject(ownerA);
    const projectB = makeProject(ownerB);
    osStore.addEvidence(projectA, [
      evidenceRow(OWNER_A, projectA, "owner-a-evidence"),
    ]);
    osStore.addEvidence(projectB, [
      evidenceRow(OWNER_B, projectB, "owner-b-evidence"),
    ]);
    seedOpenConflict(projectB);
    seedDangerousPatch(projectB);

    getRequestUser.mockReturnValue(ownerA);
    const aRes = await app.inject({ method: "GET", url: "/api/v1/gates" });
    expect(aRes.statusCode).toBe(200);
    const aGraph = aRes.json().graph;
    expect(aGraph.projectId).toBeNull();
    expect(aGraph.name).toBe("Portfolio release gates");
    expect(nodeOf(aGraph, "evidence-present").status).toBe("PASS");
    expect(nodeOf(aGraph, "conflicts-resolved").status).toBe("PASS");
    expect(nodeOf(aGraph, "patches-approved").status).toBe("PASS");
    expect(aGraph.plainLanguageSummary).not.toMatch(/open conflict/i);
    expect(aGraph.plainLanguageSummary).not.toMatch(/HIGH\/CRITICAL patch/i);

    getRequestUser.mockReturnValue(ownerB);
    const bRes = await app.inject({ method: "GET", url: "/api/v1/gates" });
    expect(bRes.statusCode).toBe(200);
    const bGraph = bRes.json().graph;
    expect(nodeOf(bGraph, "evidence-present").status).toBe("PASS");
    expect(nodeOf(bGraph, "conflicts-resolved").status).toBe("BLOCKED");
    expect(nodeOf(bGraph, "conflicts-resolved").blockerReason).toMatch(
      /1 open conflict/,
    );
    expect(nodeOf(bGraph, "patches-approved").status).toBe("BLOCKED");
    expect(nodeOf(bGraph, "patches-approved").blockerReason).toMatch(
      /1 HIGH\/CRITICAL patch/,
    );

    getRequestUser.mockReturnValue(adminUser);
    const adminRes = await app.inject({ method: "GET", url: "/api/v1/gates" });
    expect(adminRes.statusCode).toBe(200);
    const adminGraph = adminRes.json().graph;
    expect(nodeOf(adminGraph, "evidence-present").status).toBe("PASS");
    expect(nodeOf(adminGraph, "conflicts-resolved").status).toBe("BLOCKED");
    expect(nodeOf(adminGraph, "patches-approved").status).toBe("BLOCKED");
  });
});

describe("POST /api/v1/gates/evaluate", () => {
  it("401s for an unauthenticated caller (no auth guard previously existed here)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s when the real authorizeEntityAction is engaged and denies the action", async () => {
    authorizeEntityAction.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(res.json().error.message).toMatch(/test-forced denial/);
  });

  it("200s for a signed-in caller and threads the real actor id into the gate.evaluated domain event", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().graph).toBeDefined();

    const events = osStore.listDomainEvents();
    const gateEvent = [...events].reverse().find((e) => e.type === "gate.evaluated");
    expect(gateEvent).toBeDefined();
    expect((gateEvent?.payload as { actorId?: string }).actorId).toBe(
      ownerA.id,
    );
  });

  it("portfolio {} uses the same caller-readable DAG scope as GET", async () => {
    const projectA = makeProject(ownerA);
    const projectB = makeProject(ownerB);
    osStore.addEvidence(projectA, [
      evidenceRow(OWNER_A, projectA, "owner-a-evidence"),
    ]);
    seedOpenConflict(projectB);
    seedDangerousPatch(projectB);

    getRequestUser.mockReturnValue(ownerA);
    const getRes = await app.inject({ method: "GET", url: "/api/v1/gates" });
    const evalRes = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: {},
    });
    expect(evalRes.statusCode).toBe(200);
    const getStatuses = Object.fromEntries(
      getRes.json().graph.nodes.map((n: { id: string; status: string }) => [
        n.id,
        n.status,
      ]),
    );
    const evalStatuses = Object.fromEntries(
      evalRes.json().graph.nodes.map((n: { id: string; status: string }) => [
        n.id,
        n.status,
      ]),
    );
    expect(evalStatuses).toEqual(getStatuses);
    expect(evalRes.json().graph.projectId).toBeNull();
    expect(nodeOf(evalRes.json().graph, "conflicts-resolved").status).toBe(
      "PASS",
    );
    expect(nodeOf(evalRes.json().graph, "patches-approved").status).toBe("PASS");
  });

  it("403s when evaluating a foreign projectId", async () => {
    const projectId = makeProject(ownerA);
    getRequestUser.mockReturnValue(ownerB);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: { projectId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200s when the owner evaluates their own projectId", async () => {
    const projectId = makeProject(ownerA);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: { projectId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().graph.projectId).toBe(projectId);
    expect(osStore.getGateGraph(projectId)?.id).toBe(res.json().graph.id);
  });

  it("404s when evaluating a missing projectId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: { projectId: "00000000-0000-4000-8000-000000000099" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("portfolio persistence is caller-safe", () => {
  it("does not persist a null-key graph, so one caller cannot become another's portfolio", async () => {
    const projectA = makeProject(ownerA);
    const projectB = makeProject(ownerB);
    osStore.addEvidence(projectA, [
      evidenceRow(OWNER_A, projectA, "owner-a-evidence"),
    ]);
    seedOpenConflict(projectB);

    const leftoverId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const now = new Date().toISOString();
    osStore.upsertGateGraph(
      qualityGateGraphSchema.parse({
        id: leftoverId,
        projectId: null,
        name: "LEAKED GLOBAL GRAPH",
        nodes: [
          {
            id: "secrets-clean",
            title: "leaked",
            status: "FAIL",
            blockerReason: "poisoned",
            evidenceIds: [],
            waivedBy: null,
            waivedReason: null,
            updatedAt: now,
          },
        ],
        edges: [],
        plainLanguageSummary: "poisoned shared null-key graph",
        evaluatedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );

    getRequestUser.mockReturnValue(ownerA);
    const aEval = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: {},
    });
    const aGet = await app.inject({ method: "GET", url: "/api/v1/gates" });
    expect(aEval.statusCode).toBe(200);
    expect(aGet.json().graph.name).toBe("Portfolio release gates");
    expect(aGet.json().graph.id).not.toBe(leftoverId);
    expect(aGet.json().graph.plainLanguageSummary).not.toMatch(/poisoned/);
    expect(nodeOf(aGet.json().graph, "evidence-present").status).toBe("PASS");
    expect(osStore.getGateGraph(null)?.id).toBe(leftoverId);

    getRequestUser.mockReturnValue(ownerB);
    const bEval = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: {},
    });
    const bGet = await app.inject({ method: "GET", url: "/api/v1/gates" });
    expect(bEval.statusCode).toBe(200);
    expect(bGet.json().graph.id).not.toBe(aEval.json().graph.id);
    expect(bGet.json().graph.id).not.toBe(leftoverId);
    expect(nodeOf(bGet.json().graph, "conflicts-resolved").status).toBe(
      "BLOCKED",
    );
    expect(osStore.getGateGraphById(aEval.json().graph.id)).toBeUndefined();
    expect(osStore.getGateGraphById(bEval.json().graph.id)).toBeUndefined();
    expect(osStore.getGateGraph(null)?.id).toBe(leftoverId);
  });
});

describe("POST /api/v1/gates/:graphId/waive", () => {
  it("401s for an unauthenticated caller (no auth guard previously existed here)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/00000000-0000-4000-8000-000000000000/waive",
      payload: { gateId: "secrets-clean", waivedBy: "ops", reason: "known false positive" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s when the real authorizeEntityAction is engaged and denies the action", async () => {
    authorizeEntityAction.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gates/00000000-0000-4000-8000-000000000000/waive",
      payload: { gateId: "secrets-clean", waivedBy: "ops", reason: "known false positive" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("waives a gate for a signed-in caller once a project-scoped graph exists", async () => {
    const projectId = makeProject(ownerA);
    const evaluate = await app.inject({
      method: "POST",
      url: "/api/v1/gates/evaluate",
      payload: { projectId },
    });
    expect(evaluate.statusCode).toBe(200);
    const graphId = evaluate.json().graph.id as string;

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/gates/${graphId}/waive`,
      payload: { gateId: "secrets-clean", waivedBy: "ops", reason: "known false positive" },
    });
    expect(res.statusCode).toBe(200);
    const waived = res.json().graph.nodes.find(
      (n: { id: string }) => n.id === "secrets-clean",
    );
    expect(waived.status).toBe("WAIVED");
  });
});
