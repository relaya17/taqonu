import type { FastifyInstance } from "fastify";
import {
  createDatabaseClients,
  isLiveSupabase,
  type DatabaseClients,
} from "@atlas/database";
import { osStore, type PersistedShape } from "./os-store.js";

/**
 * Supabase-backed durability for `osStore` on serverless hosts.
 *
 * `osStore` keeps its state in memory and historically flushed it to
 * `.atlas/store.json`. A Vercel function's filesystem is read-only (outside
 * /tmp) and per-instance, so every write route failed with 500 and nothing
 * survived across instances. In "cloud" mode Supabase table
 * `public.atlas_os_store` is the source of truth:
 *
 * - before each request, reload the snapshot when another instance has
 *   written a newer version (cheap version probe first);
 * - before the response is sent, flush a dirty store with a compare-and-swap
 *   on `version`. If the write cannot be saved the request answers 503 rather
 *   than reporting success for data that was lost.
 *
 * Concurrent writers on different instances: the CAS detects a newer remote
 * version; this snapshot then wins (last writer wins) and the conflict is
 * logged. The store is a single document, so rows cannot be merged safely.
 */

export const OS_STORE_TABLE = "atlas_os_store";
export const OS_STORE_ROW_ID = "primary";

export interface OsStoreRow {
  readonly version: number;
  readonly shape: PersistedShape;
}

/** Narrow persistence port so tests can run without a network. */
export interface OsStoreRemote {
  readVersion(): Promise<number | null>;
  read(): Promise<OsStoreRow | null>;
  /** Insert version 1. Returns false when the row already exists. */
  insert(shape: PersistedShape): Promise<boolean>;
  /** Update when version === expected. Returns false on version mismatch. */
  compareAndSwap(expected: number, shape: PersistedShape): Promise<boolean>;
}

export function supabaseOsStoreRemote(client: DatabaseClients["service"]): OsStoreRemote {
  const table = () => client.from(OS_STORE_TABLE);
  return {
    async readVersion() {
      const { data, error } = await table()
        .select("version")
        .eq("id", OS_STORE_ROW_ID)
        .maybeSingle();
      if (error) throw new Error(`atlas_os_store version read failed: ${error.message}`);
      return data ? Number((data as { version: number }).version) : null;
    },
    async read() {
      const { data, error } = await table()
        .select("version, shape")
        .eq("id", OS_STORE_ROW_ID)
        .maybeSingle();
      if (error) throw new Error(`atlas_os_store read failed: ${error.message}`);
      if (!data) return null;
      const row = data as { version: number; shape: PersistedShape };
      return { version: Number(row.version), shape: row.shape };
    },
    async insert(shape) {
      const { error } = await table().insert({
        id: OS_STORE_ROW_ID,
        version: 1,
        shape,
      });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw new Error(`atlas_os_store insert failed: ${error.message}`);
    },
    async compareAndSwap(expected, shape) {
      const { data, error } = await table()
        .update({
          version: expected + 1,
          shape,
          updated_at: new Date().toISOString(),
        })
        .eq("id", OS_STORE_ROW_ID)
        .eq("version", expected)
        .select("version");
      if (error) throw new Error(`atlas_os_store update failed: ${error.message}`);
      return Array.isArray(data) && data.length === 1;
    },
  };
}

export interface CloudStoreLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
}

export class CloudStoreSync {
  /** Remote version this instance's memory reflects; null = never synced. */
  private version: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly remote: OsStoreRemote,
    private readonly logger?: CloudStoreLogger,
  ) {}

  currentVersion(): number | null {
    return this.version;
  }

  /** Serialize sync work so overlapping requests never interleave a reload with a flush. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Reload memory from Supabase when a newer snapshot exists. */
  pull(): Promise<void> {
    return this.exclusive(async () => {
      osStore.ensureLoaded();
      // Unflushed local changes belong to a request still in flight on this
      // instance; do not discard them. (Never-synced memory is only the cold
      // start bootstrap, so the cloud snapshot wins over it.)
      if (this.version !== null && osStore.isDirty()) return;
      const remoteVersion = await this.remote.readVersion();
      if (remoteVersion === null) {
        // No snapshot yet: whatever this instance holds becomes the first one.
        if (this.version === null) {
          this.version = 0;
          if (!osStore.isEssentiallyEmpty()) osStore.persist();
        }
        return;
      }
      if (remoteVersion === this.version) return;
      const row = await this.remote.read();
      if (!row) return;
      osStore.replaceWithShape(row.shape);
      this.version = row.version;
    });
  }

  /** Write a dirty store to Supabase. Throws when the snapshot was not saved. */
  flush(): Promise<void> {
    return this.exclusive(async () => {
      if (!osStore.isDirty()) return;
      const shape = osStore.toShape();
      if (this.version === null || this.version === 0) {
        if (await this.remote.insert(shape)) {
          this.version = 1;
          osStore.markClean();
          return;
        }
      } else if (await this.remote.compareAndSwap(this.version, shape)) {
        this.version += 1;
        osStore.markClean();
        return;
      }
      // Another instance wrote first. Last writer wins against that version.
      const latest = await this.remote.readVersion();
      if (latest === null) throw new Error("atlas_os_store row vanished during flush");
      this.logger?.warn("store_cloud_conflict", {
        localVersion: this.version,
        remoteVersion: latest,
      });
      if (!(await this.remote.compareAndSwap(latest, shape))) {
        throw new Error("atlas_os_store write conflict persisted after retry");
      }
      this.version = latest + 1;
      osStore.markClean();
    });
  }
}

export interface CloudStoreEnv {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
}

/**
 * Cloud mode: explicit `ATLAS_STORE_BACKEND=supabase`, or automatically on
 * Vercel with live Supabase credentials. `ATLAS_STORE_BACKEND=file` forces
 * the local file even on Vercel.
 */
export function cloudStoreEnabled(env: CloudStoreEnv): boolean {
  const backend = process.env.ATLAS_STORE_BACKEND?.trim().toLowerCase();
  if (backend === "file") return false;
  if (!isLiveSupabase(env)) return false;
  return backend === "supabase" || Boolean(process.env.VERCEL);
}

/**
 * Wire cloud durability into the request lifecycle. Returns the sync instance
 * (for diagnostics/tests) or null when the local file backend is in use.
 */
export function registerCloudStoreSync(
  app: FastifyInstance,
  env: CloudStoreEnv,
  logger?: CloudStoreLogger,
  remote?: OsStoreRemote,
): CloudStoreSync | null {
  if (!remote && !cloudStoreEnabled(env)) return null;
  const port =
    remote ??
    supabaseOsStoreRemote(
      createDatabaseClients({
        url: env.SUPABASE_URL,
        anonKey: env.SUPABASE_ANON_KEY,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      }).service,
    );
  osStore.setDurableBackend("cloud");
  const sync = new CloudStoreSync(port, logger);

  app.addHook("onRequest", async () => {
    try {
      await sync.pull();
    } catch (error) {
      // Serve from memory; the flush below still refuses to report a lost write.
      logger?.warn("store_cloud_pull_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    if (!osStore.isDirty()) return payload;
    try {
      await sync.flush();
      return payload;
    } catch (error) {
      logger?.warn("store_cloud_flush_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      reply.code(503);
      reply.header("content-type", "application/json; charset=utf-8");
      return JSON.stringify({
        error: {
          code: "INTEGRATION_ERROR",
          message: "The change could not be saved. Try again.",
        },
      });
    }
  });

  return sync;
}
