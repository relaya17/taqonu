import { beforeEach, describe, expect, it } from "vitest";
import { geniusRoute } from "./genius.js";
import {
  recordModelCall,
  resetModelCostTracker,
  type ModelRollingStats,
} from "../providers/llm.js";

describe("geniusRoute", () => {
  it("always includes ORCHESTRATOR", () => {
    expect(geniusRoute("hello").agentIds).toContain("ORCHESTRATOR");
  });

  it("routes security-flavored requests to SECURITY + JUDGE with multi+human hint", () => {
    const route = geniusRoute("we have an auth secret leak, is this a CVE?");
    expect(route.agentIds).toContain("SECURITY");
    expect(route.agentIds).toContain("JUDGE");
    expect(route.modelHint).toBe("multi+human");
  });

  it("routes accessibility requests to ACCESSIBILITY", () => {
    expect(geniusRoute("check wcag contrast and rtl screen reader support").agentIds).toContain(
      "ACCESSIBILITY",
    );
  });

  it("routes test/QA requests to QA and TEST_ENGINEER", () => {
    const route = geniusRoute("improve e2e test coverage and regression suite");
    expect(route.agentIds).toContain("QA");
    expect(route.agentIds).toContain("TEST_ENGINEER");
  });

  it("routes bug/crash requests to DEBUGGER", () => {
    expect(geniusRoute("the app keeps crashing with a stack trace").agentIds).toContain(
      "DEBUGGER",
    );
  });

  it("routes legal/media keywords (Hebrew + English) to LEGAL_MEDIA_COMMS + RESEARCHER + JUDGE", () => {
    const route = geniusRoute("צריך ייעוץ משפטי לגבי תקשורת ומדיה");
    expect(route.agentIds).toContain("LEGAL_MEDIA_COMMS");
    expect(route.agentIds).toContain("RESEARCHER");
    expect(route.agentIds).toContain("JUDGE");
  });

  it("routes build-intent requests to OMISSION_DETECTOR + ARCHITECT + SECURITY", () => {
    const route = geniusRoute("build a new saas app with payments");
    expect(route.agentIds).toContain("OMISSION_DETECTOR");
    expect(route.agentIds).toContain("ARCHITECT");
    expect(route.agentIds).toContain("SECURITY");
  });

  it("falls back to QA when nothing else matched, so there is always >= 1 specialist", () => {
    const route = geniusRoute("asdkjhasdkjh random text with no keywords");
    expect(route.agentIds.length).toBeGreaterThan(1);
    expect(route.agentIds).toContain("QA");
  });

  it("appends JUDGE once agent count exceeds 2, even without explicit security/code triggers", () => {
    const route = geniusRoute("architect review, ui/ux review, and qa regression coverage");
    expect(route.agentIds.filter((a) => a === "JUDGE")).toHaveLength(1);
  });

  it("uses vision hint for screenshot/figma requests (when not security-critical)", () => {
    const route = geniusRoute("review this figma screenshot for layout issues");
    expect(route.modelHint).toBe("vision");
  });
});

const DEBUGGER_REQUEST = "the app keeps crashing with a stack trace";
const STRONG_MODEL = "claude-sonnet-4-20250514"; // input $3/1M → "strong" price tier
const CHEAP_MODEL = "gpt-4o-mini"; // input $0.15/1M → "cheap" price tier

describe("geniusRoute — cost-aware demotion (wired to the real rolling tracker in providers/llm.ts)", () => {
  beforeEach(() => {
    resetModelCostTracker();
  });

  it("routes debugger-flavored requests to the strong tier by default (no cost trend recorded yet)", () => {
    const route = geniusRoute(DEBUGGER_REQUEST);
    expect(route.modelHint).toBe("strong");
  });

  it("demotes strong → cheap once strong-tier rolling avg cost exceeds 3x cheap-tier avg over enough samples", () => {
    for (let i = 0; i < 3; i++) {
      recordModelCall({ model: STRONG_MODEL, costUsd: 0.06, latencyMs: 800, ok: true, at: Date.now() });
      recordModelCall({ model: CHEAP_MODEL, costUsd: 0.001, latencyMs: 300, ok: true, at: Date.now() });
    }
    const route = geniusRoute(DEBUGGER_REQUEST);
    expect(route.modelHint).toBe("cheap");
    expect(route.hints.some((h) => h.includes("Cost-aware demotion"))).toBe(true);
  });

  it("does NOT demote when there aren't enough recent samples yet (avoids reacting to noise)", () => {
    recordModelCall({ model: STRONG_MODEL, costUsd: 0.5, latencyMs: 800, ok: true, at: Date.now() });
    recordModelCall({ model: CHEAP_MODEL, costUsd: 0.0001, latencyMs: 300, ok: true, at: Date.now() });
    const route = geniusRoute(DEBUGGER_REQUEST);
    expect(route.modelHint).toBe("strong");
  });

  it("does NOT demote when strong-tier cost is elevated but under the 3x threshold", () => {
    for (let i = 0; i < 3; i++) {
      recordModelCall({ model: STRONG_MODEL, costUsd: 0.002, latencyMs: 800, ok: true, at: Date.now() });
      recordModelCall({ model: CHEAP_MODEL, costUsd: 0.001, latencyMs: 300, ok: true, at: Date.now() });
    }
    const route = geniusRoute(DEBUGGER_REQUEST);
    expect(route.modelHint).toBe("strong");
  });

  it("demotes strong → cheap on a high recent error rate, independent of cost", () => {
    recordModelCall({ model: STRONG_MODEL, costUsd: 0.01, latencyMs: 800, ok: false, at: Date.now() });
    recordModelCall({ model: STRONG_MODEL, costUsd: 0.01, latencyMs: 800, ok: false, at: Date.now() });
    recordModelCall({ model: STRONG_MODEL, costUsd: 0.01, latencyMs: 800, ok: false, at: Date.now() });
    recordModelCall({ model: STRONG_MODEL, costUsd: 0.01, latencyMs: 800, ok: true, at: Date.now() });
    const route = geniusRoute(DEBUGGER_REQUEST);
    expect(route.modelHint).toBe("cheap");
    expect(route.hints.some((h) => h.includes("error rate"))).toBe(true);
  });

  it("never demotes multi+human (security-critical routing is risk-driven, not cost-driven)", () => {
    for (let i = 0; i < 5; i++) {
      recordModelCall({ model: STRONG_MODEL, costUsd: 1, latencyMs: 800, ok: true, at: Date.now() });
      recordModelCall({ model: CHEAP_MODEL, costUsd: 0.001, latencyMs: 300, ok: true, at: Date.now() });
    }
    const route = geniusRoute("we have an auth secret leak, is this a CVE?");
    expect(route.modelHint).toBe("multi+human");
  });

  it("accepts an injected getModelStats override so the decision can be tested without global tracker state", () => {
    const syntheticStats: readonly ModelRollingStats[] = [
      { model: STRONG_MODEL, avgCostUsd: 0.09, avgLatencyMs: 900, errorRate: 0, sampleSize: 4 },
      { model: CHEAP_MODEL, avgCostUsd: 0.001, avgLatencyMs: 250, errorRate: 0, sampleSize: 4 },
    ];
    const route = geniusRoute(DEBUGGER_REQUEST, { getModelStats: () => syntheticStats });
    expect(route.modelHint).toBe("cheap");
    // The real (empty) global tracker must not have been consulted/mutated.
    expect(geniusRoute(DEBUGGER_REQUEST).modelHint).toBe("strong");
  });
});
