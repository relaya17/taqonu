/**
 * Studio extension health — ADR-026 health contract (Arlet, 2026-10-03).
 *
 * Informational only. Nothing here grants, revokes, bypasses or blocks a
 * permission, and the extension gate (`middleware/studio-extension-gate.ts`)
 * must never import this module. Authorization stays in
 * `authorizeStudioExtensionRequest`.
 *
 * Generic: the engine knows dependency *kinds*, never extension ids. A
 * manifest declares, as data, which kinds each capability needs; probes are
 * server-owned, read-only and short. A kind with no registered probe is
 * NOT_CHECKED / UNKNOWN_DEPENDENCY — never healthy.
 *
 * Dependency statuses (fixed meanings — probes may not invent their own):
 * - OK              the requirement holds.
 * - MISSING         inspected, and the required thing is absent.
 * - NOT_CONFIGURED  the service is not configured in this deployment.
 * - UNREACHABLE     the dependency could not be reached (network failure,
 *                   no response, or a gateway/unavailable answer 502/503/504).
 * - ERROR           the dependency was reached or the probe ran, but failed
 *                   with an error that is not an availability state.
 * - TIMEOUT         no answer within the probe timeout.
 * - RATE_LIMITED    the dependency answered 429. Not an outage.
 * - NOT_CHECKED     the probe did not run (e.g. UNKNOWN_DEPENDENCY).
 * A probe returns only OK / MISSING / NOT_CONFIGURED. Anything else reaches
 * the engine as a thrown error and is classified centrally by
 * `classifyProbeError`.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createDatabaseClients, isLiveSupabase } from "@atlas/database";
import { isLiveApprovalStoreConfigured } from "./approvals.js";
import {
  getStudioExtension,
  isStudioCompatible,
  type StudioExtensionDependency,
  type StudioExtensionManifest,
} from "./studio-extensions.js";
import { OS_STORE_TABLE } from "../store/cloud-store-sync.js";
import { osStore, type StoredStudioExtensionHealth } from "../store/os-store.js";

export type DependencyStatus =
  | "OK"
  | "MISSING"
  | "NOT_CONFIGURED"
  | "UNREACHABLE"
  | "ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "NOT_CHECKED";

export type HealthState = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "NOT_CHECKED";

/** What a probe may return. Availability failures are thrown, never returned. */
export type ProbeOutcome = {
  readonly status: "OK" | "MISSING" | "NOT_CONFIGURED";
  readonly reason?: string | null;
};

export interface ProbeContext {
  readonly projectId: string;
  readonly manifest: StudioExtensionManifest;
  readonly capabilityId: string;
  readonly dependency: StudioExtensionDependency;
  readonly signal: AbortSignal;
}

export type Probe = (ctx: ProbeContext) => Promise<ProbeOutcome> | ProbeOutcome;
export type ProbeRegistry = ReadonlyMap<string, Probe>;

export interface DependencyResult {
  readonly kind: string;
  readonly key: string | null;
  readonly optional: boolean;
  readonly status: DependencyStatus;
  readonly reason: string | null;
  readonly durationMs: number;
}

export interface CapabilityHealth {
  readonly id: string;
  readonly status: HealthState;
  readonly dependencies: readonly DependencyResult[];
}

export interface HealthCounts {
  readonly healthy: number;
  readonly degraded: number;
  readonly unavailable: number;
  readonly notChecked: number;
  readonly total: number;
}

export interface ExtensionHealth {
  readonly at: string;
  readonly status: HealthState;
  readonly counts: HealthCounts;
  readonly capabilities: readonly CapabilityHealth[];
}

/** Contract limits. */
export const HEALTH_PROBE_TIMEOUT_MS = 2_000;
export const HEALTH_CACHE_MS = 60_000;

// ---------------------------------------------------------------------------
// classification (central — the only place availability states are decided)

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** An error that carries the HTTP status a dependency answered with (0 = no response). */
export class ProbeHttpError extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "ProbeHttpError";
  }
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; cause?: unknown };
  if (typeof record.code === "string") return record.code;
  if (record.cause && typeof record.cause === "object") {
    const cause = record.cause as { code?: unknown };
    if (typeof cause.code === "string") return cause.code;
  }
  return null;
}

export function classifyProbeError(error: unknown): { status: DependencyStatus; reason: string } {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "AbortError" || name === "TimeoutError" || errorCode(error) === "ETIMEDOUT") {
    return { status: "TIMEOUT", reason: "TIMEOUT" };
  }
  if (error instanceof ProbeHttpError) {
    if (error.httpStatus === 429) return { status: "RATE_LIMITED", reason: "HTTP_429" };
    if (error.httpStatus === 0) return { status: "UNREACHABLE", reason: "NO_RESPONSE" };
    if ([502, 503, 504].includes(error.httpStatus)) {
      return { status: "UNREACHABLE", reason: `HTTP_${error.httpStatus}` };
    }
    return { status: "ERROR", reason: `HTTP_${error.httpStatus}` };
  }
  const code = errorCode(error);
  if (code && NETWORK_ERROR_CODES.has(code)) return { status: "UNREACHABLE", reason: code };
  if (error instanceof TypeError && /fetch failed/i.test(message)) {
    return { status: "UNREACHABLE", reason: "FETCH_FAILED" };
  }
  return { status: "ERROR", reason: "PROBE_ERROR" };
}

// ---------------------------------------------------------------------------
// rules (contract §E and §F)

const UNAVAILABLE_DEPENDENCY: ReadonlySet<DependencyStatus> = new Set([
  "MISSING",
  "NOT_CONFIGURED",
  "UNREACHABLE",
  "ERROR",
]);
const INDETERMINATE_DEPENDENCY: ReadonlySet<DependencyStatus> = new Set([
  "TIMEOUT",
  "RATE_LIMITED",
  "NOT_CHECKED",
]);

/** Capability state from its dependency results, in rule order. */
export function capabilityState(dependencies: readonly DependencyResult[]): HealthState {
  const required = dependencies.filter((d) => !d.optional);
  if (required.some((d) => UNAVAILABLE_DEPENDENCY.has(d.status))) return "UNAVAILABLE";
  if (required.some((d) => INDETERMINATE_DEPENDENCY.has(d.status))) return "NOT_CHECKED";
  if (dependencies.some((d) => d.optional && d.status !== "OK")) return "DEGRADED";
  return "HEALTHY";
}

export function countStates(capabilities: readonly { status: HealthState }[]): HealthCounts {
  const count = (s: HealthState) => capabilities.filter((c) => c.status === s).length;
  return {
    healthy: count("HEALTHY"),
    degraded: count("DEGRADED"),
    unavailable: count("UNAVAILABLE"),
    notChecked: count("NOT_CHECKED"),
    total: capabilities.length,
  };
}

/**
 * Extension state, in rule order. Per-capability results are always kept,
 * so partial availability is never hidden behind one word:
 * 1. every capability HEALTHY                  → HEALTHY
 * 2. every capability UNAVAILABLE              → UNAVAILABLE
 * 3. no capability HEALTHY or DEGRADED (incl. none at all) → NOT_CHECKED
 * 4. anything else (some answer, some do not)  → DEGRADED
 */
export function extensionState(counts: HealthCounts): HealthState {
  if (counts.total > 0 && counts.healthy === counts.total) return "HEALTHY";
  if (counts.total > 0 && counts.unavailable === counts.total) return "UNAVAILABLE";
  if (counts.healthy + counts.degraded === 0) return "NOT_CHECKED";
  return "DEGRADED";
}

// ---------------------------------------------------------------------------
// engine

async function runProbe(
  probes: ProbeRegistry,
  ctx: Omit<ProbeContext, "signal">,
  timeoutMs: number,
): Promise<DependencyResult> {
  const { dependency } = ctx;
  const base = { kind: dependency.kind, key: dependency.key ?? null, optional: Boolean(dependency.optional) };
  const probe = probes.get(dependency.kind);
  if (!probe) {
    return { ...base, status: "NOT_CHECKED", reason: "UNKNOWN_DEPENDENCY", durationMs: 0 };
  }
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`probe ${dependency.kind} timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    const outcome = await Promise.race([Promise.resolve(probe({ ...ctx, signal: controller.signal })), timeout]);
    if (!outcome || !["OK", "MISSING", "NOT_CONFIGURED"].includes(outcome.status)) {
      // A probe returning anything else is a probe bug, not an availability state.
      return { ...base, status: "ERROR", reason: "INVALID_PROBE_RESULT", durationMs: Date.now() - started };
    }
    return { ...base, status: outcome.status, reason: outcome.reason ?? null, durationMs: Date.now() - started };
  } catch (error) {
    const classified = classifyProbeError(error);
    return { ...base, ...classified, durationMs: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Pure engine: evaluate one manifest with a given probe registry. */
export async function evaluateExtensionHealth(input: {
  readonly manifest: StudioExtensionManifest;
  readonly projectId: string;
  readonly probes: ProbeRegistry;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}): Promise<ExtensionHealth> {
  const timeoutMs = input.timeoutMs ?? HEALTH_PROBE_TIMEOUT_MS;
  const capabilities = await Promise.all(
    input.manifest.capabilities.map(async (capability) => {
      const dependencies = [...input.manifest.dependencies, ...capability.dependencies];
      const results = await Promise.all(
        dependencies.map((dependency) =>
          runProbe(
            input.probes,
            { projectId: input.projectId, manifest: input.manifest, capabilityId: capability.id, dependency },
            timeoutMs,
          ),
        ),
      );
      return { id: capability.id, status: capabilityState(results), dependencies: results };
    }),
  );
  const counts = countStates(capabilities);
  return {
    at: (input.now ?? (() => new Date()))().toISOString(),
    status: extensionState(counts),
    counts,
    capabilities,
  };
}

// ---------------------------------------------------------------------------
// server-owned, read-only probes

function workspaceRoot(projectId: string): string | null {
  const root = osStore.getWorkspaceRoot(projectId);
  return root && existsSync(root) ? root : null;
}

/** The registry used by the API. Probes read only: no commands, no writes, no provider calls, no user tokens. */
export function createServerProbes(app: FastifyInstance): ProbeRegistry {
  return new Map<string, Probe>([
    [
      "studio.compatible",
      ({ manifest }) =>
        isStudioCompatible(manifest) ? { status: "OK" } : { status: "MISSING", reason: "INCOMPATIBLE" },
    ],
    [
      "route.registered",
      ({ manifest, capabilityId }) => {
        const capability = manifest.capabilities.find((c) => c.id === capabilityId);
        const routes = manifest.routes.filter((r) => r.permission === (capability?.permission ?? null));
        const missing = routes.filter((r) => !app.hasRoute({ method: r.method, url: r.url }));
        return missing.length === 0 ? { status: "OK" } : { status: "MISSING", reason: "ROUTE_NOT_REGISTERED" };
      },
    ],
    [
      "project.workspace",
      ({ projectId }) =>
        workspaceRoot(projectId) ? { status: "OK" } : { status: "MISSING", reason: "NO_LOCAL_FOLDER" },
    ],
    [
      "project.git-repo",
      ({ projectId }) => {
        const root = workspaceRoot(projectId);
        if (!root) return { status: "MISSING", reason: "NO_LOCAL_FOLDER" };
        const gitDir = join(root, ".git");
        return existsSync(gitDir) && statSync(gitDir).isDirectory()
          ? { status: "OK" }
          : { status: "MISSING", reason: "NO_GIT_REPOSITORY" };
      },
    ],
    [
      "service.approval-store",
      () =>
        isLiveApprovalStoreConfigured()
          ? { status: "OK" }
          : { status: "NOT_CONFIGURED", reason: "APPROVAL_STORE_NOT_CONFIGURED" },
    ],
    [
      "service.durable-store",
      async ({ signal }) => {
        if (osStore.durableBackend() === "file") {
          osStore.ensureLoaded();
          return { status: "OK", reason: "LOCAL_FILE_STORE" };
        }
        const env = app.atlasEnv;
        if (!isLiveSupabase(env)) return { status: "NOT_CONFIGURED", reason: "CLOUD_STORE_NOT_CONFIGURED" };
        const client = createDatabaseClients({
          url: env.SUPABASE_URL,
          anonKey: env.SUPABASE_ANON_KEY,
          serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
        }).service;
        // One read-only head query against the store table.
        const { error, status } = await client
          .from(OS_STORE_TABLE)
          .select("id", { count: "exact", head: true })
          .limit(1)
          .abortSignal(signal);
        if (error) {
          if (signal.aborted) {
            const timeout = new Error("durable store probe timed out");
            timeout.name = "TimeoutError";
            throw timeout;
          }
          throw new ProbeHttpError(typeof status === "number" ? status : 0, error.message);
        }
        return { status: "OK", reason: "CLOUD_STORE_REACHABLE" };
      },
    ],
  ]);
}

/**
 * Run the health check for one extension in one project and store the result
 * (project scope). `persisted` is false when the result could not be saved;
 * the result is still returned.
 */
export async function checkStudioExtensionHealth(
  app: FastifyInstance,
  projectId: string,
  extensionId: string,
): Promise<{ health: ExtensionHealth; persisted: boolean } | null> {
  const manifest = getStudioExtension(extensionId);
  if (!manifest) return null;
  const health = await evaluateExtensionHealth({ manifest, projectId, probes: createServerProbes(app) });
  let persisted = true;
  try {
    const state = osStore.getStudioExtensionProject(projectId);
    state.health[extensionId] = health as StoredStudioExtensionHealth;
    osStore.setStudioExtensionProject(projectId, state);
  } catch {
    persisted = false;
  }
  return { health, persisted };
}
