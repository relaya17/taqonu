/**
 * registration-store.ts — Persistent SQLite backing store for Control Agent Registrations.
 *
 * Architecture contract:
 * - Uses Node 22 built-in `node:sqlite` — no external dependency.
 *   Engine requirement: `"node": ">=22"` (enforced in package.json).
 * - Database file location:
 *     CONTROL_PLANE_DB_PATH env var  (production — set to a persistent volume path)
 *     ./control-plane-registrations.db  (default — relative to process.cwd())
 *   Control Plane is NOT a serverless function; there is NO /tmp fallback.
 * - DB is opened exactly once per process via openRegistrationStore().
 *   Subsequent calls return the cached singleton.
 * - All public functions are synchronous (DatabaseSync). Control Plane is
 *   single-process; async wrappers are not needed.
 * - Idempotency is enforced at the DB level via PRIMARY KEY on idempotency_key.
 *   INSERT OR IGNORE prevents duplicates without races (Node is single-threaded).
 *
 * SQLite = persistent source of truth.
 * The in-process Map in agent-registry.ts is a startup-hydrated read-cache only.
 * GET and LIST always read from SQLite.
 *
 * Failure semantics:
 * - If the DB cannot be opened at startup: throw immediately — process must not
 *   silently fall back to an empty in-memory registry (false "unregistered").
 * - If a write fails: throw — the caller returns HTTP 500.
 * - If a read fails: throw — the caller returns HTTP 500.
 * - Malformed rows: throw during deserialization — never silently swallowed.
 *
 * Schema (one migration, applied via CREATE TABLE IF NOT EXISTS — idempotent):
 *
 *   control_agent_registrations
 *     idempotency_key     TEXT PRIMARY KEY NOT NULL   — deduplication key / UNIQUE
 *     agent_id            TEXT NOT NULL
 *     registration_source TEXT NOT NULL
 *     owner_id            TEXT                        — nullable
 *     registered_at       TEXT NOT NULL               — ISO-8601
 *     registered_by       TEXT NOT NULL
 *     evidence            TEXT NOT NULL
 *     status              TEXT NOT NULL DEFAULT 'CONTROL_REGISTERED'
 *
 * GAP-PERSIST: agent registrations survive Control Plane restarts.
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  ControlAgentRegistration,
  ControlRegistrationSource,
  ControlRegistrationStatus,
  RegisterAgentInControlParams,
} from "./agent-registry.js";

// ── DB path resolution ──────────────────────────────────────────────────────

/**
 * Resolve the database file path.
 *
 * In production, set CONTROL_PLANE_DB_PATH to a path on a persistent volume
 * (e.g. /data/control-plane-registrations.db).
 * In development, the default places the file in process.cwd() (repo root).
 *
 * We never fall back to /tmp — Control Plane is a long-running process, not
 * a serverless function; /tmp is not guaranteed to persist between requests.
 */
function resolveDbPath(): string {
  const env = process.env["CONTROL_PLANE_DB_PATH"];
  if (env && env.trim().length > 0) return env.trim();
  return resolve(process.cwd(), "control-plane-registrations.db");
}

// ── Singleton connection ────────────────────────────────────────────────────

let _db: DatabaseSync | null = null;
let _insertStmt: StatementSync | null = null;
let _selectByKeyStmt: StatementSync | null = null;
let _selectAllStmt: StatementSync | null = null;

/**
 * Open (or return) the singleton DB connection.
 *
 * Called at most once per process from openRegistrationStore().
 * Throws if the path is not writable — do not catch and continue.
 */
function getDb(): DatabaseSync {
  if (_db) return _db;

  const path = resolveDbPath();

  // Ensure the directory exists. Throws if the path is unreachable.
  const dir = dirname(path);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }

  // DatabaseSync throws if the file cannot be created/opened.
  const db = new DatabaseSync(path);

  // One-time schema initialization — idempotent, safe on re-start.
  // CREATE TABLE IF NOT EXISTS never destroys existing data.
  db.exec(`
    CREATE TABLE IF NOT EXISTS control_agent_registrations (
      idempotency_key     TEXT PRIMARY KEY NOT NULL,
      agent_id            TEXT NOT NULL,
      registration_source TEXT NOT NULL,
      owner_id            TEXT,
      registered_at       TEXT NOT NULL,
      registered_by       TEXT NOT NULL,
      evidence            TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'CONTROL_REGISTERED'
    );

    CREATE INDEX IF NOT EXISTS idx_car_agent_id
      ON control_agent_registrations(agent_id);
  `);

  // Pre-compile statements once.
  _insertStmt = db.prepare(`
    INSERT OR IGNORE INTO control_agent_registrations
      (idempotency_key, agent_id, registration_source, owner_id,
       registered_at, registered_by, evidence, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  _selectByKeyStmt = db.prepare(`
    SELECT * FROM control_agent_registrations
    WHERE idempotency_key = ?
  `);

  _selectAllStmt = db.prepare(`
    SELECT * FROM control_agent_registrations
    ORDER BY registered_at ASC
  `);

  _db = db;
  return db;
}

// ── Row → domain type ───────────────────────────────────────────────────────

function rowToRegistration(row: unknown): ControlAgentRegistration {
  // SQLite rows come back as plain objects; validate required fields.
  if (row === null || typeof row !== "object") {
    throw new Error("registration-store: unexpected null/non-object row from SQLite");
  }
  const r = row as Record<string, unknown>;

  const idempotencyKey = r["idempotency_key"];
  const agentId = r["agent_id"];
  const registrationSource = r["registration_source"];
  const registeredAt = r["registered_at"];
  const registeredBy = r["registered_by"];
  const evidence = r["evidence"];
  const status = r["status"];

  if (
    typeof idempotencyKey !== "string" ||
    typeof agentId !== "string" ||
    typeof registrationSource !== "string" ||
    typeof registeredAt !== "string" ||
    typeof registeredBy !== "string" ||
    typeof evidence !== "string" ||
    typeof status !== "string"
  ) {
    throw new Error(
      `registration-store: malformed row — missing required string fields: ${JSON.stringify(r)}`
    );
  }

  return {
    agentId,
    registrationSource: registrationSource as ControlRegistrationSource,
    ownerId: typeof r["owner_id"] === "string" ? r["owner_id"] : null,
    registeredAt,
    registeredBy,
    evidence,
    status: status as ControlRegistrationStatus,
    idempotencyKey,
  };
}

// ── Public store API ────────────────────────────────────────────────────────

/**
 * Initialize the DB and return all persisted registrations.
 *
 * Must be called at process startup (before any HTTP routes are served)
 * so that agent-registry.ts can hydrate its in-process cache.
 *
 * Throws if the DB cannot be opened — caller must not swallow this.
 * Safe to call multiple times (idempotent after first call).
 */
export function openRegistrationStore(): readonly ControlAgentRegistration[] {
  const db = getDb(); // throws if DB cannot be opened
  const stmt = _selectAllStmt ?? db.prepare(
    "SELECT * FROM control_agent_registrations ORDER BY registered_at ASC"
  );
  const rows = stmt.all() as unknown[];
  return rows.map(rowToRegistration); // throws if any row is malformed
}

/**
 * Persist a new registration.
 *
 * INSERT OR IGNORE: if idempotency_key already exists, the row is unchanged
 * and the existing record is returned (same semantics as the old Map).
 *
 * Throws if SQLite write fails — never silently falls back to in-memory.
 */
export function persistRegistration(
  params: RegisterAgentInControlParams & { readonly idempotencyKey: string },
): ControlAgentRegistration {
  const db = getDb();
  const ownerId = params.ownerId ?? null;
  const now = new Date().toISOString();

  const insertStmt = _insertStmt ?? db.prepare(`
    INSERT OR IGNORE INTO control_agent_registrations
      (idempotency_key, agent_id, registration_source, owner_id,
       registered_at, registered_by, evidence, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Throws on DB error (disk full, locked, etc.).
  insertStmt.run(
    params.idempotencyKey,
    params.agentId,
    params.registrationSource,
    ownerId,
    now,
    params.registeredBy,
    params.evidence,
    "CONTROL_REGISTERED",
  );

  // Always read back from DB — INSERT OR IGNORE may have left a pre-existing row
  // with an earlier registeredAt; we must return what is actually stored.
  const selectStmt = _selectByKeyStmt ?? db.prepare(
    "SELECT * FROM control_agent_registrations WHERE idempotency_key = ?"
  );
  const row = selectStmt.get(params.idempotencyKey);

  if (row === undefined || row === null) {
    // Should never happen: INSERT OR IGNORE guarantees a row exists.
    throw new Error(
      `registration-store: failed to read back record for idempotency key "${params.idempotencyKey}"`
    );
  }

  return rowToRegistration(row);
}

/**
 * Read one registration by idempotency key directly from SQLite.
 * Returns undefined when the key does not exist.
 * Throws on DB error.
 */
export function loadRegistrationByKey(
  idempotencyKey: string,
): ControlAgentRegistration | undefined {
  const db = getDb();
  const stmt = _selectByKeyStmt ?? db.prepare(
    "SELECT * FROM control_agent_registrations WHERE idempotency_key = ?"
  );
  const row = stmt.get(idempotencyKey);
  return row !== undefined && row !== null ? rowToRegistration(row) : undefined;
}

/**
 * Return all registrations from SQLite — the persistent source of truth.
 * Throws on DB error.
 */
export function loadAllRegistrations(): readonly ControlAgentRegistration[] {
  const db = getDb();
  const stmt = _selectAllStmt ?? db.prepare(
    "SELECT * FROM control_agent_registrations ORDER BY registered_at ASC"
  );
  const rows = stmt.all() as unknown[];
  return rows.map(rowToRegistration);
}

/**
 * Close the DB connection gracefully.
 * Call from process SIGTERM/SIGINT handler in server.ts.
 * Safe to call if the DB was never opened.
 */
export function closeRegistrationStore(): void {
  if (_db) {
    _db.close();
    _db = null;
    _insertStmt = null;
    _selectByKeyStmt = null;
    _selectAllStmt = null;
  }
}

/**
 * Delete all rows — for tests ONLY.
 * Never call in production code.
 */
export function clearRegistrationStoreForTests(): void {
  const db = getDb();
  db.exec("DELETE FROM control_agent_registrations");
}

/**
 * Close and reset the DB singleton — for tests that need a fresh DB per test.
 * Never call in production code.
 */
export function closeRegistrationStoreForTests(): void {
  closeRegistrationStore();
}
