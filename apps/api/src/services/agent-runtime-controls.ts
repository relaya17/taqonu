import { AtlasError } from "@atlas/shared";
import {
  AgentRuntimeControlPersistenceError,
  AgentRuntimeControlRepository,
  createDatabaseClients,
  isLiveSupabase,
  DURABLE_AGENT_RUNTIME_STATUSES,
  type AgentRuntimeControlRecord,
  type DurableAgentRuntimeStatus,
} from "@atlas/database";

/**
 * Step 4 Decision B — API-owned durable authority for the four highest-
 * stakes agent runtime statuses (PAUSED/QUARANTINED/REVOKED/DISABLED).
 * apps/api is the sole writer (via the Control-Plane-authenticated route,
 * `../routes/agent-runtime-controls.ts`) and the sole reader
 * (`resolveGovernedAgentIdentity` in `agent-runtime-authz.ts`, in-process,
 * no network hop). SUSPENDED/DEGRADED are out of scope here -- they remain
 * Control Plane's own ephemeral, in-memory overlay, read as before via
 * `lookupControlPlaneAgentRuntimeStatus`.
 *
 * Same store-binding shape as `approvals.ts`'s live approval store: no
 * process-local Map, no in-memory fallback in production.
 */
let store: AgentRuntimeControlRepository | null = null;
let storeClearedForTests = false;

export function configureAgentRuntimeControlStore(
  next: AgentRuntimeControlRepository,
): void {
  store = next;
  storeClearedForTests = false;
}

export function clearAgentRuntimeControlStoreForTests(): void {
  store = null;
  storeClearedForTests = true;
}

function notConfigured(): never {
  throw new AtlasError(
    "INTEGRATION_ERROR",
    "Agent runtime control store is not configured",
    { statusCode: 503 },
  );
}

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

function bindProductionPostgresStore(): AgentRuntimeControlRepository {
  const env = productionPostgresEnv();
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_ANON_KEY ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !isLiveSupabase({
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    })
  ) {
    notConfigured();
  }
  try {
    const { service } = createDatabaseClients({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
    return AgentRuntimeControlRepository.fromSupabase(service);
  } catch (error) {
    throw new AtlasError(
      "INTEGRATION_ERROR",
      error instanceof Error
        ? error.message
        : "Agent runtime control store is unavailable",
      { statusCode: 503, cause: error },
    );
  }
}

function requireStore(): AgentRuntimeControlRepository {
  if (store !== null) return store;
  if (storeClearedForTests) notConfigured();
  store = bindProductionPostgresStore();
  return store;
}

/**
 * True when a durable read/write can actually be attempted -- either a
 * store was injected (production wiring, or a test's
 * `configureAgentRuntimeControlStore`), or production Supabase env vars are
 * present. False means "this environment has not wired up Decision B's
 * store yet" (every pre-existing test, and any environment before this
 * migration/wiring lands) -- callers MUST treat that as "no durable
 * override" (identical to today's Control-Plane Map default when nothing
 * is set), never as a failure. It never throws, unlike `requireStore()`, so
 * a caller can branch before attempting the read at all.
 */
export function isAgentRuntimeControlStoreAvailable(): boolean {
  if (store !== null) return true;
  if (storeClearedForTests) return false;
  const env = productionPostgresEnv();
  return Boolean(
    env.SUPABASE_URL &&
      env.SUPABASE_ANON_KEY &&
      env.SUPABASE_SERVICE_ROLE_KEY &&
      isLiveSupabase({
        SUPABASE_URL: env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      }),
  );
}

function rethrowStoreError(error: unknown): never {
  if (error instanceof AtlasError) throw error;
  if (error instanceof AgentRuntimeControlPersistenceError) {
    throw new AtlasError("INTEGRATION_ERROR", error.message, {
      statusCode: 503,
      cause: error,
    });
  }
  throw new AtlasError(
    "INTEGRATION_ERROR",
    error instanceof Error ? error.message : "Agent runtime control store is unavailable",
    { statusCode: 503, cause: error },
  );
}

/**
 * Read the durable override for one agent, if any and not expired. Absence
 * (including an expired row) means "no durable override" -- treated by
 * every caller exactly like today's Control-Plane Map default (no entry =>
 * ACTIVE-for-this-subset), never as UNKNOWN/failure.
 */
export async function getDurableAgentRuntimeStatus(
  agentId: string,
): Promise<AgentRuntimeControlRecord | null> {
  try {
    const record = await requireStore().get(agentId);
    if (!record) return null;
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return record;
  } catch (error) {
    rethrowStoreError(error);
  }
}

export async function setDurableAgentRuntimeStatus(input: {
  readonly agentId: string;
  readonly status: DurableAgentRuntimeStatus;
  readonly setBy: string;
  readonly reason: string;
  readonly expiresAt?: string | null | undefined;
}): Promise<AgentRuntimeControlRecord> {
  try {
    return await requireStore().set({
      agentId: input.agentId,
      status: input.status,
      setBy: input.setBy,
      reason: input.reason,
      setAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? null,
    });
  } catch (error) {
    rethrowStoreError(error);
  }
}

/** Clears a durable override -- used by the "resume" action (-> ACTIVE, which is never itself stored). */
export async function clearDurableAgentRuntimeStatus(agentId: string): Promise<void> {
  try {
    await requireStore().clear(agentId);
  } catch (error) {
    rethrowStoreError(error);
  }
}

export { DURABLE_AGENT_RUNTIME_STATUSES };
export type { DurableAgentRuntimeStatus, AgentRuntimeControlRecord };
