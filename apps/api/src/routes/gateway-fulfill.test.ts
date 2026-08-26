import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";
import { registerTool, resetToolRegistryForTests } from "@atlas/agent-core";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-gw-fulfill-route-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_REPO_ROOT = tmpDir;

const getRequestUser = vi.fn();

vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerGatewayFulfillRoutes } = await import("./gateway-fulfill.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

let app: FastifyInstance;

function ownerUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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
  app = await buildRouteTestApp(registerGatewayFulfillRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  resetToolRegistryForTests();
});

describe("POST /api/v1/gateway/fulfill", () => {
  it("401s when unauthenticated", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a customer admin — operator/owner only", async () => {
    getRequestUser.mockReturnValue(ownerUser({ role: "admin" }));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("runs executeGovernedAction for an operator when the catalog tool is registered", async () => {
    getRequestUser.mockReturnValue(ownerUser());
    registerTool({
      name: "analyze_repo",
      run: async () => "ok",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executed: boolean;
      verified: boolean;
      toolName: string;
      outcome: { status: string };
    };
    expect(body.toolName).toBe("analyze_repo");
    expect(body.executed).toBe(true);
    expect(body.verified).toBe(false);
    expect(body.outcome.status).toBe("EXECUTED");
    expect(body.principalId).toBe(ownerUser().id);
  });

  it("ignores a forged sessionOwnerId in the body", async () => {
    getRequestUser.mockReturnValue(ownerUser());
    registerTool({
      name: "analyze_repo",
      run: async () => "ok",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
        sessionOwnerId: "99999999-9999-4999-8999-999999999999",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { principalId: string };
    expect(body.principalId).toBe(ownerUser().id);
    expect(body.principalId).not.toBe("99999999-9999-4999-8999-999999999999");
  });
});
