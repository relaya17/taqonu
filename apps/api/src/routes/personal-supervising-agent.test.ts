import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  PERSONAL_SUPERVISING_AGENT_PATH,
  type AuthUser,
} from "@atlas/shared";
import { resetPersonalSupervisingAgentForTests } from "../services/psa-test-store.js";
import { resetApprovalsForTests } from "../services/approvals-test-store.js";
import { setAuditLogPathForTests } from "../services/audit-log.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerPersonalSupervisingAgentRoutes } = await import(
  "./personal-supervising-agent.js"
);
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

const OWNER_A: AuthUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "owner-a@example.com",
  displayName: "Owner A",
  role: "user",
  locale: "en",
  provider: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const OWNER_B: AuthUser = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  email: "owner-b@example.com",
  displayName: "Owner B",
  role: "user",
  locale: "en",
  provider: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("Personal Supervising Agent routes", () => {
  let app: FastifyInstance;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "atlas-psa-route-"));
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetApprovalsForTests();
    resetPersonalSupervisingAgentForTests();
    getRequestUser.mockReset();
    getRequestUser.mockResolvedValue(OWNER_A);
    app = await buildRouteTestApp(registerPersonalSupervisingAgentRoutes);
  });

  afterEach(async () => {
    await app.close();
    setAuditLogPathForTests(null);
    resetApprovalsForTests();
    resetPersonalSupervisingAgentForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects unauthenticated callers", async () => {
    getRequestUser.mockResolvedValue(null);
    const res = await app.inject({
      method: "GET",
      url: PERSONAL_SUPERVISING_AGENT_PATH,
    });
    expect(res.statusCode).toBe(401);
  });

  it("initializes for the session owner and isolates the other owner", async () => {
    const created = await app.inject({
      method: "POST",
      url: PERSONAL_SUPERVISING_AGENT_PATH,
      payload: {
        tenantId: "tenant-alpha",
        projectIds: ["project-alpha"],
        applicationIds: ["civio"],
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().scope.ownerId).toBe(OWNER_A.id);
    expect(created.json().agentId).toBe(`psa:${OWNER_A.id}`);

    getRequestUser.mockResolvedValue(OWNER_B);
    const other = await app.inject({
      method: "GET",
      url: PERSONAL_SUPERVISING_AGENT_PATH,
    });
    expect(other.statusCode).toBe(404);
  });

  it("does not let a disabled agent coordinate specialists", async () => {
    await app.inject({
      method: "POST",
      url: PERSONAL_SUPERVISING_AGENT_PATH,
      payload: {
        tenantId: "tenant-alpha",
        projectIds: ["project-alpha"],
        applicationIds: ["civio"],
      },
    });
    await app.inject({
      method: "POST",
      url: `${PERSONAL_SUPERVISING_AGENT_PATH}/lifecycle`,
      payload: { status: "DISABLED" },
    });
    const res = await app.inject({
      method: "POST",
      url: `${PERSONAL_SUPERVISING_AGENT_PATH}/coordinate`,
      payload: { request: "plan research", agentIds: ["RESEARCHER"] },
    });
    expect(res.statusCode).toBe(403);
  });
});
