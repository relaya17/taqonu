#!/usr/bin/env tsx
/**
 * Environment / credential gate — observation only.
 * Does not invent values. Does not print secret contents.
 *
 * Usage: pnpm environment:gate
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONNECTED_APPLICATION_RUNTIME } from "../packages/shared/src/platform/connected-applications.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function present(path: string): boolean {
  return existsSync(path);
}

function envKeySet(key: string): boolean {
  return Boolean(process.env[key]?.trim());
}

const webExample = join(root, "apps", "web", ".env.example");
const webLocal = join(root, "apps", "web", ".env.local");
const apiEnv = join(root, "apps", "api", ".env");
const exampleKeys = present(webExample)
  ? readFileSync(webExample, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("NEXT_PUBLIC_") && line.includes("="))
      .map((line) => line.slice(0, line.indexOf("=")))
  : [];

const report = {
  generatedAt: new Date().toISOString(),
  studio: {
    envExample: present(webExample),
    envLocal: present(webLocal),
    requiredPublicKeys: exampleKeys,
    blocker: present(webLocal)
      ? null
      : "apps/web/.env.local is absent. Copy apps/web/.env.example and replace NEXT_PUBLIC_SUPABASE_* with Owner/environment values. Do not commit replace-me keys as production credentials.",
  },
  database: {
    provider: "Supabase Postgres (optional dual-write); local osStore JSON is the default persistence",
    requiredServerVars: [
      "DATABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
    apiEnvFilePresent: present(apiEnv),
    liveSupabaseClaim: "NOT CLAIMED from this script — API /api/v1/health reported local JSON store when last probed",
    migrations: "supabase/migrations + packages/database/migrations",
    blocker:
      "Production Postgres/Supabase credentials are an environment/Owner secret. Placeholder replace-me keys are not live Supabase.",
  },
  disasterRecovery: {
    localReplicaImplemented: true,
    offsiteDirConfigured: envKeySet("ATLAS_OFFSITE_BACKUP_DIR"),
    cloudObjectStore: "BLOCKED BY EXTERNAL INFRASTRUCTURE",
  },
  supplyChain: {
    signingIdentityConfigured: envKeySet("ATLAS_SIGNING_IDENTITY"),
    releaseReady: false,
    blocker: "Sigstore/cosign identity + verifier — Owner/deployment",
  },
  privatePlane: {
    localhostIsNotProduction: true,
    requiredDeployment: "Ubuntu VM + Tailscale per docs/deployment/private-plane.md",
    workerHttpHealth: "NOT REQUIRED — worker is a polling loop; API reports UNKNOWN by design",
  },
  connectedApplications: CONNECTED_APPLICATION_RUNTIME.map((row) => ({
    applicationId: row.applicationId,
    classification: row.reconciliation.classification,
    execute: row.execute,
    adr022Conflict: row.reconciliation.adr022Conflict,
  })),
};

console.log(JSON.stringify(report, null, 2));
