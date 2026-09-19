import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { collectP1TruthSignals } from "./p1-signals.js";

vi.mock("../security/scan.js", () => ({
  runSentinelScan: () => {
    throw new Error("GET Observer must not live-scan Sentinel");
  },
}));

describe("collectP1TruthSignals", () => {
  it("does not run a live Sentinel scan when last-scan is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-p1-noscan-"));
    const signals = collectP1TruthSignals(root, []);
    expect(signals.sentinelPosture).toBe("NOT_RUN");
    expect(signals.sentinelSecrets).toBe(0);
  });
});
