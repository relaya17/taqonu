#!/usr/bin/env node
/**
 * Push production env vars for Vercel project `taqonu-api`.
 *
 * Usage:
 *   1. pnpm dlx vercel login
 *      OR set VERCEL_TOKEN (Account → Settings → Tokens)
 *   2. Fill apps/api/.env.vercel (or copy from apps/api/.env and set WEB_ORIGIN + NODE_ENV=production)
 *   3. node scripts/push-vercel-api-env.mjs
 *
 * Options:
 *   --dry-run          Validate only (no upload)
 *   --project=NAME     Default: taqonu-api
 *   --targets=a,b,c    Default: production,preview
 *   --from=.env.file   Default: apps/api/.env.vercel
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const REQUIRED = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ENCRYPTION_KEY",
  "COOKIE_SECRET",
  "WEB_ORIGIN",
  "NODE_ENV",
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const project =
  args.find((a) => a.startsWith("--project="))?.split("=")[1] ?? "taqonu-api";
const fromFile =
  args.find((a) => a.startsWith("--from="))?.split("=")[1] ?? "apps/api/.env.vercel";
const targets = (
  args.find((a) => a.startsWith("--targets="))?.split("=")[1] ??
  "production,preview"
)
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function ensureEnvFile(path) {
  if (existsSync(path)) return;
  const example = resolve(ROOT, "scripts/vercel-api-env.example");
  if (!existsSync(example)) {
    throw new Error(`Missing ${path} and ${example}`);
  }
  copyFileSync(example, path);
  const env = parseEnv(readFileSync(path, "utf8"));
  if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY.length < 32) {
    env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
  }
  if (!env.COOKIE_SECRET || env.COOKIE_SECRET.length < 32) {
    env.COOKIE_SECRET = randomBytes(32).toString("hex");
  }
  const body = REQUIRED.map((k) => `${k}=${env[k] ?? ""}`).join("\n") + "\n";
  writeFileSync(path, body, "utf8");
  console.log(`Created ${path} with generated ENCRYPTION_KEY / COOKIE_SECRET.`);
  console.log("Fill DATABASE_URL + SUPABASE_* from the Supabase dashboard, then re-run.");
}

function validate(env) {
  const errors = [];
  for (const key of REQUIRED) {
    const v = (env[key] ?? "").trim();
    if (!v) errors.push(`${key}: empty`);
  }
  if ((env.ENCRYPTION_KEY ?? "").length < 32) {
    errors.push("ENCRYPTION_KEY: need >= 32 chars");
  }
  if ((env.COOKIE_SECRET ?? "").length < 32) {
    errors.push("COOKIE_SECRET: need >= 32 chars");
  }
  if (env.NODE_ENV !== "production") {
    errors.push(`NODE_ENV: expected production, got ${JSON.stringify(env.NODE_ENV)}`);
  }
  for (const key of ["SUPABASE_URL", "WEB_ORIGIN", "DATABASE_URL"]) {
    const v = env[key] ?? "";
    if (/localhost|127\.0\.0\.1/i.test(v)) {
      errors.push(`${key}: looks local (${v}) — use production values`);
    }
  }
  if (/replace-me/i.test(env.SUPABASE_ANON_KEY ?? "")) {
    errors.push("SUPABASE_ANON_KEY: still placeholder");
  }
  if (/replace-me/i.test(env.SUPABASE_SERVICE_ROLE_KEY ?? "")) {
    errors.push("SUPABASE_SERVICE_ROLE_KEY: still placeholder");
  }
  return errors;
}

function getToken() {
  if (process.env.VERCEL_TOKEN?.trim()) return process.env.VERCEL_TOKEN.trim();
  // Prefer CLI auth file if present
  const authPaths = [
    resolve(process.env.USERPROFILE ?? process.env.HOME ?? "", ".local/share/com.vercel.cli/auth.json"),
    resolve(process.env.APPDATA ?? "", "com.vercel.cli", "auth.json"),
    resolve(process.env.HOME ?? "", ".config/vercel/auth.json"),
  ];
  for (const p of authPaths) {
    try {
      if (!existsSync(p)) continue;
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (j?.token) return j.token;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function vercelFetch(path, { method = "GET", body, token, teamId } = {}) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || text || res.statusText;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return json;
}

async function resolveTeamId(_token) {
  if (process.env.VERCEL_TEAM_ID) return process.env.VERCEL_TEAM_ID;
  return process.env.VERCEL_ORG_ID || null;
}

async function upsertEnv(token, projectId, teamId, key, value) {
  const existing = await vercelFetch(`/v9/projects/${projectId}/env`, {
    token,
    teamId,
  });
  const list = existing.envs ?? existing ?? [];
  const match = Array.isArray(list)
    ? list.find(
        (e) =>
          e.key === key &&
          Array.isArray(e.target) &&
          targets.every((t) => e.target.includes(t)),
      )
    : null;

  if (match?.id) {
    await vercelFetch(`/v9/projects/${projectId}/env/${match.id}`, {
      method: "PATCH",
      token,
      teamId,
      body: { value, type: "encrypted", target: targets },
    });
    return "updated";
  }

  await vercelFetch(`/v10/projects/${projectId}/env`, {
    method: "POST",
    token,
    teamId,
    body: {
      key,
      value,
      type: "encrypted",
      target: targets,
    },
  });
  return "created";
}

async function main() {
  const envPath = resolve(ROOT, fromFile);
  ensureEnvFile(envPath);
  const env = parseEnv(readFileSync(envPath, "utf8"));

  // Auto-fill secrets if blank
  let rewritten = false;
  if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY.length < 32) {
    env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
    rewritten = true;
  }
  if (!env.COOKIE_SECRET || env.COOKIE_SECRET.length < 32) {
    env.COOKIE_SECRET = randomBytes(32).toString("hex");
    rewritten = true;
  }
  if (!env.NODE_ENV) {
    env.NODE_ENV = "production";
    rewritten = true;
  }
  if (!env.WEB_ORIGIN) {
    env.WEB_ORIGIN = "https://taqonu-web.vercel.app";
    rewritten = true;
  }
  if (rewritten) {
    const body = REQUIRED.map((k) => `${k}=${env[k] ?? ""}`).join("\n") + "\n";
    writeFileSync(envPath, body, "utf8");
    console.log(`Updated secrets/defaults in ${fromFile}`);
  }

  const errors = validate(env);
  console.log("\nValues checklist (lengths only):");
  for (const key of REQUIRED) {
    const v = env[key] ?? "";
    console.log(`  ${key.padEnd(28)} len=${String(v.length).padStart(4)}  ok=${v.length > 0}`);
  }

  if (errors.length) {
    console.error("\nValidation failed:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`\nEdit ${fromFile}, then re-run.`);
    process.exit(1);
  }

  if (dryRun) {
    console.log("\n--dry-run: validation OK, skipping upload.");
    return;
  }

  const token = getToken();
  if (!token) {
    console.error(`
No Vercel credentials.

Run one of:
  pnpm dlx vercel login
  # or PowerShell:
  $env:VERCEL_TOKEN = "vercel_xxxx"

Then:
  node scripts/push-vercel-api-env.mjs
`);
    process.exit(1);
  }

  const teamId = await resolveTeamId(token);
  const proj = await vercelFetch(`/v9/projects/${encodeURIComponent(project)}`, {
    token,
    teamId,
  });
  const projectId = proj.id || proj.name;
  console.log(`\nProject: ${proj.name} (${projectId})`);
  console.log(`Targets: ${targets.join(", ")}`);

  for (const key of REQUIRED) {
    const action = await upsertEnv(token, projectId, teamId, key, env[key]);
    console.log(`  ${key}: ${action}`);
  }

  console.log(`
Done. In Vercel Dashboard → ${project}:
  1. Domains: attach production hostname
  2. Deployment Protection: off for production (or allow public /health)
  3. Deployments → Redeploy (clear cache optional)

Then check: https://${project}.vercel.app/health
`);
}

main().catch((err) => {
  console.error(err.message || err);
  // Fallback hint if API shape differs
  if (String(err.message || "").includes("401") || String(err.message || "").includes("403")) {
    console.error("Token rejected — run: pnpm dlx vercel login");
  }
  process.exit(1);
});
