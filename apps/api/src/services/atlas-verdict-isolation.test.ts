import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  parseEvidenceRecord,
  SYSTEM_OWNER_ID,
  type AuthUser,
  type ProjectStateSnapshot,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-verdict-isolation-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerCommercialValidationRoutes } = await import(
  "../routes/commercial.js"
);
const { registerSystemRoutes } = await import("../routes/systems.js");
const { buildRouteTestApp } = await import(
  "../routes/test-helpers/build-route-test-app.js"
);
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("./project-access.js");
const { buildAtlasVerdict, buildExecutiveReport } = await import(
  "./atlas-verdict.js"
);
const { runPartnerAuditSpine } = await import("./partner-audit-spine.js");

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";

function signedInUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: OWNER_A,
    email: "owner-a@example.com",
    displayName: "Owner A",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const ownerA = signedInUser();
const ownerB = signedInUser({
  id: OWNER_B,
  email: "owner-b@example.com",
  displayName: "Owner B",
});
const adminUser = signedInUser({
  id: ADMIN_ID,
  email: "admin@example.com",
  displayName: "Admin",
  role: "admin",
});

function addProject(id: string, slug: string, ownerId: string) {
  const now = new Date().toISOString();
  osStore.upsertProject({
    id,
    slug,
    name: slug,
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  bindProjectOwner(id, ownerId, "bound_on_create");
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

let app: FastifyInstance;
let projectA = "";
let projectB = "";

beforeAll(async () => {
  app = await buildRouteTestApp(
    async (instance) => {
      await registerCommercialValidationRoutes(instance);
      await registerSystemRoutes(instance);
    },
    { SUPABASE_SERVICE_ROLE_KEY: "replace-me" },
  );
});

afterAll(async () => {
  if (app) await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  osStore.resetInMemoryForTests();
  projectA = crypto.randomUUID();
  projectB = crypto.randomUUID();
  addProject(projectA, `iso-a-${projectA.slice(0, 8)}`, OWNER_A);
  addProject(projectB, `iso-b-${projectB.slice(0, 8)}`, OWNER_B);
});

afterEach(() => {
  getRequestUser.mockReset();
});

describe("Verdict Evidence isolation (production path)", () => {
  it("does not count another principal's Evidence on a foreign project", () => {
    osStore.addEvidence(projectA, [
      evidenceRow(OWNER_A, projectA, "authorized-a"),
    ]);
    osStore.addEvidence(projectB, [
      evidenceRow(OWNER_B, projectB, "authorized-b"),
    ]);
    osStore.addEvidence(projectA, [
      evidenceRow(OWNER_B, projectA, "planted-by-b-on-a"),
    ]);

    const verdictA = buildAtlasVerdict({ projectId: projectA });
    expect(verdictA.evidenceCount).toBe(1);
    expect(verdictA.plainLanguageSummary).toContain(
      "Evidence records in store: 1",
    );
    expect(verdictA.plainLanguageSummary).not.toContain("planted-by-b-on-a");

    const verdictB = buildAtlasVerdict({ projectId: projectB });
    expect(verdictB.evidenceCount).toBe(1);
  });

  it("still counts the project owner's Evidence and SYSTEM Evidence", () => {
    osStore.addEvidence(projectA, [
      evidenceRow(OWNER_A, projectA, "owner-row"),
      evidenceRow(SYSTEM_OWNER_ID, projectA, "system-row"),
    ]);
    const verdict = buildAtlasVerdict({ projectId: projectA });
    expect(verdict.evidenceCount).toBe(2);
  });

  it("empty Evidence remains Evidence records in store: 0", () => {
    const verdict = buildAtlasVerdict({ projectId: projectA });
    expect(verdict.evidenceCount).toBe(0);
    expect(verdict.plainLanguageSummary).toContain(
      "Evidence records in store: 0",
    );
    const report = buildExecutiveReport({
      projectId: projectA,
      locale: "en",
      systemId: null,
    });
    expect(report.markdown).toContain("Evidence records in store: 0");
  });

  it("Run Audit does not create EvidenceRecords", () => {
    const before = osStore.getEvidence(projectA).length;
    runPartnerAuditSpine({
      projectId: projectA,
      issueCertificate: true,
    });
    expect(osStore.getEvidence(projectA)).toHaveLength(before);
    expect(osStore.getEvidence(projectA)).toHaveLength(0);
  });

  it("open conflicts keep verdict CONDITIONAL — never READY / PASS", () => {
    const now = new Date().toISOString();
    const snapshot: ProjectStateSnapshot = {
      id: crypto.randomUUID(),
      projectId: projectA,
      asOf: now,
      reconciledAt: now,
      slices: [],
      conflicts: [
        {
          id: crypto.randomUUID(),
          sliceKey: "DATABASE",
          claimAId: crypto.randomUUID(),
          claimBId: crypto.randomUUID(),
          resolution: null,
          epistemicState: "CONFLICTED",
          detectedAt: now,
        },
      ],
      overallEpistemicState: "CONFLICTED",
      sourceConnectors: [],
    };
    osStore.setSnapshot(snapshot);
    const verdict = buildAtlasVerdict({ projectId: projectA });
    expect(verdict.conflictCount).toBe(1);
    expect(verdict.status).not.toBe("READY");
  });
});

describe("GET verdict / executive-report authorization", () => {
  it("owner B cannot read owner A's verdict or executive report", async () => {
    osStore.addEvidence(projectA, [
      evidenceRow(OWNER_A, projectA, "secret-a-excerpt"),
    ]);
    getRequestUser.mockReturnValue(ownerB);
    const verdict = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectA}/verdict`,
    });
    expect(verdict.statusCode).toBe(403);
    expect(verdict.body).not.toContain("secret-a-excerpt");

    const report = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectA}/executive-report`,
    });
    expect(report.statusCode).toBe(403);
    expect(report.body).not.toContain("secret-a-excerpt");
  });

  it("owner A reads their own verdict with authorized Evidence counted", async () => {
    osStore.addEvidence(projectA, [
      evidenceRow(OWNER_A, projectA, "owner-a-row"),
      evidenceRow(OWNER_B, projectA, "planted-by-b"),
    ]);
    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectA}/verdict`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().evidenceCount).toBe(1);
    expect(res.body).not.toContain("planted-by-b");
  });

  it("admin can read another project's verdict without counting foreign-owner plants", async () => {
    osStore.addEvidence(projectB, [
      evidenceRow(OWNER_B, projectB, "owner-b-row"),
      evidenceRow(OWNER_A, projectB, "planted-by-a"),
    ]);
    getRequestUser.mockReturnValue(adminUser);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectB}/verdict`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().evidenceCount).toBe(1);
  });

  it("owner B cannot read owner A's system executive-report", async () => {
    getRequestUser.mockReturnValue(ownerA);
    const list = await app.inject({ method: "GET", url: "/api/v1/systems" });
    expect(list.statusCode).toBe(200);
    const systemId = list
      .json()
      .items.find((item: { projectId: string | null }) => item.projectId === projectA)
      ?.id as string;
    expect(systemId).toBeTruthy();

    getRequestUser.mockReturnValue(ownerB);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/systems/${systemId}/executive-report`,
    });
    expect(res.statusCode).toBe(403);
  });
});
