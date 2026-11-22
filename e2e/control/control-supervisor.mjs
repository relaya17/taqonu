// Test-only harness: runs the real Control Plane process (apps/control-plane)
// on loopback with its own throwaway registration database, and lets the
// ArletOS <-> Control spec stop and start it to observe fail-closed behaviour
// and restart persistence. Never used outside local/test runs.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const controlDir = resolve(here, "..", "..", "apps", "control-plane");
const controlPort = Number(process.env.STAGE9_CONTROL_PORT ?? "3100");
const adminPort = Number(process.env.STAGE9_CONTROL_ADMIN_PORT ?? "3199");
const token = process.env.STAGE9_CONTROL_TOKEN;
if (!token) {
  console.error("control-supervisor: STAGE9_CONTROL_TOKEN is required");
  process.exit(2);
}

const tsxCli = createRequire(join(controlDir, "package.json")).resolve("tsx/cli");
const dataDir = mkdtempSync(join(tmpdir(), "atlas-control-e2e-"));
const dbPath = join(dataDir, "registrations.db");

let child = null;

function controlHealthy() {
  return fetch(`http://127.0.0.1:${controlPort}/api/v1/status`, {
    signal: AbortSignal.timeout(2_000),
  })
    .then((res) => res.ok)
    .catch(() => false);
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startControl() {
  if (child) return;
  child = spawn(process.execPath, [tsxCli, "src/server.ts"], {
    cwd: controlDir,
    env: {
      ...process.env,
      CONTROL_PLANE_PORT: String(controlPort),
      CONTROL_PLANE_DB_PATH: dbPath,
      ATLAS_CONTROL_PLANE_TOKEN: token,
      HOST: "127.0.0.1",
    },
    stdio: "ignore",
  });
  child.on("exit", () => {
    child = null;
  });
  if (!(await waitFor(controlHealthy, 60_000))) throw new Error("Control Plane did not become healthy");
}

async function stopControl() {
  const proc = child;
  if (!proc) return;
  const exited = new Promise((r) => proc.once("exit", r));
  proc.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
  if (child) child.kill("SIGKILL");
  child = null;
  await waitFor(async () => !(await controlHealthy()), 10_000);
}

const admin = createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
    if (req.method === "GET" && req.url === "/state") return send(200, { running: child !== null });
    if (req.method === "POST" && req.url === "/start") {
      await startControl();
      return send(200, { running: true });
    }
    if (req.method === "POST" && req.url === "/stop") {
      await stopControl();
      return send(200, { running: false });
    }
    if (req.method === "POST" && req.url === "/reset") {
      // Back to an empty registry: Control restarts on a wiped database.
      await stopControl();
      rmSync(dbPath, { force: true });
      await startControl();
      return send(200, { running: true });
    }
    return send(404, { error: "not found" });
  } catch (error) {
    return send(500, { error: error instanceof Error ? error.message : String(error) });
  }
});

await startControl();
admin.listen(adminPort, "127.0.0.1", () => console.log(`control-supervisor ready on ${adminPort}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void stopControl().then(() => process.exit(0));
  });
}
