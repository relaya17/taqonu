import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPlatformWatchdog } from "./platform-watchdog.js";
import { osStore } from "../store/os-store.js";

// Isolation gap fix: this previously left `ATLAS_STORE_PATH` unset, so
// `runPlatformWatchdog` read the REAL `.atlas/store.json` at the repo
// root via `osStore.ensureLoaded()` — the "flags missing projects" test
// below asserts `osStore.listProjects()` is effectively empty, which is
// only reliably true against a fresh, isolated store, not whatever real
// project data has accumulated in the repo's actual store file.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-platform-watchdog-test-"));

beforeAll(() => {
  process.env.ATLAS_SKIP_STORE_PERSIST = "1";
  process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
});

afterAll(() => {
  delete process.env.ATLAS_SKIP_STORE_PERSIST;
  delete process.env.ATLAS_STORE_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("platform watchdog", () => {
  afterEach(() => {
    osStore.resetBillingStateForTests();
  });

  it("flags missing projects and missing BYO as actionable alerts", () => {
    const report = runPlatformWatchdog({ tier: "free" });
    expect(report.platformVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(report.alerts.some((a) => a.code === "NO_PROJECTS" || a.code === "NO_WORKSPACE_ROOTS" || a.code === "BYO_CLOUD_DISCONNECTED")).toBe(
      true,
    );
    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.score).toBeGreaterThanOrEqual(0);
  });

  it("persists last watchdog timestamp in meta", () => {
    runPlatformWatchdog({ tier: "free" });
    const raw = osStore.getMeta("admin.watchdog.last");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { at: string; score: number };
    expect(parsed.at).toMatch(/^\d{4}-/);
    expect(typeof parsed.score).toBe("number");
  });
});
