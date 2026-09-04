#!/usr/bin/env node
/**
 * Start the local private plane (API, Control Plane, Admin, Worker).
 * Does not start Studio/web — that needs apps/web env which is not in this workstation.
 * Token is written to .atlas/live-session.env (gitignored). Do not commit it.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const atlasDir = join(root, ".atlas");
mkdirSync(atlasDir, { recursive: true });

const token =
  process.env.ATLAS_CONTROL_PLANE_TOKEN?.trim() ||
  `atlas-live-${randomBytes(24).toString("hex")}`;
const civioSecret =
  process.env.ATLAS_CIVIO_CONNECTOR_SECRET?.trim() ||
  `civio-live-${randomBytes(16).toString("hex")}`;
const civioTenant = process.env.ATLAS_CIVIO_TENANT_ID?.trim() || "tenant-alpha";
const civioProject = process.env.ATLAS_CIVIO_PROJECT_ID?.trim() || "project-alpha";

const env = {
  ...process.env,
  ATLAS_CONTROL_PLANE_TOKEN: token,
  ATLAS_API_URL: "http://127.0.0.1:4000",
  ATLAS_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
  ATLAS_CIVIO_CONNECTOR_SECRET: civioSecret,
  ATLAS_CIVIO_TENANT_ID: civioTenant,
  ATLAS_CIVIO_PROJECT_ID: civioProject,
  HOST: "127.0.0.1",
};

writeFileSync(
  join(atlasDir, "live-session.env"),
  [
    `ATLAS_CONTROL_PLANE_TOKEN=${token}`,
    "ATLAS_API_URL=http://127.0.0.1:4000",
    "ATLAS_CONTROL_PLANE_URL=http://127.0.0.1:3100",
    "ATLAS_ADMIN_URL=http://127.0.0.1:3200",
    `ATLAS_CIVIO_CONNECTOR_SECRET=${civioSecret}`,
    `ATLAS_CIVIO_TENANT_ID=${civioTenant}`,
    `ATLAS_CIVIO_PROJECT_ID=${civioProject}`,
    "",
  ].join("\n"),
  { encoding: "utf8" },
);

const children = [
  { name: "api", cwd: join(root, "apps", "api"), args: ["exec", "tsx", "src/main.ts"] },
  {
    name: "control-plane",
    cwd: join(root, "apps", "control-plane"),
    args: ["exec", "tsx", "src/server.ts"],
  },
  { name: "admin", cwd: join(root, "apps", "admin"), args: ["exec", "tsx", "src/server.ts"] },
  { name: "worker", cwd: join(root, "apps", "worker"), args: ["exec", "tsx", "src/index.ts"] },
];

const pids = [];
const procs = [];
for (const child of children) {
  const proc = spawn("pnpm", child.args, {
    cwd: child.cwd,
    env,
    stdio: "inherit",
    shell: true,
    detached: false,
  });
  pids.push({ name: child.name, pid: proc.pid ?? null });
  procs.push(proc);
}

writeFileSync(join(atlasDir, "private-plane.pids.json"), JSON.stringify(pids, null, 2));
console.error(
  JSON.stringify({
    message: "private_plane_starting",
    pids,
    sessionFile: ".atlas/live-session.env",
    note: "Studio/web :3000 not started (no apps/web env). Do not commit .atlas/live-session.env.",
  }),
);

function shutdown(signal) {
  for (const proc of procs) {
    if (proc.pid) {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  console.error(JSON.stringify({ message: "private_plane_stopping", signal }));
  setTimeout(() => process.exit(1), 8_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

for (const proc of procs) {
  proc.on("exit", (code, signal) => {
    console.error(
      JSON.stringify({
        message: "private_plane_child_exit",
        pid: proc.pid,
        code,
        signal,
      }),
    );
  });
}
