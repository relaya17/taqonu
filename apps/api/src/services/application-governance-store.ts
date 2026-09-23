/**
 * Application governance persistence switch.
 *
 * Durable (live Supabase or a test-configured repository): Postgres RPCs
 * are the only authority. Maps are not written.
 * Local/test without a store: existing process-local Maps.
 * Vercel production without live Postgres: unavailable (503).
 */

import {
  ApplicationGovernancePersistenceError,
  ApplicationGovernanceRepository,
  createDatabaseClients,
  isLiveSupabase,
} from "@atlas/database";

let store: ApplicationGovernanceRepository | null = null;

export function configureApplicationGovernanceStore(
  next: ApplicationGovernanceRepository | null,
): void {
  store = next;
}

export function clearApplicationGovernanceStoreForTests(): void {
  store = null;
}

export type ApplicationGovernanceMode = "maps" | "durable" | "unavailable";

function productionPostgresEnv(): {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
} {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL ?? "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
}

function isLiveConfigured(): boolean {
  const env = productionPostgresEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return false;
  }
  return isLiveSupabase({
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

function isVercelProduction(): boolean {
  return Boolean(process.env.VERCEL) && process.env.NODE_ENV === "production";
}

export function applicationGovernanceMode(): ApplicationGovernanceMode {
  if (store !== null) return "durable";
  if (isVercelProduction() && !isLiveConfigured()) return "unavailable";
  if (isLiveConfigured()) return "durable";
  return "maps";
}

function bindProductionStore(): ApplicationGovernanceRepository {
  const env = productionPostgresEnv();
  const { service } = createDatabaseClients({
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  return new ApplicationGovernanceRepository(service);
}

export function requireApplicationGovernanceStore(): ApplicationGovernanceRepository {
  if (store !== null) return store;
  if (!isLiveConfigured()) {
    throw new ApplicationGovernancePersistenceError(
      "UNAVAILABLE",
      "Application governance store is unavailable",
    );
  }
  try {
    store = bindProductionStore();
    return store;
  } catch (error) {
    throw new ApplicationGovernancePersistenceError(
      "UNAVAILABLE",
      error instanceof Error
        ? error.message
        : "Application governance store is unavailable",
      { cause: error },
    );
  }
}

export const APPLICATION_CONNECTOR_NONCE_TTL_MS = 10 * 60 * 1000;
export const APPLICATION_PREFLIGHT_DECISION_TTL_MS_DEFAULT = 24 * 60 * 60 * 1000;

export function nonceExpiresAtIso(now = Date.now()): string {
  return new Date(now + APPLICATION_CONNECTOR_NONCE_TTL_MS).toISOString();
}

export function decisionExpiresAtIso(now = Date.now()): string {
  const raw = process.env.ATLAS_PREFLIGHT_DECISION_TTL_MS;
  const parsed = raw ? Number(raw) : NaN;
  const ttl =
    Number.isFinite(parsed) && parsed > 0
      ? parsed
      : APPLICATION_PREFLIGHT_DECISION_TTL_MS_DEFAULT;
  return new Date(now + ttl).toISOString();
}

export function governanceUnavailableResponse(): {
  readonly status: 503;
  readonly body: { readonly error: string };
} {
  return {
    status: 503,
    body: { error: "Fail closed: application governance store is unavailable" },
  };
}
