import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-pty-route-"));
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

const { registerStudioPtyRoutes } = await import("./studio-pty.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");
const { resetStudioPtyForTests, setStudioPtySpawnerForTests } = await import(
  "../services/studio-pty.js"
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

const owner = testUser();
const stranger = testUser({
  id: "33333333-3333-4333-8333-333333333333",
  email: "other@example.com",
});

function seedOwnedProject(actor: AuthUser, root: string): string {
  const now = new Date().toISOString();
  const projectId = crypto.randomUUID();
  osStore.upsertProject({
    id: projectId,
    slug: `studio-pty-${Date.now().toString(36)}`,
    name: "Studio PTY",
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

beforeAll(async () => {
  app = await buildRouteTestApp(registerStudioPtyRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(storeDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  resetStudioPtyForTests();
  setStudioPtySpawnerForTests(() => {
    let onData: ((data: string) => void) | undefined;
    let onExit: ((event: { exitCode: number; signal?: number }) => void) | undefined;
    return {
      pid: 7,
      write(data: string) {
        onData?.(`ECHO:${data}`);
      },
      resize() {
        /* no-op */
      },
      kill() {
        onExit?.({ exitCode: 0 });
      },
      onData(listener) {
        onData = listener;
      },
      onExit(listener) {
        onExit = listener;
      },
    };
  });
});

afterEach(() => {
  resetStudioPtyForTests();
  setStudioPtySpawnerForTests(null);
  for (const dir of dirs.splice(1)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Studio PTY routes", () => {
  it("creates a human session, streams stdin/stdout, resizes, and closes", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "atlas-pty-http-"));
    dirs.push(workspace);
    writeFileSync(join(workspace, "README.md"), "# http pty\n");
    getRequestUser.mockResolvedValue(owner);
    const projectId = seedOwnedProject(owner, workspace);

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/pty/sessions`,
      payload: { cols: 80, rows: 24, shell: "powershell" },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json() as {
      session: { sessionId: string; pid: number; cwd: string };
      ticket: string;
      streamPath: string;
    };
    expect(body.session.pid).toBe(7);
    expect(body.ticket.length).toBeGreaterThan(8);

    const ws = await app.injectWS(`${body.streamPath}?ticket=${body.ticket}`);
    const messages: string[] = [];
    ws.on("message", (raw) => messages.push(String(raw)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.send(JSON.stringify({ type: "input", data: "dir\r" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(messages.some((row) => row.includes("ECHO:dir"))).toBe(true);
    ws.close();

    const sseDenied = await app.inject({
      method: "GET",
      url: `${body.eventsPath}?ticket=not-the-ticket`,
    });
    expect(sseDenied.statusCode).toBe(403);

    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const sse = await fetch(
      `http://127.0.0.1:${port}${body.eventsPath}?ticket=${encodeURIComponent(body.ticket)}`,
    );
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type") ?? "").toContain("text/event-stream");
    const reader = sse.body?.getReader();
    expect(reader).toBeTruthy();
    const decoder = new TextDecoder();
    let streamed = "";
    await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/pty/sessions/${body.session.sessionId}/input`,
      payload: { data: "sse\r" },
    });
    const deadline = Date.now() + 2000;
    while (reader && Date.now() < deadline && !streamed.includes("ECHO:sse")) {
      const { value, done } = await reader.read();
      if (done) break;
      streamed += decoder.decode(value, { stream: true });
    }
    await reader?.cancel();
    expect(streamed).toContain("ECHO:sse");

    const resized = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/pty/sessions/${body.session.sessionId}/resize`,
      payload: { cols: 100, rows: 30 },
    });
    expect(resized.statusCode).toBe(200);
    expect(resized.json().session.cols).toBe(100);

    const closed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/pty/sessions/${body.session.sessionId}/close`,
    });
    expect(closed.statusCode).toBe(200);
  });

  it("rejects Agent PTY access and foreign-user attach", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "atlas-pty-deny-"));
    dirs.push(workspace);
    writeFileSync(join(workspace, "README.md"), "# deny\n");
    getRequestUser.mockResolvedValue(owner);
    const projectId = seedOwnedProject(owner, workspace);

    const agent = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/pty/sessions`,
      headers: { "x-atlas-actor-kind": "AGENT" },
      payload: {},
    });
    expect(agent.statusCode).toBe(403);
    expect(String(agent.json().error?.message ?? agent.body)).toMatch(/human-only/i);

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/pty/sessions`,
      payload: {},
    });
    expect(created.statusCode).toBe(200);
    const sessionId = created.json().session.sessionId as string;
    const eventsPath = created.json().eventsPath as string;

    const agentStream = await app.inject({
      method: "GET",
      url: `${eventsPath}?ticket=${created.json().ticket}`,
      headers: { "x-atlas-actor-kind": "AGENT" },
    });
    expect(agentStream.statusCode).toBe(403);

    getRequestUser.mockResolvedValue(stranger);
    const stolen = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/pty/sessions/${sessionId}/input`,
      payload: { data: "whoami" },
    });
    expect([403, 404]).toContain(stolen.statusCode);
  });
});
