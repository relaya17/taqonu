import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ATLAS_SELF_APPLICATION_ID,
  ATLAS_SELF_PROJECT_ID,
  ATLAS_SELF_TENANT_ID,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-gov-knowledge-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const {
  retrieveGovernedKnowledge,
  resolveAtlasSurfaceKnowledgeScope,
} = await import("./governed-knowledge-retrieval.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("./project-access.js");

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "replace-me",
};

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("governed knowledge retrieval", () => {
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
