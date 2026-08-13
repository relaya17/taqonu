import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";
import {
  diffFlows,
  parseAnnotatedFlows,
  runObserveCycle,
} from "./index.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlas-observer-"));
  temps.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { zod: "3" } }),
    "utf8",
  );
  return dir;
}

const goodFlow = [
  {
    id: "POST /api/bookings",
    method: "POST",
    path: "/api/bookings",
    steps: [
      { id: "validate-guest", label: "validate guest" },
      { id: "create-booking", label: "create booking" },
      { id: "charge-payment", label: "charge payment" },
      { id: "send-confirmation", label: "send confirmation" },
    ],
  },
];

const badFlow = [
  {
    id: "POST /api/bookings",
    method: "POST",
    path: "/api/bookings",
    steps: [
      { id: "validate-guest", label: "validate guest" },
      { id: "create-booking", label: "create booking" },
      { id: "send-confirmation", label: "send confirmation" },
      { id: "charge-payment", label: "charge payment" },
    ],
  },
];

describe("observer behavior diff", () => {
  it("flags payment-after-confirmation as HIGH inferred regression", () => {
    const diffs = diffFlows(goodFlow, badFlow);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.riskBand).toBe("HIGH");
    expect(diffs[0]?.claim).toBe("INFERRED");
  });
});

describe("annotated flows", () => {
  it("parses @atlas-flow markers", () => {
    const flows = parseAnnotatedFlows(
      `
// @atlas-flow POST /api/bookings
// @atlas-step validate guest
// @atlas-step create booking
`,
      "src/bookings.ts",
    );
    expect(flows).toHaveLength(1);
    expect(flows[0]?.steps).toHaveLength(2);
  });
});

describe("observe cycle", () => {
  it("baselines EXPECTED then detects behavioral drift with evidence + counters", () => {
    const root = tempWorkspace();
    const first = runObserveCycle({
      workspaceRoot: root,
      projectSlug: "demo",
      flows: goodFlow,
      persist: true,
      trigger: "manual",
    });
    expect(first.behaviorDiffs).toHaveLength(0);
    expect(first.expectedPromotedAt).toBeTruthy();
    expect(first.counters.cycles).toBe(1);
    expect(first.findings.some((f) => (f.evidenceRefs?.length ?? 0) > 0)).toBe(
      true,
    );

    const second = runObserveCycle({
      workspaceRoot: root,
      projectSlug: "demo",
      flows: badFlow,
      persist: true,
      trigger: "github_webhook",
    });
    expect(second.behaviorDiffs.some((d) => d.riskBand === "HIGH")).toBe(true);
    expect(second.counters.analyzed).toBeGreaterThanOrEqual(2);
    expect(second.counters.confirmedRegressions).toBeGreaterThanOrEqual(1);
    expect(second.counters.caughtBeforeProd).toBeGreaterThanOrEqual(1);
    expect(second.history.length).toBeGreaterThanOrEqual(1);
    const drift = second.findings.find((f) => f.id.includes("behavior-"));
    expect((drift?.evidenceRefs?.length ?? 0) >= 2).toBe(true);
  });
});
