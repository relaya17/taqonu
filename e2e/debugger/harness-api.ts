/**
 * TEST-ONLY API host for the Studio Debugger product-path run
 * (playwright.debugger.config.ts). Not product code and not imported by it.
 *
 * It starts the REAL API application in-process on loopback with a throwaway
 * store, the Debugger host opt-in, and a small control listener on a SEPARATE
 * loopback port (never routes of the real app, so its session gate is untouched):
 *
 * - /classify: the existing in-process P2 test seam (`setProjectEnvironmentTierForTests`).
 *   The ordinary production path still fail-closes on an unclassified project;
 *   nothing here makes P2 pass for a project that was not classified by the test.
 * - /transfer-owner: simulates an ownership change (authorization loss).
 * - /expire: fires the same session-expiry transition the idle/lifetime timers fire.
 * - /audit, /session: read-only views used to verify evidence.
 *
 * Refuses to run under NODE_ENV=production and listens on loopback only.
 */
import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.env.NODE_ENV === "production") {
  throw new Error("The Debugger e2e harness refuses to run with NODE_ENV=production.");
}

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, "..", "..", "apps", "api");
const port = Number(process.env.DEBUGGER_E2E_API_PORT ?? 4100);
const webOrigin = process.env.DEBUGGER_E2E_WEB_ORIGIN ?? "http://localhost:3100";

// The API reads apps/api/.env relative to its working directory.
process.chdir(apiDir);
const scratch = mkdtempSync(join(tmpdir(), "atlas-debugger-e2e-"));
Object.assign(process.env, {
  ATLAS_DEBUGGER_ENABLED: "1",
  ATLAS_STORE_PATH: join(scratch, "store.json"),
  ATLAS_SKIP_STORE_PERSIST: "1",
  ATLAS_SKIP_AUDIT_LOG: "1",
  ATLAS_AUTH_PATH: join(scratch, "users.json"),
  ATLAS_SESSIONS_PATH: join(scratch, "sessions.json"),
  WEB_ORIGIN: webOrigin,
  API_PORT: String(port),
});
// A parent shell may export the non-live sentinel; keep the local live key (same rule as the Stage 9 config).
if (process.env.SUPABASE_SERVICE_ROLE_KEY === "replace-me") delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const load = <T>(file: string): Promise<T> => import(pathToFileURL(join(apiDir, "src", file)).href) as Promise<T>;

// Same module the API resolves for "@atlas/config" (ESM-only, so resolved by path).
const { loadServerEnv } = (await import(
  pathToFileURL(join(apiDir, "node_modules", "@atlas", "config", "dist", "index.js")).href
)) as {
  loadServerEnv: () => unknown;
};
const { buildApp } = await load<{
  buildApp: (env: unknown) => Promise<{
    ready: () => Promise<unknown>;
    listen: (options: { host: string; port: number }) => Promise<unknown>;
  }>;
}>("create-app.ts");
const gate = await load<{
  setProjectEnvironmentTierForTests: (projectId: string, tier: "PRODUCTION" | "STAGING" | "DEVELOPMENT" | null) => void;
}>("services/studio-debug-gate.ts");
const sessions = await load<{
  systemCloseDebugSession: (sessionId: string, cause: "timeout") => void;
  getDebugSession: (sessionId: string) => unknown;
  getDebugSessionInternal: (sessionId: string) => { inspectorConn?: unknown } | undefined;
}>("services/studio-debug-session.ts");
const access = await load<{
  bindProjectOwner: (projectId: string, ownerId: string, reason: "claimed") => void;
}>("services/project-access.ts");
const { osStore } = await load<{ osStore: { listAudit: () => readonly Record<string, unknown>[] } }>("store/os-store.ts");

const app = await buildApp(loadServerEnv());

// Control endpoints live on their OWN loopback-only listener. They are never
// routes of the real app, so the app's global session gate is left untouched.
const controlPort = Number(process.env.DEBUGGER_E2E_CONTROL_PORT ?? 4101);

function readJson(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolveBody(chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, string>) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const control = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "POST" && url.pathname === "/classify") {
        const body = await readJson(req);
        gate.setProjectEnvironmentTierForTests(body.projectId as string, body.tier as "DEVELOPMENT");
        return reply(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/transfer-owner") {
        const body = await readJson(req);
        access.bindProjectOwner(body.projectId as string, body.ownerId as string, "claimed");
        return reply(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/expire") {
        const body = await readJson(req);
        sessions.systemCloseDebugSession(body.sessionId as string, "timeout");
        return reply(200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/audit") {
        const sessionId = url.searchParams.get("sessionId");
        return reply(200, { entries: osStore.listAudit().filter((entry) => entry.sessionId === sessionId) });
      }
      if (req.method === "GET" && url.pathname === "/session") {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        return reply(200, {
          session: sessions.getDebugSession(sessionId),
          inspectorConnected: Boolean(sessions.getDebugSessionInternal(sessionId)?.inspectorConn),
        });
      }
      return reply(404, { error: "not found" });
    } catch {
      return reply(400, { error: "bad request" });
    }
  })();
});

await app.ready();
await app.listen({ host: "127.0.0.1", port });
await new Promise<void>((resolveListen) => control.listen(controlPort, "127.0.0.1", resolveListen));
console.error(JSON.stringify({ level: "info", message: "debugger_e2e_api_started", port, controlPort, webOrigin }));
