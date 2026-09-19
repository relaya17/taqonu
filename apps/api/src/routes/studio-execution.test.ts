import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-studio-exec-"));
process.env.ATLAS_STORE_PATH = join(storeDir, "store.json");
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

const { registerStudioExecutionRoutes } = await import("./studio-execution.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");
const { resetApprovalsForTests } = await import(
  "../services/approvals-test-store.js"
);
const { resetGovernedClaimStartsForTests } = await import(
  "../services/governed-claimed-execution.js"
);
const { resetStudioExecutionForTests } = await import("./studio-execution.js");
const { resetStudioExtensionsForTests } = await import(
  "../services/studio-extensions.js"
);
const { resetGovernedCommandRuntimeForTests } = await import(
  "../services/governed-command.js"
);

let app: FastifyInstance;
const dirs: string[] = [storeDir];

function testUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "engineer@example.com",
    displayName: "Engineer",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const requester = testUser();
const decider = testUser({
  id: "77777777-7777-4777-8777-777777777777",
  email: "decider@example.com",
  role: "admin",
});
const stranger = testUser({
  id: "33333333-3333-4333-8333-333333333333",
  email: "other@example.com",
});

function seedOwnedProject(actor: AuthUser, root: string): string {
  const now = new Date().toISOString();
  const projectId = crypto.randomUUID();
  osStore.upsertProject({
    id: projectId,
    slug: `studio-exec-${Date.now().toString(36)}`,
    name: "Studio Exec",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  osStore.setWorkspaceRoot(projectId, root);
  bindProjectOwner(projectId, actor.id, "bound_on_create");
  return projectId;
}

describe("governed Studio terminal / tests / extensions", () => {
  beforeAll(async () => {
    app = await buildRouteTestApp(registerStudioExecutionRoutes);
  });

  afterAll(async () => {
    await app.close();
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    osStore.unloadForTests();
    osStore.ensureLoaded();
    resetApprovalsForTests();
    resetGovernedClaimStartsForTests();
    resetStudioExecutionForTests();
    resetStudioExtensionsForTests();
    resetGovernedCommandRuntimeForTests();
    getRequestUser.mockReset();
  });

  afterEach(() => {
    getRequestUser.mockReset();
  });

  it("401s catalog when not signed in", async () => {
    getRequestUser.mockResolvedValue(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${crypto.randomUUID()}/studio/commands`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s catalog for a non-owner", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-exec-ws-"));
    dirs.push(root);
    const projectId = seedOwnedProject(requester, root);
    getRequestUser.mockResolvedValue(stranger);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/studio/commands`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects client argv / unknown command without spawning", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-exec-ws-"));
    dirs.push(root);
    const projectId = seedOwnedProject(requester, root);
    getRequestUser.mockResolvedValue(requester);
    const argv = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/terminal`,
      payload: { commandId: "node.version", command: "rm -rf /" },
    });
    expect(argv.statusCode).toBe(400);
    const unknown = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/terminal`,
      payload: { commandId: "bash.login" },
    });
    expect(unknown.statusCode).toBe(400);
    const wrongKind = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/terminal`,
      payload: { commandId: "vitest.run" },
    });
    expect(wrongKind.statusCode).toBe(400);
  });

  it("POST terminal without approval is 202; last-run stays NOT_RUN", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-exec-ws-"));
    dirs.push(root);
    const projectId = seedOwnedProject(requester, root);
    getRequestUser.mockResolvedValue(requester);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/terminal`,
      payload: { commandId: "node.version" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as {
      status: string;
      approvalId: string;
      approvalRequestId: string;
    };
    expect(body.status).toBe("APPROVAL_REQUIRED");
    expect(body.approvalId).toBe(body.approvalRequestId);
    expect(typeof (res.json() as { executionId?: string }).executionId).toBe(
      "string",
    );
    const last = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/studio/executions/last`,
    });
    expect(last.statusCode).toBe(200);
    expect(last.json()).toMatchObject({ status: "NOT_RUN", result: null });
  });

  it("SoD: requester cannot decide-and-execute; a second identity runs node.version", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-exec-ws-"));
    dirs.push(root);
    const projectId = seedOwnedProject(requester, root);
    getRequestUser.mockResolvedValue(requester);
    const requested = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/terminal`,
      payload: { commandId: "node.version" },
    });
    expect(requested.statusCode).toBe(202);
    const approvalId = (requested.json() as { approvalId: string }).approvalId;

    const selfDecide = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/terminal/decide-and-execute`,
      payload: {
        approvalId,
        decisionReason: "self",
        commandId: "node.version",
      },
    });
    expect(selfDecide.statusCode).toBeGreaterThanOrEqual(400);

    getRequestUser.mockResolvedValue(decider);
    const executed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/terminal/decide-and-execute`,
      payload: {
        approvalId,
        decisionReason: "reviewed node.version",
        commandId: "node.version",
      },
    });
    expect(executed.statusCode).toBe(200);
    const body = executed.json() as {
      status: string;
      stdout: string;
      exitCode: number;
      passed: null;
    };
    expect(body.status).toBe("EXITED");
    expect(body.exitCode).toBe(0);
    expect(body.stdout).toMatch(/^v\d+/);
    expect(body.passed).toBeNull();

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/terminal/decide-and-execute`,
      payload: {
        approvalId,
        decisionReason: "replay",
        commandId: "node.version",
      },
    });
    expect(replay.statusCode).toBe(403);

    resetStudioExecutionForTests();
    const lastAfterReset = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/studio/executions/last`,
    });
    expect(lastAfterReset.statusCode).toBe(200);
    expect(lastAfterReset.json()).toMatchObject({
      status: "OBSERVED",
      result: { status: "EXITED", exitCode: 0 },
    });
  });

  it("test runner: missing vitest is UNAVAILABLE not PASS after live-human decision", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-exec-ws-"));
    dirs.push(root);
    const projectId = seedOwnedProject(requester, root);
    getRequestUser.mockResolvedValue(requester);
    const requested = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/tests`,
      payload: { commandId: "vitest.run" },
    });
    expect(requested.statusCode).toBe(202);
    const approvalId = (requested.json() as { approvalId: string }).approvalId;
    getRequestUser.mockResolvedValue(decider);
    const executed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/tests/decide-and-execute`,
      payload: {
        approvalId,
        decisionReason: "run tests",
        commandId: "vitest.run",
      },
    });
    expect(executed.statusCode).toBe(200);
    const body = executed.json() as {
      status: string;
      passed: boolean;
      denial: string;
    };
    expect(body.status).toBe("UNAVAILABLE");
    expect(body.passed).toBe(false);
    expect(body.denial).toBe("UNAVAILABLE");
  });

  it("test runner: workspace-local vitest fixture is observed pass/fail, not Truth", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-exec-ws-"));
    dirs.push(root);
    mkdirSync(join(root, "node_modules", "vitest"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "vitest", "vitest.mjs"),
      "console.log('VITEST_FIXTURE_OK'); process.exit(0);\n",
      "utf8",
    );
    const projectId = seedOwnedProject(requester, root);
    getRequestUser.mockResolvedValue(requester);
    const requested = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/tests`,
      payload: { commandId: "vitest.run" },
    });
    const approvalId = (requested.json() as { approvalId: string }).approvalId;
    getRequestUser.mockResolvedValue(decider);
    const executed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/tests/decide-and-execute`,
      payload: {
        approvalId,
        decisionReason: "run fixture",
        commandId: "vitest.run",
      },
    });
    expect(executed.statusCode).toBe(200);
    const body = executed.json() as {
      status: string;
      passed: boolean;
      stdout: string;
      exitCode: number;
    };
    expect(body.status).toBe("EXITED");
    expect(body.exitCode).toBe(0);
    expect(body.passed).toBe(true);
    expect(body.stdout).toContain("VITEST_FIXTURE_OK");
  });

  it("extensions: catalog is fail-closed; unknown id 404; enable does not start a host", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-exec-ws-"));
    dirs.push(root);
    const projectId = seedOwnedProject(requester, root);
    getRequestUser.mockResolvedValue(requester);
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/studio/extensions`,
    });
    expect(listed.statusCode).toBe(200);
    const catalog = listed.json() as {
      contract: { marketplace: boolean; hostApi: boolean };
      extensions: Array<{ hostReady: boolean; invocability: string }>;
    };
    expect(catalog.contract.marketplace).toBe(false);
    expect(catalog.contract.hostApi).toBe(false);
    expect(catalog.extensions.every((item) => item.hostReady === false)).toBe(
      true,
    );
    expect(
      catalog.extensions.every((item) => item.invocability === "unavailable"),
    ).toBe(true);

    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/extensions/not.a.real.extension/enable`,
    });
    expect(missing.statusCode).toBe(404);

    const enabled = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/extensions/atlas.workspace-inspector/enable`,
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toMatchObject({
      enabled: true,
      hostReady: false,
    });
  });

  it("kill of a non-running execution is 409 fail-closed", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-exec-ws-"));
    dirs.push(root);
    const projectId = seedOwnedProject(requester, root);
    getRequestUser.mockResolvedValue(requester);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/execution/kill`,
      payload: { executionId: "00000000-0000-4000-8000-000000000099" },
    });
    expect(res.statusCode).toBe(409);
  });
});
