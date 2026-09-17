import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Task 7 -- Runtime Kill Switch Control: persistence + audit for
 * `OsStore.{get,set,clear}KillSwitchOverride`. Uses a REAL on-disk
 * `store.json` (no `ATLAS_SKIP_STORE_PERSIST`) so the "survives restart"
 * requirement is actually exercised -- `unloadForTests()` forces the next
 * `ensureLoaded()` to re-read from disk, simulating an API process
 * restart, exactly as its own doc comment describes.
 */
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-os-store-kill-switch-test-"));
const storePath = join(tmpDir, "store.json");
process.env.ATLAS_STORE_PATH = storePath;
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const { osStore } = await import("./os-store.js");

describe("OsStore kill switch runtime overrides (Task 7)", () => {
  afterEach(() => {
    osStore.unloadForTests();
    for (const category of ["agentDispatch", "payments", "webhooksInbound"]) {
      osStore.clearKillSwitchOverride(category, "test-cleanup", "test cleanup");
    }
    osStore.unloadForTests();
  });

  it("setKillSwitchOverride persists the record and survives a simulated restart", () => {
    const record = osStore.setKillSwitchOverride("payments", "owner-1", "suspicious payout spike");
    expect(record).toMatchObject({ reason: "suspicious payout spike", setBy: "owner-1" });
    expect(typeof record.setAt).toBe("string");

    // Simulate a process restart: drop in-memory state, force reload from disk.
    osStore.unloadForTests();
    const reloaded = osStore.getKillSwitchOverrides();
    expect(reloaded.payments).toMatchObject({ reason: "suspicious payout spike", setBy: "owner-1" });
  });

  it("clearKillSwitchOverride removes the record and the removal survives a simulated restart", () => {
    osStore.setKillSwitchOverride("payments", "owner-1", "temp");
    const result = osStore.clearKillSwitchOverride("payments", "owner-1", "resolved");
    expect(result.cleared).toBe(true);

    osStore.unloadForTests();
    const reloaded = osStore.getKillSwitchOverrides();
    expect(reloaded.payments).toBeUndefined();
  });

  it("clearing a category with no existing override reports cleared:false and does not write a spurious persist", () => {
    const result = osStore.clearKillSwitchOverride("aiWorkers", "owner-1", "no-op clear");
    expect(result.cleared).toBe(false);
  });

  it("appends an audit entry with actor/category/reason/previous/next on activation, readable via listAudit()", () => {
    osStore.setKillSwitchOverride("webhooksInbound", "owner-2", "compromised webhook secret");
    const entries = osStore.listAudit();
    // The audit ring is real, on-disk, and shared across every test in this
    // file (persistence is intentionally NOT skipped here -- see the file
    // doc comment), so it can already contain matching-type entries from
    // earlier tests. Take the MOST RECENT match, not the first.
    const entry = [...entries].reverse().find((e) => e.type === "kill_switch.runtime_override.activated");
    expect(entry).toMatchObject({
      type: "kill_switch.runtime_override.activated",
      category: "webhooksInbound",
      actorId: "owner-2",
      reason: "compromised webhook secret",
      previous: null,
    });
    expect(entry?.next).toMatchObject({ reason: "compromised webhook secret", setBy: "owner-2" });
  });

  it("appends an audit entry with the previous record on clear, readable via listAudit()", () => {
    osStore.setKillSwitchOverride("webhooksInbound", "owner-2", "compromised webhook secret");
    osStore.clearKillSwitchOverride("webhooksInbound", "owner-3", "secret rotated, resolved");
    const entries = osStore.listAudit();
    // Same reasoning as above: take the most recent matching entry, since
    // this file's own afterEach cleanup (and other tests) also append
    // "cleared" entries to the same real, persisted audit ring.
    const entry = [...entries].reverse().find((e) => e.type === "kill_switch.runtime_override.cleared");
    expect(entry).toMatchObject({
      type: "kill_switch.runtime_override.cleared",
      category: "webhooksInbound",
      actorId: "owner-3",
      reason: "secret rotated, resolved",
      next: null,
    });
    expect(entry?.previous).toMatchObject({ reason: "compromised webhook secret", setBy: "owner-2" });
  });

  it("backward compatibility: a store.json written before this field existed loads cleanly with an empty override map", () => {
    osStore.setWorkspaceRoot("legacy-project", "/tmp/legacy");
    osStore.unloadForTests();

    // Simulate a pre-Task-7 persisted store.json: read what's on disk and
    // strip the new field entirely, as if it had never existed.
    const raw = JSON.parse(readFileSync(storePath, "utf8"));
    delete raw.killSwitchOverrides;
    writeFileSync(storePath, JSON.stringify(raw), "utf8");

    osStore.unloadForTests();
    expect(osStore.getKillSwitchOverrides()).toEqual({});
    // And the pre-existing field this store.json DID have is unaffected.
    expect(osStore.getWorkspaceRoot("legacy-project")).toBe("/tmp/legacy");
  });
});
