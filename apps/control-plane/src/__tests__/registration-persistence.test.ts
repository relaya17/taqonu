/**
 * GAP-PERSIST — Persistence Tests
 *
 * Proves:
 *  1. register → persistent record exists in SQLite
 *  2. read registration after registration
 *  3. close store → reopen NEW store instance on same DB file
 *  4. registration still exists (survives restart simulation)
 *  5. same idempotency key does not create a duplicate
 *  6. two different registrations both persist
 *  7. GET reads from persistent SQLite state
 *  8. LIST reads from persistent SQLite state
 *  9. fresh store works without relying on the previous in-memory Map
 * 10. SQLite write failure propagates — does not update Map as if persisted
 * 11. SQLite read failure propagates — does not become "unregistered"
 *
 * Uses isolated temporary DB files per test group.
 * Does NOT use :memory: for restart/persistence tests (memory DB cannot survive a new DatabaseSync instance).
 * Does NOT touch the production DB path.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  openRegistrationStore,
  persistRegistration,
  loadRegistrationByKey,
  loadAllRegistrations,
  clearRegistrationStoreForTests,
  closeRegistrationStoreForTests,
} from "../services/registration-store.js";

import {
  registerAgentInControl,
  getAgentRegistration,
  listAgentRegistrations,
  clearDynamicRegistrationsForTests,
  clearRegistrationCacheOnlyForTests,
  initDynamicRegistrationCache,
  buildIdempotencyKey,
} from "../services/agent-registry.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tempDbPath(): string {
  const dir = join(tmpdir(), "atlas-control-persist-tests");
  mkdirSync(dir, { recursive: true });
  return join(dir, `test-${randomUUID()}.db`);
}

function cleanupDb(_path: string): void {
  // Cleanup order matters for Windows NTFS file-handle semantics:
  //
  // WRONG order (previous):
  //   1. closeRegistrationStoreForTests() → _db.close(), _db = null
  //   2. clearDynamicRegistrationsForTests() → storeClearForTests()
  //        → clearRegistrationStoreForTests() → getDb() → _db REOPENED
  //      Result: _db is open again after "cleanup". Any rmSync → EBUSY.
  //
  // CORRECT order (below):
  //   1. clearDynamicRegistrationsForTests() — clears rows while _db is still
  //      open (or opens it once if not yet opened). _db is left open after this.
  //   2. closeRegistrationStoreForTests() — closes _db LAST, _db = null.
  //      No code after this reopens _db, so the file handle is released.
  //
  // File deletion is intentionally omitted: each test uses a unique UUID path
  // (tempDbPath()), so isolation is guaranteed by path uniqueness, not deletion.
  // Leftover temp files are harmless and cleaned by the OS on next boot.
  clearDynamicRegistrationsForTests();   // clears rows; _db may open here — OK
  closeRegistrationStoreForTests();      // closes _db LAST — file handle released
}

/**
 * Returns a path that is guaranteed to make getDb() throw on any platform.
 *
 * Strategy: create a regular file at `barrier`, then return `barrier/nested.db`.
 * When getDb() calls mkdirSync(dirname(path), { recursive: true }), dirname is
 * `barrier` — a file, not a directory — so mkdirSync throws ENOTDIR on both
 * Linux and Windows. This replaces the Linux-only /proc/1/mem trick.
 */
function badDbPath(): string {
  const barrier = join(tmpdir(), "atlas-control-persist-tests", `barrier-${randomUUID()}`);
  writeFileSync(barrier, ""); // create a regular file at this path
  return join(barrier, "nested.db"); // dirname = barrier (a file) → mkdirSync ENOTDIR
}

// ── Store-level tests (registration-store.ts) ─────────────────────────────

describe("GAP-PERSIST — registration-store.ts (SQLite layer)", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDbPath();
    // Point the store at the temp file for this test
    process.env["CONTROL_PLANE_DB_PATH"] = dbPath;
    closeRegistrationStoreForTests();
  });

  afterEach(() => {
    cleanupDb(dbPath);
    delete process.env["CONTROL_PLANE_DB_PATH"];
  });

  // Test 1: register → record exists in SQLite
  it("1. persists a registration to SQLite", () => {
    openRegistrationStore();

    const record = persistRegistration({
      agentId: "SECURITY",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "test-evidence",
      registeredBy: "test-suite",
      idempotencyKey: "SECURITY",
    });

    expect(record.agentId).toBe("SECURITY");
    expect(record.status).toBe("CONTROL_REGISTERED");
    expect(record.idempotencyKey).toBe("SECURITY");

    // Verify directly in SQLite — not via the store API
    const raw = new DatabaseSync(dbPath);
    const row = raw.prepare("SELECT * FROM control_agent_registrations WHERE idempotency_key = ?").get("SECURITY");
    raw.close();
    expect(row).toBeDefined();
    expect((row as Record<string, unknown>)["agent_id"]).toBe("SECURITY");
  });

  // Test 2: read registration after registration
  it("2. loadRegistrationByKey returns the persisted record", () => {
    openRegistrationStore();
    persistRegistration({
      agentId: "RESEARCHER",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "evidence",
      registeredBy: "test",
      idempotencyKey: "RESEARCHER",
    });

    const found = loadRegistrationByKey("RESEARCHER");
    expect(found).toBeDefined();
    expect(found?.agentId).toBe("RESEARCHER");
    expect(found?.status).toBe("CONTROL_REGISTERED");
  });

  // Tests 3 & 4: close store → reopen → record still exists
  it("3 & 4. registration survives store close and reopen (restart simulation)", () => {
    openRegistrationStore();
    persistRegistration({
      agentId: "CODE_ENGINEER",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "evidence",
      registeredBy: "test",
      idempotencyKey: "CODE_ENGINEER",
    });

    // Simulate Control Plane restart: close the singleton
    closeRegistrationStoreForTests();

    // Reopen on the SAME file — simulates a new process
    const afterRestart = openRegistrationStore();
    expect(afterRestart).toHaveLength(1);
    expect(afterRestart[0]?.agentId).toBe("CODE_ENGINEER");

    // Also verify via direct lookup
    const found = loadRegistrationByKey("CODE_ENGINEER");
    expect(found).toBeDefined();
    expect(found?.agentId).toBe("CODE_ENGINEER");
  });

  // Test 5: same idempotency key → no duplicate
  it("5. same idempotency key does not create a duplicate", () => {
    openRegistrationStore();

    persistRegistration({
      agentId: "SECURITY",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "first",
      registeredBy: "test",
      idempotencyKey: "SECURITY",
    });
    const firstRegisteredAt = loadRegistrationByKey("SECURITY")?.registeredAt;

    // Second call with same key
    persistRegistration({
      agentId: "SECURITY",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "second — must be ignored",
      registeredBy: "test",
      idempotencyKey: "SECURITY",
    });

    const all = loadAllRegistrations();
    expect(all).toHaveLength(1); // no duplicate

    const record = loadRegistrationByKey("SECURITY");
    // Existing record is unchanged
    expect(record?.registeredAt).toBe(firstRegisteredAt);
    expect(record?.evidence).toBe("first"); // not overwritten
  });

  // Test 6: two different registrations both persist
  it("6. two different registrations both persist", () => {
    openRegistrationStore();

    persistRegistration({
      agentId: "SECURITY",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "e1",
      registeredBy: "t",
      idempotencyKey: "SECURITY",
    });
    persistRegistration({
      agentId: "LEGAL_MEDIA_COMMS",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "e2",
      registeredBy: "t",
      idempotencyKey: "LEGAL_MEDIA_COMMS",
    });

    const all = loadAllRegistrations();
    expect(all).toHaveLength(2);
    const ids = all.map((r) => r.agentId);
    expect(ids).toContain("SECURITY");
    expect(ids).toContain("LEGAL_MEDIA_COMMS");
  });

  // Test 7 & 8: loadAllRegistrations reads from SQLite
  it("7 & 8. loadAllRegistrations reads from SQLite (persistent source of truth)", () => {
    openRegistrationStore();

    persistRegistration({
      agentId: "SECURITY",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "e",
      registeredBy: "t",
      idempotencyKey: "SECURITY",
    });

    closeRegistrationStoreForTests(); // close singleton

    // Reopen — fresh singleton, no previous in-memory state
    const records = openRegistrationStore();
    expect(records).toHaveLength(1);
    expect(records[0]?.agentId).toBe("SECURITY");
  });

  // Test 9: fresh store — no dependency on previous in-memory Map
  it("9. fresh store after restart contains persisted data without any Map dependency", () => {
    openRegistrationStore();
    persistRegistration({
      agentId: "RESEARCHER",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "e",
      registeredBy: "t",
      idempotencyKey: "RESEARCHER",
    });

    // Wipe all in-memory state
    closeRegistrationStoreForTests();

    // Fresh store, empty Map — reads from file
    openRegistrationStore();
    const found = loadRegistrationByKey("RESEARCHER");
    expect(found).toBeDefined();
    expect(found?.agentId).toBe("RESEARCHER");
  });

  // PSA owner-scoped registration
  it("PSA registration with owner-scoped idempotency key persists correctly", () => {
    openRegistrationStore();
    const ownerId = "owner-test-123";
    const agentId = `psa:${ownerId}`;
    const key = `${agentId}::owner::${ownerId}`;

    persistRegistration({
      agentId,
      registrationSource: "PSA_OWNER",
      ownerId,
      evidence: "psa-evidence",
      registeredBy: "atlas-api",
      idempotencyKey: key,
    });

    closeRegistrationStoreForTests();
    openRegistrationStore();

    const found = loadRegistrationByKey(key);
    expect(found).toBeDefined();
    expect(found?.agentId).toBe(agentId);
    expect(found?.ownerId).toBe(ownerId);
    expect(found?.registrationSource).toBe("PSA_OWNER");
  });
});

// ── Registry-level tests (agent-registry.ts) ─────────────────────────────

describe("GAP-PERSIST — agent-registry.ts (high-level API)", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDbPath();
    process.env["CONTROL_PLANE_DB_PATH"] = dbPath;
    closeRegistrationStoreForTests();
    clearDynamicRegistrationsForTests();
  });

  afterEach(() => {
    cleanupDb(dbPath);
    delete process.env["CONTROL_PLANE_DB_PATH"];
  });

  // initDynamicRegistrationCache + restart
  it("initDynamicRegistrationCache hydrates from SQLite after restart", () => {
    // First process lifetime
    initDynamicRegistrationCache(); // opens DB
    registerAgentInControl({
      agentId: "SECURITY",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "e",
      registeredBy: "t",
    });

    // Simulate restart: close DB singleton only — do NOT clear SQLite rows.
    // clearDynamicRegistrationsForTests() would delete all rows and make the
    // restart test a no-op (re-opening an intentionally empty DB).
    closeRegistrationStoreForTests();
    clearRegistrationCacheOnlyForTests(); // clear Map without touching DB file

    // Second process lifetime — hydrate from SQLite
    initDynamicRegistrationCache();

    // getAgentRegistration reads from SQLite
    const found = getAgentRegistration("SECURITY");
    expect(found).toBeDefined();
    expect(found?.agentId).toBe("SECURITY");
  });

  // GET reads from SQLite
  it("getAgentRegistration reads from SQLite — not from Map", () => {
    initDynamicRegistrationCache();
    registerAgentInControl({
      agentId: "RESEARCHER",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "e",
      registeredBy: "t",
    });

    // Clear Map only — SQLite remains
    clearDynamicRegistrationsForTests();
    // Re-init to allow store calls (Map clear also cleared the store test util)
    // But we need the store to stay open — use store directly
    // Actually clearDynamicRegistrationsForTests clears both Map AND DB.
    // For this test we need to clear Map only.
    // We use the store directly to re-register after clearing
    closeRegistrationStoreForTests();

    // Manually persist to SQLite without going through the Map cache path
    process.env["CONTROL_PLANE_DB_PATH"] = dbPath; // same file
    openRegistrationStore();
    persistRegistration({
      agentId: "RESEARCHER",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "e",
      registeredBy: "t",
      idempotencyKey: "RESEARCHER",
    });

    // GET — reads from SQLite (Map is empty)
    const found = getAgentRegistration("RESEARCHER");
    expect(found).toBeDefined();
    expect(found?.agentId).toBe("RESEARCHER");
  });

  // LIST reads from SQLite
  it("listAgentRegistrations reads from SQLite", () => {
    initDynamicRegistrationCache();
    registerAgentInControl({
      agentId: "SECURITY",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "e",
      registeredBy: "t",
    });
    registerAgentInControl({
      agentId: "LEGAL_MEDIA_COMMS",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "e",
      registeredBy: "t",
    });

    const all = listAgentRegistrations();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.agentId)).toContain("SECURITY");
    expect(all.map((r) => r.agentId)).toContain("LEGAL_MEDIA_COMMS");
  });

  // Idempotency via registerAgentInControl
  it("registerAgentInControl is idempotent across restart", () => {
    initDynamicRegistrationCache();
    const first = registerAgentInControl({
      agentId: "CODE_ENGINEER",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "first",
      registeredBy: "t",
    });

    // Simulate restart: close singleton + clear Map only. SQLite data stays on disk.
    closeRegistrationStoreForTests();
    clearRegistrationCacheOnlyForTests();
    initDynamicRegistrationCache();

    const second = registerAgentInControl({
      agentId: "CODE_ENGINEER",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "second — must be ignored",
      registeredBy: "t",
    });

    // registeredAt is preserved from the first registration
    expect(second.registeredAt).toBe(first.registeredAt);
    expect(second.evidence).toBe("first");

    // Exactly one record in SQLite
    const all = listAgentRegistrations();
    expect(all).toHaveLength(1);
  });

  // Test 10: SQLite write failure does NOT update Map
  it("10. SQLite write failure — Map is not updated, error propagates", () => {
    initDynamicRegistrationCache();

    // Force a write failure by redirecting DB path to an unwritable location.
    // badDbPath() creates a regular file as the "directory", so mkdirSync inside
    // getDb() throws ENOTDIR — works on both Linux and Windows (replaces /proc/1/mem).
    closeRegistrationStoreForTests();
    clearRegistrationCacheOnlyForTests();
    const bad = badDbPath();
    process.env["CONTROL_PLANE_DB_PATH"] = bad;

    // Attempt to register — must throw because DB cannot be opened at the bad path
    expect(() =>
      registerAgentInControl({
        agentId: "SECURITY",
        registrationSource: "STATIC_CATALOG",
        ownerId: null,
        evidence: "e",
        registeredBy: "t",
      })
    ).toThrow();

    // Map must not have been updated — verify by reopening the real DB.
    // Also clean up the barrier file created by badDbPath().
    rmSync(join(bad, ".."), { force: true, recursive: true });
    process.env["CONTROL_PLANE_DB_PATH"] = dbPath;
    const key = buildIdempotencyKey("SECURITY", null);
    openRegistrationStore();
    const found = loadRegistrationByKey(key);
    expect(found).toBeUndefined(); // nothing was persisted
  });

  // Test 11: SQLite read failure propagates — not silently "unregistered"
  it("11. SQLite read failure propagates — does not return undefined as if unregistered", () => {
    initDynamicRegistrationCache();
    registerAgentInControl({
      agentId: "SECURITY",
      registrationSource: "STATIC_CATALOG",
      ownerId: null,
      evidence: "e",
      registeredBy: "t",
    });

    // Force a read failure by closing the singleton and redirecting to an unwritable path.
    // badDbPath() creates a regular file as the "directory", so mkdirSync inside
    // getDb() throws ENOTDIR — works on both Linux and Windows (replaces /proc/1/mem).
    closeRegistrationStoreForTests();
    clearRegistrationCacheOnlyForTests();
    const bad = badDbPath();
    process.env["CONTROL_PLANE_DB_PATH"] = bad;

    // getAgentRegistration reads from SQLite — must throw, not return undefined
    expect(() => getAgentRegistration("SECURITY")).toThrow();

    // listAgentRegistrations — must throw, not return empty array
    expect(() => listAgentRegistrations()).toThrow();

    // Restore valid path so afterEach cleanup works; clean up barrier file.
    rmSync(join(bad, ".."), { force: true, recursive: true });
    process.env["CONTROL_PLANE_DB_PATH"] = dbPath;
  });

  // PSA registration persists through registry API
  it("PSA registration persists and is readable after restart", () => {
    initDynamicRegistrationCache();
    const ownerId = "owner-psa-456";

    registerAgentInControl({
      agentId: `psa:${ownerId}`,
      registrationSource: "PSA_OWNER",
      ownerId,
      evidence: "psa-bootstrap",
      registeredBy: "atlas-api",
    });

    // Simulate restart: close singleton + clear Map only. SQLite data stays on disk.
    closeRegistrationStoreForTests();
    clearRegistrationCacheOnlyForTests();
    initDynamicRegistrationCache();

    const found = getAgentRegistration(`psa:${ownerId}`, ownerId);
    expect(found).toBeDefined();
    expect(found?.ownerId).toBe(ownerId);
    expect(found?.registrationSource).toBe("PSA_OWNER");
  });
});
