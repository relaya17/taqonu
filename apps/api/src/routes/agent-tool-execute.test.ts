import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

/**
 * P0.7 — HTTP-level proof that `POST /api/v1/agents/tool-execute` is the
 * governed execution gate wearing a route, and not a second, looser one.
 *
 * `governed-execution.test.ts` already proves the gate itself refuses every
 * attack in the chain. What could not be proven until this route existed is
 * that a network caller reaches THAT function with a session-derived
 * identity — that the body cannot name its own owner, cannot name its own
 * sandbox root, and that each refusal stage lands on the status code a
 * client can act on. These tests exercise the real gate end to end: no
 * mocked policy engine, no mocked dispatch guard, real Tool Runtime, real
 * audit chain against a tmpdir.
 */

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-agent-tool-execute-test-"));
const projectRoot = join(tmpDir, "repo");
mkdirSync(join(projectRoot, "src"), { recursive: true });

const FIXTURE = "export const answer = 42;\n";
writeFileSync(join(projectRoot, "src", "index.ts"), FIXTURE, "utf8");

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

const OWNER_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

describe("POST /api/v1/agents/tool-execute", () => {
  it("401s for an unauthenticated caller — no session, no agent identity", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      payload: body(),
    });
    expect(res.statusCode).toBe(401);
  });

  it("200s for a RESEARCHER fs.read_file the catalog grants, returning the file content and its artifact hash", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      payload: body(),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe("EXECUTED");
    expect(json.agentId).toBe("RESEARCHER");
    expect(json.output).toContain("export const answer = 42;");
    expect(typeof json.artifactHash).toBe("string");
    expect(json.artifactHash).toHaveLength(64);

    // The gate audits on the way out, and the chain must still verify.
    const entries = listUnifiedAuditEntries().filter(
      (e) => e.type === "agents.tool-execute",
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.at(-1)?.result).toBe("SUCCESS");
    expect(verifyAuditChain().intact).toBe(true);
  });

  it("403s for a tool that is not in the agent's allowedTools", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      // `propose_patch` belongs to CODE_ENGINEER, not RESEARCHER.
      payload: body({ toolName: "propose_patch" }),
    });
    expect(res.statusCode).toBe(403);
    const json = res.json();
    expect(json.stage).toBe("AUTHORIZATION");
    expect(json.status).toBe("DENIED");
    expect(json.error.message).toMatch(/allowedTools/);
  });

  it("403s when the payload names a different owner — the identity came from the session, the payload cannot widen it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      payload: body({ payload: { targetOwnerId: OWNER_B_ID } }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().stage).toBe("AUTHORIZATION");
    expect(res.json().error.message).toMatch(/cross-tenant/);
  });

  it("400s when the body tries to supply its own owner — ownerId is not an accepted field, it is rejected rather than ignored", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      payload: body({ ownerId: OWNER_B_ID }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("403s for an agent id outside the closed catalog", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      payload: body({ fabricAgentId: "NOT_A_REAL_AGENT" }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("422s for a path escaping the server-derived project root — authorized agent, authorized tool, refused invocation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      payload: body({ toolArgs: { path: "../../../etc/passwd" } }),
    });
    expect(res.statusCode).toBe(422);
    const json = res.json();
    expect(json.stage).toBe("EXECUTION");
    expect(json.status).toBe("FAILED");
    expect(json.error.message).toMatch(/escapes the project root/);
  });

  it("never leaks an absolute server path in a refusal message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/tool-execute",
      // A path inside the root that does not exist: the underlying ENOENT
      // carries the absolute filesystem path of the fixture repo.
      payload: body({ toolArgs: { path: "src/does-not-exist.ts" } }),
    });
    expect(res.statusCode).toBe(422);
    const message: string = res.json().error.message;
    expect(message).not.toContain(tmpDir);
    expect(message).not.toContain("/");
  });
});
