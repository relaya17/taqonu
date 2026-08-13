import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runPlatformWatchdog } from "./platform-watchdog.js";
import { osStore } from "../store/os-store.js";

beforeAll(() => {
  process.env.ATLAS_SKIP_STORE_PERSIST = "1";
});

afterAll(() => {
  delete process.env.ATLAS_SKIP_STORE_PERSIST;
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
