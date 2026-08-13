import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { detectAdrConflicts, detectProductionSignals } from "../index.js";

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("production signals", () => {
  it("detects health and logging signals", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-prod-"));
    temps.push(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p" }));
    writeFileSync(
      join(dir, "src", "server.ts"),
      `import pino from "pino";\napp.get("/health", () => "ok");\n`,
    );
    const signals = detectProductionSignals(dir);
    expect(signals.find((s) => s.id === "prod-logging")?.present).toBe(true);
    expect(signals.find((s) => s.id === "prod-health")?.present).toBe(true);
  });
});

describe("ADR conflicts", () => {
  it("flags payment drift against ADR mentioning payment", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-adr-"));
    temps.push(dir);
    mkdirSync(join(dir, "docs", "adr"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p" }));
    writeFileSync(
      join(dir, "docs", "adr", "ADR-021-payments.md"),
      "# Payment must charge before confirmation email.\nWebhook retries must stay idempotent.\n",
    );
    writeFileSync(join(dir, "src.ts"), "export const x = 1;\n");
    const conflicts = detectAdrConflicts(dir, [
      {
        flowId: "POST /api/bookings",
        method: "POST",
        path: "/api/bookings",
        beforeSteps: ["charge payment", "send confirmation"],
        afterSteps: ["send confirmation", "charge payment"],
        kind: "STEP_ORDER_CHANGED",
        title: "Behavioral regression: payment ordering",
        detail: "Payment/charge moved relative to confirmation",
        claim: "INFERRED",
        riskBand: "HIGH",
      },
    ]);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]?.matchedTerms.length).toBeGreaterThan(0);
  });
});
