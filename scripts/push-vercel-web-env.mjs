#!/usr/bin/env node
/**
 * Push public env vars for Vercel project `taqonu-web`.
 *
 * Usage:
 *   pnpm dlx vercel login
 *   node scripts/push-vercel-web-env.mjs
 *
 * Reads apps/web/.env.local (or --from=...).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_APP_NAME",
  "NEXT_PUBLIC_PRODUCT_CODENAME",
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const project =
  args.find((a) => a.startsWith("--project="))?.split("=")[1] ?? "taqonu-web";
const fromFile =
  args.find((a) => a.startsWith("--from="))?.split("=")[1] ??
  "apps/web/.env.local";
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

function getToken() {
  if (process.env.VERCEL_TOKEN?.trim()) return process.env.VERCEL_TOKEN.trim();
  const authPaths = [
    resolve(
      process.env.USERPROFILE ?? process.env.HOME ?? "",
      ".local/share/com.vercel.cli/auth.json",
    ),
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
      body: { value, type: "plain", target: targets },
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
      type: "plain",
      target: targets,
    },
  });
  return "created";
}

async function main() {
  const envPath = resolve(ROOT, fromFile);
  if (!existsSync(envPath)) {
    const fallback = {
      NEXT_PUBLIC_SUPABASE_URL: "https://cfdqhsvriyxhsmhvnzgx.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_API_URL: "https://taqonu-api.vercel.app",
      NEXT_PUBLIC_APP_NAME: "ArletOS",
      NEXT_PUBLIC_PRODUCT_CODENAME: "Atlas",
    };
    writeFileSync(
      envPath,
      REQUIRED.map((k) => `${k}=${fallback[k] ?? ""}`).join("\n") + "\n",
    );
    console.log(`Created ${fromFile} — fill NEXT_PUBLIC_SUPABASE_ANON_KEY then re-run.`);
    process.exit(1);
  }

  const fileEnv = parseEnv(readFileSync(envPath, "utf8"));
  /** @type {Record<string, string>} */
  const env = {
    NEXT_PUBLIC_APP_NAME: "ArletOS",
    NEXT_PUBLIC_PRODUCT_CODENAME: "Atlas",
    NEXT_PUBLIC_API_URL: "https://taqonu-api.vercel.app",
    ...fileEnv,
  };

  // Prefer production API URL on Vercel even if local file points to localhost
  if (/localhost|127\.0\.0\.1/i.test(env.NEXT_PUBLIC_API_URL ?? "")) {
    env.NEXT_PUBLIC_API_URL = "https://taqonu-api.vercel.app";
  }

  console.log("\nValues checklist (lengths only):");
  const errors = [];
  for (const key of REQUIRED) {
    const v = env[key] ?? "";
    console.log(
      `  ${key.padEnd(32)} len=${String(v.length).padStart(4)}  ok=${v.length > 0}`,
    );
    if (!v.trim()) errors.push(`${key}: empty`);
  }
  if (/localhost|127\.0\.0\.1/i.test(env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
    errors.push("NEXT_PUBLIC_SUPABASE_URL: looks local");
  }
  if (errors.length) {
    console.error("\nValidation failed:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log("\n--dry-run: validation OK, skipping upload.");
    return;
  }

  const token = getToken();
  if (!token) {
    console.error(`
No Vercel credentials. Run:
  pnpm dlx vercel login
`);
    process.exit(1);
  }

  const teamId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || null;
  const proj = await vercelFetch(`/v9/projects/${encodeURIComponent(project)}`, {
    token,
    teamId,
  });
  const projectId = proj.id || proj.name;
  console.log(`\nProject: ${proj.name} (${projectId})`);

  for (const key of REQUIRED) {
    const action = await upsertEnv(token, projectId, teamId, key, env[key]);
    console.log(`  ${key}: ${action}`);
  }

  console.log(`
Done for ${project}.

CRITICAL (Dashboard — this is why you see 100% errors / CONFIG_ERROR):
  1. Open project taqonu-web → Settings → General → Root Directory = apps/web
  2. Domains: taqonu-web.vercel.app must belong to taqonu-web (NOT taqonu-api)
  3. Redeploy Production

Also push API secrets:
  node scripts/push-vercel-api-env.mjs
`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
