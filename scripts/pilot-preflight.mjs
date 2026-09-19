/**
 * Read-only local pilot checks. Does not start/stop services, Docker,
 * or Supabase. Does not print secrets. Does not claim production.
 *
 * Usage: pnpm pilot:preflight
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function classifyEnv(file, keys) {
  if (!existsSync(file)) return { exists: false, rows: [] };
  const map = Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      }),
  );
  return {
    exists: true,
    rows: keys.map((key) => {
      const value = map[key] ?? "";
      const placeholder =
        !value ||
        /^(replace-me|changeme|your-anon|your-service|placeholder)$/i.test(
          value,
        );
      return {
        key,
        present: value.length > 0,
        placeholder,
        len: value.length,
        localHost: /127\.0\.0\.1|localhost/.test(value),
      };
    }),
  };
}

function tcp(host, port, ms = 1500) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, ms);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function httpStatus(url, ms = 2500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

const docker = spawnSync("docker", ["info"], {
  encoding: "utf8",
  timeout: 8000,
  windowsHide: true,
});

const ports = {
  kong: await tcp("127.0.0.1", 15432),
  postgres: await tcp("127.0.0.1", 15433),
  studioSupabase: await tcp("127.0.0.1", 15434),
  web: await tcp("127.0.0.1", 3000) || await tcp("localhost", 3000),
  control: await tcp("127.0.0.1", 3100),
  admin: await tcp("127.0.0.1", 3200),
  api: await tcp("127.0.0.1", 4000) || await tcp("localhost", 4000),
};

const health = {
  kongAuth: ports.kong
    ? await httpStatus("http://127.0.0.1:15432/auth/v1/health")
    : 0,
  api: ports.api ? await httpStatus("http://127.0.0.1:4000/health") : 0,
  control: ports.control
    ? await httpStatus("http://127.0.0.1:3100/api/v1/status")
    : 0,
};

const apiEnv = classifyEnv(join(root, "apps/api/.env"), [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);
const webEnv = classifyEnv(join(root, "apps/web/.env.local"), [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
]);

const kongKeysOk =
  apiEnv.exists &&
  apiEnv.rows.every((row) => row.present && !row.placeholder);
const webAnonOk =
  webEnv.exists &&
  webEnv.rows.every((row) => row.present && !row.placeholder);

const report = {
  claim: "LOCAL PILOT ONLY — production is NOT READY (AWS private plane unavailable)",
  docker: docker.status === 0 ? "UP" : "DOWN",
  supabaseHostPorts: {
    "15432_kong": ports.kong,
    "15433_postgres": ports.postgres,
    "15434_studio": ports.studioSupabase,
    kongAuthHealth: health.kongAuth,
  },
  atlasSurfaces: {
    web3000: ports.web,
    api4000: ports.api,
    apiHealth: health.api,
    control3100: ports.control,
    controlStatus: health.control,
    admin3200: ports.admin,
  },
  env: {
    apiEnvPresent: apiEnv.exists,
    webEnvPresent: webEnv.exists,
    apiKeysPlaceholder: apiEnv.exists
      ? apiEnv.rows
          .filter((row) => row.key.includes("KEY"))
          .some((row) => row.placeholder)
      : true,
    webAnonPlaceholder: webEnv.exists
      ? webEnv.rows.some((row) => row.key.includes("KEY") && row.placeholder)
      : true,
    supabaseUrlIsLoopback: apiEnv.rows.find((row) => row.key === "SUPABASE_URL")
      ?.localHost,
  },
};

console.log(JSON.stringify(report, null, 2));

const surfacesUp = ports.web && ports.api && ports.control && ports.admin;
const supabaseUp = ports.kong && ports.postgres && health.kongAuth === 200;
const ready = surfacesUp && supabaseUp && kongKeysOk && webAnonOk;

if (!ready) {
  const missing = [];
  if (docker.status !== 0) missing.push("Docker Desktop");
  if (!supabaseUp) missing.push("local Supabase 15432–15434 (npx supabase start, no --no-backup)");
  if (!surfacesUp) missing.push("Atlas surfaces (pnpm dev)");
  if (!kongKeysOk || !webAnonOk) missing.push("gitignored local keys (not replace-me)");
  console.error(
    `\nPILOT PREFLIGHT: not fully ready — ${missing.join("; ")}. Still not production.`,
  );
  process.exit(1);
}

console.error(
  "\nPILOT PREFLIGHT: local surfaces + local Supabase look up. Still not production. Demo script: docs/strategy/pilot-offer.md",
);
process.exit(0);
