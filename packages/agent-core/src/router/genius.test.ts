import { describe, expect, it } from "vitest";
import type { ModelRollingStats } from "../providers/llm.js";
import { geniusRoute } from "./genius.js";

/** Debugger path → initial `modelHint` is `strong` (not multi+human / vision / local). */
const STRONG_INTENT = "the app keeps crashing with a stack trace";
const VISION_INTENT = "review this figma screenshot for layout issues";
const LOCAL_INTENT = "keep this confidential, local only, air-gap notes";
const MULTI_HUMAN_INTENT = "we have an auth secret leak, is this a CVE?";
const CHEAP_INTENT = "asdkjhasdkjh random text with no keywords";

function rolling(
  model: string,
  sampleSize: number,
  avgCostUsd: number,
  errorRate: number,
): ModelRollingStats {
  return { model, sampleSize, avgCostUsd, avgLatencyMs: 0, errorRate };
}

/** Priced strong (`gpt-4o`) vs priced cheap (`gpt-4o-mini`) at >3x cost, both ≥3 samples. */
const COST_RATIO_DEMOTION_STATS: readonly ModelRollingStats[] = [
  rolling("gpt-4o", 3, 0.04, 0),
  rolling("gpt-4o-mini", 3, 0.01, 0),
];

const COST_RATIO_DEMOTION_REASON =
  "Cost-aware demotion: strong-tier avg cost/call ($0.0400) is over 3x cheap-tier avg ($0.0100) across the last 3 strong-tier calls → falling back to cheap";

/** Strong-tier error rate 75% with no cheap samples — error path only. */
const ERROR_RATE_DEMOTION_STATS: readonly ModelRollingStats[] = [
  rolling("gpt-4o", 4, 0.01, 0.75),
];

const ERROR_RATE_DEMOTION_REASON =
  "Cost-aware demotion: strong-tier error rate 75% over the last 4 calls exceeds 50% → falling back to cheap";

function injectStats(stats: readonly ModelRollingStats[]) {
  return { getModelStats: () => stats };
}

function hasDemotionHint(hints: readonly string[]): boolean {
  return hints.some((hint) => hint.includes("Cost-aware demotion"));
}

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

describe("geniusRoute strong-tier demotion (injected rolling stats)", () => {
  it("leaves a strong route as strong when there are no rolling stats", () => {
    const route = geniusRoute(STRONG_INTENT, injectStats([]));
    expect(route.modelHint).toBe("strong");
    expect(hasDemotionHint(route.hints)).toBe(false);
  });

  it("demotes strong to cheap when strong-tier avg cost exceeds 3x cheap-tier with enough samples", () => {
    const route = geniusRoute(STRONG_INTENT, injectStats(COST_RATIO_DEMOTION_STATS));
    expect(route.modelHint).toBe("cheap");
    expect(route.hints).toContain(COST_RATIO_DEMOTION_REASON);
  });

  it("demotes strong to cheap when strong-tier error rate exceeds 50%", () => {
    const route = geniusRoute(STRONG_INTENT, injectStats(ERROR_RATE_DEMOTION_STATS));
    expect(route.modelHint).toBe("cheap");
    expect(route.hints).toContain(ERROR_RATE_DEMOTION_REASON);
  });

  it("does not demote when strong-tier samples are below the trend minimum", () => {
    const route = geniusRoute(
      STRONG_INTENT,
      injectStats([
        rolling("gpt-4o", 2, 1.0, 1.0),
        rolling("gpt-4o-mini", 5, 0.01, 0),
      ]),
    );
    expect(route.modelHint).toBe("strong");
    expect(hasDemotionHint(route.hints)).toBe(false);
  });

  it("does not take the cost-ratio path when cheap-tier samples are below the trend minimum", () => {
    const route = geniusRoute(
      STRONG_INTENT,
      injectStats([
        rolling("gpt-4o", 3, 0.04, 0),
        rolling("gpt-4o-mini", 2, 0.01, 0),
      ]),
    );
    expect(route.modelHint).toBe("strong");
    expect(hasDemotionHint(route.hints)).toBe(false);
  });

  it("does not let unpriced models participate in cheap/strong aggregation", () => {
    const route = geniusRoute(
      STRONG_INTENT,
      injectStats([
        rolling("gpt-4o", 2, 0.04, 0),
        rolling("unknown-local-model", 10, 9.99, 1),
        rolling("gpt-4o-mini", 5, 0.01, 0),
      ]),
    );
    expect(route.modelHint).toBe("strong");
    expect(hasDemotionHint(route.hints)).toBe(false);
  });

  it("does not demote vision even when injected stats would demote strong", () => {
    const route = geniusRoute(VISION_INTENT, injectStats(COST_RATIO_DEMOTION_STATS));
    expect(route.modelHint).toBe("vision");
    expect(hasDemotionHint(route.hints)).toBe(false);
  });

  it("does not demote local even when injected stats would demote strong", () => {
    const route = geniusRoute(LOCAL_INTENT, injectStats(COST_RATIO_DEMOTION_STATS));
    expect(route.modelHint).toBe("local");
    expect(hasDemotionHint(route.hints)).toBe(false);
  });

  it("does not demote multi+human even when injected stats would demote strong", () => {
    const route = geniusRoute(MULTI_HUMAN_INTENT, injectStats(COST_RATIO_DEMOTION_STATS));
    expect(route.modelHint).toBe("multi+human");
    expect(hasDemotionHint(route.hints)).toBe(false);
  });

  it("does not enter the strong demotion path when the initial tier is cheap", () => {
    const route = geniusRoute(CHEAP_INTENT, injectStats(COST_RATIO_DEMOTION_STATS));
    expect(route.modelHint).toBe("cheap");
    expect(hasDemotionHint(route.hints)).toBe(false);
  });
});
