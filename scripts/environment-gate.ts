#!/usr/bin/env tsx
/**
 * Environment / credential gate — observation only.
 * Does not invent values. Does not print secret contents.
 *
 * Usage: pnpm environment:gate
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONNECTED_APPLICATION_RUNTIME } from "../packages/shared/src/platform/connected-applications.ts";
import { createDatabaseClients } from "../packages/database/src/client.ts";
import { isLiveSupabase } from "../packages/database/src/persist.ts";
import { AuditLogRepository } from "../packages/database/src/repositories/audit-log.ts";

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
    // P0 persistence fix (2026-09-05): env vars merely being *set* is not
    // proof that production runtime actually persists to Postgres --
    // `auditLogPersistence` below is a real write+read+cleanup round trip
    // against public.audit_logs, not a config-presence check. See
    // `probeAuditLogPersistence()`.
    migrations: "supabase/migrations + packages/database/migrations",
    blocker:
      "Production Postgres/Supabase credentials are an environment/Owner secret. Placeholder replace-me keys are not live Supabase.",
  },
  disasterRecovery: {
    localReplicaImplemented: true,
    offsiteDirConfigured: envKeySet("ATLAS_OFFSITE_BACKUP_DIR"),
    cloudObjectStore: "BLOCKED BY EXTERNAL INFRASTRUCTURE",
    classification: envKeySet("ATLAS_OFFSITE_BACKUP_DIR")
      ? "FILESYSTEM OFFSITE CONFIGURED — NOT CLOUD DR"
      : "DR CODE COMPLETE — EXTERNAL DESTINATION REQUIRED",
    rpoRto: "NOT CLAIMED",
    procedure: "pnpm dr:drill — docs/operations/disaster-recovery.md",
  },
  supplyChain: {
    signingIdentityConfigured: envKeySet("ATLAS_SIGNING_IDENTITY"),
    releaseReady: false,
    blocker: "Sigstore/cosign identity + verifier — Owner/deployment",
    commands: {
      generate: "pnpm sbom:generate",
      verify: "pnpm supply-chain:verify",
      sign: "pnpm supply-chain:sign",
    },
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

async function probe(url: string): Promise<{
  readonly url: string;
  readonly reachable: boolean;
  readonly status: number | null;
}> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return { url, reachable: true, status: response.status };
  } catch {
    return { url, reachable: false, status: null };
  }
}

/**
 * Real round-trip verification of canonical audit persistence (P0
 * persistence fix, instruction 10: "do not let SUPABASE_URL exists +
 * SUPABASE_SERVICE_ROLE_KEY exists be treated as proof that production
 * runtime uses Supabase"). Writes one safely-identifiable temporary probe
 * row to public.audit_logs, reads it back, and deletes it -- via the raw
 * service-role client directly, not AuditLogRepository, because that
 * repository intentionally exposes no delete/mutate method for real audit
 * rows (an audit trail must stay append-only on every production code
 * path). Only this script, and only this one safely-tagged probe row,
 * ever deletes an audit_logs row.
 */
async function probeAuditLogPersistence(): Promise<{
  readonly configured: boolean;
  readonly live: boolean;
  readonly verified: boolean;
  readonly detail: string;
}> {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceRoleKey) {
    return {
      configured: false,
      live: false,
      verified: false,
      detail: "SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are not all set",
    };
  }
  const env = { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey };
  if (!isLiveSupabase(env)) {
    return {
      configured: true,
      live: false,
      verified: false,
      detail: "SUPABASE_SERVICE_ROLE_KEY looks like the replace-me placeholder -- not a live database",
    };
  }

  const probeId = randomUUID();
  const client = createDatabaseClients({
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  }).service;
  const repo = new AuditLogRepository(client);
  try {
    const written = await repo.append({
      id: probeId,
      ownerId: null,
      action: "environment-gate.persistence-probe",
      entityType: "ENVIRONMENT_GATE_PROBE",
      entityId: null,
      payload: { environmentGateProbe: true, at: new Date().toISOString() },
    });
    const readBack = await repo.getById(probeId);
    const roundTripOk = Boolean(
      readBack && readBack.id === probeId && readBack.hash === written.hash,
    );
    const { error: deleteError } = await client.from("audit_logs").delete().eq("id", probeId);
    return {
      configured: true,
      live: true,
      verified: roundTripOk,
      detail: roundTripOk
        ? deleteError
          ? `round-trip write+read verified; cleanup delete failed (manual cleanup needed for id=${probeId}): ${deleteError.message}`
          : "round-trip write+read+cleanup verified against public.audit_logs"
        : "write or read-back did not match -- canonical audit persistence is NOT verified",
    };
  } catch (error) {
    return {
      configured: true,
      live: true,
      verified: false,
      detail: `round-trip probe threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

const listenProbes = {
  note: "Loopback reachability is LOCAL PRIVATE PLANE only. It is not Ubuntu/Tailscale/systemd production proof.",
  apiHealth: await probe("http://127.0.0.1:4000/health"),
  controlPlaneStatus: await probe("http://127.0.0.1:3100/api/v1/status"),
  adminRoot: await probe("http://127.0.0.1:3200/"),
  studioRoot: await probe("http://127.0.0.1:3000/"),
};

const auditLogPersistence = await probeAuditLogPersistence();

console.log(JSON.stringify({ ...report, listenProbes, auditLogPersistence }, null, 2));
