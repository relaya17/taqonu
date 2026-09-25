import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ATLAS_SELF_APPLICATION_ID,
  ATLAS_SELF_PROJECT_ID,
  ATLAS_SELF_TENANT_ID,
  governanceProfileForAgentId,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-gov-knowledge-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
delete process.env.ATLAS_SKIP_AUDIT_LOG;

const {
  retrieveGovernedKnowledge,
  resolveAtlasSurfaceKnowledgeScope,
  searchEligibleKnowledge,
} = await import("./governed-knowledge-retrieval.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("./project-access.js");
const { listUnifiedAuditEntries, setAuditLogPathForTests, verifyAuditLogChain } =
  await import("./audit-log.js");

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "replace-me",
};

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("governed knowledge retrieval", () => {
  beforeEach(() => {
    setAuditLogPathForTests(join(tmpDir, `audit-${Date.now()}-${Math.random()}.ndjson`));
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
  });

  it("fails closed when session owner does not match requested owner scope", async () => {
    const result = await retrieveGovernedKnowledge({
      env,
      sessionOwnerId: OWNER,
      scope: {
        ownerId: OTHER,
        tenantId: "tenant-test",
        projectId: "22222222-2222-4222-8222-222222222222",
        applicationId: "app-test",
        requestingAgentId: "RESEARCHER",
      },
      query: "webhook idempotency",
      requestId: "req-1",
      routeLabel: "knowledge.search",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/owner scope/);
    }
    expect(
      listUnifiedAuditEntries().some((entry) => entry.type === "knowledge.retrieved"),
    ).toBe(false);
  });

  it("attributes incomplete-scope retrieval audits from the supplied scope", async () => {
    const result = await retrieveGovernedKnowledge({
      env,
      sessionOwnerId: OWNER,
      scope: {
        ownerId: OWNER,
        tenantId: "tenant-test",
        projectId: PROJECT,
        applicationId: "",
        requestingAgentId: "RESEARCHER",
      },
      query: "webhook idempotency",
      requestId: "req-incomplete",
      routeLabel: "knowledge.search",
    });
    expect(result.ok).toBe(false);
    const entry = listUnifiedAuditEntries().find((row) => row.type === "knowledge.retrieved");
    expect(entry?.tenantId).toBe("tenant-test");
    expect(entry?.projectId).toBe(PROJECT);
    expect(entry?.agentId).toBe("RESEARCHER");
    expect(entry?.ownerId).toBe(OWNER);
    expect(entry?.agentId).not.toBe(entry?.ownerId);
    expect(verifyAuditLogChain().ok).toBe(true);
  });

  it("does not fabricate tenant or project when retrieval scope is missing", async () => {
    await searchEligibleKnowledge({
      env,
      query: "no scope",
      scope: null,
    });
    const entry = listUnifiedAuditEntries().find((row) => row.type === "knowledge.retrieved");
    expect(entry).toBeDefined();
    expect(entry?.tenantId == null || entry.tenantId === "").toBe(true);
    expect(entry?.projectId == null || entry.projectId === "").toBe(true);
  });

  it("denies governed professional-knowledge retrieval for a personal-only Control identity", async () => {
    const requestingAgentId = `psa:${OWNER}`;
    const profile = governanceProfileForAgentId(requestingAgentId);
    expect(profile?.personalScope).toBe(true);
    expect(profile?.professionalScope).toBe(false);
    expect(profile?.memory.canReadProfessionalKnowledge).toBe(false);

    const result = await retrieveGovernedKnowledge({
      env,
      sessionOwnerId: OWNER,
      scope: {
        ownerId: OWNER,
        tenantId: "tenant-test",
        projectId: PROJECT,
        applicationId: "app-test",
        requestingAgentId,
      },
      query: "webhook idempotency",
      requestId: "req-psa-knowledge-deny",
      routeLabel: "knowledge.search",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("CONTROL_PROFILE_DENIES_PROFESSIONAL_KNOWLEDGE");
      expect(result.stage).toBe("AUTHORIZATION");
    }
  });
});

describe("resolveAtlasSurfaceKnowledgeScope", () => {
  it("binds Atlas-self tenant/application/project from the session, not the body", () => {
    const scope = resolveAtlasSurfaceKnowledgeScope({
      sessionOwnerId: OWNER,
    });
    expect(scope).toEqual({
      ownerId: OWNER,
      tenantId: ATLAS_SELF_TENANT_ID,
      projectId: ATLAS_SELF_PROJECT_ID,
      applicationId: ATLAS_SELF_APPLICATION_ID,
      requestingAgentId: "RESEARCHER",
    });
  });

  it("fails closed when the requested project does not exist", () => {
    expect(
      resolveAtlasSurfaceKnowledgeScope({
        sessionOwnerId: OWNER,
        requestedProjectId: PROJECT,
      }),
    ).toBeNull();
  });

  it("fails closed when the requested project is owned by someone else", () => {
    const now = new Date().toISOString();
    osStore.ensureLoaded();
    osStore.upsertProject({
      id: PROJECT,
      slug: "knowledge-scope-foreign",
      name: "Foreign Project",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    bindProjectOwner(PROJECT, OTHER, "bound_on_create");
    expect(
      resolveAtlasSurfaceKnowledgeScope({
        sessionOwnerId: OWNER,
        requestedProjectId: PROJECT,
      }),
    ).toBeNull();
  });

  it("uses an owned project id when the session matches the bound owner", () => {
    bindProjectOwner(PROJECT, OWNER, "claimed");
    expect(
      resolveAtlasSurfaceKnowledgeScope({
        sessionOwnerId: OWNER,
        requestedProjectId: PROJECT,
      }),
    ).toEqual({
      ownerId: OWNER,
      tenantId: ATLAS_SELF_TENANT_ID,
      projectId: PROJECT,
      applicationId: ATLAS_SELF_APPLICATION_ID,
      requestingAgentId: "RESEARCHER",
    });
  });
});
