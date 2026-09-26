import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

/**
 * Stage 4 (approved 2026-09-26, contract D-B) — `POST /api/v1/agents/tool-execute`
 * is reachable only by a signed-in human session. A caller-selected
 * `fabricAgentId` is a REQUESTED TARGET, never an authenticated actor, and no
 * trusted runtime agent identity exists on this route. The route therefore
 * fails closed: no AuthenticatedAgentIdentity is built from caller input and
 * no tool runs. The denial is audited with the real actor (USER) and the
 * requested target.
 *
 * History: before Stage 4 this suite proved (P0.7) that the route reached
 * `executeGovernedAction` with a session-derived owner. That gate is still
 * covered end to end by `governed-execution.test.ts` and, for trusted runtime
 * callers (operator session / Control Plane service), by
 * `gateway-fulfill.test.ts`.
 */

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-agent-tool-execute-test-"));
const projectRoot = join(tmpDir, "repo");
mkdirSync(join(projectRoot, "src"), { recursive: true });

const FIXTURE = "export const answer = 42;\n";
const OTHER = "export const other = 1;\n";
writeFileSync(join(projectRoot, "src", "index.ts"), FIXTURE, "utf8");
writeFileSync(join(projectRoot, "src", "other.ts"), OTHER, "utf8");

process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
// The route derives `projectRoot` from `findRepoRoot()` for an unscoped
// request (services/repo-root.ts), which honours ATLAS_REPO_ROOT — the same
// seam `observe-system-facets.test.ts` uses to point the server at a fixture
// repo instead of the real monorepo.
process.env.ATLAS_REPO_ROOT = projectRoot;

// Same stubbing mechanism as `agent-fabric.test.ts`: mock `getRequestUser` so
// `requireSignedInForWrite` sees a fake signed-in user (or nobody, for the
// 401 test) without a real cookie/session fixture.
const getRequestUser = vi.fn();

vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerAgentFabricRoutes } = await import("./agent-fabric.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { setAuditLogPathForTests, listUnifiedAuditEntries, verifyAuditChain } =
  await import("../services/audit-log.js");
const { registerFilesystemTools, resetToolRegistryForTests } = await import(
  "@atlas/agent-core"
);

let app: FastifyInstance;

const OWNER_A: AuthUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "owner-a@example.com",
  displayName: "Owner A",
  role: "user",
  locale: "en",
  provider: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
};

/**
 * DOCUMENT.READ is the entity/action pair the gate's own suite uses for its
 * executing path: read-only, no approval manufactured by the Policy/Risk
 * stage, so the interesting variable in each test below stays the one thing
 * that test is about.
 */
function body(overrides: Record<string, unknown> = {}) {
  return {
    fabricAgentId: "RESEARCHER",
    toolName: "fs.read_file",
    toolArgs: { path: "src/index.ts" },
    artifact: FIXTURE,
    entityType: "DOCUMENT",
    action: "READ",
    ...overrides,
  };
}

beforeAll(async () => {
  // Real audit chain, isolated to this tmpdir — the gate audits every
  // outcome including refusals, and a route test that skipped the log would
  // not notice the trail going missing.
  delete process.env.ATLAS_SKIP_AUDIT_LOG;
  setAuditLogPathForTests(join(tmpDir, "audit.ndjson"));
  resetToolRegistryForTests();
  registerFilesystemTools();
  app = await buildRouteTestApp(registerAgentFabricRoutes);
});

afterAll(async () => {
  await app.close();
  setAuditLogPathForTests(null);
  resetToolRegistryForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(OWNER_A);
});

const OPERATOR: AuthUser = { ...OWNER_A, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", role: "operator" };

function toolExecuteEntries() {
  return listUnifiedAuditEntries().filter((e) => e.type === "agents.tool-execute");
}

describe("POST /api/v1/agents/tool-execute (Stage 4 fail-closed identity)", () => {
  it("401s for an unauthenticated caller — no session, no agent identity", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      payload: body(),
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s a caller-selected catalog agent: the id is a requested target, not an actor, and no tool runs", async () => {
    const before = toolExecuteEntries().length;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      payload: body(),
    });
    expect(res.statusCode).toBe(403);
    const json = res.json();
    expect(json.stage).toBe("IDENTITY");
    expect(json.status).toBe("DENIED");
    expect(json.error.message).toMatch(/requested target, not an authenticated actor/);
    expect(JSON.stringify(json)).not.toContain("export const answer = 42;");

    const entries = toolExecuteEntries();
    expect(entries.length).toBe(before + 1);
    const denial = entries.at(-1);
    expect(denial?.decision).toBe("DENY");
    expect(denial?.result).toBe("FAILURE");
    expect(denial?.actorKind).toBe("USER");
    expect(denial?.actorId).toBe(OWNER_A.id);
    expect(denial?.agentId).toBeNull();
    expect(denial?.input.requestedTargetAgentId).toBe("RESEARCHER");
    expect(entries.some((e) => e.result === "SUCCESS")).toBe(false);
    expect(verifyAuditChain().intact).toBe(true);
  });

  it("403s every requested agent id the same way (known, unknown, PSA-shaped, empty)", async () => {
    for (const fabricAgentId of ["CODE_ENGINEER", "NOT_A_REAL_AGENT", `psa:${OWNER_A.id}`, ""]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/agents/tool-execute",
        payload: body({ fabricAgentId }),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().stage).toBe("IDENTITY");
    }
  });

  it("a self-asserted agent header does not grant authority", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      headers: { "x-atlas-actor-kind": "AGENT", "x-atlas-agent-id": "RESEARCHER" },
      payload: body(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().stage).toBe("IDENTITY");
  });

  it("an operator session is still a human, not an agent: denied", async () => {
    getRequestUser.mockReturnValue(OPERATOR);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      payload: body(),
    });
    expect(res.statusCode).toBe(403);
    expect(toolExecuteEntries().at(-1)?.actorId).toBe(OPERATOR.id);
  });

  it("400s when the body tries to supply its own owner — ownerId is not an accepted field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      payload: body({ ownerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    });
    expect(res.statusCode).toBe(400);
  });
});
