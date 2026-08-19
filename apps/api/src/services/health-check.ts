import type { FastifyInstance } from "fastify";
import { createDatabaseClients, isLiveSupabase } from "@atlas/database";
import { osStore } from "../store/os-store.js";

/**
 * Per-component health status. `UNKNOWN` is reserved for checks that cannot
 * actually be performed from this process (see `checkWorker` below) — it is
 * an honest "we don't know", never a stand-in for a real pass/fail.
 */
export type ComponentStatus =
  | "HEALTHY"
  | "WARNING"
  | "DEGRADED"
  | "CRITICAL"
  | "UNKNOWN";

/** Overall rollup never reports UNKNOWN — see `worstOf` for why. */
export type SystemStatus = "HEALTHY" | "WARNING" | "DEGRADED" | "CRITICAL";

export interface ComponentHealth {
  readonly status: ComponentStatus;
  readonly detail?: string;
  readonly latencyMs?: number;
}

export interface SystemHealth {
  readonly status: SystemStatus;
  readonly components: Record<string, ComponentHealth>;
}

/** Real DB round-trip budget. Kept short so a hung DB doesn't hang the health check itself. */
const DB_TIMEOUT_MS = 2000;
/** Above this, the DB answered but slowly enough to be worth flagging. */
const DB_SLOW_WARNING_MS = 1000;

const SEVERITY: Record<Exclude<ComponentStatus, "UNKNOWN">, number> = {
  HEALTHY: 0,
  WARNING: 1,
  DEGRADED: 2,
  CRITICAL: 3,
};

/**
 * Aggregation rule: the overall status is the worst of every component that
 * reports a *known* status (HEALTHY < WARNING < DEGRADED < CRITICAL).
 *
 * Components reporting UNKNOWN (checks this process genuinely cannot perform,
 * e.g. worker liveness from inside the API) are surfaced in `components` for
 * visibility but excluded from the rollup: an unknown is not evidence of a
 * problem, and folding it into the worst-case would make every deployment
 * permanently report at least "not fully healthy" for a component nobody can
 * check from here.
 */
function worstOf(statuses: readonly ComponentStatus[]): SystemStatus {
  let worst: SystemStatus = "HEALTHY";
  for (const status of statuses) {
    if (status === "UNKNOWN") continue;
    if (SEVERITY[status] > SEVERITY[worst]) {
      worst = status;
    }
  }
  return worst;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Database/store health.
 *
 * When live Supabase is configured (`isLiveSupabase`), does a real,
 * lightweight `select ... limit 1` head query against the `projects` table
 * with a short timeout, using the same client-construction path as the rest
 * of the app (`createDatabaseClients` from `@atlas/database`).
 *
 * When Supabase isn't configured (local-only dev mode — the default in this
 * repo's tests and personal deployments), the local `osStore` JSON file *is*
 * the database for this deployment mode. We check it loads without throwing
 * and report HEALTHY, not CRITICAL — a missing cloud DB is expected, not a
 * fault, when the deployment was never configured to use one.
 */
async function checkDatabase(app: FastifyInstance): Promise<ComponentHealth> {
  const env = app.atlasEnv;

  if (!isLiveSupabase(env)) {
    const startedAt = Date.now();
    try {
      osStore.ensureLoaded();
      const projectCount = osStore.listProjects().length;
      return {
        status: "HEALTHY",
        detail: `Local JSON store loaded (${projectCount} project(s)); Supabase not configured for this deployment`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        status: "CRITICAL",
        detail: `Local store failed to load: ${errorMessage(error)}`,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  const client = createDatabaseClients({
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  }).service;

  const startedAt = Date.now();
  try {
    const { error } = await client
      .from("projects")
      .select("id", { count: "exact", head: true })
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    const latencyMs = Date.now() - startedAt;

    if (error) {
      return {
        status: "CRITICAL",
        detail: `Supabase query failed: ${error.message}`,
        latencyMs,
      };
    }

    if (latencyMs > DB_SLOW_WARNING_MS) {
      return {
        status: "WARNING",
        detail: `Supabase reachable but slow to respond (>${DB_SLOW_WARNING_MS}ms)`,
        latencyMs,
      };
    }

    return { status: "HEALTHY", detail: "Supabase reachable", latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const timedOut =
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");
    return {
      status: "CRITICAL",
      detail: timedOut
        ? `Supabase query timed out after ${DB_TIMEOUT_MS}ms`
        : `Supabase query threw: ${errorMessage(error)}`,
      latencyMs,
    };
  }
}

/**
 * LLM/AI provider configuration health.
 *
 * Deliberately does NOT make a live network call to an AI provider on every
 * health check — that would be slow, costly (burns provider quota/spend on
 * every probe), and racy under provider-side rate limiting. Instead this
 * reports whether at least one real provider is configured via API key (or
 * a reachable local Ollama base URL); `createLlmProvider` in
 * `packages/agent-core/src/providers/llm.ts` falls back to the no-op
 * context-echo provider when none are, which is a legitimate dev/test mode
 * but not something to call HEALTHY for a deployment meant to serve real
 * completions.
 */
function checkLlmProviders(app: FastifyInstance): ComponentHealth {
  const env = app.atlasEnv;
  const configured: string[] = [];
  if (env.ANTHROPIC_API_KEY) configured.push("anthropic");
  if (env.OPENAI_API_KEY) configured.push("openai");
  if (env.GEMINI_API_KEY) configured.push("gemini");
  if (env.DEEPSEEK_API_KEY) configured.push("deepseek");
  if (env.GROQ_API_KEY) configured.push("groq");
  if (env.OLLAMA_BASE_URL) configured.push("ollama");

  if (configured.length === 0) {
    return {
      status: "WARNING",
      detail:
        "No AI provider API key (or OLLAMA_BASE_URL) configured; requests fall back to the context-echo provider only",
    };
  }

  return {
    status: "HEALTHY",
    detail: `Configured provider(s): ${configured.join(", ")}`,
  };
}

/**
 * Worker/queue liveness. The API and worker (`apps/worker`) run as separate
 * processes with no shared state or health channel in this architecture —
 * there is no way to check worker liveness from inside the API process.
 * Reporting a fabricated HEALTHY/CRITICAL here would be worse than useless
 * (false confidence); UNKNOWN says plainly that this needs a separate check
 * (worker's own process monitor, queue depth/heartbeat, etc).
 */
function checkWorker(): ComponentHealth {
  return {
    status: "UNKNOWN",
    detail:
      "API and worker are separate processes with no shared health channel; worker liveness cannot be verified from here. Monitor the worker process/queue directly.",
  };
}

export async function checkSystemHealth(
  app: FastifyInstance,
): Promise<SystemHealth> {
  const [database, llmProviders] = await Promise.all([
    checkDatabase(app),
    Promise.resolve(checkLlmProviders(app)),
  ]);
  const worker = checkWorker();

  const components: Record<string, ComponentHealth> = {
    database,
    llmProviders,
    worker,
  };

  return {
    status: worstOf(Object.values(components).map((c) => c.status)),
    components,
  };
}
